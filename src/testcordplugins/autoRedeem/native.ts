/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * Main-process code: it runs through the plugin's native bridge (`entry.main` of plugin.json), never in the page. Every function gets the
 * engine's `host` as its first argument; `host.fetch` is the only way to the network (https, only the hosts declared in plugin.json with
 * `from: "main"`, every redirect checked) and `host.secret` is the only way to read the keys the person saved in the settings window.
 */

import { setTimeout as sleep } from "timers/promises";

import type { NativeFetchInit, NativeHostApi, NativeResponse } from "../../main/nativeHost";
import type { NativeCaptchaResponse, VoidSolverTaskResult } from "./types";

export { startNightyAltDetection, stopNightyAltDetection, waitForNightyGiftCode } from "./nightyAlts";

const NONECAP_SOLVES_URL = "https://api.nonecap.com/v1/solves";
const NOCAPTCHAAI_URL = "https://api.nocaptchaai.com";
const VOIDSOLVER_URL = "https://api.voidsolver.tech";
const MAX_RESPONSE_BYTES = 64 * 1024;
/**
 * Was 115 000 ms. The engine answers an error when a native call has not answered in 120 000 ms, and a request already on its way cannot be cancelled
 * (it ends by itself after the host's 12 s limit), so the solve stops earlier to always answer in time.
 */
const SOLVE_TIMEOUT_MS = 100_000;
/**
 * Was `wait=90`. `host.fetch` gives up on any one request after 12 s, so NoneCap is asked to hold the first answer for at most 10 s; the loop below
 * already polls while the solve is `pending` or `solving`, so a longer solve still completes.
 */
const NONECAP_WAIT_SECONDS = 10;
const WEBHOOK_HOSTS = ["discord.com", "discordapp.com"];
const activeSolves = new Set<AbortController>();

