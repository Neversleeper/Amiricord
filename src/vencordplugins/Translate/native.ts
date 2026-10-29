/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Translate (authors Ven, AshtonMemer and koish1) as found in TestCord's copy of Vencord's plugins.
// The main-process side: DeepL and Kagi do not allow the page to ask them (CORS), so the text goes from here, through Amiricord's `host.fetch` (only the three hosts in plugin.json).
// The DeepL key and the Kagi session are secrets of the plugin (the page can save them but never read them back); they are read here with `host.secret`. NOT tried with a real key.

import type { NativeHostApi } from "../../main/nativeHost";

interface Answer { status: number; data: string; }

const MAX_BYTES = 1_000_000;

async function post(host: NativeHostApi, url: string, headers: Record<string, string>, body: string): Promise<Answer> {
    try {
        const response = await host.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body, maxBytes: MAX_BYTES });
        return { status: response.status, data: await response.text() };
    } catch (error) {
        return { status: -1, data: String(error) };
    }
}

export async function deepl(host: NativeHostApi, pro: unknown, payload: unknown): Promise<Answer> {
    const key = host.secret("deeplApiKey");
    if (!key) return { status: 403, data: "no key" };
    if (typeof payload !== "string") return { status: -1, data: "bad request" };
    const url = pro === true ? "https://api.deepl.com/v2/translate" : "https://api-free.deepl.com/v2/translate";
    return post(host, url, { Authorization: `DeepL-Auth-Key ${key}` }, payload);
}

export async function kagi(host: NativeHostApi, text: unknown, sourceLang: unknown, targetLang: unknown): Promise<Answer> {
    const token = host.secret("kagiSession");
    if (!token) return { status: 401, data: "no session" };
    if (typeof text !== "string" || typeof sourceLang !== "string" || typeof targetLang !== "string") return { status: -1, data: "bad request" };
    return post(host, "https://translate.kagi.com/api/translate", { Cookie: `kagi_session=${token}` }, JSON.stringify({ text, from: sourceLang, to: targetLang, model: "standard" }));
}
