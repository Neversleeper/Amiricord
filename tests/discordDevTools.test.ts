/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEVTOOLS_FLAG, enableDiscordDevTools, PASTE_WARNING_KEY } from "../src/installer/discordDevTools";

describe("developer tools on by default", () => {
    let folder: string;
    beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), "amiricord-devtools-")); });
    afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

    const read = async (name: string) => JSON.parse(await readFile(join(folder, name), "utf8")) as Record<string, unknown>;

    it("sets the flag and the paste choice and keeps everything else in both files", async () => {
        await writeFile(join(folder, "settings.json"), JSON.stringify({ IS_MAXIMIZED: true, WINDOW_BOUNDS: { x: 1 } }));
        await writeFile(join(folder, "Preferences"), JSON.stringify({ spellcheck: { a: 1 }, electron: { devtools: { preferences: { "panel-selected-tab": "\"console\"" } } } }));
        const result = await enableDiscordDevTools(folder);
        assert.equal(result.changed.length, 2);
        assert.deepEqual(result.problems, []);
        const settings = await read("settings.json");
        assert.equal(settings[DEVTOOLS_FLAG], true);
        assert.equal(settings.IS_MAXIMIZED, true);
        assert.deepEqual(settings.WINDOW_BOUNDS, { x: 1 });
        const preferences = await read("Preferences") as { spellcheck: unknown; electron: { devtools: { preferences: Record<string, string>; }; }; };
        assert.equal(preferences.electron.devtools.preferences[PASTE_WARNING_KEY], "true");
        assert.equal(preferences.electron.devtools.preferences["panel-selected-tab"], "\"console\"");
        assert.deepEqual(preferences.spellcheck, { a: 1 });
    });

    it("builds the missing parts of Preferences, and changes nothing when both are already on", async () => {
        await writeFile(join(folder, "settings.json"), JSON.stringify({ [DEVTOOLS_FLAG]: true }));
        await writeFile(join(folder, "Preferences"), JSON.stringify({ other: 1 }));
        assert.equal((await enableDiscordDevTools(folder)).changed.length, 1);
        assert.equal(((await read("Preferences")).electron as { devtools: { preferences: Record<string, string>; }; }).devtools.preferences[PASTE_WARNING_KEY], "true");
        assert.deepEqual((await enableDiscordDevTools(folder)).changed, []);
    });

    it("leaves a file it cannot read alone and says so", async () => {
        await writeFile(join(folder, "settings.json"), "{ not json");
        const result = await enableDiscordDevTools(folder);
        assert.equal(result.changed.length, 0);
        assert.match(result.problems[0], /settings\.json could not be changed/);
        assert.equal(await readFile(join(folder, "settings.json"), "utf8"), "{ not json");
    });

    it("creates nothing when Discord's folder or files are not there", async () => {
        const missing = await enableDiscordDevTools(join(folder, "nope"));
        assert.match(missing.problems[0], /was not found/);
        const empty = await enableDiscordDevTools(folder);
        assert.equal(empty.changed.length, 0);
        assert.match(empty.problems[0], /settings\.json was not found/);
        await assert.rejects(readFile(join(folder, "Preferences"), "utf8"));
    });
});
