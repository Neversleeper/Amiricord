/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { probeTopBar, TOP_BAR_DELAY_MS, TOP_BAR_SCRIPT, topBarLines } from "../src/main/topBarProbe";

describe("the shapes of the top of the page", () => {
    it("the script reads shapes only: no text, and the only label kept is one of a window button", () => {
        assert.doesNotMatch(TOP_BAR_SCRIPT, /textContent|innerText|innerHTML|value\b/);
        assert.match(TOP_BAR_SCRIPT, /minimize\|maximize\|restore\|close/);
    });

    it("writes one line per element, with its class, role, button label, place and size", () => {
        const lines = topBarLines([["div", "bar  x", "", "", 0, 0, 100, 22], ["div", "", "button", "Minimize", 5, 3, 20, 20]]);
        assert.deepEqual(lines, ["top bar: <div> class=\"bar x\" at 0,0 size 100x22", "top bar: <div> class=\"\" role=button label=Minimize at 5,3 size 20x20"]);
    });

    it("keeps at most 40 lines, skips rows of the wrong shape, and says so when nothing is usable", () => {
        assert.equal(topBarLines(Array.from({ length: 70 }, () => ["i", "", "", "", 0, 0, 1, 1])).length, 40);
        assert.deepEqual(topBarLines([["div", "a"], "x", null, ["div", 1, "", "", 0, 0, 1, 1]]), ["top bar: no elements were found in the top of the page"]);
        assert.deepEqual(topBarLines("nope"), ["top bar: the page gave no rows"]);
    });
});

describe("probing the top of the page", () => {
    const setup = (page: Parameters<typeof probeTopBar>[0]) => {
        const lines: string[] = [];
        const scheduled: Array<{ run: () => void; ms: number; }> = [];
        probeTopBar(page, text => { lines.push(text); }, (run, ms) => { scheduled.push({ run, ms }); });
        return { lines, scheduled };
    };

    it("waits, and then reads a window that shows Discord's app, once", async () => {
        const t = setup({ getURL: () => "https://discord.com/channels/@me", executeJavaScript: () => Promise.resolve([["div", "bar", "", "", 0, 0, 9, 9]]) });
        assert.equal(t.scheduled.length, 1);
        assert.equal(t.scheduled[0].ms, TOP_BAR_DELAY_MS);
        t.scheduled[0].run();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(t.lines, ["top bar: <div> class=\"bar\" at 0,0 size 9x9"]);
    });

    it("leaves other windows alone, and a window that is gone", () => {
        let asked = 0;
        const other = setup({ getURL: () => "https://example.com/", executeJavaScript: () => { asked++; return Promise.resolve([]); } });
        other.scheduled[0].run();
        const gone = setup({ getURL: () => "https://discord.com/app", isDestroyed: () => true, executeJavaScript: () => { asked++; return Promise.resolve([]); } });
        gone.scheduled[0].run();
        assert.equal(asked, 0);
    });

    it("writes a failure in the trace instead of throwing", async () => {
        const rejects = setup({ getURL: () => "https://discord.com/app", executeJavaScript: () => Promise.reject(new Error("page closed")) });
        rejects.scheduled[0].run();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(rejects.lines, ["top bar: could not be read: page closed"]);
        const throws = setup({ getURL: () => "https://discord.com/app", executeJavaScript: () => { throw new Error("no page"); } });
        assert.doesNotThrow(() => { throws.scheduled[0].run(); });
        assert.deepEqual(throws.lines, ["top bar: could not be read: no page"]);
    });
});
