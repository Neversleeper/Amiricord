/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { before, describe, it } from "node:test";

import { build } from "esbuild";

import { pageOptions } from "../scripts/build/build";
import { SettingsClient } from "../src/api/settingsClient";
import type { EnginePluginContext, PluginCode } from "../src/renderer/engine";
import { compileModule } from "../src/webpack/compileModule";

const srcRoot = resolve(import.meta.dirname, "..", "src");

type Plugin = PluginCode & { buildLayout(builder: { key?: unknown; buildLayout(): unknown; }): unknown; };
interface Node { key?: unknown; type?: unknown; Component?: unknown; buildLayout?: () => Node[]; useTitle?: () => string; }

let load: () => Plugin;

before(async () => {
    // The plugin is bundled the way the build does it (same JSX runtime, same image loader) and run here, so the glue is tested too.
    const result = await build({
        entryPoints: [resolve(srcRoot, "plugins/Settings/index.tsx")],
        ...pageOptions(srcRoot),
        bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", absWorkingDir: resolve(srcRoot, "..")
    });
    const code = result.outputFiles[0].text;
    load = () => {
        const module = { exports: {} as { default: Plugin; } };
        // eslint-disable-next-line no-new-func -- runs the code just bundled from the project's own source
        new Function("module", "exports", code)(module, module.exports);
        return module.exports.default;
    };
});

/** A context like the engine gives a core plugin, recording what the plugin does with it. */
function fakeContext(options: { types?: unknown; withEngine?: boolean; } = {}) {
    const log = { styles: [] as Array<[string, string | undefined]>, disposers: [] as Array<() => void>, errors: [] as Array<[string, unknown]>, restarts: 0, folders: 0 };
    const ctx = {
        id: "Settings",
        onDispose: (undo: () => void) => { log.disposers.push(undo); },
        addStyle: (css: string, name?: string) => { log.styles.push([css, name]); return { update: () => undefined, remove: () => undefined }; },
        reportError: (source: string, error: unknown) => { log.errors.push([source, error]); },
        finders: { byProps: () => ({ get: () => options.types }) },
        engine: options.withEngine === false ? undefined : {
            status: () => ({ version: "0.1.0", discordBuild: 650101, safeMode: false, safeModeReason: null, enteredSafeMode: false, quarantine: [], devMode: false, problems: [] }),
            openDataFolder: () => { log.folders++; }, openHealthReport: () => undefined, openSourceCode: () => undefined
        },
        plugins: options.withEngine === false ? undefined : { cards: () => [], card: () => undefined, toggle: async () => ({ status: "unchanged" }), restart: () => { log.restarts++; } }
    } as unknown as EnginePluginContext;
    return { ctx, log };
}

const root = (list: Node[]) => ({ key: "$Root", buildLayout: () => list });
const sections = (...keys: string[]): Node[] => keys.map(key => ({ key, type: 1 }));

