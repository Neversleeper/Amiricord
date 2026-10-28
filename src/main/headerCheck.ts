/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Check A of the privacy self-test (design 05, piece P1), now that there is a request hub: the first request to Discord's API carries the header
// `X-Super-Properties`. This reads that header once, keeps only the value of `has_client_mods`, reports it to the health report and removes itself.
// It never changes or cancels anything and never keeps another part of the header. Design: docs/analysis-14-request-hub.md section 4.

import type { HealthEvent } from "../shared/health";
import { readFlagFromSuperProperties } from "../shared/modFlag";
import type { RequestHandler } from "./requestHub";

export const HEADER_CHECK_NAME = "request-header";
export const HEADER_CHECK_MAX_MS = 60_000;

export interface HeaderCheckDeps {
    report(event: HealthEvent): void;
    now(): number;
    /** Runs `work` after `ms` and gives back a function that cancels it. */
    after(work: () => void, ms: number): () => void;
    /** Takes the handler out of the hub (called once the answer is known). */
    remove(): void;
    maxMs?: number;
}

export interface HeaderCheck {
    handler: RequestHandler;
    /** True once an answer was reported. */
    done(): boolean;
}

const isDiscordApi = (url: string): boolean => {
    try {
        const address = new URL(url);
        return address.protocol === "https:" && (address.hostname === "discord.com" || address.hostname.endsWith(".discord.com")) && address.pathname.startsWith("/api/");
    } catch {
        return false;
    }
};

export function makeHeaderCheck(deps: HeaderCheckDeps): HeaderCheck {
    const started = deps.now();
    let finished = false;
    let cancelTimer: () => void = () => undefined;

    const finish = (status: "pass" | "fail" | "not-seen", detail: string) => {
        if (finished) return;
        finished = true;
        cancelTimer();
        try {
            deps.report({ type: "self-test", name: HEADER_CHECK_NAME, status, detail, ms: Math.max(0, Math.round(deps.now() - started)) });
        } catch {
            // Reporting must never disturb a request.
        }
        try {
            deps.remove();
        } catch {
            // The hub failing to remove it only leaves an idle handler.
        }
    };

    const maxMs = deps.maxMs ?? HEADER_CHECK_MAX_MS;
    cancelTimer = deps.after(() => {
        finish("not-seen", `no request to Discord's API carried the properties header within ${Math.round(maxMs / 1000)} seconds`);
    }, maxMs);

    return {
        done: () => finished,
        handler: {
            name: HEADER_CHECK_NAME,
            beforeSendHeaders(details) {
                if (finished || !isDiscordApi(details.url) || !details.requestHeaders) return;
                const key = Object.keys(details.requestHeaders).find(k => k.toLowerCase() === "x-super-properties");
                if (!key) return;
                const value = readFlagFromSuperProperties(details.requestHeaders[key]);
                if (value === "false") finish("pass", "has_client_mods is false in the header of the first request to Discord's API");
                else if (value === "true") finish("fail", "has_client_mods is TRUE in the header of the first request to Discord's API");
                else finish("not-seen", "the properties header had no readable has_client_mods");
            }
        }
    };
}
