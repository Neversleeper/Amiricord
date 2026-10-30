/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { HEALTH_FILE, openOwn, OpenOwnDeps, OWN_PLACES, SOURCE_URL } from "../src/main/openOwn";
import { UPDATE_REPO } from "../src/shared/project";

const FOLDER = join("C:\\", "Users", "x", "Amiricord");

function setup(options: { browserFails?: boolean; revealThrows?: boolean; } = {}) {
    const log: string[] = [];
    const deps: OpenOwnDeps = {
        folder: FOLDER,
        open: path => { log.push(`open ${path}`); return Promise.resolve(""); },
        reveal: path => { log.push(`reveal ${path}`); if (options.revealThrows) throw new Error("no explorer"); },
        openExternal: url => { log.push(`browser ${url}`); return options.browserFails ? Promise.reject(new Error("no browser")) : Promise.resolve(); },
        trace: text => { log.push(`trace ${text}`); }
    };
    return { deps, log };
}

describe("the two places the Amiricord tab can open", () => {
    it("has exactly two, and the address is the project's page on GitHub", () => {
        assert.deepEqual([...OWN_PLACES], ["health", "source"]);
        assert.equal(SOURCE_URL, `https://github.com/${UPDATE_REPO}`);
        assert.equal(HEALTH_FILE, "health.json");
    });

    it("shows the health report file in the explorer, from the engine's own folder", async () => {
        const t = setup();
        await openOwn("health", t.deps);
        assert.deepEqual(t.log, [`reveal ${join(FOLDER, HEALTH_FILE)}`, "trace open data folder: asked the explorer to show a file inside it"]);
    });

    it("opens the project's page in the browser, and nothing else", async () => {
        const t = setup();
        await openOwn("source", t.deps);
        assert.deepEqual(t.log, [`browser ${SOURCE_URL}`, "trace open source code: asked the browser to open the project's page"]);
    });

    it("ignores anything that is not one of the two words: no address, no path, no other shape", async () => {
        for (const bad of ["https://example.com", "../state.json", "HEALTH", "", undefined, null, 1, {}, ["health"]]) {
            const t = setup();
            await openOwn(bad, t.deps);
            assert.deepEqual(t.log, [], String(bad));
        }
    });

    it("never throws when the browser or the explorer fail, and says so in the trace", async () => {
        const browser = setup({ browserFails: true });
        await assert.doesNotReject(openOwn("source", browser.deps));
        assert.equal(browser.log.at(-1), "trace open source code FAILED: no browser");
        const explorer = setup({ revealThrows: true });
        await assert.doesNotReject(openOwn("health", explorer.deps));
        assert.ok(explorer.log.some(line => line.includes("FAILED: no explorer")));
    });
});
