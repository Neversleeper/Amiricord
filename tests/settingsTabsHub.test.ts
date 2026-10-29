/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSettingsTabs, createSettingsTabsHub } from "../src/api/settingsTabs";

const Panel = () => null;
const Other = () => null;

describe("tabs plugins add to the settings", () => {
    it("lists a tab with a key made from the plugin, in the order added", () => {
        const hub = createSettingsTabsHub();
        assert.equal(hub.add("TokenLogin", { title: "Token Login", Component: Panel }), true);
        assert.equal(hub.add("Other", { title: "Other", panelTitle: "The other one", Component: Other }), true);
        assert.deepEqual(hub.list().map(tab => [tab.key, tab.title, tab.panelTitle]), [["plugin-TokenLogin", "Token Login", undefined], ["plugin-Other", "Other", "The other one"]]);
    });

    it("gives one tab per plugin: a second call replaces the first in the same place", () => {
        const hub = createSettingsTabsHub();
        hub.add("A", { title: "One", Component: Panel });
        hub.add("B", { title: "Two", Component: Panel });
        hub.add("A", { title: "One again", Component: Other });
        assert.deepEqual(hub.list().map(tab => tab.title), ["One again", "Two"]);
        assert.equal(hub.list()[0]!.Component, Other);
    });

    it("refuses a tab without a name, with a very long name, or without a component, and a plugin id that is not plain", () => {
        const hub = createSettingsTabsHub();
        assert.equal(hub.add("A", { title: "  ", Component: Panel }), false);
        assert.equal(hub.add("A", { title: "x".repeat(41), Component: Panel }), false);
        assert.equal(hub.add("A", { title: "Ok", Component: "nope" }), false);
        assert.equal(hub.add("A", { title: "Ok", Component: Panel, icon: "nope" as never }), false);
        assert.equal(hub.add("bad id!", { title: "Ok", Component: Panel }), false);
        assert.equal(hub.list().length, 0);
    });

    it("returns copies, so changing the list does not change the hub", () => {
        const hub = createSettingsTabsHub();
        hub.add("A", { title: "One", Component: Panel });
        hub.list()[0]!.title = "changed";
        assert.equal(hub.list()[0]!.title, "One");
    });

    it("takes a plugin's tab back when it stops", () => {
        const hub = createSettingsTabsHub();
        const callbacks: Array<() => void> = [];
        const tabs = buildSettingsTabs(hub, "A", callback => { callbacks.push(callback); });
        assert.equal(tabs.add({ title: "One", Component: Panel }), true);
        hub.add("B", { title: "Two", Component: Panel });
        for (const callback of callbacks) callback();
        assert.deepEqual(hub.list().map(tab => tab.plugin), ["B"]);
    });
});
