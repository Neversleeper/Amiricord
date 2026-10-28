/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateManifest, ValidationContext } from "../scripts/build/manifest/validate";
import { canonicalPermissions, computeRisk, emptyPermissions, needsRestartToToggle, Permissions } from "../src/shared/manifest";

const OWN: ValidationContext = { folderName: "Sample", expectedOrigin: "amiricord" };

function base(overrides: Record<string, unknown> = {}) {
    return {
        schema: 1,
        id: "Sample",
        name: "Sample",
        version: "1.0.0",
        description: "A sample plugin.",
        origin: "amiricord",
        license: "GPL-3.0-or-later",
        authors: [{ name: "szlcx404", discordId: "1554284154009682032" }],
        entry: { renderer: "index.tsx" },
        permissions: {},
        ...overrides
    };
}

function errorsOf(raw: unknown, ctx = OWN): string[] {
    const r = validateManifest(raw, ctx);
    assert.equal(r.ok, false, "expected the manifest to be rejected");
    return r.ok ? [] : r.errors;
}

function hasError(errors: string[], needle: string) {
    assert.ok(errors.some(e => e.includes(needle)), `expected an error containing "${needle}", got:\n${errors.join("\n")}`);
}

describe("validateManifest: accepted manifests", () => {
    it("accepts a minimal plugin and fills the defaults", () => {
        const r = validateManifest(base(), OWN);
        assert.ok(r.ok);
        if (!r.ok) return;
        assert.equal(r.manifest.enabledByDefault, false);
        assert.equal(r.manifest.requiresRestart, "auto");
        assert.equal(r.manifest.core, false);
        assert.deepEqual(r.manifest.permissions, emptyPermissions());
        assert.equal(r.risk.level, "low");
    });

    it("accepts the PinterestTool example and rates it medium", () => {
        const r = validateManifest(base({
            id: "PinterestTool",
            name: "Pinterest Tool",
            tags: ["chat", "media"],
            dependencies: ["CommandsAPI"],
            entry: { renderer: "index.tsx", main: "native.ts" },
            permissions: {
                network: [
                    { host: "www.pinterest.com", from: "main", why: "search and session" },
                    { host: "i.pinimg.com", from: "main", why: "image download" },
                    { host: "s.pinimg.com", from: "main", why: "image download" }
                ],
                native: { functions: ["warmUp", "search", "download"] },
                system: { clipboard: true, openExternal: true }
            },
            secrets: ["pinterestCookie"]
        }), { folderName: "PinterestTool", expectedOrigin: "amiricord" });
        assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
        if (r.ok) assert.equal(r.risk.level, "medium");
    });

    it("accepts an adapted plugin that credits its original author, and rates a quest-progress writer high", () => {
        const r = validateManifest(base({
            id: "RiskyExample",
            origin: "equicord",
            authors: [{ name: "Etorix", role: "author" }, { name: "szlcx404", role: "contributor" }],
            credits: [{ name: "Etorix", license: "GPL-3.0-or-later", url: "https://github.com/Equicord/Equicord" }],
            entry: { renderer: "index.tsx", main: "native.ts" },
            permissions: {
                network: [{ host: "*.discordsays.com", from: "main", why: "activity quests" }],
                native: { functions: ["quest"] },
                account: { write: ["quest.progress"] }
            },
            riskySettings: ["allowChangingDangerousSettings"]
        }), { folderName: "RiskyExample", expectedOrigin: "equicord" });
        assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
        if (r.ok) {
            assert.equal(r.risk.level, "high");
            assert.ok(r.risk.reasons.some(x => x.includes("quest.progress")));
        }
    });
});

