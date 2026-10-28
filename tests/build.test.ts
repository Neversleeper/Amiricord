/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import { build as esbuild } from "esbuild";

import { buildAll } from "../scripts/build/build";
import { nativeModulesSource, pluginModulesSource, registryView } from "../scripts/build/generate";
import { checkPlugins } from "../scripts/build/manifest/checkPlugins";
import { buildRegistry, Registry } from "../scripts/build/manifest/registry";
import { buildPluginCards } from "../src/api/pluginCards";
import { buildRendererScript } from "../src/preload/script";
import { HealthEvent } from "../src/shared/health";

const realSrc = resolve(import.meta.dirname, "..", "src");

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "amiricord-build-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

/** Run the bundled page script the way the preload would, with a fake bridge, and return what it sent. */
async function runPage(bundle: string, extra: Record<string, unknown> = {}) {
    const events: HealthEvent[] = [];
    const bridge = {
        bootInfo: { safeMode: false, safeModeReason: null, quarantine: [], enteredSafeMode: false, problems: [], devMode: false, settings: { schema: 1, plugins: {} } },
        // Objects made inside the page belong to another realm, so they are copied before they are compared.
        sendHealth: (event: HealthEvent) => { events.push(JSON.parse(JSON.stringify(event))); },
        cleanBoot: () => { /* not reached inside this test's lifetime */ },
        changeSetting: () => { /* the build test changes nothing */ }
    };
    const key = "bridgeKeyForTest";
    // The timers of the page must not keep the test process alive (the self-test waits up to a minute for Discord).
    const patientTimeout = (work: () => void, ms?: number) => { const timer = setTimeout(work, ms); timer.unref(); return timer; };
    const page = createContext({ [key]: bridge, setTimeout: patientTimeout, clearTimeout, performance, console, ...extra });
    runInContext(buildRendererScript(bundle, key), page);
    await new Promise(resolve => setTimeout(resolve, 30));
    return { events, page };
}

