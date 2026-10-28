/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkValue, definePluginSettings, describeSettings, isPluginSettings, SettingsDefinition, validateDefinition } from "../src/api/pluginSettings";
import { SettingsClient } from "../src/api/settingsClient";
import { defaultSettings, SettingsChange, SettingsData } from "../src/shared/settings";

function client(initial: SettingsData = defaultSettings()) {
    const sent: SettingsChange[] = [];
    return { client: new SettingsClient(initial, change => { sent.push(change); }), sent };
}

const declared = () => definePluginSettings({
    enabledThing: { type: "boolean", default: true, description: "A switch" },
    size: { type: "number", default: 5, min: 1, max: 10, integer: true, description: "A size", restartNeeded: true },
    name: { type: "string", default: "hello", maxLength: 8, description: "A name" },
    mode: { type: "select", default: "fast", options: [{ label: "Fast", value: "fast" }, { label: "Slow", value: "slow" }], description: "A mode" }
});

describe("SettingsClient", () => {
    it("applies a change at once and sends exactly the checked change", () => {
        const { client: c, sent } = client();
        assert.equal(c.setEnabled("A", true), null);
        assert.equal(c.setValue("A", "k", [1, 2]), null);
        assert.equal(c.getEnabled("A"), true);
        assert.deepEqual(c.getValue("A", "k"), [1, 2]);
        assert.deepEqual(sent, [{ type: "plugin-enabled", plugin: "A", enabled: true }, { type: "plugin-setting", plugin: "A", key: "k", value: [1, 2] }]);
    });

    it("refuses what is not a valid change, changes nothing and sends nothing", () => {
        const { client: c, sent } = client();
        assert.ok(c.change({ type: "plugin-enabled", plugin: "__proto__", enabled: true }));
        assert.ok(c.change("nonsense"));
        assert.ok(c.setValue("A", "bad key", 1));
        assert.deepEqual(sent, []);
        assert.deepEqual(c.snapshot, defaultSettings());
    });

    it("keeps working when sending fails, and tells listeners in order, surviving one that throws", () => {
        const throwing = new SettingsClient(defaultSettings(), () => { throw new Error("main process is gone"); });
        const seen: string[] = [];
        throwing.subscribe(() => { throw new Error("broken listener"); });
        throwing.subscribe(change => { seen.push(change.type); });
        assert.equal(throwing.setEnabled("A", false), null);
        assert.equal(throwing.getEnabled("A"), false);
        assert.deepEqual(seen, ["plugin-enabled"]);
    });

    it("stops telling a listener that unsubscribed, and tells none about a refused change", () => {
        const { client: c } = client();
        let count = 0;
        const stop = c.subscribe(() => { count++; });
        c.setEnabled("A", true);
        stop();
        c.setEnabled("A", false);
        c.setValue("A", "bad key", 1);
        assert.equal(count, 1);
    });

    it("does not read a prototype property as a saved value", () => {
        const { client: c } = client();
        assert.equal(c.getValue("A", "toString"), undefined);
        c.setValue("A", "k", 1);
        assert.equal(c.getValue("A", "toString"), undefined);
        assert.equal(c.getValue("A", "constructor"), undefined);
    });
});

describe("checkValue", () => {
    it("checks every kind of setting and says what is wrong", () => {
        const s = declared().definition;
        assert.equal(checkValue(s.enabledThing, true), null);
        assert.match(checkValue(s.enabledThing, "yes") ?? "", /true or false/);
        assert.equal(checkValue(s.size, 3), null);
        assert.match(checkValue(s.size, 0) ?? "", /at least 1/);
        assert.match(checkValue(s.size, 11) ?? "", /at most 10/);
        assert.match(checkValue(s.size, 2.5) ?? "", /whole number/);
        assert.match(checkValue(s.size, NaN) ?? "", /must be a number/);
        assert.match(checkValue(s.size, "3") ?? "", /must be a number/);
        assert.equal(checkValue(s.name, "12345678"), null);
        assert.match(checkValue(s.name, "123456789") ?? "", /at most 8/);
        assert.match(checkValue(s.name, 5) ?? "", /text/);
        assert.equal(checkValue(s.mode, "slow"), null);
        assert.match(checkValue(s.mode, "medium") ?? "", /listed options/);
    });
});

