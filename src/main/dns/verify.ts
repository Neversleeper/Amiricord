/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The check of a DNS-over-HTTPS provider (design 05, piece P6b): ask it a real question and see whether a real DNS answer comes back, the way RFC 8484 says (a POST of the
// binary message), before encrypted DNS is applied. The request function comes in from outside (`fetch` in the program, a made-up one in the tests), so nothing here needs a network.
// It asks for `discord.com`, waits at most 3 seconds, reads at most 4 KB, refuses to follow a redirect, and says in plain words why a provider was not accepted.
// It never puts into a sentence the text of an error that came from the network, only fixed words and short error codes. Design: docs/analysis-21-encrypted-dns.md section 5.

import { buildQuery, MAX_ANSWER_BYTES, readAnswer } from "./message";

export const VERIFY_NAME = "discord.com";
export const VERIFY_TIMEOUT_MS = 3000;
const TEMPLATE = "{?dns}";

/** What the check needs from `fetch`: only these fields are read. */
export interface FetchResponse {
    status: number;
    headers: { get(name: string): string | null; };
    body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array; }>; cancel(): Promise<void>; }; } | null;
}

export type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: Uint8Array; redirect: "error"; signal: AbortSignal; }) => Promise<FetchResponse>;

export interface VerifyDeps {
    fetch: FetchLike;
    /** Milliseconds, any steady clock. */
    now(): number;
    timeoutMs?: number;
    /** Runs `work` after `ms` and gives back a function that cancels it. */
    after(work: () => void, ms: number): () => void;
}

export interface VerifyResult {
    ok: boolean;
    /** In plain words; empty when `ok`. */
    reason: string;
    /** How long the question took, in milliseconds. Meaningful when `ok`. */
    ms: number;
}

/** A short error code such as `ENOTFOUND`, or nothing: never the message the network gave. */
function codeOf(error: unknown): string {
    const cause = (error as { cause?: { code?: unknown; }; code?: unknown; } | null);
    const code = cause?.cause?.code ?? cause?.code;
    return typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : "";
}

/** Read at most `limit` bytes of the body, then stop. Null when there is more than `limit`. */
async function readLimited(response: FetchResponse, limit: number): Promise<Uint8Array | null> {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            size += value.length;
            if (size > limit) {
                await reader.cancel().catch(() => undefined);
                return null;
            }
            chunks.push(value);
        }
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    return all;
}

/** Ask the provider at `address` (the plain address, or a template with the `{?dns}` ending) for `discord.com`. Never throws. */
export async function verifyProvider(address: string, deps: VerifyDeps): Promise<VerifyResult> {
    const started = deps.now();
    const timeout = deps.timeoutMs ?? VERIFY_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const cancelTimer = deps.after(() => { timedOut = true; controller.abort(); }, timeout);
    const elapsed = () => Math.max(0, Math.round(deps.now() - started));
    const refuse = (reason: string): VerifyResult => ({ ok: false, reason, ms: elapsed() });
    try {
        const url = address.endsWith(TEMPLATE) ? address.slice(0, -TEMPLATE.length) : address;
        const response = await deps.fetch(url, {
            method: "POST",
            headers: { "content-type": "application/dns-message", accept: "application/dns-message" },
            body: buildQuery(VERIFY_NAME),
            redirect: "error",
            signal: controller.signal
        });
        if (response.status !== 200) return refuse(`the provider answered with the HTTP code ${Number.isInteger(response.status) ? response.status : "?"}, not 200`);
        const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (type !== "application/dns-message") return refuse("the provider did not answer in the standard DNS format (it may need another address)");
        const bytes = await readLimited(response, MAX_ANSWER_BYTES);
        if (bytes === null) return refuse("the answer is too large to be a DNS answer");
        const answer = readAnswer(bytes, VERIFY_NAME);
        if (!answer.ok) return refuse(answer.reason);
        return { ok: true, reason: "", ms: elapsed() };
    } catch (error) {
        if (timedOut) return refuse(`the provider did not answer within ${Math.round(timeout / 1000)} seconds`);
        const code = codeOf(error);
        return refuse(code ? `the provider could not be reached (${code})` : "the provider could not be reached");
    } finally {
        cancelTimer();
    }
}