describe("validateManifest: rejected manifests", () => {
    it("rejects something that is not an object", () => {
        hasError(errorsOf(null), "must be an object");
        hasError(errorsOf([]), "must be an object");
    });

    it("rejects unknown fields at every level", () => {
        hasError(errorsOf(base({ surprise: 1 })), "manifest.surprise: unknown field");
        hasError(errorsOf(base({ permissions: { nework: [] } })), "permissions.nework: unknown field");
        hasError(errorsOf(base({ entry: { renderer: "index.tsx", extra: true } })), "entry.extra: unknown field");
        hasError(errorsOf(base({ authors: [{ name: "a", nick: "b" }] })), "authors[0].nick: unknown field");
    });

    it("keeps the GitHub profile link of an author and rejects anything that is not one", () => {
        const ok = validateManifest(base({ authors: [{ name: "Neversleeper", github: "https://github.com/Neversleeper" }, { name: "szlcx404", github: "https://github.com/szlcx404" }] }), OWN);
        assert.equal(ok.ok, true);
        if (ok.ok) assert.deepEqual(ok.manifest.authors.map(a => a.github), ["https://github.com/Neversleeper", "https://github.com/szlcx404"]);
        for (const bad of ["github.com/Neversleeper", "http://github.com/Neversleeper", "https://github.com/", "https://github.com/a/b", "https://github.com/Neversleeper?tab=x", "https://github.com.evil.example/x", "see https://github.com/Neversleeper", "https://github.com/-bad", "https://example.com/Neversleeper"]) {
            hasError(errorsOf(base({ authors: [{ name: "a", github: bad }] })), "authors[0].github");
        }
    });

    it("rejects a missing permissions object", () => {
        const raw = base() as Record<string, unknown>;
        delete raw.permissions;
        hasError(errorsOf(raw), "permissions: is required");
    });

    it("rejects an id that differs from the folder name", () => {
        hasError(errorsOf(base({ id: "Other" })), "must equal the plugin folder name");
    });

    it("rejects an origin that differs from the folder the plugin is in", () => {
        hasError(errorsOf(base({ origin: "vencord", credits: [{ name: "x" }] })), "because the plugin is in the");
        hasError(errorsOf(base({ origin: "elsewhere" })), "origin: must be one of");
    });

    it("rejects an adapted plugin without credits", () => {
        hasError(errorsOf(base({ origin: "testcord" }), { folderName: "Sample", expectedOrigin: "testcord" }), "credits: is required");
        hasError(errorsOf(base({ origin: "betterdiscord" }), { folderName: "Sample", expectedOrigin: "betterdiscord" }), "credits: is required");
    });

    it("rejects bad network hosts", () => {
        const bad = ["https://example.com", "example.com/path", "example.com:8080", "*", "*.com", "localhost", "EXAMPLE.com", "exa mple.com"];
        for (const host of bad) {
            const errors = errorsOf(base({ permissions: { network: [{ host, from: "main", why: "x" }] } }));
            hasError(errors, "permissions.network[0].host");
        }
    });

    it("accepts good network hosts", () => {
        for (const host of ["example.com", "www.example.com", "*.example.com", "a-b.example.co"]) {
            const r = validateManifest(base({ permissions: { network: [{ host, from: "renderer", why: "x" }] } }), OWN);
            assert.ok(r.ok, `${host}: ${r.ok ? "" : r.errors.join("\n")}`);
        }
    });

    it("requires `from` and `why` on each network entry and rejects duplicates", () => {
        hasError(errorsOf(base({ permissions: { network: [{ host: "example.com", why: "x" }] } })), "from: is required");
        hasError(errorsOf(base({ permissions: { network: [{ host: "example.com", from: "main" }] } })), "why");
        const dup = { host: "example.com", from: "main", why: "x" };
        hasError(errorsOf(base({ permissions: { network: [dup, dup] } })), "twice");
    });

    it("keeps `entry.main` and `native.functions` consistent", () => {
        hasError(errorsOf(base({ permissions: { native: { functions: ["go"] } } })), "entry.main: is required");
        hasError(errorsOf(base({ entry: { renderer: "index.tsx", main: "native.ts" } })), "must list the native functions");
    });

    it("rejects unsafe entry paths", () => {
        for (const renderer of ["../index.tsx", "/abs/index.tsx", "C:\\x\\index.tsx", "index.js", "a\\b.tsx"]) {
            hasError(errorsOf(base({ entry: { renderer } })), "entry.renderer");
        }
    });

    it("rejects wrong value types and values", () => {
        hasError(errorsOf(base({ schema: 2 })), "schema: must be 1");
        hasError(errorsOf(base({ version: "one" })), "version");
        hasError(errorsOf(base({ tags: ["nope"] })), "tags[0]");
        hasError(errorsOf(base({ authors: [] })), "authors: needs at least one author");
        hasError(errorsOf(base({ authors: [{ name: "a", discordId: "12" }] })), "discordId");
        hasError(errorsOf(base({ permissions: { token: "yes" } })), "permissions.token");
        hasError(errorsOf(base({ permissions: { files: "everything" } })), "permissions.files");
        hasError(errorsOf(base({ permissions: { system: { listen: [70000] } } })), "port number");
        hasError(errorsOf(base({ requiresRestart: "sometimes" })), "requiresRestart");
        hasError(errorsOf(base({ discord: { minBuild: 10, maxBuild: 5 } })), "minBuild cannot be greater");
    });

    it("checks the start stage and the deferrable flag", () => {
        const ok = validateManifest(base({ startAt: "domReady", deferrable: true }), OWN);
        assert.ok(ok.ok);
        if (ok.ok) {
            assert.equal(ok.manifest.startAt, "domReady");
            assert.equal(ok.manifest.deferrable, true);
        }
        const defaults = validateManifest(base(), OWN);
        assert.ok(defaults.ok);
        if (defaults.ok) {
            assert.equal(defaults.manifest.startAt, "webpackReady");
            assert.equal(defaults.manifest.deferrable, false);
        }
        hasError(errorsOf(base({ startAt: "later" })), "startAt: must be one of");
        hasError(errorsOf(base({ startAt: "init", deferrable: true })), "starts at \"init\" cannot be deferred");
        hasError(errorsOf(base({ core: true, deferrable: true })), "core plugin cannot be deferred");
        hasError(errorsOf(base({ deferrable: "yes" })), "deferrable: must be true or false");
    });

    it("rejects inconsistent flags", () => {
        hasError(errorsOf(base({ replacedBy: "Other" })), "replacedBy: only makes sense when legacy");
        hasError(errorsOf(base({ legacy: true, enabledByDefault: true })), "legacy plugin cannot be enabled by default");
        hasError(errorsOf(base({ core: true, origin: "equicord", credits: [{ name: "x" }] }), { folderName: "Sample", expectedOrigin: "equicord" }), "only plugins with origin");
        hasError(errorsOf(base({ dependencies: ["Sample"] })), "cannot depend on itself");
    });

    it("reports every problem at once, not only the first", () => {
        const errors = errorsOf(base({ version: "x", tags: ["nope"], surprise: true }));
        assert.ok(errors.length >= 3, errors.join("\n"));
    });
});

