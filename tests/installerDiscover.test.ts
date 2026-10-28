/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BRANCH_DIRS, BRANCH_EXES, BRANCHES, compareVersions, findInstall, isBranch, parseAppVersion } from "../src/installer/discover";

let local: string;
beforeEach(() => { local = mkdtempSync(join(tmpdir(), "amiricord-discover-")); });
afterEach(() => { rmSync(local, { recursive: true, force: true }); });

const addApp = (folder: string, app: string, withResources = true) => {
    const dir = join(local, folder, app);
    mkdirSync(withResources ? join(dir, "resources") : dir, { recursive: true });
};

describe("versions", () => {
    it("reads app folder names", () => {
        assert.deepEqual(parseAppVersion("app-1.0.9265"), [1, 0, 9265]);
        assert.deepEqual(parseAppVersion("app-1"), [1]);
        for (const bad of ["app-", "app-1.0.x", "app-1.0.1-beta", "resources", "App-1.0.1", "xapp-1.0.1", "app-1.0.1 "]) {
            assert.equal(parseAppVersion(bad), null, bad);
        }
    });

    it("compares numbers as numbers, not as text", () => {
        assert.ok(compareVersions([1, 0, 10000], [1, 0, 9265]) > 0);
        assert.ok(compareVersions([1, 0, 9], [1, 0, 10]) < 0);
        assert.equal(compareVersions([1, 0], [1, 0, 0]) < 0, true);
        assert.equal(compareVersions([2, 0, 0], [2, 0, 0]), 0);
    });
});

describe("branches", () => {
    it("knows the three branches, their folders and programs", () => {
        assert.deepEqual([...BRANCHES], ["stable", "canary", "ptb"]);
        assert.equal(BRANCH_DIRS.canary, "DiscordCanary");
        assert.equal(BRANCH_EXES.ptb, "DiscordPTB.exe");
        assert.equal(isBranch("canary"), true);
        assert.equal(isBranch("auto"), false);
        assert.equal(isBranch(undefined), false);
    });
});

describe("findInstall", () => {
    it("returns null when the branch is not installed", async () => {
        assert.equal(await findInstall(local, "canary"), null);
        assert.equal(await findInstall(join(local, "nothing-here"), "stable"), null);
    });

    it("picks the newest app folder by number and keeps the others in order", async () => {
        for (const app of ["app-1.0.9265", "app-1.0.10000", "app-1.0.1281", "download", "packages"]) addApp("DiscordCanary", app);
        writeFileSync(join(local, "DiscordCanary", "Update.exe"), "");
        const install = (await findInstall(local, "canary"))!;
        assert.deepEqual(install.apps.map(a => a.name), ["app-1.0.1281", "app-1.0.9265", "app-1.0.10000"]);
        assert.equal(install.active?.name, "app-1.0.10000");
        assert.equal(install.active?.resources, join(local, "DiscordCanary", "app-1.0.10000", "resources"));
        assert.equal(install.root, join(local, "DiscordCanary"));
    });

    it("ignores app folders without a resources folder", async () => {
        addApp("Discord", "app-1.0.5");
        addApp("Discord", "app-1.0.6", false);
        assert.equal((await findInstall(local, "stable"))!.active?.name, "app-1.0.5");
    });

    it("has no active app when none qualifies, and keeps branches apart", async () => {
        addApp("DiscordPTB", "app-1.0.1", false);
        addApp("Discord", "app-1.0.2");
        assert.equal((await findInstall(local, "ptb"))!.active, null);
        assert.equal((await findInstall(local, "stable"))!.active?.name, "app-1.0.2");
    });
});