/** The names of the secrets this plugin declares in plugin.json (`secrets`). */
const CAPTCHA_KEY_SECRET: Record<string, string> = {
    nonecap: "noneCapApiKey",
    nocaptchaai: "noCaptchaAiApiKey",
    voidsolver: "voidSolverApiKey"
};
const VOIDSOLVER_PROXY_SECRET = "voidSolverProxy";
const WEBHOOK_SECRET = "webhookUrl";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function validatePageUrl(pageUrl: string) {
    if (pageUrl.length > 2048) return null;
    try {
        const url = new URL(pageUrl);
        if (url.protocol !== "https:" || url.hostname !== "discord.com" && !url.hostname.endsWith(".discord.com")) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function getErrorMessage(body: unknown, fallback: string) {
    if (!isRecord(body)) return fallback;
    if (typeof body.error === "string") return body.error;
    if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
    if (typeof body.errorDescription === "string") return body.errorDescription;
    if (typeof body.msg === "string") return body.msg;
    return fallback;
}

function throwIfAborted(signal: AbortSignal) {
    if (!signal.aborted) return;
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
}

/**
 * One request through the host. `host.fetch` takes no abort signal, so the signal is checked before the request and after it: a cancelled solve
 * stops at the next request boundary (a request already on its way ends by itself, at most 12 s later).
 */
async function hostFetch(host: NativeHostApi, url: string, init: NativeFetchInit, signal: AbortSignal): Promise<NativeResponse> {
    throwIfAborted(signal);
    const response = await host.fetch(url, { ...init, maxBytes: MAX_RESPONSE_BYTES });
    throwIfAborted(signal);
    return response;
}

// The host already stops an answer bigger than `maxBytes` (and says so), so the size check of the old stream reader is not repeated here.
async function readJson(response: NativeResponse): Promise<unknown> {
    const text = await response.text();
    return text ? JSON.parse(text) as unknown : null;
}

async function requestNoneCap(host: NativeHostApi, url: string, apiKey: string, signal: AbortSignal, body?: string) {
    const response = await hostFetch(host, url, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body
    }, signal);
    const data = await readJson(response);
    if (!response.ok) {
        throw new Error(getErrorMessage(data, `NoneCap returned status ${response.status}.`));
    }
    return data;
}

function parseSolve(data: unknown) {
    if (!isRecord(data)) throw new Error("NoneCap returned an invalid response.");
    return {
        id: typeof data.id === "string" ? data.id : null,
        status: typeof data.status === "string" ? data.status : null,
        token: typeof data.token === "string" ? data.token : null,
        error: getErrorMessage(data, "NoneCap could not solve the CAPTCHA.")
    };
}

async function requestNoCaptchaAI(host: NativeHostApi, path: string, apiKey: string, signal: AbortSignal, body: Record<string, unknown>) {
    const response = await hostFetch(host, `${NOCAPTCHAAI_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ clientKey: apiKey, ...body })
    }, signal);
    const data = await readJson(response);
    if (!response.ok) {
        throw new Error(getErrorMessage(data, `NoCaptchaAI returned status ${response.status}.`));
    }
    return data;
}

function parseNoCaptchaAI(data: unknown) {
    if (!isRecord(data)) throw new Error("NoCaptchaAI returned an invalid response.");
    const solution = isRecord(data.solution) ? data.solution : null;
    return {
        taskId: typeof data.taskId === "string" ? data.taskId : null,
        status: typeof data.status === "string" ? data.status : null,
        token: solution && typeof solution.token === "string" ? solution.token : null,
        errorId: typeof data.errorId === "number" ? data.errorId : 0,
        error: getErrorMessage(data, "NoCaptchaAI could not solve the CAPTCHA.")
    };
}

async function requestVoidSolver(host: NativeHostApi, path: string, apiKey: string, signal: AbortSignal, body?: Record<string, unknown>) {
    const response = await hostFetch(host, `${VOIDSOLVER_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    }, signal);
    const data = await readJson(response);
    if (!response.ok) {
        throw new Error(getErrorMessage(data, `VoidSolver returned status ${response.status}.`));
    }
    return data;
}

function parseVoidSolver(data: unknown) {
    if (!isRecord(data)) throw new Error("VoidSolver returned an invalid response.");
    const payload = isRecord(data.data) ? data.data : data;
    const taskIdValue = payload.taskId ?? payload.task_id ?? payload.id;
    const taskId = typeof taskIdValue === "string"
        ? taskIdValue
        : typeof taskIdValue === "number" && Number.isFinite(taskIdValue)
            ? String(taskIdValue)
            : null;

    return {
        taskId,
        status: typeof payload.status === "string" ? payload.status : typeof data.status === "string" ? data.status : null,
        token: typeof payload.solvedToken === "string"
            ? payload.solvedToken
            : typeof payload.uuid === "string"
                ? payload.uuid
                : typeof payload.token === "string"
                    ? payload.token
                    : null,
        externalTaskId: typeof payload.externalTaskId === "string" ? payload.externalTaskId : undefined,
        solveTime: typeof payload.solveTime === "number" && Number.isFinite(payload.solveTime) ? payload.solveTime : undefined,
        site: typeof payload.site === "string" ? payload.site : undefined,
        createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : undefined,
        error: getErrorMessage(payload, getErrorMessage(data, "VoidSolver could not solve the CAPTCHA."))
    };
}

function toVoidSolverTaskResult(task: ReturnType<typeof parseVoidSolver>, taskId: string): VoidSolverTaskResult {
    return {
        taskId: task.taskId ?? taskId,
        externalTaskId: task.externalTaskId,
        status: task.status ?? "unknown",
        solveTime: task.solveTime,
        site: task.site,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
    };
}

async function solveWithNoneCap(host: NativeHostApi, apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let solve = parseSolve(await requestNoneCap(
        host,
        `${NONECAP_SOLVES_URL}?wait=${NONECAP_WAIT_SECONDS}`,
        apiKey,
        signal,
        JSON.stringify({
            type: rqdata ? "hcaptcha_enterprise" : "hcaptcha",
            sitekey,
            url,
            ...(rqdata ? { rqdata } : {}),
            user_agent: userAgent
        })
    ));

    while (solve.status === "pending" || solve.status === "solving") {
        if (!solve.id || !/^solve_[a-zA-Z0-9_-]+$/.test(solve.id)) {
            return { success: false, error: "NoneCap returned an invalid solve ID." };
        }
        await sleep(2000, undefined, { signal });
        solve = parseSolve(await requestNoneCap(
            host,
            `${NONECAP_SOLVES_URL}/${encodeURIComponent(solve.id)}`,
            apiKey,
            signal
        ));
    }

    if (solve.status !== "solved" || !solve.token) {
        return { success: false, error: solve.error };
    }

    return { success: true, token: solve.token };
}

async function solveWithNoCaptchaAI(host: NativeHostApi, apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let task = parseNoCaptchaAI(await requestNoCaptchaAI(host, "/createTask", apiKey, signal, {
        task: {
            type: "HCaptchaTaskProxyLess",
            websiteURL: url,
            websiteKey: sitekey,
            userAgent,
            ...(rqdata ? { enterprisePayload: { rqdata } } : {})
        }
    }));

    if (task.errorId) return { success: false, error: task.error };
    if (!task.taskId || task.taskId.length > 256 || /[\r\n]/.test(task.taskId)) {
        return { success: false, error: "NoCaptchaAI returned an invalid task ID." };
    }
    const { taskId } = task;

    while (task.status === "idle" || task.status === "processing") {
        await sleep(3000, undefined, { signal });
        task = parseNoCaptchaAI(await requestNoCaptchaAI(host, "/getTaskResult", apiKey, signal, { taskId }));
        if (task.errorId) return { success: false, error: task.error };
    }

    if (task.status !== "ready" || !task.token) {
        return { success: false, error: task.error };
    }

    return { success: true, token: task.token };
}

async function solveWithVoidSolver(host: NativeHostApi, apiKey: string, proxy: string | undefined, sitekey: string, rqdata: string | undefined, url: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let task = parseVoidSolver(await requestVoidSolver(host, "/createtask", apiKey, signal, {
        site_url: url,
        site_key: sitekey,
        ...(proxy ? { proxy } : {}),
        ...(rqdata ? { rqdata } : {}),
        pow_type: "hsw"
    }));

    if (task.status === "success" && task.token && task.taskId) {
        return { success: true, token: task.token, task: toVoidSolverTaskResult(task, task.taskId) };
    }

    const taskId = task.taskId?.trim();
    if (!taskId || taskId.length > 256 || /[\r\n]/.test(taskId)) return { success: false, error: task.error };

    do {
        await sleep(2000, undefined, { signal });
        task = parseVoidSolver(await requestVoidSolver(
            host,
            `/gettaskresult?taskid=${encodeURIComponent(taskId)}`,
            apiKey,
            signal
        ));
    } while (task.status === "solving");

    if (task.status !== "success" || !task.token) {
        return { success: false, error: task.error, task: toVoidSolverTaskResult(task, taskId) };
    }

    return { success: true, token: task.token, task: toVoidSolverTaskResult(task, taskId) };
}

function getProviderLabel(provider: string) {
    if (provider === "nocaptchaai") return "NoCaptchaAI";
    if (provider === "voidsolver") return "VoidSolver";
    return "NoneCap";
}

/**
 * Solve one hCaptcha with the chosen service. The API key (and, for VoidSolver, the optional proxy) are read here from the plugin's secrets, so they never
 * travel through the page: the old signature took them as arguments (`apiKey`, `proxy`).
 */
export async function solveCaptcha(
    host: NativeHostApi,
    provider: string,
    sitekey: string,
    rqdata: string | undefined,
    pageUrl: string,
    userAgent: string
): Promise<NativeCaptchaResponse> {
    if (provider !== "nonecap" && provider !== "nocaptchaai" && provider !== "voidsolver") return { success: false, error: "CAPTCHA service is invalid." };
    const key = (host.secret(CAPTCHA_KEY_SECRET[provider]) ?? "").trim();
    const proxy = provider === "voidsolver" ? (host.secret(VOIDSOLVER_PROXY_SECRET) ?? "").trim() || undefined : undefined;
    const url = typeof pageUrl === "string" ? validatePageUrl(pageUrl) : null;
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "CAPTCHA API key is invalid." };
    if (typeof sitekey !== "string" || !sitekey || sitekey.length > 256) return { success: false, error: "CAPTCHA site key is invalid." };
    if (proxy !== undefined && (typeof proxy !== "string" || proxy.length > 2048 || /[\r\n]/.test(proxy))) return { success: false, error: "CAPTCHA proxy is invalid." };
    if (rqdata !== undefined && (typeof rqdata !== "string" || rqdata.length > 20_000)) return { success: false, error: "CAPTCHA request data is invalid." };
    if (!url) return { success: false, error: "Discord page URL is invalid." };
    if (typeof userAgent !== "string" || userAgent.length > 512 || /[\r\n]/.test(userAgent)) return { success: false, error: "User agent is invalid." };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLVE_TIMEOUT_MS);
    activeSolves.add(controller);

    try {
        if (provider === "nocaptchaai") return await solveWithNoCaptchaAI(host, key, sitekey, rqdata, url, userAgent, controller.signal);
        if (provider === "voidsolver") return await solveWithVoidSolver(host, key, proxy, sitekey, rqdata, url, controller.signal);
        return await solveWithNoneCap(host, key, sitekey, rqdata, url, userAgent, controller.signal);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
                ? `${getProviderLabel(provider)} solve timed out.`
                : error instanceof Error
                    ? error.message
                    : "CAPTCHA solve failed."
        };
    } finally {
        clearTimeout(timeout);
        activeSolves.delete(controller);
    }
}

