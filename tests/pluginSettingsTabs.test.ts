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
import { buildSettingsTabs, createSettingsTabHub, MAX_SETTINGS_TABS_PER_PLUGIN } from "../src/api/settingsTabs";
import type { EnginePluginContext, PluginCode } from "../src/renderer/engine";

const srcRoot = resolve(import.meta.dirname, "..", "src");
const Tab = () => null;

describe("the hub of settings tabs", () => {
    it("adds a tab under the key <plugin>:<key>, in the order added, and tells those who listen", () => {
        const hub = createSettingsTabHub();
        let heard = 0;
        hub.subscribe(() => { heard++; });
        assert.equal(hub.add("AutoRedeem", "logs", { title: "  Logs ", Component: Tab }), null);
        assert.equal(hub.add("Other", "logs", { title: "Other logs", panelTitle: "Panel", Component: Tab }), null);
        assert.deepEqual(hub.list().map(entry => [entry.key, entry.plugin, entry.title, entry.panelTitle]), [["AutoRedeem:logs", "AutoRedeem", "Logs", undefined], ["Other:logs", "Other", "Other logs", "Panel"]]);
        assert.equal(heard, 2);
        assert.equal(hub.version(), 2);
    });

    it("refuses a bad key, title, component or icon, a repeated key, and more than three tabs per plugin, saying why", () => {
        const hub = createSettingsTabHub();
        for (const key of ["", "a b", "-x", "x".repeat(33), "a:b", 5 as unknown as string]) assert.match(String(hub.add("P", key, { title: "T", Component: Tab })), /key of a settings tab/, String(key));
        assert.match(String(hub.add("P", "k", { title: "", Component: Tab })), /title/);
        assert.match(String(hub.add("P", "k", { title: "x".repeat(41), Component: Tab })), /title/);
        assert.match(String(hub.add("P", "k", { title: "T", Component: 5 })), /not a component/);
        assert.match(String(hub.add("P", "k", { title: "T", Component: null })), /not a component/);
        assert.match(String(hub.add("P", "k", { title: "T", Component: Tab, icon: "x" as unknown as () => unknown })), /icon/);
        assert.match(String(hub.add("P", "k", null as unknown as never)), /needs a title/);
        assert.equal(hub.list().length, 0);
        assert.equal(hub.add("P", "a", { title: "A", Component: Tab }), null);
        assert.match(String(hub.add("P", "a", { title: "A", Component: Tab })), /already a settings tab/);
        for (const key of ["b", "c"]) assert.equal(hub.add("P", key, { title: key, Component: Tab }), null);
        assert.match(String(hub.add("P", "d", { title: "D", Component: Tab })), new RegExp(`at most ${MAX_SETTINGS_TABS_PER_PLUGIN}`));
        assert.equal(hub.add("Q", "a", { title: "A", Component: Tab }), null, "the limit is per plugin");
    });

    it("takes a tab or all the tabs of a plugin away, and a broken listener does not stop the others", () => {
        const hub = createSettingsTabHub();
        let heard = 0;
        hub.subscribe(() => { throw new Error("broken"); });
        hub.subscribe(() => { heard++; });
        hub.add("P", "a", { title: "A", Component: Tab });
        hub.add("P", "b", { title: "B", Component: Tab });
        hub.add("Q", "a", { title: "A", Component: Tab });
        hub.remove("P", "a");
        assert.deepEqual(hub.list().map(entry => entry.key), ["P:b", "Q:a"]);
        hub.removeAll("P");
        assert.deepEqual(hub.list().map(entry => entry.key), ["Q:a"]);
        const before = hub.version();
        hub.remove("P", "none");
        hub.removeAll("P");
        assert.equal(hub.version(), before, "taking away what is not there changes nothing");
        assert.ok(heard >= 5);
    });
});

