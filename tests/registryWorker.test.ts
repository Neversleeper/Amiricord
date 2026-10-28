/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import worker from "../worker/index.js";

const ID = "1564847328794382408";

function fakeEnv(initial: string[] = []) {
    const store = new Map(initial.map(id => [id, "1"]));
    const writes: string[] = [];
    return {
        writes,
        env: {
            USERS: {
                get: async (key: string) => store.get(key) ?? null,
                put: async (key: string, value: string) => { writes.push(key); store.set(key, value); },
                list: async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true })
            }
        }
    };
}
const ctx = { waitUntil: () => undefined };
const post = (path: string, body: string) => new Request(`https://registry.test${path}`, { method: "POST", body });

describe("the registry worker", () => {
    it("remembers a new id and writes nothing for one it already knows", async () => {
        const { env, writes } = fakeEnv();
        assert.equal((await worker.fetch(post("/register", JSON.stringify({ id: ID })), env, ctx)).status, 204);
        assert.equal((await worker.fetch(post("/register", JSON.stringify({ id: ID })), env, ctx)).status, 204);
        assert.deepEqual(writes, [ID], "the second registration is only a read");
    });

    it("refuses anything that is not a plain Discord id", async () => {
        const { env, writes } = fakeEnv();
        for (const body of ["", "not json", "{}", JSON.stringify({ id: 5 }), JSON.stringify({ id: "12" }), JSON.stringify({ id: `${ID}x` }), JSON.stringify({ id: "1".repeat(30) }), JSON.stringify({ id: ID, pad: "x".repeat(300) })]) {
            assert.equal((await worker.fetch(post("/register", body), env, ctx)).status, 400, body.slice(0, 30));
        }
        assert.deepEqual(writes, []);
    });

    it("lists the ids one per line, and knows no other address or method", async () => {
        const { env } = fakeEnv([ID, "1554284154009682032"]);
        const list = await worker.fetch(new Request("https://registry.test/users"), env, ctx);
        assert.equal(list.status, 200);
        assert.equal(await list.text(), `${ID}\n1554284154009682032`);
        assert.equal((await worker.fetch(new Request("https://registry.test/other"), env, ctx)).status, 404);
        assert.equal((await worker.fetch(new Request("https://registry.test/users", { method: "POST", body: "{}" }), env, ctx)).status, 404);
        assert.equal((await worker.fetch(new Request("https://registry.test/register"), env, ctx)).status, 404);
    });
});
