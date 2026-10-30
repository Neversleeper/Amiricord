/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * Nothing here is global any more: the engine hands the plugin its `ctx` at `start`, and every Discord object, native call, secret, storage key,
 * toast and notification below comes from it. The queue, the message flow, the matchers and the event handlers are the original's, line for line
 * (see PORTING_NOTES.md for the list of every line that is not).
 */

import { type NativeFunctions, nativeOf } from "../../api/native";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { buildCaptchaHeaders, parseCaptchaChallenge } from "./captcha";
import { createAutoRedeemLegalWarning } from "./captchaWarning";
import { DEFAULT_CHANNEL_WARMUP_CONCURRENCY, warmupChannels } from "./channelWarmup";
import { isExternalClaimed, onExternalClaimRelease } from "./claimFence";
import { createLogTab } from "./components/LogTab";
import { createSettingsPanel } from "./components/SettingsPanel";
import { type AutoRedeemDeps, createDeps, type DiscordMessage } from "./deps";
import { createMessageCodeState, type GiftCodeMessage } from "./giftCodes";
import type { NightyWaitResult } from "./nightyAlts";
import { createRequestCoordinator, type RequestCoordinator } from "./requestCoordinator";
import { CAPTCHA_KEY_SECRETS, createSecretsState, type SecretsState } from "./secretsState";
import { createLogStore, type LogStore, type RedeemType } from "./store";
import type { CaptchaProvider, ClaimInfo, NightyGiftDetection, VoidSolverTaskResult } from "./types";
import { createWebhook, type Webhook } from "./webhook";

/** The part of the engine's `ctx.settingsTabs` that AutoRedeem uses (the API is newer than some engines; see `start`). */
interface SettingsTabsApi {
    add(key: string, tab: { title: string; panelTitle?: string; Component: unknown; icon?: () => unknown; }): () => void;
}

// What `start` builds from the engine's `ctx`. They are module state because the queue below is module state (as in the original); `start` sets them
// before anything runs and `flux` handlers only fire after `start` has finished, so no function reads them early.
let ctx!: EnginePluginContext;
let deps!: AutoRedeemDeps;
let logs!: LogStore;
let webhook!: Webhook;
let secrets!: SecretsState;
let requests!: RequestCoordinator;
/** This plugin's native file (native.ts) as typed async calls through `ctx.native`. */
let Native!: NativeFunctions<typeof import("./native")>;
let SettingsPanel: ((props: { onClose(): void; }) => unknown) | undefined;

// The engine has no logger API; these go to the console like Vencord's `Logger` did.
const logger = {
    debug: (...args: unknown[]) => console.debug("[AutoRedeem]", ...args),
    info: (...args: unknown[]) => console.info("[AutoRedeem]", ...args),
    warn: (...args: unknown[]) => console.warn("[AutoRedeem]", ...args),
    error: (...args: unknown[]) => console.error("[AutoRedeem]", ...args)
};

const messageCodeState = createMessageCodeState();
let altListenerId = 0;
let voidSolverTask: VoidSolverTaskResult | undefined;

// The settings the engine can declare: boolean, number, string and select. What Vencord-style settings did beyond that moved elsewhere:
// - the three CAPTCHA keys, the VoidSolver proxy and the webhook URL are secrets (plugin.json `secrets`), written in the settings window (SettingsPanel.tsx);
// - the "Send Test Webhook" component is in that same window; `hidden` (show only the chosen provider's fields) has no equivalent, so all fields show;
// - the `onChange` callbacks are registered in `start` with `settings.onChange` (instant mode) and on the secrets (CAPTCHA key changes);
// - the concurrency slider is a number between 1 and 20.
const settings = definePluginSettings({
    speedMode: {
        type: "boolean",
        description: "Blazing fast mode: parallel redemption with no prevalidation and no inter-request delay. Raises captcha and rate-limit risk.",
        default: false
    },
    maxConcurrency: {
        type: "number",
        description: "How many gifts to redeem at once while a fast mode is active.",
        default: 5,
        min: 1,
        max: 20,
        integer: true
    },
    instantMode: {
        type: "boolean",
        description: "Instant Internet Mode: load one newest page from every readable channel, skip prevalidation, and redeem gifts with a rolling worker pool. May increase captcha, rate-limit, or stale-code risk.",
        default: false
    },
    ignoreSelf: {
        type: "boolean",
        description: "Ignore gifts sent by yourself",
        default: true
    },
    ignoreBots: {
        type: "boolean",
        description: "Ignore gifts sent by bots",
        default: false
    },
    prevalidate: {
        type: "boolean",
        description: "Pre-check gift codes before redeeming. Skips already-claimed/invalid codes and dramatically reduces captchas.",
        default: true
    },
    notifyOnRedeem: {
        type: "boolean",
        description: "Show a notification when successfully redeeming a gift",
        default: true
    },
    notifyOnFail: {
        type: "boolean",
        description: "Show a notification when failing to redeem a gift",
        default: true
    },
    captchaProvider: {
        type: "select",
        description: "Service used to solve gift redemption hCaptchas. Its API key is set below, under Credentials.",
        default: "nonecap",
        options: [
            { label: "NoneCap", value: "nonecap" },
            { label: "NoCaptchaAI", value: "nocaptchaai" },
            { label: "VoidSolver", value: "voidsolver" }
        ]
    },
    watchNightyAlts: {
        type: "boolean",
        description: "Also claim gift codes your Nighty alt accounts detect. Windows only, and needs Nighty's Nitro Sniper log to exist.",
        default: false
    }
});

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    channelId: string;
    guildId: string;
    message: DiscordMessage;
}

interface GiftPrecheckBody {
    redeemed?: boolean;
    uses?: number | null;
    max_uses?: number | null;
    expires_at?: string | null;
}

function classifyGift(data: unknown): RedeemType {
    const value = data as { subscription_plan?: { name?: unknown; }; store_listing?: { sku?: { name?: unknown; }; }; } | null;
    const rawName = value?.subscription_plan?.name ?? value?.store_listing?.sku?.name;
    const name = typeof rawName === "string" ? rawName.toLowerCase() : "";
    if (name.includes("nitro") || name.includes("boost")) return "nitro";
    if (name.includes("decoration") || name.includes("avatar") || name.includes("profile")) return "decoration";
    return "other";
}