describe("computeRisk", () => {
    const withPerms = (changes: (p: Permissions) => void) => {
        const p = emptyPermissions();
        changes(p);
        return computeRisk(p);
    };

    it("is low with no permissions", () => {
        assert.deepEqual(computeRisk(emptyPermissions()), { level: "low", reasons: [] });
    });

    it("is medium for network, native code, clipboard or links", () => {
        assert.equal(withPerms(p => { p.network.push({ host: "example.com", from: "main", why: "x" }); }).level, "medium");
        assert.equal(withPerms(p => { p.native.functions.push("f"); }).level, "medium");
        assert.equal(withPerms(p => { p.system.clipboard = true; }).level, "medium");
        assert.equal(withPerms(p => { p.system.openExternal = true; }).level, "medium");
    });

    it("is high for each of the high risk permissions", () => {
        const cases: Array<(p: Permissions) => void> = [
            p => { p.account.write.push("profile.pronouns"); },
            p => { p.messages.send = true; },
            p => { p.messages.read = "all-channels"; },
            p => { p.token = true; },
            p => { p.files = "user-chosen"; },
            p => { p.files = "paths"; },
            p => { p.system.spawn = true; },
            p => { p.system.listen.push(18963); },
            p => { p.code.dynamic = true; },
            p => { p.telemetry.send.push("discord.com/api/v9/science"); }
        ];
        for (const change of cases) assert.equal(withPerms(change).level, "high");
    });

    it("does not raise the level for reading visible messages or the plugin data folder", () => {
        assert.equal(withPerms(p => { p.messages.read = "visible"; p.files = "plugin-data"; }).level, "low");
    });

    it("lists the high risk reasons before the medium ones", () => {
        const r = withPerms(p => {
            p.network.push({ host: "example.com", from: "main", why: "x" });
            p.token = true;
        });
        assert.equal(r.level, "high");
        assert.equal(r.reasons[0], "Uses your token");
        assert.ok(r.reasons[1].startsWith("Connects to"));
    });
});

