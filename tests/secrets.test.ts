/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NativeBridge } from "../src/api/native";
import { buildSecrets } from "../src/api/secrets";

function setup(answer: unknown | ((message: unknown) => unknown)) {
    const sent: unknown[] = [];
    const bridge: NativeBridge = async message => {
        sent.push(message);
        const value = typeof answer === "function" ? (answer as (m: unknown) => unknown)(message) : answer;
        if (value instanceof Error) throw value;
        return value;
    };
    return { secrets: buildSecrets("Pin", bridge), sent };
}

describe("buildSecrets", () => {
    it("asks whether a secret exists and only ever gets a yes or a no", async () => {
        const t = setup({ ok: true, value: true });
        assert.equal(await t.secrets.has("pinterestCookie"), true);
        assert.deepEqual(t.sent, [{ action: "has", plugin: "Pin", name: "pinterestCookie" }]);
        assert.equal(await setup({ ok: true, value: false }).secrets.has("k"), false);
        assert.equal(await setup({ ok: true, value: "secret-text" }).secrets.has("k"), false, "anything but true is no");
        assert.equal(await setup({ ok: true }).secrets.has("k"), false);
    });

    it("sends the value once, to save it, and nothing else about it", async () => {
        const t = setup({ ok: true });
        assert.equal(await t.secrets.set("pinterestCookie", "sess=1"), undefined);
        assert.deepEqual(t.sent, [{ action: "set", plugin: "Pin", name: "pinterestCookie", value: "sess=1" }]);
    });

    it("forgets a secret without sending a value", async () => {
        const t = setup({ ok: true });
        await t.secrets.clear("pinterestCookie");
        assert.deepEqual(t.sent, [{ action: "clear", plugin: "Pin", name: "pinterestCookie" }]);
    });

    it("has no way to read a secret back", () => {
        const { secrets } = setup({ ok: true });
        assert.deepEqual(Object.keys(secrets).sort(), ["clear", "has", "set"]);
    });

    it("rejects with the main process's words when it refuses", async () => {
        const t = setup({ ok: false, error: "Pin: this computer's secure storage is not available, so the secret was not saved" });
        await assert.rejects(t.secrets.set("k", "v"), { message: "Pin: this computer's secure storage is not available, so the secret was not saved" });
        await assert.rejects(setup({ ok: false }).secrets.clear("k"), { message: "Pin: the secret clear failed" });
    });

    it("rejects, naming the plugin, when the channel fails or the answer cannot be read, and never repeats the value", async () => {
        await assert.rejects(setup(new Error("Error invoking remote method")).secrets.set("k", "TOP-SECRET"), (error: Error) => {
            assert.match(error.message, /^Pin: the secret set could not be done \(Error invoking remote method\)$/);
            assert.equal(error.message.includes("TOP-SECRET"), false);
            return true;
        });
        for (const answer of [undefined, null, 5, "ok", [], { value: true }, { ok: "yes" }]) {
            await assert.rejects(setup(answer).secrets.has("k"), { message: "Pin: the main process gave an answer about a secret that cannot be read" }, JSON.stringify(answer));
        }
    });

    it("rejects, without sending anything, when there is no bridge", async () => {
        const secrets = buildSecrets("Pin", undefined);
        await assert.rejects(secrets.has("k"), /Pin: the main process is not reachable/);
        await assert.rejects(secrets.set("k", "v"), /not reachable/);
        await assert.rejects(secrets.clear("k"), /not reachable/);
    });
});
