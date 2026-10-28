/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNative, type NativeBridge, nativeOf } from "../src/api/native";

function setup(answer: unknown | ((message: unknown) => unknown)) {
    const sent: unknown[] = [];
    const bridge: NativeBridge = async message => {
        sent.push(message);
        const value = typeof answer === "function" ? (answer as (m: unknown) => unknown)(message) : answer;
        if (value instanceof Error) throw value;
        return value;
    };
    return { native: buildNative("Pin", bridge), sent };
}

describe("buildNative", () => {
    it("sends the plugin's id, the function and the arguments, and gives back the value", async () => {
        const t = setup({ ok: true, value: { found: [1, 2] } });
        assert.deepEqual(await t.native.call("search", "cats", { page: 2 }), { found: [1, 2] });
        assert.deepEqual(t.sent, [{ plugin: "Pin", fn: "search", args: ["cats", { page: 2 }] }]);
    });

    it("accepts an answer with no value", async () => {
        const t = setup({ ok: true });
        assert.equal(await t.native.call("warmUp"), undefined);
    });

    it("rejects with the main process's own words when it says no", async () => {
        const t = setup({ ok: false, error: "Pin: search is not a declared native function." });
        await assert.rejects(t.native.call("search"), { message: "Pin: search is not a declared native function." });
    });

    it("rejects with a plain message when it says no without saying why", async () => {
        const t = setup({ ok: false });
        await assert.rejects(t.native.call("search"), { message: "Pin: search failed" });
    });

    it("rejects, naming the plugin and the function, when the channel itself fails", async () => {
        const t = setup(new Error("Error invoking remote method"));
        await assert.rejects(t.native.call("search"), { message: "Pin: search could not be called (Error invoking remote method)" });
    });

    it("rejects an answer that is not what the main process sends", async () => {
        for (const answer of [undefined, null, 5, "ok", [], { value: 1 }, { ok: "yes" }]) {
            const t = setup(answer);
            await assert.rejects(t.native.call("search"), { message: "Pin: the main process gave an answer for search that cannot be read" }, JSON.stringify(answer));
        }
    });

    it("rejects, without sending anything, when there is no bridge", async () => {
        const native = buildNative("Pin", undefined);
        await assert.rejects(native.call("search"), /Pin: the main process is not reachable/);
    });
});

describe("nativeOf", () => {
    interface Native { search(host: unknown, query: string, page: number): Promise<string[]>; warmUp(host: unknown): void; }

    it("turns each name into a call, without the host parameter", async () => {
        const t = setup({ ok: true, value: ["a"] });
        const view = nativeOf<Native>(t.native);
        const found: string[] = await view.search("cats", 3);
        assert.deepEqual(found, ["a"]);
        assert.deepEqual(t.sent, [{ plugin: "Pin", fn: "search", args: ["cats", 3] }]);
    });

    it("is never taken for a promise, and gives nothing for symbols", () => {
        const view = nativeOf<Native>(setup({ ok: true }).native) as unknown as Record<string | symbol, unknown>;
        assert.equal(view.then, undefined);
        assert.equal(view[Symbol.iterator], undefined);
        assert.equal(typeof view.warmUp, "function");
    });

    it("lets the view be awaited without calling anything", async () => {
        const t = setup({ ok: true });
        const view = nativeOf<Native>(t.native);
        // A view that looked like a promise would never settle, so the wait has a limit and fails instead of hanging the test run.
        const settled = await Promise.race([Promise.resolve(view), new Promise<string>(resolve => { setTimeout(() => { resolve("never settled"); }, 200).unref(); })]);
        assert.equal(settled, view);
        assert.deepEqual(t.sent, []);
    });
});
