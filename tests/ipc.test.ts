/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEV_DUMP_MAX_BYTES, IPC, isTrustedSender, parseDevDump, parseHealthEvent } from "../src/shared/ipc";

describe("isTrustedSender", () => {
    it("accepts Discord's pages over https", () => {
        for (const url of ["https://discord.com/app", "https://canary.discord.com/channels/@me", "https://ptb.discord.com/"]) {
            assert.equal(isTrustedSender(url), true, url);
        }
    });

    it("rejects look-alikes, other schemes and non-text values", () => {
        for (const url of [
            "https://evildiscord.com/", "https://discord.com.evil.net/", "http://discord.com/", "file:///C:/x.html",
            "https://discord.com@evil.net/", "devtools://devtools/bundled/x.html", "not a url", "", undefined, null, 5
        ]) {
            assert.equal(isTrustedSender(url), false, String(url));
        }
    });
});

describe("IPC channel names", () => {
    it("are distinct and carry the project name", () => {
        const names = Object.values(IPC);
        assert.equal(new Set(names).size, names.length);
        for (const name of names) assert.match(name, /^amiricord:/);
    });
});

describe("parseHealthEvent", () => {
    it("accepts every kind of event and keeps its fields", () => {
        const events = [
            { type: "patch", plugin: "A", find: "f", moduleId: "1", required: true, status: "failed", replacements: [{ match: "m", status: "errored", error: "boom" }] },
            { type: "patch-no-module", plugin: "A", find: "f", required: false },
            { type: "start-failed", plugin: "A", error: "x" },
            { type: "started", plugin: "A", ms: 12 },
            { type: "runtime-error", plugin: "A", source: "s", error: "x" },
            { type: "finder-miss", plugin: "A", finder: "props(\"a\")", required: true },
            { type: "discord-changed", plugin: "A", find: "f", detail: "d" },
            { type: "enabled", plugins: ["A", "B"] },
            { type: "discord-build", build: 123 },
            { type: "discord-build", build: null }
        ];
        for (const event of events) assert.deepEqual(parseHealthEvent(event), event);
    });

    it("drops fields it does not know", () => {
        const parsed = parseHealthEvent({ type: "started", plugin: "A", ms: 1, extra: "x", __proto__: { evil: 1 } });
        assert.deepEqual(parsed, { type: "started", plugin: "A", ms: 1 });
    });

    it("rejects anything malformed", () => {
        const bad: unknown[] = [
            null, undefined, 5, "x", [], {}, { type: 5 }, { type: "nope" },
            { type: "started", plugin: "A", ms: "1" }, { type: "started", plugin: "A", ms: Infinity },
            { type: "start-failed", plugin: 1, error: "x" },
            { type: "enabled", plugins: ["A", 2] },
            { type: "discord-build", build: "1" },
            { type: "patch", plugin: "A", find: "f", moduleId: "1", required: true, status: "weird", replacements: [] },
            { type: "patch", plugin: "A", find: "f", moduleId: "1", required: true, status: "applied", replacements: [{ match: "m", status: "weird" }] },
            { type: "patch", plugin: "A", find: "f", moduleId: "1", required: true, status: "applied", replacements: "x" }
        ];
        for (const value of bad) assert.equal(parseHealthEvent(value), null, JSON.stringify(value));
    });
});

describe("parseDevDump", () => {
    it("accepts a plain name and a text, and keeps only those two fields", () => {
        assert.deepEqual(parseDevDump({ name: "settings-1", text: "{}", extra: 1 }), { name: "settings-1", text: "{}" });
    });

    it("refuses names that could be a path or are not plain", () => {
        for (const name of ["", "..", "../x", "a/b", "a\\b", "A", "a b", "a.json", "x".repeat(41), "name\u0000", 5]) {
            assert.equal(parseDevDump({ name, text: "x" }), null, String(name));
        }
    });

    it("refuses a text over 1 MB, counted in bytes, and anything that is not text", () => {
        assert.notEqual(parseDevDump({ name: "ok", text: "x".repeat(DEV_DUMP_MAX_BYTES) }), null);
        assert.equal(parseDevDump({ name: "ok", text: "x".repeat(DEV_DUMP_MAX_BYTES + 1) }), null);
        // Two-byte characters: half a million of them is already over the limit.
        assert.equal(parseDevDump({ name: "ok", text: "é".repeat(DEV_DUMP_MAX_BYTES / 2 + 1) }), null);
        for (const value of [null, undefined, "x", [], { name: "ok" }, { text: "x" }, { name: "ok", text: 5 }]) assert.equal(parseDevDump(value), null);
    });
});

describe("the project version", () => {
    it("is the version of package.json, so the settings page does not show a stale number", async () => {
        const { readFileSync } = await import("node:fs");
        const { PROJECT_VERSION } = await import("../src/shared/project");
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; };
        assert.equal(PROJECT_VERSION, pkg.version);
    });
});