describe("canonicalPermissions", () => {
    it("gives the same text whatever the order of keys and items", () => {
        const a = emptyPermissions();
        a.network.push({ host: "a.example.com", from: "main", why: "x" }, { host: "b.example.com", from: "main", why: "y" });
        a.native.functions.push("one", "two");
        const b = {
            telemetry: { send: [] }, code: { dynamic: false },
            system: { openExternal: false, listen: [], clipboard: false, spawn: false, devtools: false },
            files: "none", token: false, messages: { send: false, read: "none" },
            account: { write: [] }, native: { functions: ["two", "one"] },
            network: [{ why: "y", from: "main", host: "b.example.com" }, { host: "a.example.com", why: "x", from: "main" }]
        } as Permissions;
        assert.equal(canonicalPermissions(a), canonicalPermissions(b));
    });

    it("changes when a permission is added", () => {
        const a = emptyPermissions();
        const b = emptyPermissions();
        b.token = true;
        assert.notEqual(canonicalPermissions(a), canonicalPermissions(b));
    });
});

describe("needsRestartToToggle", () => {
    it("follows the plugin's own word, and 'auto' follows its patches", () => {
        assert.equal(needsRestartToToggle(true, false), true);
        assert.equal(needsRestartToToggle(false, true), false);
        assert.equal(needsRestartToToggle("auto", true), true);
        assert.equal(needsRestartToToggle("auto", false), false);
    });

    it("also asks for a restart for main-process code when the word is 'auto', but never overrides the plugin's own word", () => {
        assert.equal(needsRestartToToggle("auto", false, true), true);
        assert.equal(needsRestartToToggle("auto", true, true), true);
        assert.equal(needsRestartToToggle("auto", false, false), false);
        assert.equal(needsRestartToToggle(false, false, true), false);
        assert.equal(needsRestartToToggle(true, false, false), true);
    });
});

describe("permissions.system.devtools", () => {
    const fromManifest = (system: unknown) => validateManifest(base({ entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["open"] }, system } }), OWN);

    it("is false unless declared, and true when declared", () => {
        assert.equal(emptyPermissions().system.devtools, false);
        const off = fromManifest({ clipboard: true });
        assert.ok(off.ok);
        if (off.ok) assert.equal(off.manifest.permissions.system.devtools, false);
        const on = fromManifest({ devtools: true });
        assert.ok(on.ok);
        if (on.ok) assert.equal(on.manifest.permissions.system.devtools, true);
    });

    it("must be true or false", () => {
        for (const bad of ["yes", 1, null, [], {}]) {
            const r = fromManifest({ devtools: bad });
            assert.equal(r.ok, false, String(bad));
            if (!r.ok) hasError(r.errors, "permissions.system.devtools");
        }
    });

    it("still refuses a system permission it does not know", () => {
        const r = fromManifest({ devtool: true });
        assert.equal(r.ok, false);
    });

    it("makes the risk medium with its own reason, and never high by itself", () => {
        const p = emptyPermissions();
        p.system.devtools = true;
        assert.deepEqual(computeRisk(p), { level: "medium", reasons: ["Opens Discord's developer tools"] });
    });

    it("leaves the canonical text, and so the permission hash, of a plugin that does not use it exactly as it was", () => {
        const text = canonicalPermissions(emptyPermissions());
        assert.equal(text.includes("devtools"), false);
        const old = { ...emptyPermissions(), system: { openExternal: false, listen: [], clipboard: false, spawn: false } } as unknown as Permissions;
        assert.equal(canonicalPermissions(emptyPermissions()), canonicalPermissions(old));
    });

    it("changes the canonical text when it is true", () => {
        const on = emptyPermissions();
        on.system.devtools = true;
        assert.match(canonicalPermissions(on), /"devtools":true/);
        assert.notEqual(canonicalPermissions(on), canonicalPermissions(emptyPermissions()));
    });
});