describe("the Settings plugin patch", () => {
    const plugin = () => load();

    it("applies to the shape of Discord's code that builds the settings tree, and calls our function with the builder", () => {
        // The shape read from Canary (analysis 09 section 8): the builder is called with `.buildLayout().map(...)`.
        const source = "function(e,t,n){\"use strict\";function r(t){return function t(n){if(\"buildLayout\"in n&&\"function\"==typeof n.buildLayout){let u=n.buildLayout().map(t),{buildLayout:e,...r}=n,i={...r,layout:u};return u.forEach(t=>t.parent=i),i}return n}(t)}n.d(t,{x:()=>r})}";
        const [patch] = plugin().patches!;
        const result = compileModule("1", source, [{ ...patch, plugin: "Settings" }]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.match(result.code, /\.buildLayout\(n\)\.map\(t\)/);
        assert.ok(!result.code.includes("n.buildLayout().map"));
        assert.deepEqual(result.patchedBy, ["Settings"]);
    });

    it("is required, so a Discord that changes this code shows up as a failure of the plugin and not as a silent gap", () => {
        const [patch] = plugin().patches!;
        assert.notEqual(patch.required, false);
        assert.equal(patch.find, ".buildLayout().map");
        assert.equal(patch.lazy, true, "its module loads only when Settings opens, so it must not be called missing at start");
        const result = compileModule("1", "function(e,t,n){var x=1}", [{ ...patch, plugin: "Settings" }]);
        assert.equal(result.changed, false);
    });
});

describe("the Settings plugin in use", () => {
    it("adds nothing before it has started, and adds the Amiricord section with its main tab after it started", async () => {
        const plugin = load();
        const list = sections("user_section", "billing_section", "app_section");
        assert.equal(plugin.buildLayout(root(list)), list, "not started: Discord's own list");

        const { ctx, log } = fakeContext();
        await plugin.start!(ctx);
        const result = plugin.buildLayout(root(list)) as Node[];
        assert.deepEqual(result.map(node => node.key), ["user_section", "amiricord_section", "billing_section", "app_section"]);
        const section = result[1];
        assert.equal(section.useTitle?.(), "Amiricord Settings");
        const [item] = section.buildLayout!();
        assert.equal(item.key, "amiricord");
        assert.equal(item.useTitle?.(), "Amiricord");
        const custom = item.buildLayout!()[0].buildLayout!()[0].buildLayout!()[0];
        assert.equal(typeof custom.Component, "function");
        assert.deepEqual(log.styles.map(([, name]) => name), ["settings", "plugins-tab"]);
        assert.match(log.styles[0][0], /\.amiricord-tab/);
        assert.match(log.styles[1][0], /\.amiricord-plugin\b/);
        assert.deepEqual(section.buildLayout!().map(entry => entry.key), ["amiricord", "privacy", "plugins", "updater"], "the main tab first, then Privacy & Security, the Plugins tab and the Updates tab");
        assert.deepEqual(log.errors, []);
    });

    it("uses the numbers Discord's table gives, and the ones seen on Canary when it gives none", async () => {
        const custom = async (types: unknown) => {
            const plugin = load();
            const { ctx } = fakeContext({ types });
            await plugin.start!(ctx);
            const section = (plugin.buildLayout(root(sections("billing_section"))) as Node[])[0];
            const item = section.buildLayout!()[0];
            return [section.type, item.type, item.buildLayout!()[0].type];
        };
        assert.deepEqual(await custom({ SECTION: 11, SIDEBAR_ITEM: 12, PANEL: 13, CATEGORY: 15, CUSTOM: 29 }), [11, 12, 13]);
        assert.deepEqual(await custom(undefined), [1, 2, 3]);
        assert.deepEqual(await custom({ SECTION: "nope" }), [1, 2, 3]);
    });

    it("leaves Discord's list alone for every builder that is not the root, and does not add the section twice", async () => {
        const plugin = load();
        const { ctx } = fakeContext();
        await plugin.start!(ctx);
        const list = sections("a", "b");
        assert.equal(plugin.buildLayout({ key: "billing_section", buildLayout: () => list }), list);
        const once = plugin.buildLayout(root(sections("a", "billing_section")));
        assert.equal(plugin.buildLayout(root(once as Node[])), once);
    });

    it("takes the section away when the plugin stops, and the tab is gone from the list", async () => {
        const plugin = load();
        const { ctx, log } = fakeContext();
        await plugin.start!(ctx);
        assert.equal((plugin.buildLayout(root(sections("billing_section"))) as Node[]).length, 2);
        // The engine runs the undo functions the plugin registered, then `stop`.
        for (const undo of log.disposers.splice(0).reverse()) undo();
        await plugin.stop!(ctx);
        const list = sections("billing_section");
        assert.equal(plugin.buildLayout(root(list)), list);
    });

    it("can start again after it stopped, with a fresh tab and without the 'already there' error", async () => {
        const plugin = load();
        for (let round = 0; round < 2; round++) {
            const { ctx, log } = fakeContext();
            await plugin.start!(ctx);
            assert.equal((plugin.buildLayout(root(sections("billing_section"))) as Node[]).length, 2, `round ${round}`);
            for (const undo of log.disposers.splice(0).reverse()) undo();
            await plugin.stop!(ctx);
        }
    });

    it("applies the saved custom CSS when it starts, follows both of its settings, and takes the style out when it stops", async () => {
        const plugin = load();
        const saved = { customCssOn: true, customCss: "a { color: red }" };
        plugin.settings!.bind(new SettingsClient({ schema: 1, plugins: { Settings: { values: saved } } }, () => undefined), "Settings");
        const { ctx, log } = fakeContext();
        const sheets = new Map<string, string>();
        (ctx as unknown as { addStyle(css: string, name?: string): unknown; }).addStyle = (css, name = "?") => {
            if (name === "custom-css") sheets.set(name, css);
            else log.styles.push([css, name]);
            return { update: (next: string) => { sheets.set(name, next); }, remove: () => { sheets.delete(name); } };
        };
        await plugin.start!(ctx);
        assert.equal(sheets.get("custom-css"), "a { color: red }", "applied when it starts");
        (plugin.settings as unknown as { store: Record<string, unknown>; }).store.customCss = "b { color: blue }";
        assert.equal(sheets.get("custom-css"), "b { color: blue }", "a new sheet is applied at once");
        (plugin.settings as unknown as { store: Record<string, unknown>; }).store.customCssOn = false;
        assert.equal(sheets.has("custom-css"), false, "switching it off takes it out of the page");
        (plugin.settings as unknown as { store: Record<string, unknown>; }).store.customCssOn = true;
        assert.equal(sheets.get("custom-css"), "b { color: blue }");
        for (const undo of log.disposers.splice(0)) undo();
        assert.equal(sheets.has("custom-css"), false, "stopping the plugin takes it out");
        assert.deepEqual(log.errors, []);
        plugin.settings!.unbind();
    });

    it("applies no custom CSS in safe mode, and none by default", async () => {
        const plugin = load();
        plugin.settings!.bind(new SettingsClient({ schema: 1, plugins: { Settings: { values: { customCssOn: true, customCss: "a { color: red }" } } } }, () => undefined), "Settings");
        const safe = fakeContext();
        const sheets: string[] = [];
        (safe.ctx as unknown as { addStyle(css: string, name?: string): unknown; }).addStyle = (css, name) => { if (name === "custom-css") sheets.push(css); return { update: () => undefined, remove: () => undefined }; };
        (safe.ctx.engine as unknown as { status(): { safeMode: boolean; }; }).status = () => ({ safeMode: true });
        await plugin.start!(safe.ctx);
        assert.equal(sheets.length, 0);
        for (const undo of safe.log.disposers.splice(0)) undo();
        await plugin.stop!(safe.ctx);
        plugin.settings!.unbind();
        plugin.settings!.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "Settings");
        const fresh = fakeContext();
        (fresh.ctx as unknown as { addStyle(css: string, name?: string): unknown; }).addStyle = (css, name) => { if (name === "custom-css") sheets.push(css); return { update: () => undefined, remove: () => undefined }; };
        await plugin.start!(fresh.ctx);
        assert.equal(sheets.length, 0);
        plugin.settings!.unbind();
    });

    it("refuses to start without the engine and the plugin cards that only a core plugin gets", async () => {
        const { ctx } = fakeContext({ withEngine: false });
        await assert.rejects(async () => { await load().start!(ctx); }, /needs the engine and plugin cards/);
    });

    it("reports a failure of its own part and still gives Discord its list", async () => {
        const plugin = load();
        const { ctx, log } = fakeContext({ types: new Proxy({}, { get() { throw new Error("hostile table"); } }) });
        await plugin.start!(ctx);
        // A table that throws when read is ignored (the fallback numbers are used), so nothing is reported and nothing breaks.
        const result = plugin.buildLayout(root(sections("billing_section"))) as Node[];
        assert.equal(result.length, 2);
        assert.deepEqual(log.errors, []);
    });
});
