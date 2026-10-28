/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SettingInfo } from "../src/api/pluginSettings";
import { boxText, checkNumber, checkText, emptyText, NONE_TEXT, OFF_TEXT, optionLabel, settingTitle } from "../src/plugins/Settings/pluginWindowModel";

const info = (over: Partial<SettingInfo> = {}): SettingInfo => ({ key: "size", type: "number", description: "A size", default: 5, value: 5, changed: false, restartNeeded: false, risky: false, ...over });

describe("what the window says when there is nothing to edit", () => {
    it("says to turn the plugin on when its settings cannot be read, and that there are none otherwise", () => {
        assert.equal(emptyText({ state: "not-loaded" }), OFF_TEXT);
        assert.equal(emptyText({ state: "none" }), NONE_TEXT);
        assert.equal(emptyText({ state: "ready", settings: [] }), NONE_TEXT);
    });

    it("says nothing when there are settings to show", () => {
        assert.equal(emptyText({ state: "ready", settings: [info()] }), null);
    });
});

describe("checking a number typed in a box", () => {
    it("accepts a number inside its limits, with spaces around it, and a decimal when the setting allows it", () => {
        assert.deepEqual(checkNumber(" 7 ", { min: 1, max: 10, integer: true }), { ok: true, value: 7 });
        assert.deepEqual(checkNumber("2.5", { min: 1, max: 10 }), { ok: true, value: 2.5 });
        assert.deepEqual(checkNumber("-3", {}), { ok: true, value: -3 });
        assert.deepEqual(checkNumber("1", { min: 1, max: 1 }), { ok: true, value: 1 }, "the limits themselves are allowed");
    });

    it("says why when it is empty, not a number, not whole, or out of its limits", () => {
        assert.deepEqual(checkNumber("", {}), { ok: false, error: "Type a number." });
        assert.deepEqual(checkNumber("   ", {}), { ok: false, error: "Type a number." });
        assert.deepEqual(checkNumber("abc", {}), { ok: false, error: "That is not a number." });
        assert.deepEqual(checkNumber("Infinity", {}), { ok: false, error: "That is not a number." });
        assert.deepEqual(checkNumber("2.5", { integer: true }), { ok: false, error: "It must be a whole number." });
        assert.deepEqual(checkNumber("0", { min: 1 }), { ok: false, error: "It must be at least 1." });
        assert.deepEqual(checkNumber("11", { max: 10 }), { ok: false, error: "It must be at most 10." });
    });
});

describe("checking a text typed in a box", () => {
    it("allows any text up to the limit and says why when it is longer", () => {
        assert.equal(checkText("12345678", { maxLength: 8 }), null);
        assert.equal(checkText("123456789", { maxLength: 8 }), "It must be at most 8 characters.");
        assert.equal(checkText("anything", {}), null);
    });
});

describe("what a box shows", () => {
    it("shows what is being typed, or the value in use", () => {
        assert.equal(boxText(info({ value: 5 }), undefined), "5");
        assert.equal(boxText(info({ value: 5 }), "12"), "12");
        assert.equal(boxText(info({ value: "hi" }), ""), "", "an emptied box stays empty while typing");
    });

    it("names the chosen option, or the value itself when it is no longer an option", () => {
        const options = [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }];
        assert.equal(optionLabel({ options, value: "b" }), "Beta");
        assert.equal(optionLabel({ options, value: "z" }), "z");
        assert.equal(optionLabel({ value: 3 }), "3");
    });
});

describe("the title of a setting", () => {
    it("makes a readable title from the name", () => {
        assert.equal(settingTitle("randomizeSearch"), "Randomize Search");
        assert.equal(settingTitle("show_all"), "Show all");
        assert.equal(settingTitle("size"), "Size");
        assert.equal(settingTitle("useHTTPSOnly"), "Use HTTPS Only");
        assert.equal(settingTitle("a-b"), "A b");
        assert.equal(settingTitle("___"), "___", "a name with nothing readable is kept as it is");
    });
});
