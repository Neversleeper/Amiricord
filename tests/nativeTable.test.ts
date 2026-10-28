/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nativeTableFromRegistry } from "../src/main/nativeTable";

interface Entry { id: string; core?: boolean; enabledByDefault?: boolean; dependencies?: string[]; functions?: string[]; network?: Array<{ host: unknown; from: string; }>; secrets?: unknown; }

function registry(entries: Entry[]): string {
    return JSON.stringify({
        schema: 1,
        plugins: entries.map(e => ({
            id: e.id, core: e.core ?? false, enabledByDefault: e.enabledByDefault ?? false, dependencies: e.dependencies ?? [],
            secrets: e.secrets,
            permissions: { network: e.network ?? [], native: { functions: e.functions ?? [] } }
        })),
        startOrder: entries.map(e => e.id)
    });
}

const code = () => ({ search: () => 1 });

function table(entries: Entry[], extra: { choices?: Record<string, boolean>; safeMode?: boolean; quarantine?: string[]; modules?: Record<string, (() => Record<string, unknown>) | undefined>; text?: string; } = {}) {
    return nativeTableFromRegistry({
        registryText: extra.text ?? registry(entries),
        safeMode: extra.safeMode ?? false,
        quarantine: extra.quarantine ?? [],
        choices: extra.choices ?? {},
        modules: extra.modules ?? { Pin: code, Other: code }
    });
}

const pin: Entry = { id: "Pin", functions: ["search", "fetchMedia"], network: [{ host: "www.pinterest.com", from: "main" }, { host: "*.pinimg.com", from: "main" }, { host: "page.example", from: "renderer" }] };

describe("nativeTableFromRegistry", () => {
    it("lists a switched-on plugin with its functions, its main-side hosts and its code", () => {
        const t = table([pin], { choices: { Pin: true } });
        assert.deepEqual(t.problems, []);
        assert.deepEqual(Object.keys(t.plugins), ["Pin"]);
        assert.deepEqual(t.plugins.Pin.functions, ["search", "fetchMedia"]);
        assert.deepEqual(t.plugins.Pin.hosts, ["www.pinterest.com", "*.pinimg.com"], "a host for the page side is not a host for native code");
        assert.equal(typeof t.plugins.Pin.load().search, "function");
    });

    it("leaves out a plugin that is switched off, by default or by choice", () => {
        assert.deepEqual(Object.keys(table([pin]).plugins), []);
        assert.deepEqual(Object.keys(table([{ ...pin, enabledByDefault: true }], { choices: { Pin: false } }).plugins), []);
        assert.deepEqual(Object.keys(table([{ ...pin, enabledByDefault: true }]).plugins), ["Pin"]);
    });

    it("leaves out plugins in safe mode and quarantined ones", () => {
        assert.deepEqual(Object.keys(table([pin], { choices: { Pin: true }, safeMode: true }).plugins), []);
        assert.deepEqual(Object.keys(table([pin], { choices: { Pin: true }, quarantine: ["Pin"] }).plugins), []);
    });

    it("leaves out a plugin with no native functions", () => {
        const t = table([{ id: "Plain" }], { choices: { Plain: true }, modules: { Plain: code } });
        assert.deepEqual(t.plugins, {});
        assert.deepEqual(t.problems, []);
    });

    it("tells, and leaves the plugin out, when the build has no native code for it", () => {
        const t = table([pin], { choices: { Pin: true }, modules: {} });
        assert.deepEqual(Object.keys(t.plugins), []);
        assert.equal(t.problems.length, 1);
        assert.match(t.problems[0], /Pin declares native functions but this build has no native code/);
    });

    it("does not take names that every object has as native code", () => {
        const t = table([{ id: "constructor", functions: ["x"] }], { choices: { constructor: true }, modules: {} });
        assert.deepEqual(Object.keys(t.plugins), []);
        assert.equal(t.problems.length, 1);
    });

    it("drops a host that is not a plain name and says so, keeping the good ones", () => {
        const t = table([{ ...pin, network: [{ host: "www.pinterest.com", from: "main" }, { host: "https://bad.example/x", from: "main" }, { host: 5, from: "main" }] }], { choices: { Pin: true } });
        assert.deepEqual(t.plugins.Pin.hosts, ["www.pinterest.com"]);
        assert.equal(t.problems.length, 2);
    });

    it("carries the secret names the plugin declared, and none when the list is missing or not a list of texts", () => {
        assert.deepEqual(table([{ ...pin, secrets: ["pinterestCookie"] }], { choices: { Pin: true } }).plugins.Pin.secrets, ["pinterestCookie"]);
        assert.deepEqual(table([pin], { choices: { Pin: true } }).plugins.Pin.secrets, []);
        assert.deepEqual(table([{ ...pin, secrets: ["a", 5] }], { choices: { Pin: true } }).plugins.Pin.secrets, []);
        assert.deepEqual(table([{ ...pin, secrets: "cookie" }], { choices: { Pin: true } }).plugins.Pin.secrets, []);
    });

    it("lists a host once, however many times it is declared", () => {
        const t = table([{ ...pin, network: [{ host: "www.pinterest.com", from: "main" }, { host: "WWW.Pinterest.com", from: "main" }, { host: "www.pinterest.com", from: "main" }] }], { choices: { Pin: true } });
        assert.deepEqual(t.plugins.Pin.hosts, ["www.pinterest.com"]);
    });

    it("gives no native code at all when the registry cannot be read", () => {
        for (const text of ["not json", "[]", JSON.stringify({ plugins: 1 }), JSON.stringify({ plugins: [], startOrder: "x" })]) {
            const t = table([], { text });
            assert.deepEqual(t.plugins, {});
            assert.equal(t.problems.length, 1, text);
        }
    });

    it("keeps a plugin that a switched-on plugin needs, even if it was switched off", () => {
        const t = table([{ id: "Other", functions: ["search"], network: [] }, { id: "Pin", functions: ["search"], dependencies: ["Other"] }], { choices: { Pin: true, Other: false } });
        assert.deepEqual(Object.keys(t.plugins).sort(), ["Other", "Pin"]);
    });
});

describe("nativeTableFromRegistry: the developer tools permission", () => {
    const withSystem = (system: unknown) => JSON.stringify({
        schema: 1,
        plugins: [{ id: "Pin", core: false, enabledByDefault: true, dependencies: [], permissions: { network: [], native: { functions: ["search"] }, ...(system === undefined ? {} : { system }) } }],
        startOrder: ["Pin"]
    });
    const entryFor = (system: unknown) => nativeTableFromRegistry({ registryText: withSystem(system), safeMode: false, quarantine: [], choices: {}, modules: { Pin: code } }).plugins.Pin;

    it("marks a plugin that declared it", () => {
        assert.equal(entryFor({ devtools: true }).devtools, true);
    });

    it("leaves it out for a plugin that declared false, did not declare it, or declared something that is not true", () => {
        for (const system of [{ devtools: false }, { clipboard: true }, undefined, {}, { devtools: "true" }, { devtools: 1 }, "x", null]) {
            const entry = entryFor(system);
            assert.ok(entry, JSON.stringify(system));
            assert.equal("devtools" in entry, false, JSON.stringify(system));
        }
    });
});
