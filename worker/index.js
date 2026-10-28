/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The registry of people who use Amiricord, run as a Cloudflare Worker. Two jobs:
//  - POST /register  {"id": "<discord user id>"}  remembers that this account uses Amiricord (it writes only when the id is new);
//  - GET  /users     the ids, one per line, so every Amiricord can draw the "Amiricord User" badge.
// It stores nothing but the ids. The ids are not checked against Discord (nothing here can prove who sends one), and the list is public by design.
// See worker/README.md for how it is deployed.

export const ID_PATTERN = /^\d{17,20}$/;
const MAX_BODY_BYTES = 200;
const MAX_IDS = 200_000;
const LIST_CACHE_SECONDS = 600;

const reply = (status, text, headers = {}) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });

/** The id in a register request, or null when the request is not a plain {"id": "..."} with a Discord-looking id. */
export async function idOf(request) {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    try {
        const body = JSON.parse(text);
        return body && typeof body === "object" && typeof body.id === "string" && ID_PATTERN.test(body.id) ? body.id : null;
    } catch {
        return null;
    }
}

async function register(request, env) {
    const id = await idOf(request);
    if (id === null) return reply(400, "bad request");
    // A read costs nothing against the daily limit of writes, so a known id is not written again.
    if ((await env.USERS.get(id)) === null) await env.USERS.put(id, "1");
    return new Response(null, { status: 204 });
}

async function listIds(env) {
    const ids = [];
    let cursor;
    do {
        const page = await env.USERS.list({ cursor });
        for (const key of page.keys) ids.push(key.name);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor !== undefined && ids.length < MAX_IDS);
    return ids.slice(0, MAX_IDS).join("\n");
}

async function users(request, env, ctx) {
    const cache = globalThis.caches?.default;
    const key = new Request(new URL("/users", request.url).href);
    const cached = await cache?.match(key);
    if (cached) return cached;
    const answer = reply(200, await listIds(env), { "cache-control": `public, max-age=${LIST_CACHE_SECONDS}` });
    if (cache) ctx.waitUntil(cache.put(key, answer.clone()));
    return answer;
}

export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);
        if (pathname === "/register" && request.method === "POST") return register(request, env);
        if (pathname === "/users" && request.method === "GET") return users(request, env, ctx);
        return reply(404, "not found");
    }
};
