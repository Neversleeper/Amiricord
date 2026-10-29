/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consoleErrorLine, makeConsoleErrorListener } from "../src/main/consoleErrors";

describe("page errors copied to the boot trace", () => {
    it("reads the old shape of the event (separate arguments) and only for errors", () => {
        assert.equal(consoleErrorLine([{}, 3, "boom", 12, "https://x/app.js"]), "boom (app.js:12)".replace("app.js", "https://x/app.js"));
        assert.equal(consoleErrorLine([{}, 1, "info", 1, "a.js"]), null);
        assert.equal(consoleErrorLine([{}, 2, "warn", 1, "a.js"]), null);
    });

    it("reads the new shape of the event (one object) and only for errors", () => {
        assert.equal(consoleErrorLine([{}, { level: "error", message: "boom", lineNumber: 7, sourceId: "a.js" }]), "boom (a.js:7)");
        assert.equal(consoleErrorLine([{}, { level: "info", message: "fine" }]), null);
    });

    it("keeps only the first line, cuts it to 300 characters, and leaves out a missing place", () => {
        assert.equal(consoleErrorLine([{}, { level: "error", message: "first\n    at stack line" }]), "first");
        assert.equal(consoleErrorLine([{}, { level: "error", message: "x".repeat(900) }])!.length, 300);
    });

    it("never throws on anything odd", () => {
        for (const odd of [[], [undefined], [{}, null], [{}, { level: "error", message: 5 }], [{}, "error", { toString() { throw new Error("no"); } }]]) {
            assert.doesNotThrow(() => consoleErrorLine(odd), JSON.stringify(odd));
        }
    });

    it("writes at most 25 lines per window and then says it stopped", () => {
        const lines: string[] = [];
        const listener = makeConsoleErrorListener(text => { lines.push(text); });
        for (let i = 0; i < 40; i++) listener({}, { level: "error", message: `e${i}` });
        assert.equal(lines.length, 26);
        assert.equal(lines[0], "page error: e0");
        assert.match(lines[25], /no more page errors/);
    });

    it("does not throw when writing the trace fails", () => {
        const listener = makeConsoleErrorListener(() => { throw new Error("disk full"); });
        assert.doesNotThrow(() => listener({}, { level: "error", message: "boom" }));
    });
});