function handleCaptchaKeyChanged() {
    if (!hasCaptchaApiKey()) return;
    clearCaptchaRetry();
    captchaRetryAttempt = 0;
    if (!captchaPaused) return;
    captchaPaused = false;
    pauseToastShown = false;
    pumpQueue();
    requestWarmup();
}

function getCaptchaProvider(): CaptchaProvider {
    return settings.store.captchaProvider as CaptchaProvider;
}

function hasCaptchaApiKey() {
    switch (settings.store.captchaProvider) {
        case "nocaptchaai": return secrets.has("noCaptchaAiApiKey");
        case "voidsolver": return secrets.has("voidSolverApiKey");
        default: return secrets.has("noneCapApiKey");
    }
}

const TERMINAL_CAP = 5000;
const UNCERTAIN_TTL = 10 * 60_000;
const terminalCodes = new Set<string>();
const uncertainUntil = new Map<string, number>();
const uncertainMessages = new Map<string, string>();
interface ActiveJob {
    jobId: number;
    generation: number;
}
const activeJobs = new Map<string, ActiveJob>();
let nextJobId = 1;

function codeKey(code: string) {
    return code.toUpperCase();
}

function rememberTerminal(code: string, uncertain = false, messageId?: string) {
    const key = codeKey(code);
    terminalCodes.delete(key);
    terminalCodes.add(key);
    if (uncertain && messageId) {
        uncertainUntil.set(key, Date.now() + UNCERTAIN_TTL);
        uncertainMessages.set(key, messageId);
    } else {
        uncertainUntil.delete(key);
        uncertainMessages.delete(key);
    }
    while (terminalCodes.size > TERMINAL_CAP) {
        const oldest = terminalCodes.values().next().value;
        if (oldest === undefined) break;
        terminalCodes.delete(oldest);
        uncertainUntil.delete(oldest);
        const messageId = uncertainMessages.get(oldest);
        if (messageId) messageCodeState.release(messageId, oldest);
        uncertainMessages.delete(oldest);
    }
}

function isKnownCode(code: string) {
    const key = codeKey(code);
    const expiry = uncertainUntil.get(key);
    if (expiry !== undefined) {
        if (expiry > Date.now()) return true;
        uncertainUntil.delete(key);
        const messageId = uncertainMessages.get(key);
        if (messageId) messageCodeState.release(messageId, code);
        uncertainMessages.delete(key);
        terminalCodes.delete(key);
    }
    return terminalCodes.has(key) || activeJobs.has(key);
}

const QUEUE_CAP = 1000;
const queue: QueueItem[] = [];
const DEFERRED_CAP = 2000;
type DeferredMessage = { message: DiscordMessage; guildId?: string; };
const deferredMessages = new Map<string, DeferredMessage>();
const pendingObservations = new Map<string, DeferredMessage>();
let drainingDeferred = false;
let running = 0;
let generation = 0;
let started = false;
let nextSerialStart = 0;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let pumpTimerAt = 0;
let captchaPaused = false;
const CAPTCHA_RETRY_DELAYS = [5_000, 15_000, 60_000, 300_000];
let captchaRetryTimer: ReturnType<typeof setTimeout> | undefined;
let captchaRetryAttempt = 0;
let blockedUntil = 0;
let pauseToastShown = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
let queueFullWarningShown = false;
let deferredLimitWarningShown = false;
type CaptchaSolveResult = { success: boolean; token?: string; error?: string; task?: VoidSolverTaskResult; };
let captchaSolvePromise: Promise<CaptchaSolveResult> | null = null;

interface QueueItem {
    jobId: number;
    generation: number;
    code: string;
    source: "discord" | "nighty";
    channelId?: string;
    messageId?: string;
    guildId?: string;
    authorId?: string;
    authorBot?: boolean;
    readyAt?: number;
    submitted?: boolean;
    uncertain?: boolean;
    immediate?: boolean;
    nighty?: NightyGiftDetection;
}

function isPaused() {
    return captchaPaused || blockedUntil > Date.now();
}

function schedulePump(delay = 0) {
    const target = Date.now() + Math.max(0, delay);
    if (pumpTimer !== undefined) {
        if (target >= pumpTimerAt) return;
        clearTimeout(pumpTimer);
    }
    pumpTimerAt = target;
    pumpTimer = setTimeout(() => {
        pumpTimer = undefined;
        pumpTimerAt = 0;
        pumpQueue();
    }, Math.max(0, target - Date.now()));
}

function getConcurrency() {
    if (!settings.store.instantMode && !settings.store.speedMode) return 1;
    return Math.max(1, Math.min(20, Math.round(settings.store.maxConcurrency)));
}

function pumpQueue() {
    if (!started || isPaused()) return;
    drainDeferredMessages();

    const fast = settings.store.instantMode || settings.store.speedMode;
    if (!fast && running === 0 && queue.length > 0) {
        const wait = nextSerialStart - Date.now();
        if (wait > 0) {
            schedulePump(wait);
            return;
        }
        nextSerialStart = Date.now() + jitter(1, 1200);
    }

    while (running < getConcurrency() && queue.length > 0) {
        const now = Date.now();
        const isReady = (item: QueueItem) => !item.readyAt || item.readyAt <= now;
        // A gift that just landed in chat must not queue behind a channel warmup sweep.
        let index = queue.findIndex(item => item.immediate && isReady(item));
        if (index < 0) index = queue.findIndex(isReady);
        if (index < 0) {
            let nextReady = now;
            for (const candidate of queue) {
                if (candidate.readyAt !== null && candidate.readyAt !== undefined && candidate.readyAt > nextReady) nextReady = candidate.readyAt;
            }
            schedulePump(nextReady - now);
            return;
        }

        const [item] = queue.splice(index, 1);
        running++;
        void handleRedeem(item, item.generation)
            .catch(error => logger.error("AutoRedeem worker failed:", error))
            .finally(() => {
                if (item.generation === generation) {
                    running--;
                    drainDeferredMessages();
                    pumpQueue();
                } else {
                    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
                        if (item.uncertain) rememberTerminal(item.code, true, item.messageId);
                        activeJobs.delete(codeKey(item.code));
                    }
                    if (started) {
                        drainDeferredMessages();
                        pumpQueue();
                    }
                }
            });
    }
    if (queue.length === 0) queueFullWarningShown = false;
}