function cancelCaptchaSolves() {
    for (const controller of activeSolves) controller.abort();
    activeSolves.clear();
}

/**
 * Post one payload to the webhook the person saved (secret `webhookUrl`). Same answer shape as before: `{ status, data }`, with status -1 when the
 * request could not be made. The address is checked here, in the main process, where it is read: it must be https on discord.com or discordapp.com.
 */
export async function sendWebhook(host: NativeHostApi, payload: string): Promise<{ status: number; data: string; }> {
    try {
        const saved = (host.secret(WEBHOOK_SECRET) ?? "").trim();
        if (!saved) return { status: -1, data: "Webhook URL is empty." };

        let url: URL;
        try {
            url = new URL(saved);
        } catch {
            return { status: -1, data: "Webhook URL is invalid." };
        }
        if (url.protocol !== "https:" || !WEBHOOK_HOSTS.includes(url.hostname)) {
            return { status: -1, data: "Webhook URL must be an https://discord.com or https://discordapp.com address." };
        }

        url.searchParams.set("wait", "true");
        const response = await host.fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            maxBytes: MAX_RESPONSE_BYTES
        });
        return { status: response.status, data: await response.text() };
    } catch (error) {
        return { status: -1, data: error instanceof Error ? error.message : String(error) };
    }
}

export async function cancelAll(_host: NativeHostApi) {
    cancelCaptchaSolves();
}