describe("validateDefinition", () => {
    it("accepts a good declaration and refuses the ones that cannot work", () => {
        assert.doesNotThrow(() => declared());
        const base = { description: "d" };
        assert.throws(() => validateDefinition({ "bad key": { type: "boolean", default: true, ...base } }), /not a valid setting name/);
        assert.throws(() => validateDefinition(Object.fromEntries([["constructor", { type: "boolean", default: true, ...base }]]) as SettingsDefinition), /not a valid setting name/);
        assert.throws(() => validateDefinition({ a: { type: "boolean", default: true, description: "" } }), /description/);
        assert.throws(() => validateDefinition({ a: { type: "number", default: 20, max: 10, ...base } }), /default must be at most 10/);
        assert.throws(() => validateDefinition({ a: { type: "number", default: 5, min: 9, max: 3, ...base } }), /min is above max/);
        assert.throws(() => validateDefinition({ a: { type: "select", default: "x", options: [{ label: "A", value: "a" }], ...base } }), /listed options/);
        assert.throws(() => validateDefinition({ a: { type: "select", default: "a", options: [], ...base } }), /at least one option/);
        assert.throws(() => validateDefinition({ a: { type: "select", default: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "a" }], ...base } }), /same value/);
        assert.throws(() => validateDefinition({ a: { type: "string", default: "toolong", maxLength: 3, ...base } }), /at most 3/);
    });

    it("refuses more settings than a plugin may keep", () => {
        const many: Record<string, { type: "boolean"; default: boolean; description: string; }> = {};
        for (let i = 0; i < 201; i++) many[`s${i}`] = { type: "boolean", default: false, description: "d" };
        assert.throws(() => validateDefinition(many), /at most 200/);
    });
});

describe("definePluginSettings", () => {
    it("gives the defaults before it is attached to a plugin, and refuses to save", () => {
        const settings = declared();
        assert.equal(settings.pluginId, null);
        assert.deepEqual({ ...settings.store }, { enabledThing: true, size: 5, name: "hello", mode: "fast" });
        assert.throws(() => { settings.store.size = 3; }, /before the plugin is loaded/);
    });

    it("reads a saved value that fits, and the default for one that does not or is missing", () => {
        const { client: c } = client({ schema: 1, plugins: { P: { values: { size: 7, name: "a-name-that-is-too-long", mode: "medium", enabledThing: "yes" } } } });
        const settings = declared();
        settings.bind(c, "P");
        assert.equal(settings.pluginId, "P");
        assert.equal(settings.store.size, 7);
        assert.equal(settings.store.name, "hello", "too long: default");
        assert.equal(settings.store.mode, "fast", "not an option: default");
        assert.equal(settings.store.enabledThing, true, "wrong type: default");
    });

    it("saves what is assigned, through the client, and reads it back", () => {
        const { client: c, sent } = client();
        const settings = declared();
        settings.bind(c, "P");
        settings.store.size = 9;
        settings.store.mode = "slow";
        assert.equal(settings.store.size, 9);
        assert.deepEqual(sent, [
            { type: "plugin-setting", plugin: "P", key: "size", value: 9 },
            { type: "plugin-setting", plugin: "P", key: "mode", value: "slow" }
        ]);
        assert.equal(c.getValue("P", "size"), 9);
    });

    it("refuses a value of the wrong kind, throws, and changes nothing", () => {
        const { client: c, sent } = client();
        const settings = declared();
        settings.bind(c, "P");
        const wrong = settings.store as unknown as Record<string, unknown>;
        assert.throws(() => { wrong.size = "9"; }, TypeError);
        assert.throws(() => { wrong.size = 99; }, /at most 10/);
        assert.throws(() => { wrong.mode = "medium"; }, /listed options/);
        assert.deepEqual(sent, []);
        assert.equal(settings.store.size, 5);
    });

    it("tells onChange listeners with the new value, only for its own setting, and subscribe listeners for any of them", () => {
        const { client: c } = client();
        const settings = declared();
        settings.bind(c, "P");
        const sizes: number[] = [];
        let any = 0;
        settings.onChange("size", value => { sizes.push(value); });
        settings.subscribe(() => { any++; });
        settings.store.size = 3;
        settings.store.name = "x";
        // Another plugin's change, and a change of the owner's choice, are not this plugin's settings.
        c.setValue("Other", "size", 1);
        c.setEnabled("P", false);
        assert.deepEqual(sizes, [3]);
        assert.equal(any, 2);
    });

    it("also tells about a change made by someone else (the settings page), and about a reset of the plugin", () => {
        const { client: c } = client();
        const settings = declared();
        settings.bind(c, "P");
        const values: unknown[] = [];
        settings.onChange("name", v => { values.push(v); });
        c.setValue("P", "name", "page-x");
        c.reset("P");
        assert.deepEqual(values, ["page-x", "hello"]);
    });

    it("stops telling a listener that unsubscribed, and survives one that throws", () => {
        const { client: c } = client();
        const settings = declared();
        settings.bind(c, "P");
        let calls = 0;
        const stop = settings.onChange("size", () => { calls++; });
        settings.onChange("size", () => { throw new Error("broken"); });
        settings.store.size = 2;
        stop();
        assert.doesNotThrow(() => { settings.store.size = 3; });
        assert.equal(calls, 1);
    });

    it("reset forgets one setting or all of them, and the defaults apply again", () => {
        const { client: c } = client();
        const settings = declared();
        settings.bind(c, "P");
        settings.store.size = 9;
        settings.store.name = "x";
        settings.reset("size");
        assert.equal(settings.store.size, 5);
        assert.equal(settings.store.name, "x");
        settings.reset();
        assert.equal(settings.store.name, "hello");
        assert.deepEqual(c.snapshot.plugins, {});
    });

    it("can be attached once, and detached", () => {
        const { client: c } = client();
        const settings = declared();
        settings.bind(c, "P");
        assert.throws(() => settings.bind(c, "Q"), /already attached to "P"/);
        let calls = 0;
        settings.subscribe(() => { calls++; });
        settings.unbind();
        assert.equal(settings.pluginId, null);
        c.setValue("P", "size", 4);
        assert.equal(calls, 0);
        assert.equal(settings.store.size, 5);
    });

    it("refuses a bad declaration when it is defined, not later", () => {
        assert.throws(() => definePluginSettings({ a: { type: "number", default: 50, max: 10, description: "x" } }), /default must be at most 10/);
    });
});

