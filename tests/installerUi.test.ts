/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { colorsEnabled, makeStyle, stripAnsi } from "../src/installer/ui/ansi";
import { Key, KeySource, toKey } from "../src/installer/ui/keys";
import { applyKey, MenuItem, renderMenu, selectMenu } from "../src/installer/ui/menu";

const plain = makeStyle(false);

describe("colors", () => {
    it("are off for a pipe, NO_COLOR and a dumb terminal, and on for a normal terminal", () => {
        assert.equal(colorsEnabled({}, true), true);
        assert.equal(colorsEnabled({}, false), false);
        assert.equal(colorsEnabled({ NO_COLOR: "1" }, true), false);
        assert.equal(colorsEnabled({ NO_COLOR: "" }, true), true);
        assert.equal(colorsEnabled({ TERM: "dumb" }, true), false);
    });

    it("add codes when on, add nothing when off, and strip back to the same text", () => {
        const on = makeStyle(true);
        assert.notEqual(on.green("ok"), "ok");
        assert.equal(stripAnsi(on.bold(on.cyan("ok"))), "ok");
        assert.equal(plain.green("ok"), "ok");
        assert.equal(stripAnsi("\u001b[2Aa\u001b[0Jb"), "ab");
    });
});

describe("toKey", () => {
    it("maps the keys the menus use and ignores the rest", () => {
        assert.deepEqual(toKey(undefined, { name: "up" }), { name: "up" });
        assert.deepEqual(toKey(undefined, { name: "down" }), { name: "down" });
        assert.deepEqual(toKey("\r", { name: "return" }), { name: "enter" });
        assert.deepEqual(toKey("\r", { name: "enter" }), { name: "enter" });
        assert.deepEqual(toKey("\u001b", { name: "escape" }), { name: "escape" });
        assert.deepEqual(toKey("\u0003", { name: "c", ctrl: true }), { name: "interrupt" });
        assert.deepEqual(toKey("3", { name: "3" }), { name: "digit", digit: 3 });
        assert.deepEqual(toKey("0", undefined), { name: "digit", digit: 0 });
        for (const other of [toKey("a", { name: "a" }), toKey("", undefined), toKey(undefined, undefined), toKey("12", undefined)]) assert.equal(other, null);
    });
});

const items: MenuItem<string>[] = [
    { label: "Canary · app-1.0.1 · not patched", detail: "C:\\x", value: "canary" },
    { label: "Stable · app-1.0.2 · patched", tone: "good", value: "stable" },
    { label: "PTB", value: "ptb" }
];

describe("renderMenu", () => {
    it("shows a pointer on the chosen line, numbers, details and the help line", () => {
        const lines = renderMenu("Which Discord?", items, 1, plain);
        assert.equal(lines[0], "Which Discord?");
        assert.equal(lines[1], "  1. Canary · app-1.0.1 · not patched  C:\\x");
        assert.equal(lines[2], "› 2. Stable · app-1.0.2 · patched");
        assert.equal(lines[3], "  3. PTB");
        assert.match(lines[4], /Enter to choose/);
    });

    it("paints the chosen line and tones when colors are on", () => {
        const lines = renderMenu("t", items, 0, makeStyle(true));
        assert.ok(lines[1].includes("\u001b[36m"));
        assert.ok(lines[2].includes("\u001b[32m"));
        assert.equal(stripAnsi(lines[1]), renderMenu("t", items, 0, plain)[1]);
    });
});

describe("applyKey", () => {
    it("moves with wrap-around, chooses, cancels and jumps by digit", () => {
        assert.deepEqual(applyKey(0, 3, { name: "up" }), { selected: 2 });
        assert.deepEqual(applyKey(2, 3, { name: "down" }), { selected: 0 });
        assert.deepEqual(applyKey(1, 3, { name: "enter" }), { chosen: 1 });
        assert.deepEqual(applyKey(1, 3, { name: "escape" }), { cancelled: true });
        assert.deepEqual(applyKey(1, 3, { name: "interrupt" }), { cancelled: true });
        assert.deepEqual(applyKey(0, 3, { name: "digit", digit: 3 }), { chosen: 2 });
    });

    it("ignores a digit that points at nothing", () => {
        assert.deepEqual(applyKey(1, 3, { name: "digit", digit: 4 }), { selected: 1 });
        assert.deepEqual(applyKey(1, 3, { name: "digit", digit: 0 }), { selected: 1 });
    });
});

function scripted(...keys: Array<Key | null>): KeySource {
    const queue = [...keys];
    return { next: async () => (queue.length ? queue.shift() ?? null : null) };
}

describe("selectMenu", () => {
    const run = (keys: KeySource, initial?: number) => {
        let out = "";
        return selectMenu({ out: t => { out += t; }, style: plain, keys }, "Pick", items, initial).then(value => ({ value, out: () => out }));
    };

    it("returns the value under the pointer on Enter, starting at the first item", async () => {
        assert.equal((await run(scripted({ name: "enter" }))).value, "canary");
        assert.equal((await run(scripted({ name: "down" }, { name: "down" }, { name: "enter" }))).value, "ptb");
        assert.equal((await run(scripted({ name: "up" }, { name: "enter" }))).value, "ptb");
    });

    it("honors the first selected item and digit shortcuts", async () => {
        assert.equal((await run(scripted({ name: "enter" }), 1)).value, "stable");
        assert.equal((await run(scripted({ name: "digit", digit: 3 }))).value, "ptb");
    });

    it("returns null on Esc, Ctrl+C and when the input ends", async () => {
        assert.equal((await run(scripted({ name: "escape" }))).value, null);
        assert.equal((await run(scripted({ name: "interrupt" }))).value, null);
        assert.equal((await run(scripted())).value, null);
    });

    it("redraws over itself when the pointer moves, and returns null for an empty menu", async () => {
        const { out } = await run(scripted({ name: "down" }, { name: "enter" }));
        assert.match(out(), /\u001b\[5A\u001b\[0J/);
        assert.equal(await selectMenu({ out: () => undefined, style: plain, keys: scripted() }, "t", []), null);
    });
});
