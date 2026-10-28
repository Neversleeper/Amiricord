/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { openDataFolder, OpenFolderDeps, REVEAL_FILE } from "../src/main/openFolder";

const FOLDER = join("C:\\", "Users", "x", "Amiricord");

function setup(options: { open?: () => Promise<string>; revealThrows?: boolean; } = {}) {
    const log: string[] = [];
    const deps: OpenFolderDeps = {
        folder: FOLDER,
        open: path => { log.push(`open ${path}`); return (options.open ?? (() => Promise.resolve("")))(); },
        reveal: path => { log.push(`reveal ${path}`); if (options.revealThrows) throw new Error("no explorer"); },
        trace: text => { log.push(`trace ${text}`); }
    };
    return { deps, log };
}

describe("openDataFolder", () => {
    it("asks the explorer to show a file inside the folder first, which brings its window to the front, and does nothing else", async () => {
        const t = setup();
        await openDataFolder(t.deps);
        assert.deepEqual(t.log, [`reveal ${join(FOLDER, REVEAL_FILE)}`, "trace open data folder: asked the explorer to show a file inside it"]);
    });

    it("when showing a file fails, opens the folder itself and writes both results to the trace", async () => {
        const t = setup({ revealThrows: true });
        await openDataFolder(t.deps);
        assert.deepEqual(t.log, [
            `reveal ${join(FOLDER, REVEAL_FILE)}`, "trace open data folder: showing a file FAILED: no explorer",
            `open ${FOLDER}`, "trace open data folder: asked the explorer to open the folder"
        ]);
    });

    it("treats an error text of the second way as a failure in the trace", async () => {
        const t = setup({ revealThrows: true, open: () => Promise.resolve("Failed to open path") });
        await openDataFolder(t.deps);
        assert.equal(t.log.at(-1), "trace open data folder: opening the folder also FAILED: Failed to open path");
    });

    it("never throws, even when both ways fail, and says so in the trace", async () => {
        const t = setup({ revealThrows: true, open: () => Promise.reject(new Error("boom")) });
        await assert.doesNotReject(openDataFolder(t.deps));
        assert.equal(t.log.at(-1), "trace open data folder: opening the folder also FAILED: boom");
    });
});
