/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { trace, TRACE_FILE, TRACE_MAX_BYTES } from "../src/main/trace";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-trace-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const read = () => readFileSync(join(dir, TRACE_FILE), "utf8");
const at = () => new Date("2026-10-25T04:40:00.000Z");

describe("the boot trace", () => {
    it("adds one line with the time and the process number, and keeps adding", () => {
        trace(dir, "first", at, 123);
        trace(dir, "second", at, 123);
        assert.equal(read(), "2026-10-25T04:40:00.000Z pid=123 first\n2026-10-25T04:40:00.000Z pid=123 second\n");
    });

    it("keeps each entry on one line and cuts a very long one", () => {
        trace(dir, "a\nb\r\nc", at, 1);
        trace(dir, "x".repeat(1000), at, 1);
        const lines = read().trimEnd().split("\n");
        assert.equal(lines.length, 2);
        assert.ok(lines[0].endsWith(" a b c"));
        assert.ok(lines[1].length < 400);
    });

    it("starts the file again once it passes the limit, so it can never fill a disk", () => {
        writeFileSync(join(dir, TRACE_FILE), "x".repeat(TRACE_MAX_BYTES + 1));
        trace(dir, "after the cut", at, 7);
        assert.equal(read(), "2026-10-25T04:40:00.000Z pid=7 after the cut\n");
        appendFileSync(join(dir, TRACE_FILE), "y".repeat(10));
        trace(dir, "no cut below the limit", at, 7);
        assert.ok(read().includes("after the cut"));
    });

    it("never throws, even when the folder does not exist", () => {
        assert.doesNotThrow(() => trace(join(dir, "missing", "deeper"), "x"));
        mkdirSync(join(dir, TRACE_FILE));
        assert.doesNotThrow(() => trace(dir, "the file is a folder"));
    });
});