function requeueItem(item: QueueItem, readyAt: number) {
    if (!started || item.generation !== generation) return;
    item.readyAt = Math.max(item.readyAt ?? 0, readyAt);
    if (queue.length + running > QUEUE_CAP) logger.debug("AutoRedeem retry temporarily exceeds the queue budget.");
    queue.push(item);
    schedulePump(Math.max(0, item.readyAt - Date.now()));
}

function finishItem(item: QueueItem) {
    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
        activeJobs.delete(codeKey(item.code));
        rememberTerminal(item.code, item.uncertain === true, item.messageId);
    }
}

function jitter(minMs: number, maxMs: number) {
    return minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs));
}

type ErrorBody = Record<string, unknown>;

// Fire a lightweight request on start to warm up DNS + TLS session for discord.com.
// Subsequent requests reuse the cached connection, cutting first-request latency. Idle
// sockets get reaped, so a refocus re-warms rather than paying TLS on the next gift.
const CONNECTION_WARMUP_STALE_MS = 60_000;
let lastConnectionWarmupAt = 0;
function warmupConnection(force = false) {
    if (!force && Date.now() - lastConnectionWarmupAt < CONNECTION_WARMUP_STALE_MS) return;
    lastConnectionWarmupAt = Date.now();
    requests.request({
        key: "discord:warmup:users-me",
        ttlMs: 10_000,
        run: () => deps.RestAPI.get({ url: "/users/@me" })
    }).catch(error => logger.debug("AutoRedeem connection warmup failed:", error));
}

function handleWindowFocus() {
    warmupConnection();
}

function getRetryAt(error: unknown): number {
    const value = error as { status?: number; body?: { retry_after?: number; }; headers?: { "retry-after"?: string; }; };
    const retryAfter = Number(value?.body?.retry_after ?? value?.headers?.["retry-after"] ?? 0);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(retryAfter * 1000, 1000) : 1000;
    return Date.now() + waitMs;
}

function clearPendingQueue() {
    for (const item of queue) cancelItem(item);
    queue.length = 0;
}

function clearCaptchaRetry() {
    if (captchaRetryTimer !== undefined) clearTimeout(captchaRetryTimer);
    captchaRetryTimer = undefined;
}

function pauseForCaptcha(reason: string, retryLater: boolean) {
    captchaPaused = true;
    if (!pauseToastShown) {
        pauseToastShown = true;
        ctx.toasts.show(`AutoRedeem paused: ${reason}`, "failure");
        logger.warn(`Paused: ${reason}`);
    }
    if (!retryLater || captchaRetryTimer !== undefined) return;

    const delay = CAPTCHA_RETRY_DELAYS[Math.min(captchaRetryAttempt, CAPTCHA_RETRY_DELAYS.length - 1)];
    captchaRetryAttempt++;
    captchaRetryTimer = setTimeout(() => {
        captchaRetryTimer = undefined;
        if (!started || !captchaPaused) return;
        captchaPaused = false;
        pauseToastShown = false;
        pumpQueue();
        requestWarmup();
    }, delay);
}

function notifyPaused(reason: string, resumeAt: number) {
    const pauseGeneration = generation;
    blockedUntil = Math.max(blockedUntil, resumeAt);

    if (!pauseToastShown) {
        pauseToastShown = true;
        ctx.toasts.show(`AutoRedeem paused: ${reason}`, "failure");
        logger.warn(`Paused: ${reason}`);
    }

    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
        resumeTimer = undefined;
        if (!started || pauseGeneration !== generation) return;
        if (Date.now() < blockedUntil) {
            notifyPaused(reason, blockedUntil);
            return;
        }
        blockedUntil = 0;
        if (!captchaPaused) pauseToastShown = false;
        pumpQueue();
        if (!captchaPaused) requestWarmup();
    }, Math.max(0, blockedUntil - Date.now()));
}

function resumeAfterCaptcha() {
    clearCaptchaRetry();
    captchaRetryAttempt = 0;
    captchaPaused = false;
    captchaSolvePromise = null;
    pauseToastShown = false;
    pumpQueue();
    requestWarmup();
}

async function trySolveCaptcha(sitekey: string, rqdata: string | undefined, pageUrl: string): Promise<CaptchaSolveResult> {
    if (!hasCaptchaApiKey()) return { success: false, error: "" };

    // The API key (and the VoidSolver proxy) are secrets of the plugin: the main process reads them itself (`host.secret`), so they are not sent from here.
    return Native.solveCaptcha(
        getCaptchaProvider(),
        sitekey,
        rqdata,
        pageUrl,
        navigator.userAgent
    );
}

function buildClaimInfo(item: QueueItem): ClaimInfo {
    const currentUser = deps.UserStore.getCurrentUser();
    if (item.nighty) {
        return {
            code: item.code,
            source: "nighty",
            channelName: item.nighty.channelName,
            guildName: item.nighty.guildName,
            authorName: item.nighty.authorName,
            detectedAccount: item.nighty.accountName
        };
    }

    const author = item.authorId ? deps.UserStore.getUser(item.authorId) : undefined;
    return {
        code: item.code,
        source: "discord",
        channelId: item.channelId,
        channelName: item.channelId ? deps.ChannelStore.getChannel(item.channelId)?.name : undefined,
        messageId: item.messageId,
        guildId: item.guildId,
        guildName: item.guildId ? deps.GuildStore.getGuild(item.guildId)?.name : undefined,
        authorId: item.authorId,
        authorName: author?.globalName ?? author?.username,
        authorAvatarUrl: author ? deps.IconUtils.getUserAvatarURL(author, false, 128) : undefined,
        detectedAccount: currentUser?.globalName ?? currentUser?.username,
        detectedAccountId: currentUser?.id
    };
}

function notifyClaimWebhook(result: "claimed" | "failed", item: QueueItem, giftType: string | null, error?: string, task?: VoidSolverTaskResult) {
    if (!secrets.has("webhookUrl")) return;
    void webhook.sendClaimWebhook(result, buildClaimInfo(item), giftType, error, task)
        .catch(webhookError => logger.debug("AutoRedeem webhook failed:", webhookError));
}

