/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { checkPlugins, formatReport } from "../scripts/build/manifest/checkPlugins";
import { Origin, ORIGIN_FOLDERS } from "../src/shared/manifest";

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "amiricord-plugins-"));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function manifest(id: string, origin: string, extra: Record<string, unknown> = {}) {
    return {
        schema: 1,
        id,
        name: id,
        version: "1.0.0",
        description: `${id} plugin`,
        origin,
        license: "GPL-3.0-or-later",
        authors: [{ name: "szlcx404" }],
        credits: origin === "amiricord" ? [] : [{ name: "Original Author" }],
        entry: { renderer: "index.tsx" },
        permissions: {},
        ...extra
    };
}

/** Create `<root>/<origin>/<id>/` with a plugin.json and the entry files it names. */
function addPlugin(origin: Origin, id: string, extra: Record<string, unknown> = {}, files: Record<string, string> = { "index.tsx": "export {};\n" }) {
    const dir = join(root, ORIGIN_FOLDERS[origin], id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest(id, origin, extra)));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
}

describe("checkPlugins", () => {
    it("reports a missing plugins folder", () => {
        const r = checkPlugins(join(root, "does-not-exist"));
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /not found/);
    });

    it("accepts an empty tree, ignoring .gitkeep files", () => {
        for (const folder of Object.values(ORIGIN_FOLDERS)) {
            mkdirSync(join(root, folder));
            writeFileSync(join(root, folder, ".gitkeep"), "");
        }
        // Folders that are not plugin folders must be ignored.
        mkdirSync(join(root, "api"));
        mkdirSync(join(root, "utils"));
        const r = checkPlugins(root);
        assert.equal(r.ok, true);
        assert.equal(r.plugins.length, 0);
    });

    it("validates plugins from several origins and reports their risk", () => {
        addPlugin("amiricord", "NoTrack", { core: true });
        addPlugin("equicord", "RiskyExample", {
            permissions: { account: { write: ["quest.progress"] }, native: { functions: ["q"] } },
            entry: { renderer: "index.tsx", main: "native.ts" }
        }, { "index.tsx": "export {};\n", "native.ts": "export function q() {}\n" });
        const r = checkPlugins(root);
        assert.equal(r.ok, true, JSON.stringify(r, null, 2));
        const byLabel = Object.fromEntries(r.plugins.map(p => [p.label, p.risk?.level]));
        assert.deepEqual(byLabel, { "plugins/NoTrack": "low", "equicordplugins/RiskyExample": "high" });
    });

    it("fails a plugin folder with no plugin.json", () => {
        mkdirSync(join(root, "plugins", "Empty"), { recursive: true });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.plugins[0].errors[0], /plugin\.json is missing/);
    });

    it("fails a plugin.json that is not valid JSON, and accepts one with a byte order mark", () => {
        const bad = join(root, "plugins", "Broken");
        mkdirSync(bad, { recursive: true });
        writeFileSync(join(bad, "plugin.json"), "{ not json");
        const dir = addPlugin("amiricord", "WithBom");
        writeFileSync(join(dir, "plugin.json"), "﻿" + JSON.stringify(manifest("WithBom", "amiricord")));
        const r = checkPlugins(root);
        const byFolder = Object.fromEntries(r.plugins.map(p => [p.folder, p]));
        assert.equal(byFolder.Broken.ok, false);
        assert.match(byFolder.Broken.errors[0], /could not be read as JSON/);
        assert.equal(byFolder.WithBom.ok, true);
    });

    it("passes validator errors through with the plugin that caused them", () => {
        addPlugin("amiricord", "Bad", { version: "one" });
        const r = checkPlugins(root);
        assert.equal(r.plugins[0].ok, false);
        assert.ok(r.plugins[0].errors.some(e => e.startsWith("version:")));
    });

    it("flags an unknown plugins folder", () => {
        mkdirSync(join(root, "somethingplugins"), { recursive: true });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.problems[0], /unknown plugins folder "somethingplugins"/);
    });

    it("rejects a plugin whose origin does not match its folder", () => {
        const dir = join(root, "plugins", "Misplaced");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest("Misplaced", "vencord")));
        writeFileSync(join(dir, "index.tsx"), "export {};\n");
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.ok(r.plugins[0].errors.some(e => e.includes("because the plugin is in the plugins folder")));
    });

    it("flags entry files that do not exist", () => {
        addPlugin("amiricord", "NoFiles", {}, {});
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.ok(r.plugins[0].errors.some(e => e.includes("file not found: index.tsx")));
    });

    it("flags the same plugin id in two origins", () => {
        addPlugin("amiricord", "Same");
        addPlugin("vencord", "Same");
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.ok(r.problems.some(p => p.includes('"Same" is used more than once')));
    });

    it("resolves dependencies against plugins and engine APIs", () => {
        addPlugin("amiricord", "Base");
        addPlugin("amiricord", "Child", { dependencies: ["Base", "CommandsAPI"] });
        const withoutApi = checkPlugins(root);
        assert.equal(withoutApi.ok, false);
        assert.ok(withoutApi.plugins.find(p => p.folder === "Child")!.errors.some(e => e.includes('"CommandsAPI"')));

        const withApi = checkPlugins(root, { engineApis: ["CommandsAPI"] });
        assert.equal(withApi.ok, true, JSON.stringify(withApi, null, 2));
    });

    it("detects dependency cycles", () => {
        addPlugin("amiricord", "A", { dependencies: ["B"] });
        addPlugin("amiricord", "B", { dependencies: ["C"] });
        addPlugin("amiricord", "C", { dependencies: ["A"] });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.ok(r.problems.some(p => p.startsWith("dependency cycle:")), r.problems.join("\n"));
    });

    it("only warns when `replacedBy` points outside the tree", () => {
        addPlugin("amiricord", "Old", { legacy: true, replacedBy: "NewThing" });
        const r = checkPlugins(root);
        assert.equal(r.ok, true);
        assert.equal(r.plugins[0].warnings.length, 1);
    });
});