describe("generated modules", () => {
    it("lists plugins sorted by id with their paths encoded as strings", () => {
        const text = pluginModulesSource([
            { id: "Zed", file: "C:\\src\\plugins\\Zed\\index.ts" },
            { id: "Alpha", file: "/odd\"path/index.ts" }
        ]);
        assert.ok(text.indexOf("\"Alpha\"") < text.indexOf("\"Zed\""));
        assert.match(text, /"Alpha": \(\) => \(require\("\/odd\\"path\/index\.ts"\) as \{ default: PluginCode; \}\)\.default/);
        assert.match(text, /"Zed": \(\) => \(require\("C:\/src\/plugins\/Zed\/index\.ts"\) as \{ default: PluginCode; \}\)\.default/);
    });

    it("never imports a plugin at the top, so the code of a plugin that is off does not run", () => {
        const text = pluginModulesSource([{ id: "A", file: "/a/index.ts" }, { id: "B", file: "/b/index.ts" }]);
        assert.doesNotMatch(text, /^import (?!type)/m);
        assert.equal([...text.matchAll(/require\("/g)].length, 2);
    });

    it("is a valid, empty table when there are no plugins", () => {
        assert.match(pluginModulesSource([]), /pluginModules: Readonly<Record<string, \(\) => PluginCode>> = \{\};/);
    });

    it("gives the page what it needs to decide and to draw the plugin cards, and never secrets, paths or hashes", () => {
        const entry = {
            id: "A", core: true, enabledByDefault: false, dependencies: ["B"], startAt: "init", deferrable: true,
            name: "Alpha", version: "1.2.3", description: "Does alpha", origin: "vencord", license: "GPL-3.0-or-later",
            authors: [{ name: "Someone" }], credits: [{ name: "Original" }], tags: ["ui"], experimental: false, legacy: true, replacedBy: "Beta",
            requiresRestart: "auto", hasPatches: true, hasSettings: true, hasNative: true, discord: { minBuild: 1, maxBuild: null },
            permissions: { network: [{ host: "x.com", from: "renderer", why: "looks up" }] }, riskySettings: ["danger"],
            // These must stay out of the page:
            secrets: ["apiKey"], path: "C:\\Users\\me\\src\\plugins\\A", permissionsHash: "abc", entry: { renderer: "index.ts" }, risk: { level: "medium", reasons: [] }
        };
        const registry = { schema: 1, plugins: [entry], startOrder: ["B", "A"] } as unknown as Registry;
        const view = registryView(registry);
        assert.deepEqual(view.startOrder, ["B", "A"]);
        const { secrets: _s, path: _p, permissionsHash: _h, entry: _e, risk: _r, ...expected } = entry;
        assert.deepEqual(view.plugins, [expected]);
        const text = JSON.stringify(view);
        for (const hidden of ["apiKey", "C:\\\\Users", "abc", "index.ts"]) assert.ok(!text.includes(hidden), hidden);
    });

    it("keeps working end to end: a plugin read by the checker reaches the page with the data the cards and the switch need", () => {
        const src = join(root, "src");
        const dir = join(src, "plugins", "Patched");
        mkdirSync(dir, { recursive: true });
        for (const folder of ["vencordplugins", "equicordplugins", "testcordplugins", "betterdiscordplugins"]) mkdirSync(join(src, folder), { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id: "Patched", name: "Patched plugin", version: "2.0.0", description: "Has patches", origin: "amiricord", license: "GPL-3.0-or-later",
            authors: [{ name: "szlcx404" }], credits: [], tags: ["ui"], entry: { renderer: "index.ts" }, permissions: {}, secrets: ["mySecretSetting"]
        }));
        writeFileSync(join(dir, "index.ts"), "export default { patches: [] };\n");
        const view = registryView(buildRegistry(checkPlugins(src)));
        const [plugin] = view.plugins;
        assert.deepEqual([plugin.id, plugin.name, plugin.version, plugin.hasPatches, plugin.requiresRestart], ["Patched", "Patched plugin", "2.0.0", true, "auto"]);
        const [card] = buildPluginCards({
            plugins: view.plugins, enabledSet: { enabled: [], why: {}, skipped: {} }, choiceOf: () => undefined, build: null, stateOf: () => undefined, errorOf: () => null
        });
        assert.deepEqual([card.name, card.restartToToggle, card.risk.level], ["Patched plugin", true, "low"]);
        assert.ok(!JSON.stringify(view).includes("mySecretSetting"), "the name of a secret setting never reaches the page");
    });
});

describe("the build", () => {
    it("bundles the three parts, with the Settings plugin and its logo inside, and the page script runs and reports it", async () => {
        const summary = await buildAll({ srcRoot: realSrc, outDir: root });
        assert.equal(summary.ok, true);
        // The logo travels inside the page script as a data URL; nothing for it is loaded from the network.
        assert.match(read("renderer.js"), /data:image\/webp;base64,/);
        // Plugins adapted from other projects are in the build too; they are off by default, so only the two core plugins and the Badges plugin run (checked below).
        const registered = JSON.parse(read("registry.json")).plugins.map((p: { id: string; }) => p.id) as string[];
        assert.equal(summary.plugins, registered.length);
        assert.ok(registered.includes("NoTrack") && registered.includes("Settings"));

        // Only Electron may be required where Electron exists; the page script requires nothing.
        assert.deepEqual([...read("preload.js").matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]), ["electron"]);
        // Comments may mention "require()"; a call with a module name is what must not be there.
        assert.doesNotMatch(read("renderer.js"), /\brequire\(\s*["'`]/);
        for (const file of ["main.js", "preload.js", "renderer.js"]) assert.match(read(file), /SPDX-License-Identifier: GPL-3\.0-or-later/);

        const { events } = await runPage(read("renderer.js"));
        // The self-test also reports at once that this test page has no WebSocket to watch: "not seen", never a pass; NoTrack starts at once (stage init).
        assert.deepEqual(events.map(e => e.type), ["enabled", "discord-build", "self-test", "started"]);
        const selfTest = events.find(e => e.type === "self-test");
        assert.ok(selfTest && selfTest.type === "self-test" && selfTest.name === "first-gateway-message" && selfTest.status === "not-seen");
        assert.deepEqual(events[0], { type: "enabled", plugins: ["Badges", "NoTrack", "Settings"] });
    });

    it("includes a plugin's code in the page script and starts it", async () => {
        const src = join(root, "src");
        cpSync(realSrc, src, { recursive: true });
        // The Settings plugin imports the logo from the assets folder next to src, and the patch notes from NEWS.json.
        cpSync(join(realSrc, "..", "assets"), join(root, "assets"), { recursive: true });

        cpSync(join(realSrc, "..", "NEWS.json"), join(root, "NEWS.json"));
        const dir = join(src, "plugins", "Demo");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id: "Demo", name: "Demo", version: "1.0.0", description: "Demo plugin", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], credits: [], entry: { renderer: "index.ts" },
            permissions: {}, startAt: "init", enabledByDefault: true
        }));
        writeFileSync(join(dir, "index.ts"), "export default { start(ctx: { id: string; }) { (globalThis as Record<string, unknown>).startedBy = ctx.id; } };\n");

        const out = join(root, "dist");
        const summary = await buildAll({ srcRoot: src, outDir: out });
        assert.equal(summary.ok, true);
        assert.ok(JSON.parse(readFileSync(join(out, "registry.json"), "utf8")).plugins.some((p: { id: string; }) => p.id === "Demo"));

        const { events, page } = await runPage(readFileSync(join(out, "renderer.js"), "utf8"));
        assert.equal((page as Record<string, unknown>).startedBy, "Demo");
        assert.deepEqual(events.find(e => e.type === "enabled"), { type: "enabled", plugins: ["Badges", "Demo", "NoTrack", "Settings"] });
        assert.equal(events.some(e => e.type === "started" && e.plugin === "Demo"), true);
    });

    /** Builds the real sources plus one plugin whose file sets a flag when it is loaded (not when it starts). */
    async function buildWithFlagPlugin(enabledByDefault: boolean) {
        const src = join(root, "src");
        cpSync(realSrc, src, { recursive: true });
        cpSync(join(realSrc, "..", "assets"), join(root, "assets"), { recursive: true });

        cpSync(join(realSrc, "..", "NEWS.json"), join(root, "NEWS.json"));
        const dir = join(src, "plugins", "Flag");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id: "Flag", name: "Flag", version: "1.0.0", description: "Sets a flag when its file runs", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], credits: [], entry: { renderer: "index.ts" },
            permissions: {}, startAt: "init", enabledByDefault
        }));
        writeFileSync(join(dir, "index.ts"), "(globalThis as Record<string, unknown>).flagFileRan = true;\nexport default { start() { /* nothing */ } };\n");
        const out = join(root, "dist");
        assert.equal((await buildAll({ srcRoot: src, outDir: out })).ok, true);
        return runPage(readFileSync(join(out, "renderer.js"), "utf8"));
    }

    it("does not run any code of a plugin that is switched off, even what its file does outside start()", async () => {
        const { page, events } = await buildWithFlagPlugin(false);
        assert.deepEqual(events.find(e => e.type === "enabled"), { type: "enabled", plugins: ["Badges", "NoTrack", "Settings"] });
        assert.equal((page as Record<string, unknown>).flagFileRan, undefined);
    });

    it("still runs the code of a plugin that is switched on", async () => {
        const { page, events } = await buildWithFlagPlugin(true);
        assert.equal(events.some(e => e.type === "started" && e.plugin === "Flag"), true);
        assert.equal((page as Record<string, unknown>).flagFileRan, true);
    });

    it("builds nothing when a plugin has errors", async () => {
        const src = join(root, "src");
        cpSync(realSrc, src, { recursive: true });
        const dir = join(src, "plugins", "Broken");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), "{ not json");

        const out = join(root, "dist");
        const summary = await buildAll({ srcRoot: src, outDir: out });
        assert.equal(summary.ok, false);
        assert.throws(() => readFileSync(join(out, "renderer.js")));
    });
});

