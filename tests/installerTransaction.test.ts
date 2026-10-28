/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Fsx, nodeFsx, runTransaction, Step } from "../src/installer/transaction";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-transaction-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const at = (name: string) => join(dir, name);
const read = (name: string) => readFileSync(at(name), "utf8");

/** Steps the installer will use: move the original away, write the loader in its place. */
const patchSteps = (): Step[] => [
    { type: "rename", from: at("app.asar"), to: at("_app.asar") },
    { type: "write", path: at("app.asar.amiricord-new"), data: Buffer.from("loader") },
    { type: "rename", from: at("app.asar.amiricord-new"), to: at("app.asar") }
];

/** A file system that fails when it reaches the given step number (1-based) of its operations. */
function failingAt(failAt: number, failUndo = false): Fsx & { ops: string[]; } {
    const ops: string[] = [];
    let n = 0;
    const guard = (label: string) => {
        ops.push(label);
        if (++n === failAt) throw new Error(`disk problem at step ${failAt}`);
    };
    return {
        ops,
        rename: async (from, to) => { guard(`rename ${from}`); if (failUndo && ops.length > failAt) throw new Error("undo failed"); await nodeFsx.rename(from, to); },
        writeFile: async (path, data) => { guard(`write ${path}`); await nodeFsx.writeFile(path, data); },
        copy: nodeFsx.copy,
        remove: nodeFsx.remove
    };
}

describe("runTransaction", () => {
    it("runs the steps in order and then the deletions", async () => {
        writeFileSync(at("app.asar"), "original");
        writeFileSync(at("leftover"), "x");
        const result = await runTransaction({ fsx: nodeFsx, steps: patchSteps(), commit: [{ type: "remove", path: at("leftover") }] });
        assert.deepEqual(result, { ok: true, commitErrors: [] });
        assert.equal(read("app.asar"), "loader");
        assert.equal(read("_app.asar"), "original");
        assert.equal(existsSync(at("leftover")), false);
    });

    it("undoes everything when a step fails, and keeps the deletions for later", async () => {
        writeFileSync(at("app.asar"), "original");
        writeFileSync(at("keep-me"), "x");
        const result = await runTransaction({ fsx: failingAt(3), steps: patchSteps(), commit: [{ type: "remove", path: at("keep-me") }] });
        assert.equal(result.ok, false);
        assert.equal(!result.ok && result.rolledBack, true);
        assert.equal(read("app.asar"), "original");
        assert.equal(existsSync(at("_app.asar")), false);
        assert.equal(existsSync(at("app.asar.amiricord-new")), false);
        assert.equal(existsSync(at("keep-me")), true);
    });

    it("undoes in reverse order", async () => {
        writeFileSync(at("app.asar"), "original");
        const order: string[] = [];
        const fsx: Fsx = {
            rename: async (from, to) => { order.push(`rename ${from.split(/[\\/]/).pop()} -> ${to.split(/[\\/]/).pop()}`); await nodeFsx.rename(from, to); },
            writeFile: async (path, data) => { order.push("write"); await nodeFsx.writeFile(path, data); },
            copy: nodeFsx.copy,
            remove: async path => { order.push("remove"); await nodeFsx.remove(path); }
        };
        await runTransaction({ fsx, steps: patchSteps(), verify: async () => { throw new Error("check failed"); } });
        assert.deepEqual(order, [
            "rename app.asar -> _app.asar", "write", "rename app.asar.amiricord-new -> app.asar",
            "rename app.asar -> app.asar.amiricord-new", "remove", "rename _app.asar -> app.asar"
        ]);
        assert.equal(read("app.asar"), "original");
    });

    it("undoes everything when the final check fails", async () => {
        writeFileSync(at("app.asar"), "original");
        const result = await runTransaction({ fsx: nodeFsx, steps: patchSteps(), verify: async () => { throw new Error("not a loader"); } });
        assert.equal(result.ok, false);
        assert.equal(read("app.asar"), "original");
        assert.equal(existsSync(at("_app.asar")), false);
    });

    it("refuses to overwrite a file that already exists", async () => {
        writeFileSync(at("app.asar"), "original");
        writeFileSync(at("app.asar.amiricord-new"), "someone else's file");
        const result = await runTransaction({ fsx: nodeFsx, steps: patchSteps() });
        assert.equal(result.ok, false);
        assert.equal(read("app.asar.amiricord-new"), "someone else's file");
        assert.equal(read("app.asar"), "original");
    });

    it("says so when the undo itself fails, and keeps going with the rest of the undo", async () => {
        writeFileSync(at("app.asar"), "original");
        const result = await runTransaction({ fsx: failingAt(3, true), steps: patchSteps() });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.rolledBack, false);
        assert.ok(result.undoErrors.length >= 1);
    });

    it("reports a deletion that failed without failing the whole operation", async () => {
        writeFileSync(at("app.asar"), "original");
        const fsx: Fsx = { ...nodeFsx, remove: async () => { throw new Error("file in use"); } };
        const result = await runTransaction({ fsx, steps: patchSteps(), commit: [{ type: "remove", path: at("x") }] });
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.commitErrors.length, 1);
    });

    it("writes every step and the outcome to the journal", async () => {
        writeFileSync(at("app.asar"), "original");
        const events: string[] = [];
        await runTransaction({ fsx: nodeFsx, steps: patchSteps(), journal: event => { events.push(event); } });
        assert.deepEqual(events, ["step", "step", "step", "done"]);
        events.length = 0;
        writeFileSync(at("app.asar"), "original");
        rmSync(at("_app.asar"), { force: true });
        await runTransaction({ fsx: failingAt(2), steps: patchSteps(), journal: event => { events.push(event); } });
        assert.deepEqual(events, ["step", "step", "rollback"]);
    });
});