async function precheckGift(code: string): Promise<{ ok: boolean; data?: GiftPrecheckBody; reason?: string; retryAt?: number; captcha?: boolean; }> {
    try {
        const { body } = await requests.request<{ body?: GiftPrecheckBody; }>({
            key: `discord:gift-precheck:${code}`,
            ttlMs: 60_000,
            run: () => deps.RestAPI.get({
                url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
                retries: 0
            }) as Promise<{ body?: GiftPrecheckBody; }>
        });
        if (body?.redeemed) return { ok: false, data: body, reason: "already claimed" };
        if (body?.uses !== null && body?.uses !== undefined && body?.max_uses !== null && body?.max_uses !== undefined && body.uses >= body.max_uses) {
            return { ok: false, data: body, reason: "already claimed" };
        }
        if (body?.expires_at && Date.parse(body.expires_at) < Date.now()) {
            return { ok: false, data: body, reason: "expired" };
        }
        return { ok: true, data: body };
    } catch (error: unknown) {
        const body = getErrorBody(error);
        const status = Number((error as { status?: number; })?.status ?? 0);
        if (parseCaptchaChallenge(body, status)) {
            return { ok: true, captcha: true, reason: "captcha required" };
        }
        const msg = typeof body?.message === "string" ? body.message : "";
        const codeName = typeof body?.code === "string" ? body.code : "";
        if (status === 429 || status >= 500) {
            return { ok: false, reason: "precheck rate limited", retryAt: getRetryAt(error) };
        }
        if (status === 404 || /unknown/i.test(msg) || /invalid/i.test(msg)) {
            return { ok: false, reason: "invalid code" };
        }
        return { ok: true, reason: codeName || msg || undefined };
    }
}

function isCurrentJob(item: QueueItem, jobGeneration: number) {
    return started && jobGeneration === generation && item.generation === generation;
}

function getErrorBody(error: unknown): ErrorBody | undefined {
    const body = (error as { body?: unknown; })?.body;
    return body && typeof body === "object" ? body as ErrorBody : undefined;
}

function getErrorMessage(error: unknown): string {
    const message = getErrorBody(error)?.message;
    return typeof message === "string" && message ? message : "Unknown error";
}

function buildNotificationClick(item: QueueItem) {
    if (!item.channelId || !item.messageId) return undefined;
    const target = `/channels/${item.guildId ?? "@me"}/${item.channelId}/${item.messageId}`;
    return () => deps.NavigationRouter.transitionTo(target);
}

// `ctx.notifications.show` draws a card inside Discord's window (the original used Vencord's `showNotification`, a desktop notification). The card has no
// colour option, so the green/red accent of the original is carried by the emoji in the title.
function showRedeemNotification(title: string, text: string, item: QueueItem) {
    const icon = deps.UserStore.getCurrentUser()?.getAvatarURL?.();
    const onClick = buildNotificationClick(item);
    ctx.notifications.show({ title, body: text, ...(icon ? { icon } : {}), ...(onClick ? { onClick } : {}) });
}

async function completeRedeem(item: QueueItem, body: unknown, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) {
        finishItem(item);
        return;
    }
    const { code, channelId, messageId } = item;
    const giftType = classifyGift(body);
    finishItem(item);
    const fast = settings.store.speedMode || settings.store.instantMode;
    try {
        logs.addLog({ code, status: "success", type: giftType, channelId, messageId });
        if (!fast) ctx.toasts.show(`Redeemed gift: ${code}`, "success");
        logger.info(`Redeemed gift code: ${code}`);
        if (!fast && settings.store.notifyOnRedeem) {
            showRedeemNotification("Gift Redeemed! 🎉", `Successfully redeemed: ${code}`, item);
        }
        notifyClaimWebhook("claimed", item, giftType, undefined, voidSolverTask);
    } catch (error) {
        logger.error("AutoRedeem post-success side effects failed:", error);
    }
}

async function failItem(item: QueueItem, reason: string, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) return;
    const { code, channelId, messageId } = item;
    finishItem(item);
    const fast = settings.store.speedMode || settings.store.instantMode;
    try {
        logs.addLog({ code, status: "failed", type: "other", error: reason, channelId, messageId });
        if (!fast && settings.store.notifyOnFail) {
            ctx.toasts.show(`Failed to redeem ${code}: ${reason}`, "failure");
        }
        logger.warn(`Failed to redeem ${code}: ${reason}`);
        if (!fast && settings.store.notifyOnFail) {
            showRedeemNotification("Redeem Failed ❌", `${code}: ${reason}`, item);
        }
        notifyClaimWebhook("failed", item, "other", reason, voidSolverTask);
    } catch (error) {
        logger.error("AutoRedeem failure side effects failed:", error);
    }
}