describe("describeSettings and isPluginSettings", () => {
    it("describes nothing for no settings, keeps the declared order, and gives a string the default length limit", () => {
        assert.deepEqual(describeSettings(definePluginSettings({})), []);
        const s = definePluginSettings({
            z: { type: "string", default: "", description: "Z" },
            a: { type: "boolean", default: true, description: "A" }
        });
        const info = describeSettings(s);
        assert.deepEqual(info.map(i => i.key), ["z", "a"]);
        assert.equal(info[0].maxLength, 10_000);
        assert.deepEqual(Object.keys(info[1]).sort(), ["changed", "default", "description", "key", "restartNeeded", "risky", "type", "value"], "a yes/no setting carries no limits");
    });

    it("marks only the names it is told are risky, and a value that is not the default as changed", () => {
        const s = definePluginSettings({ a: { type: "number", default: 1, description: "A" }, b: { type: "number", default: 1, description: "B" } });
        const info = describeSettings(s, ["b", "ghost"]);
        assert.deepEqual(info.map(i => i.risky), [false, true]);
        assert.deepEqual(info.map(i => i.changed), [false, false]);
    });

    it("recognises the object definePluginSettings gives back and nothing else", () => {
        assert.equal(isPluginSettings(definePluginSettings({})), true);
        for (const other of [undefined, null, 5, "x", {}, { definition: {}, store: {} }, { definition: null, store: {}, reset() { /* nothing */ } }, { bind() { /* nothing */ } }]) assert.equal(isPluginSettings(other), false, String(JSON.stringify(other)));
    });
});

describe("describeSettings and the plugin's own declaration", () => {
    it("gives copies: changing what it returns never changes what the plugin declared", () => {
        const s = definePluginSettings({ mode: { type: "select", default: "a", options: [{ label: "A", value: "a" }], description: "Mode" } });
        const info = describeSettings(s);
        info[0].options!.push({ label: "Injected", value: "x" });
        info[0].options![0].label = "Changed";
        assert.deepEqual(s.definition.mode.options, [{ label: "A", value: "a" }]);
    });
});