describe("native modules of the main process", () => {
    it("lists plugins sorted by id with their paths encoded, as a require inside each function and never an import", () => {
        const text = nativeModulesSource([{ id: "Zed", file: "C:\\src\\plugins\\Zed\\native.ts" }, { id: "Alpha", file: "/odd\"path/native.ts" }]);
        assert.ok(text.indexOf("\"Alpha\"") < text.indexOf("\"Zed\""));
        assert.match(text, /"Alpha": \(\) => require\("\/odd\\"path\/native\.ts"\) as Record<string, unknown>/);
        assert.match(text, /"Zed": \(\) => require\("C:\/src\/plugins\/Zed\/native\.ts"\) as Record<string, unknown>/);
        assert.doesNotMatch(text, /^import /m);
        assert.match(nativeModulesSource([]), /= \{\};/);
    });

    /** Builds the real sources plus a plugin with a native file that sets a flag when it is loaded and exports one function. */
    async function buildWithNativePlugin(extraPermissions: Record<string, unknown> = {}) {
        const src = join(root, "src");
        cpSync(realSrc, src, { recursive: true });
        cpSync(join(realSrc, "..", "assets"), join(root, "assets"), { recursive: true });

        cpSync(join(realSrc, "..", "NEWS.json"), join(root, "NEWS.json"));
        const dir = join(src, "plugins", "Nat");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id: "Nat", name: "Nat", version: "1.0.0", description: "Has native code", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], credits: [], entry: { renderer: "index.ts", main: "native.ts" },
            permissions: { native: { functions: ["ping"] }, ...extraPermissions }
        }));
        writeFileSync(join(dir, "index.ts"), "export default { start() { /* nothing */ } };\n");
        writeFileSync(join(dir, "native.ts"), "(globalThis as Record<string, unknown>).nativeFileRan = true;\nexport function ping() { return \"pong-from-native-marker\"; }\n");
        const out = join(root, "dist");
        const summary = await buildAll({ srcRoot: src, outDir: out });
        return { summary, out, src };
    }

    it("bundles the native file of a plugin into main.js and says so", async () => {
        const { summary, out } = await buildWithNativePlugin();
        assert.equal(summary.ok, true);
        assert.ok(summary.mainEntriesBundled.includes("Nat"));
        assert.match(read("dist", "main.js"), /pong-from-native-marker/);
        assert.doesNotMatch(readFileSync(join(out, "renderer.js"), "utf8"), /pong-from-native-marker/, "native code never goes into the page script");
    });

    it("bundles exactly the plugins of the registry that declare a native entry", async () => {
        const out = join(root, "dist");
        cpSync(join(realSrc, "..", "assets"), join(root, "assets"), { recursive: true });

        cpSync(join(realSrc, "..", "NEWS.json"), join(root, "NEWS.json"));
        const summary = await buildAll({ srcRoot: realSrc, outDir: out });
        assert.equal(summary.ok, true);
        const registry = JSON.parse(readFileSync(join(out, "registry.json"), "utf8")) as { plugins: Array<{ id: string; entry: { main?: string; }; }>; };
        assert.deepEqual([...summary.mainEntriesBundled].sort(), registry.plugins.filter(p => p.entry.main).map(p => p.id).sort());
    });

    it("does not run the native file until the plugin's code is asked for", async () => {
        const { src } = await buildWithNativePlugin();
        const source = nativeModulesSource([{ id: "Nat", file: join(src, "plugins", "Nat", "native.ts") }]);
        const bundled = await esbuild({ stdin: { contents: source, loader: "ts", resolveDir: src }, bundle: true, format: "cjs", write: false, platform: "node", logLevel: "silent" });
        const sandbox: { module: { exports: Record<string, unknown>; }; nativeFileRan?: boolean; globalThis?: unknown; } = { module: { exports: {} } };
        sandbox.globalThis = sandbox;
        runInContext(bundled.outputFiles[0].text, createContext({ ...sandbox, module: sandbox.module, exports: sandbox.module.exports, require: () => undefined }));
        const modules = sandbox.module.exports.nativeModules as Record<string, () => Record<string, unknown>>;
        assert.deepEqual(Object.keys(modules), ["Nat"]);
        assert.equal(sandbox.nativeFileRan, undefined);
        assert.equal(typeof modules.Nat().ping, "function");
        assert.equal((modules.Nat().ping as () => string)(), "pong-from-native-marker");
    });

    it("fails the build when a native file reaches the network without the host helper", async () => {
        const src = join(root, "src");
        cpSync(realSrc, src, { recursive: true });
        const dir = join(src, "plugins", "Leak");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id: "Leak", name: "Leak", version: "1.0.0", description: "Bypasses the helper", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], credits: [], entry: { renderer: "index.ts", main: "native.ts" },
            permissions: { native: { functions: ["go"] }, network: [{ host: "example.com", from: "main", why: "x" }] }
        }));
        writeFileSync(join(dir, "index.ts"), "export default {};\n");
        writeFileSync(join(dir, "native.ts"), "export async function go() { return fetch(\"https://example.com\"); }\n");
        assert.equal((await buildAll({ srcRoot: src, outDir: join(root, "dist") })).ok, false);
    });
});