describe("formatReport", () => {
    it("lists plugins with their level and status, then a summary", () => {
        addPlugin("amiricord", "Good");
        addPlugin("amiricord", "Bad", { version: "one" });
        const text = formatReport(checkPlugins(root), "src/plugins");
        assert.match(text, /^Checking plugins in src\/plugins/);
        assert.match(text, /plugins\/Good\s+low\s+OK/);
        assert.match(text, /plugins\/Bad\s+-\s+FAILED/);
        assert.match(text, /error: version:/);
        assert.match(text, /Summary: 2 plugin\(s\), 1 ok, 1 failed/);
    });
});

describe("checkPlugins: patches and restarts", () => {
    it("records whether a plugin has patches, looking at its page-side files only", () => {
        addPlugin("amiricord", "WithPatches", {}, { "index.tsx": "export default { patches: [] };\n" });
        addPlugin("amiricord", "Without", {}, { "index.tsx": "export default {};\n" });
        addPlugin("amiricord", "MainSide", { entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["run"] } } },
            { "index.tsx": "export default {};\n", "native.ts": "const patches = []; export function run() { return patches; }\n" });
        const r = checkPlugins(root);
        const byId = Object.fromEntries(r.plugins.map(p => [p.folder, p.hasPatches]));
        assert.deepEqual(byId, { MainSide: false, Without: false, WithPatches: true });
    });

    it("refuses a plugin that says it needs no restart but has patches", () => {
        addPlugin("amiricord", "Liar", { requiresRestart: false }, { "index.tsx": "export default { patches: [] };\n" });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.plugins[0].errors.join("\n"), /requiresRestart is false, but the code has patches/);
    });

    it("accepts requiresRestart false without patches, and true or auto with them", () => {
        addPlugin("amiricord", "Hot", { requiresRestart: false });
        addPlugin("amiricord", "Forced", { requiresRestart: true }, { "index.tsx": "export default { patches: [] };\n" });
        addPlugin("amiricord", "Auto", { requiresRestart: "auto" }, { "index.tsx": "export default { patches: [] };\n" });
        assert.equal(checkPlugins(root).ok, true);
    });

    it("finds patches in a plugin even when the scan of capabilities is turned off", () => {
        addPlugin("amiricord", "P", {}, { "index.tsx": "export default { patches: [] };\n" });
        assert.equal(checkPlugins(root, { scan: false }).plugins[0].hasPatches, true);
    });
});

describe("a plugin with main-process code and requiresRestart", () => {
    const withMain = (requiresRestart: boolean | "auto") => ({
        requiresRestart, entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["run"] } }
    });
    const files = { "index.tsx": "export default {};\n", "native.ts": "export function run() { return 1; }\n" };

    it("refuses requiresRestart false, because the main process loads native code only when Discord starts", () => {
        addPlugin("amiricord", "NativeLiar", withMain(false), files);
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.plugins[0].errors.join("\n"), /requiresRestart is false, but the plugin has main-process code/);
    });

    it("accepts true and auto", () => {
        addPlugin("amiricord", "NativeAuto", withMain("auto"), files);
        addPlugin("amiricord", "NativeForced", withMain(true), files);
        assert.equal(checkPlugins(root).ok, true);
    });
});

describe("the developer tools permission in the build", () => {
    const open = { "index.tsx": "export default {};\n", "native.ts": "export async function go(host) { return host.openDevTools(); }\n" };
    const extra = (system: Record<string, unknown>) => ({ entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["go"] }, system } });

    it("refuses native code that opens the developer tools without the permission", () => {
        addPlugin("amiricord", "Open", extra({}), open);
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.plugins[0].errors.join("\n"), /S-DEVTOOLS/);
    });

    it("does not refuse the page calling a native function of the plugin that happens to be named openDevTools", () => {
        addPlugin("amiricord", "Page", { entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["openDevTools"] } } }, {
            "index.tsx": "export default { start(ctx) { ctx.native.openDevTools(); } };\n",
            "native.ts": "export async function openDevTools() { return true; }\n"
        });
        const r = checkPlugins(root);
        assert.equal(r.ok, true, r.plugins[0].errors.join("\n"));
    });

    it("accepts it with the permission, and rates the plugin medium", () => {
        addPlugin("amiricord", "Open", extra({ devtools: true }), open);
        const r = checkPlugins(root);
        assert.equal(r.ok, true, r.plugins[0].errors.join("\n"));
        assert.equal(r.plugins[0].risk?.level, "medium");
        assert.ok(r.plugins[0].risk?.reasons.includes("Opens Discord's developer tools"));
    });

    it("warns, without failing, when the permission is declared and nothing uses it", () => {
        addPlugin("amiricord", "Idle", extra({ devtools: true }), { "index.tsx": "export default {};\n", "native.ts": "export async function go() { return 1; }\n" });
        const r = checkPlugins(root);
        assert.equal(r.ok, true);
        assert.match(r.plugins[0].warnings.join("\n"), /permissions\.system\.devtools is true but no call/);
    });
});