describe("what a plugin gets as ctx.settingsTabs", () => {
    it("adds a tab, gives back the way to take it out, and removes everything it added when the plugin stops", () => {
        const hub = createSettingsTabHub();
        const disposers: Array<() => void> = [];
        const errors: string[] = [];
        const tabs = buildSettingsTabs(hub, "AutoRedeem", undo => { disposers.push(undo); }, (source, error) => { errors.push(`${source}: ${(error as Error).message}`); });
        const removeLogs = tabs.add("logs", { title: "Logs", Component: Tab });
        tabs.add("more", { title: "More", Component: Tab });
        assert.equal(hub.list().length, 2);
        removeLogs();
        assert.deepEqual(hub.list().map(entry => entry.key), ["AutoRedeem:more"]);
        for (const undo of disposers) undo();
        assert.equal(hub.list().length, 0);
        assert.deepEqual(errors, []);
    });

    it("reports a refused tab to the health report and hands back a function that does nothing", () => {
        const hub = createSettingsTabHub();
        const errors: string[] = [];
        const tabs = buildSettingsTabs(hub, "P", () => undefined, (source, error) => { errors.push(`${source}: ${(error as Error).message}`); });
        const undo = tabs.add("bad key", { title: "T", Component: Tab });
        assert.doesNotThrow(undo);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^settings tab: the key of a settings tab/);
    });

    it("takes the short form add(tab) for a plugin with one tab (Themes and Token Login use it), under the key \"main\"", () => {
        const hub = createSettingsTabHub();
        const errors: string[] = [];
        const tabs = buildSettingsTabs(hub, "Themes", () => undefined, (source, error) => { errors.push(`${source}: ${(error as Error).message}`); });
        const remove = tabs.add({ title: "Themes", panelTitle: "Themes and Quick CSS", Component: Tab });
        assert.deepEqual(hub.list().map(entry => [entry.key, entry.title, entry.panelTitle]), [["Themes:main", "Themes", "Themes and Quick CSS"]]);
        remove();
        assert.equal(hub.list().length, 0);
        tabs.add({ title: " ", Component: Tab });
        assert.equal(errors.length, 1, "a refused short form is reported like any other");
    });
});

describe("the Settings plugin with a tab from another plugin", () => {
    type Plugin = PluginCode & { buildLayout(builder: { key?: unknown; buildLayout(): unknown; }): unknown; };
    interface Node { key?: unknown; type?: unknown; Component?: unknown; buildLayout?: () => Node[]; useTitle?: () => string; }
    let load: () => { plugin: Plugin; hub: ReturnType<typeof createSettingsTabHub>; };

    before(async () => {
        // The plugin and the hub are bundled together, so both are the same copy, as they are in the page.
        const result = await build({
            stdin: {
                contents: "import plugin from \"./plugins/Settings/index.tsx\"; import { settingsTabs as hub } from \"./api/settingsTabs\"; export { plugin, hub };",
                resolveDir: srcRoot, sourcefile: "entry.ts", loader: "ts"
            },
            ...pageOptions(srcRoot),
            bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", absWorkingDir: resolve(srcRoot, "..")
        });
        const code = result.outputFiles[0].text;
        load = () => {
            const module = { exports: {} as { plugin: Plugin; hub: ReturnType<typeof createSettingsTabHub>; } };
            // eslint-disable-next-line no-new-func -- runs the code just bundled from the project's own source
            new Function("module", "exports", code)(module, module.exports);
            return module.exports;
        };
    });

    const fakeContext = () => {
        const errors: unknown[] = [];
        const ctx = {
            id: "Settings",
            onDispose: () => undefined,
            addStyle: () => ({ update: () => undefined, remove: () => undefined }),
            reportError: (_source: string, error: unknown) => { errors.push(error); },
            finders: { byProps: () => ({ get: () => undefined }) },
            engine: { status: () => ({ version: "0.1.0", discordBuild: 650101, safeMode: false, safeModeReason: null, enteredSafeMode: false, quarantine: [], devMode: false, problems: [] }), openDataFolder: () => undefined, openHealthReport: () => undefined, openSourceCode: () => undefined },
            plugins: { cards: () => [], card: () => undefined, toggle: async () => ({ status: "unchanged" }), restart: () => undefined }
        } as unknown as EnginePluginContext;
        return { ctx, errors };
    };

    it("puts the tab after the core ones, with its own title, and draws it", async () => {
        const { plugin, hub } = load();
        const { ctx, errors } = fakeContext();
        await plugin.start!(ctx);
        assert.equal(hub.add("AutoRedeem", "logs", { title: "AutoRedeem Logs", panelTitle: "Gift logs", Component: Tab }), null);
        const section = (plugin.buildLayout({ key: "$Root", buildLayout: () => [{ key: "billing_section", type: 1 }] }) as Node[])[0];
        const keys = section.buildLayout!().map(entry => entry.key);
        assert.deepEqual(keys, ["amiricord", "privacy", "plugins", "updater", "AutoRedeem:logs"]);
        const item = section.buildLayout!()[4];
        assert.equal(item.useTitle?.(), "AutoRedeem Logs");
        const custom = item.buildLayout!()[0].buildLayout!()[0].buildLayout!()[0];
        assert.equal(typeof custom.Component, "function");
        assert.deepEqual(errors, []);
    });

    it("takes the tab out of the sidebar when the plugin that added it stops", async () => {
        const { plugin, hub } = load();
        await plugin.start!(fakeContext().ctx);
        hub.add("AutoRedeem", "logs", { title: "Logs", Component: Tab });
        hub.removeAll("AutoRedeem");
        const section = (plugin.buildLayout({ key: "$Root", buildLayout: () => [{ key: "billing_section", type: 1 }] }) as Node[])[0];
        assert.deepEqual(section.buildLayout!().map(entry => entry.key), ["amiricord", "privacy", "plugins", "updater"]);
    });
});