async function handleRedeemError(item: QueueItem, error: unknown, jobGeneration: number, captchaAttempted = false) {
    const body = getErrorBody(error);
    const status = Number((error as { status?: number; })?.status ?? 0);
    const challenge = parseCaptchaChallenge(body, status);
    const wasSubmitted = item.submitted === true;

    if (!isCurrentJob(item, jobGeneration)) {
        if (status === 429 || challenge || (wasSubmitted && status >= 400 && status < 500)) item.submitted = false;
        else if (wasSubmitted && (status === 0 || status >= 500)) item.uncertain = true;
        return;
    }

    const { code } = item;
    if (challenge && !captchaAttempted) {
        if (captchaPaused || captchaSolvePromise) {
            requeueItem(item, Date.now() + 1000);
            return;
        }

        pauseForCaptcha("captcha required", false);
        if (challenge.service === "hcaptcha" && challenge.sitekey && hasCaptchaApiKey()) {
            let solveResult: CaptchaSolveResult;
            const solvePromise = captchaSolvePromise ??= trySolveCaptcha(challenge.sitekey, challenge.rqdata, location.href);
            try {
                solveResult = await solvePromise;
            } catch (error) {
                logger.warn(`${getCaptchaProvider()} solve threw for ${code}:`, error);
                pauseForCaptcha("captcha required", true);
                requeueItem(item, Date.now() + 1000);
                return;
            } finally {
                if (captchaSolvePromise === solvePromise) captchaSolvePromise = null;
            }
            if (!isCurrentJob(item, jobGeneration)) return;
            if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
                cancelItem(item);
                resumeAfterCaptcha();
                return;
            }
            if (solveResult.success && solveResult.token) {
                voidSolverTask = solveResult.task;
                let headers: Record<string, string>;
                try {
                    headers = buildCaptchaHeaders(solveResult.token, challenge);
                } catch (error) {
                    logger.warn(`${getCaptchaProvider()} returned an invalid CAPTCHA token for ${code}:`, error);
                    pauseForCaptcha("captcha required", true);
                    requeueItem(item, Date.now() + 1000);
                    return;
                }
                try {
                    const result = await deps.RestAPI.post({
                        url: `/entitlements/gift-codes/${code}/redeem`,
                        retries: 0,
                        headers,
                        body: item.channelId ? { channel_id: item.channelId } : {}
                    });
                    await completeRedeem(item, result.body, jobGeneration);
                    if (isCurrentJob(item, jobGeneration)) resumeAfterCaptcha();
                    return;
                } catch (retryError) {
                    if (!isCurrentJob(item, jobGeneration)) return handleRedeemError(item, retryError, jobGeneration, true);
                    captchaPaused = false;
                    pauseToastShown = false;
                    return handleRedeemError(item, retryError, jobGeneration, true);
                }
            }
            if (solveResult.error) logger.warn(`${getCaptchaProvider()} solve failed for ${code}: ${solveResult.error}`);
        }
        pauseForCaptcha("captcha required", true);
        requeueItem(item, Date.now() + 1000);
        return;
    }

    if (status === 429) {
        item.submitted = false;
        const retryAt = getRetryAt(error);
        notifyPaused(`rate limited (retry at ${new Date(retryAt).toISOString()})`, retryAt);
        requeueItem(item, retryAt);
        return;
    }

    if (challenge) {
        if (captchaAttempted) logger.warn("CAPTCHA retry was challenged again; the retry headers may not have been accepted.");
        pauseForCaptcha("captcha required", true);
        requeueItem(item, Date.now() + 1000);
        return;
    }

    if (status === 0 || status >= 500) {
        item.uncertain = true;
        await failItem(item, `uncertain: ${getErrorMessage(error)}`, jobGeneration);
        return;
    }

    item.submitted = false;
    await failItem(item, getErrorMessage(error), jobGeneration);
}

async function handleRedeem(item: QueueItem, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) return;
    if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
        cancelItem(item);
        return;
    }
    const { code, channelId } = item;
    const fast = settings.store.speedMode || settings.store.instantMode;
    const skipPrecheck = fast;

    if (!skipPrecheck && (fast || settings.store.prevalidate)) {
        const pre = await precheckGift(code);
        if (!isCurrentJob(item, jobGeneration)) return;
        if (!pre.captcha && !pre.ok) {
            if (pre.retryAt) {
                notifyPaused("precheck rate limited", pre.retryAt);
                requeueItem(item, pre.retryAt);
                return;
            }
            const reason = pre.reason ?? "unredeemable";
            if (reason === "captcha required") {
                pauseForCaptcha("captcha required", true);
                requeueItem(item, Date.now() + 1000);
                return;
            }
            await failItem(item, reason, jobGeneration);
            return;
        }
    }

    if (!isCurrentJob(item, jobGeneration)) return;
    if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
        cancelItem(item);
        return;
    }
    if (isPaused()) {
        requeueItem(item, Math.max(Date.now() + 1000, blockedUntil));
        return;
    }
    if (isExternalClaimed(code)) {
        requeueItem(item, Date.now() + 1000);
        return;
    }

    item.submitted = true;
    voidSolverTask = undefined;
    try {
        const result = await deps.RestAPI.post({
            url: `/entitlements/gift-codes/${code}/redeem`,
            retries: 0,
            body: channelId ? { channel_id: channelId } : {}
        });
        await completeRedeem(item, result.body, jobGeneration);
    } catch (error) {
        await handleRedeemError(item, error, jobGeneration);
    }
}

function isMessageCodeCurrent(item: QueueItem) {
    if (!item.messageId) return item.source === "nighty";
    return messageCodeState.codesForMessage(item.messageId).some(code => code.toUpperCase() === item.code.toUpperCase());
}

function cancelItem(item: QueueItem) {
    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
        if (item.messageId) messageCodeState.release(item.messageId, item.code);
        activeJobs.delete(codeKey(item.code));
    }
}

function isItemAllowed(item: QueueItem) {
    if (item.source === "nighty") return true;

    let { authorId, authorBot } = item;
    if ((settings.store.ignoreBots || settings.store.ignoreSelf) && !authorId && item.channelId && item.messageId) {
        try {
            const message = deps.MessageStore.getMessage(item.channelId, item.messageId);
            authorId = message?.author?.id ?? authorId;
            authorBot = message?.author?.bot ?? authorBot;
        } catch (error) {
            logger.debug("AutoRedeem could not refresh message author:", error);
        }
    }
    if (settings.store.ignoreBots && authorBot) return false;
    if (settings.store.ignoreSelf && authorId && authorId === deps.UserStore.getCurrentUser()?.id) return false;
    return true;
}

function retainDeferredMessage(message: DiscordMessage, guildId?: string) {
    if (deferredMessages.has(message.id)) {
        deferredMessages.set(message.id, { message, guildId });
        return;
    }
    if (deferredMessages.size >= DEFERRED_CAP) {
        if (!deferredLimitWarningShown) {
            deferredLimitWarningShown = true;
            logger.error("AutoRedeem deferred-message memory limit reached; new overflow messages will be dropped.");
        }
        return;
    }
    deferredMessages.set(message.id, { message, guildId });
}

function rememberPendingObservation(code: string, message: DiscordMessage, guildId?: string) {
    pendingObservations.set(codeKey(code), { message, guildId });
}

function drainPendingObservations() {
    if (!started || isPaused() || pendingObservations.size === 0) return;
    for (const [code, observation] of [...pendingObservations]) {
        if (isPaused()) return;
        if (isExternalClaimed(code)) continue;
        const active = activeJobs.get(codeKey(code));
        if (active && active.generation !== generation) continue;
        pendingObservations.delete(code);
        enqueueGifts(observation.message, observation.guildId);
    }
}

function enqueueGifts(message: DiscordMessage, guildId?: string, immediate = false) {
    if (!started || !message || message.deleted || message.state === "SENDING") return;
    if (!message.channel_id || !message.id) return;
    if (!Array.isArray(message.giftCodes) && typeof message.content !== "string") return;

    let { author } = message;
    if (!author && (settings.store.ignoreBots || settings.store.ignoreSelf)) {
        try {
            author = deps.MessageStore.getMessage(message.channel_id, message.id)?.author;
        } catch (error) {
            logger.debug("AutoRedeem could not read message author:", error);
        }
    }
    if (settings.store.ignoreBots && author?.bot) return;
    if (settings.store.ignoreSelf && author?.id === deps.UserStore.getCurrentUser()?.id) return;

    const currentCodes = messageCodeState.codesForMessage(message.id);
    for (const code of currentCodes) isKnownCode(code);
    const freshCodes = messageCodeState.sync(message as GiftCodeMessage, { emit: false });
    const observedCodes = new Set([...currentCodes, ...freshCodes]);
    const oldActiveCodes = [...observedCodes].filter(code => {
        const active = activeJobs.get(codeKey(code));
        return active && active.generation !== generation;
    });
    const externalCodes = freshCodes.filter(isExternalClaimed);
    if (oldActiveCodes.length > 0 || externalCodes.length > 0) {
        for (const code of [...oldActiveCodes, ...externalCodes]) rememberPendingObservation(code, message, guildId);
        return;
    }
    const candidates = freshCodes.filter(code => !isKnownCode(code));
    if (candidates.length === 0) {
        deferredMessages.delete(message.id);
        return;
    }
    if (captchaPaused) {
        retainDeferredMessage(message, guildId);
        return;
    }
    const available = Math.max(0, QUEUE_CAP - queue.length - running);
    const accepted = candidates.slice(0, available);
    if (accepted.length < candidates.length) {
        retainDeferredMessage(message, guildId);
        if (!queueFullWarningShown) {
            queueFullWarningShown = true;
            logger.warn(`AutoRedeem queue is full; deferred ${candidates.length - accepted.length} gift code(s)`);
        }
    }
    if (accepted.length === 0) return;
    if (accepted.length === candidates.length) deferredMessages.delete(message.id);
    for (const code of accepted) {
        messageCodeState.claim(message.id, code);
        if (isKnownCode(code)) continue;
        const jobId = nextJobId++;
        activeJobs.set(codeKey(code), { jobId, generation });
        queue.push({
            jobId,
            generation,
            code,
            source: "discord",
            channelId: message.channel_id,
            messageId: message.id,
            guildId: guildId ?? message.guild_id,
            authorId: author?.id,
            authorBot: author?.bot === true,
            immediate
        });
    }
    pumpQueue();
}

function drainDeferredMessages() {
    if (!started || isPaused() || drainingDeferred) return;
    drainingDeferred = true;
    try {
        drainPendingObservations();
        if (isPaused()) return;
        for (const deferred of [...deferredMessages.values()]) {
            if (queue.length + running >= QUEUE_CAP) break;
            enqueueGifts(deferred.message, deferred.guildId);
        }
    } finally {
        drainingDeferred = false;
        if (deferredMessages.size < DEFERRED_CAP) deferredLimitWarningShown = false;
    }
}

function latestMessages(messages: DiscordMessage[], limit: number) {
    return [...messages].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0).slice(0, limit);
}

function waitForMessages(channelId: string) {
    if (typeof deps.MessageStore.isLoadingMessages !== "function" || !deps.MessageStore.isLoadingMessages(channelId)) return Promise.resolve();
    return new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            warmupWaitTimers.delete(timeout);
            warmupWaitResolvers.delete(finish);
            resolve();
        };
        const timeout = setTimeout(finish, 5_000);
        warmupWaitTimers.add(timeout);
        warmupWaitResolvers.add(finish);
        try {
            deps.MessageStore.whenReady(channelId, finish);
            if (!deps.MessageStore.isLoadingMessages(channelId)) finish();
        } catch (error) {
            logger.debug(`AutoRedeem could not wait for channel ${channelId}:`, error);
            finish();
        }
    });
}

const WARMUP_CHANNEL_BUDGET = 50;
const WARMUP_STALE_MS = 5 * 60_000;
let warmupRunning = false;
let warmupPending = false;
let warmupRunId = 0;
let activeWarmupRun = 0;
let warmupBlockedUntil = 0;
let warmupRetryTimer: ReturnType<typeof setTimeout> | undefined;
let warmupBatchTimer: ReturnType<typeof setTimeout> | undefined;
const lastWarmedAt = new Map<string, number>();
const warmupWaitTimers = new Set<ReturnType<typeof setTimeout>>();
const warmupWaitResolvers = new Set<() => void>();
let warmupCursor = 0;
let warmupRunCurrentIncluded = false;

function pauseWarmup(retryAt: number) {
    const pauseGeneration = generation;
    const previousDeadline = warmupBlockedUntil;
    warmupBlockedUntil = Math.max(warmupBlockedUntil, retryAt);
    if (warmupRetryTimer !== undefined) clearTimeout(warmupRetryTimer);
    warmupRetryTimer = setTimeout(() => {
        warmupRetryTimer = undefined;
        if (!started || pauseGeneration !== generation) return;
        if (Date.now() < warmupBlockedUntil) {
            pauseWarmup(warmupBlockedUntil);
            return;
        }
        warmupBlockedUntil = 0;
        requestWarmup();
    }, Math.max(0, warmupBlockedUntil - Date.now()));
    if (warmupBlockedUntil > previousDeadline) logger.warn(`AutoRedeem channel warmup paused until ${new Date(warmupBlockedUntil).toISOString()}.`);
}

function scheduleNextWarmup() {
    if (!started || captchaPaused || !settings.store.instantMode || warmupBatchTimer !== undefined || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    try {
        if (warmupCursor >= deps.ChannelStore.getChannelIds().length) return;
    } catch (error) {
        logger.debug("AutoRedeem could not count channels for warmup:", error);
        return;
    }
    const jobGeneration = generation;
    warmupBatchTimer = setTimeout(() => {
        warmupBatchTimer = undefined;
        if (started && jobGeneration === generation) requestWarmup();
    }, 500);
}

function requestWarmup() {
    if (!started || captchaPaused || !settings.store.instantMode || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    try {
        if (warmupCursor >= deps.ChannelStore.getChannelIds().length) warmupCursor = 0;
    } catch (error) {
        logger.debug("AutoRedeem could not count channels for warmup:", error);
        return;
    }
    if (warmupRunning) {
        warmupPending = true;
        return;
    }
    void warmChannels(generation);
}

async function warmChannels(jobGeneration = generation) {
    if (!started || captchaPaused || jobGeneration !== generation || !settings.store.instantMode || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    if (warmupRunning) {
        warmupPending = true;
        return;
    }
    if (typeof deps.MessageActions.fetchMessages !== "function") return;
    const runId = ++warmupRunId;
    activeWarmupRun = runId;
    warmupRunCurrentIncluded = false;
    warmupRunning = true;
    let attempted = 0;
    let unique = 0;
    let completed = false;
    try {
        if (typeof deps.ChannelStore.loadAllGuildAndPrivateChannelsFromDisk === "function") {
            await deps.ChannelStore.loadAllGuildAndPrivateChannelsFromDisk();
        }
        if (!started || jobGeneration !== generation || !settings.store.instantMode) return;
        const result = await warmupChannels({
            enumerateChannels: function* () {
                const ids = deps.ChannelStore.getChannelIds();
                const currentId = deps.SelectedChannelStore.getChannelId();
                const hasCurrent = Boolean(currentId && ids.includes(currentId));
                warmupRunCurrentIncluded = hasCurrent;
                const otherIds = hasCurrent ? ids.filter(id => id !== currentId) : ids;
                const offset = otherIds.length > 0 ? warmupCursor % otherIds.length : 0;
                const rotated = otherIds.length > 0 ? [...otherIds.slice(offset), ...otherIds.slice(0, offset)] : otherIds;
                const ordered = hasCurrent && currentId ? [currentId, ...rotated] : rotated;
                for (let index = 0; index < ordered.length; index++) {
                    const id = ordered[index];
                    try {
                        const channel = deps.ChannelStore.getChannel(id);
                        if (channel) yield channel;
                    } catch (error) {
                        logger.debug(`AutoRedeem could not inspect channel ${id}:`, error);
                    }
                }
            },
            getCurrentChannelId: () => deps.SelectedChannelStore.getChannelId(),
            canReadChannel: channel => {
                if (channel.type === 4 || channel.type === 15) return false;
                if (!channel.guild_id) return true;
                return deps.PermissionStore.can(deps.PermissionsBits.VIEW_CHANNEL, channel)
                    && deps.PermissionStore.can(deps.PermissionsBits.READ_MESSAGE_HISTORY, channel);
            },
            isChannelFetched: channelId => deps.MessageStore.getMessages(channelId)?.hasFetched ?? false,
            isChannelLoading: channelId => deps.MessageStore.isLoadingMessages(channelId),
            getPriority: channel => channel.id === deps.SelectedChannelStore.getChannelId()
                ? 0
                : channel.guild_id ? 2 : 1,
            fetchMessages: async request => {
                let cached = deps.MessageStore.getMessages(request.channelId);
                if (cached?.loadingMore) await waitForMessages(request.channelId);
                cached = deps.MessageStore.getMessages(request.channelId);
                const lastWarmed = lastWarmedAt.get(request.channelId);
                const cacheIsFresh = lastWarmed !== undefined && Date.now() - lastWarmed < WARMUP_STALE_MS;
                if (cached?.loadingMore && (cached._array?.length ?? 0) > 0) return latestMessages(cached._array ?? [], request.limit);
                if (cached?.hasFetched && cacheIsFresh) return latestMessages(cached._array ?? [], request.limit);
                await deps.MessageActions.fetchMessages?.({ channelId: request.channelId, limit: request.limit });
                if (started && jobGeneration === generation) lastWarmedAt.set(request.channelId, Date.now());
                return latestMessages(deps.MessageStore.getMessages(request.channelId)?._array ?? [], request.limit);
            },
            onMessages: (channelId, messages) => {
                const guildId = deps.ChannelStore.getChannel(channelId)?.guild_id;
                for (const message of messages) enqueueGifts(message, guildId);
            },
            onError: (_channelId, error) => {
                const status = Number((error as { status?: number; })?.status ?? 0);
                if (status === 429 || (getErrorBody(error)?.retry_after !== null && getErrorBody(error)?.retry_after !== undefined)) pauseWarmup(getRetryAt(error));
            },
            isCurrent: () => started && jobGeneration === generation && settings.store.instantMode && !isPaused() && warmupBlockedUntil <= Date.now(),
            concurrency: DEFAULT_CHANNEL_WARMUP_CONCURRENCY,
            maxChannels: WARMUP_CHANNEL_BUDGET,
            processFetched: true
        });
        attempted = result.attempted;
        unique = result.unique;
        completed = !result.stopped;
        logger.debug(`AutoRedeem channel warmup finished: ${result.processed} processed, ${result.failed} failed`);
    } catch (error) {
        logger.debug("AutoRedeem channel warmup failed:", error);
    } finally {
        if (activeWarmupRun !== runId) return;
        warmupRunning = false;
        if (jobGeneration === generation) {
            const consumed = completed ? unique : attempted;
            if (consumed > 0) warmupCursor += consumed - (warmupRunCurrentIncluded ? 1 : 0);
            if (warmupPending && settings.store.instantMode) {
                warmupPending = false;
                void warmChannels(generation);
            } else {
                scheduleNextWarmup();
            }
        } else {
            warmupPending = false;
            if (started && settings.store.instantMode) {
                warmupPending = true;
                void warmChannels(generation);
            }
        }
    }
}

function enqueueNightyGift(detection: NightyGiftDetection) {
    if (!started) return;
    if (queue.length + running >= QUEUE_CAP) {
        logger.warn("AutoRedeem queue is full; a Nighty alt gift code was dropped.");
        return;
    }
    if (isKnownCode(detection.code)) return;

    const jobId = nextJobId++;
    activeJobs.set(codeKey(detection.code), { jobId, generation });
    queue.push({
        jobId,
        generation,
        code: detection.code,
        source: "nighty",
        nighty: detection,
        immediate: true
    });
    pumpQueue();
}

async function listenForNightyAlts() {
    if (!settings.store.watchNightyAlts) return;

    const listenerId = ++altListenerId;
    try {
        const error = await Native.startNightyAltDetection();
        if (error) {
            logger.warn(error);
            return;
        }

        while (listenerId === altListenerId) {
            // A wait that finds nothing answers "idle" after a minute (the engine ends a native call that stays open for 2 minutes): ask again.
            const result: NightyWaitResult = await Native.waitForNightyGiftCode();
            if (result.status === "stopped" || listenerId !== altListenerId) return;
            if (result.status === "gift") enqueueNightyGift(result.detection);
        }
    } catch (error) {
        logger.error("Nighty alt gift detection failed.", error);
    }
}

function AutoRedeemSettingsComponent(props: { onClose(): void; }) {
    return SettingsPanel ? <SettingsPanel {...props} /> : null;
}

const plugin: PluginCode = {
    settings,
    // The legal notice, the credentials, the test-webhook button and the redeem log (the original's "AutoRedeem Logs" tab).
    settingsComponent: AutoRedeemSettingsComponent,

    async start(context) {
        ctx = context;
        deps = createDeps(ctx);
        logs = createLogStore(ctx);
        webhook = createWebhook(ctx);
        secrets = createSecretsState(ctx);
        requests = createRequestCoordinator();
        Native = nativeOf<typeof import("./native")>(ctx.native);
        const LogTab = createLogTab({ ctx, deps, store: logs });
        // Engines that offer `ctx.settingsTabs` get the logs as their own tab in Discord's settings (the original's "AutoRedeem Logs" tab); in older ones
        // the logs stay at the bottom of this plugin's own settings window. The engine takes the tab away when the plugin stops.
        const ownTabs = (ctx as EnginePluginContext & { settingsTabs?: SettingsTabsApi; }).settingsTabs;
        ownTabs?.add("logs", { title: "AutoRedeem Logs", panelTitle: "AutoRedeem Logs", Component: LogTab });
        SettingsPanel = createSettingsPanel({
            ctx,
            secrets,
            webhook,
            LegalWarning: createAutoRedeemLegalWarning(ctx),
            LogTab: ownTabs ? undefined : LogTab
        });
        ctx.onDispose(() => { SettingsPanel = undefined; requests.clear(); });

        // The page cannot read a secret, only ask whether it exists: learn which keys are saved before the first gift can arrive.
        await secrets.refresh();

        // `require()` does not wait: let Discord's REST client and stores finish loading before anything below reads them.
        await deps.ready();

        // What the original did with `onChange` of its settings and with the module-level `onExternalClaimRelease` call.
        ctx.onDispose(settings.onChange("instantMode", value => {
            if (value) requestWarmup();
        }));
        ctx.onDispose(secrets.subscribe(changed => {
            if (changed !== undefined && CAPTCHA_KEY_SECRETS.includes(changed)) handleCaptchaKeyChanged();
        }));
        const stopListeningForExternalClaims = onExternalClaimRelease(() => {
            if (!started) return;
            drainDeferredMessages();
            pumpQueue();
        });
        ctx.onDispose(() => { stopListeningForExternalClaims(); });
        ctx.onDispose(() => { window.removeEventListener("focus", handleWindowFocus); });

        started = true;
        generation++;
        running = 0;
        nextSerialStart = 0;
        queue.length = 0;
        drainingDeferred = false;
        clearCaptchaRetry();
        captchaRetryAttempt = 0;
        captchaPaused = false;
        blockedUntil = 0;
        pauseToastShown = false;
        queueFullWarningShown = false;
        warmupPending = false;
        if (pumpTimer !== undefined) clearTimeout(pumpTimer);
        if (resumeTimer !== undefined) clearTimeout(resumeTimer);
        pumpTimer = undefined;
        pumpTimerAt = 0;
        resumeTimer = undefined;
        messageCodeState.reset();
        drainDeferredMessages();
        pumpQueue();
        void logs.loadLogs();
        warmupConnection(true);
        window.addEventListener("focus", handleWindowFocus);
        void listenForNightyAlts();
        if (settings.store.instantMode) requestWarmup();
    },

    stop() {
        started = false;
        generation++;
        clearPendingQueue();
        if (deferredMessages.size > 0) logger.debug(`AutoRedeem discarded ${deferredMessages.size} deferred message(s) while stopping.`);
        deferredMessages.clear();
        drainingDeferred = false;
        running = 0;
        clearCaptchaRetry();
        captchaRetryAttempt = 0;
        captchaPaused = false;
        blockedUntil = 0;
        pauseToastShown = false;
        captchaSolvePromise = null;
        warmupPending = false;
        lastWarmedAt.clear();
        warmupCursor = 0;
        warmupRunId++;
        warmupBlockedUntil = 0;
        if (warmupRetryTimer !== undefined) clearTimeout(warmupRetryTimer);
        warmupRetryTimer = undefined;
        for (const resolver of warmupWaitResolvers) resolver();
        warmupWaitResolvers.clear();
        for (const timer of warmupWaitTimers) clearTimeout(timer);
        warmupWaitTimers.clear();
        if (warmupBatchTimer !== undefined) clearTimeout(warmupBatchTimer);
        warmupBatchTimer = undefined;
        if (pumpTimer !== undefined) clearTimeout(pumpTimer);
        if (resumeTimer !== undefined) clearTimeout(resumeTimer);
        pumpTimer = undefined;
        pumpTimerAt = 0;
        resumeTimer = undefined;
        window.removeEventListener("focus", handleWindowFocus);
        altListenerId++;
        // Native calls can be refused now (the bridge may be gone while Discord closes); a refused call here changes nothing, so it is not left unhandled.
        void Native.stopNightyAltDetection().catch(() => undefined);
        void Native.cancelAll().catch(() => undefined);
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, guildId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            enqueueGifts(message, guildId, true);
        },
        MESSAGE_UPDATE({ message, guildId }: { message: IMessageCreate["message"]; guildId?: string; }) {
            enqueueGifts(message, guildId, true);
        },
        MESSAGE_DELETE({ id }: { id: string; }) {
            deferredMessages.delete(id);
            for (const [code, observation] of pendingObservations) {
                if (observation.message.id === id) pendingObservations.delete(code);
            }
            messageCodeState.remove(id);
        },
        MESSAGE_DELETE_BULK({ ids }: { ids: string[]; }) {
            for (const id of ids) {
                deferredMessages.delete(id);
                for (const [code, observation] of pendingObservations) {
                    if (observation.message.id === id) pendingObservations.delete(code);
                }
                messageCodeState.remove(id);
            }
        }
    }
};

export default plugin;
