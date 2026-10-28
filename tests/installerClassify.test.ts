/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { buildAsar, buildLoaderAsar } from "../src/installer/asar";
import { classifyResources } from "../src/installer/classify";

let resources: string;
beforeEach(() => { resources = mkdtempSync(join(tmpdir(), "amiricord-classify-")); });
afterEach(() => { rmSync(resources, { recursive: true, force: true }); });

/** Something that looks like Discord's own app.asar: big enough not to be a loader, with no loader inside. */
const discordAsar = () => buildAsar({ "package.json": JSON.stringify({ name: "discord", main: "app_bootstrap/index.js" }), "app_bootstrap/data.bin": Buffer.alloc(200 * 1024, 7) });

const put = (name: string, data: Buffer | string) => writeFileSync(join(resources, name), data);

/** Another mod's loader: same shape, no marker of ours. */
const foreignLoader = () => buildAsar({ "index.js": "require(\"C:\\\\other\\\\patcher.js\")", "package.json": JSON.stringify({ name: "discord", main: "index.js" }) });

describe("classifyResources", () => {
    it("pristine: Discord's own app.asar and nothing else", async () => {
        put("app.asar", discordAsar());
        const c = await classifyResources(resources);
        assert.equal(c.state, "pristine");
        assert.deepEqual(c.leftovers, []);
    });

    it("patched: our loader and Discord's original", async () => {
        put("app.asar", buildLoaderAsar("C:\\mod\\main.js"));
        put("_app.asar", discordAsar());
        const c = await classifyResources(resources);
        assert.equal(c.state, "patched");
        assert.equal(c.loader?.modPath, "C:\\mod\\main.js");
    });

    it("broken: our loader without the original, or no app.asar at all", async () => {
        put("app.asar", buildLoaderAsar("C:\\mod\\main.js"));
        assert.equal((await classifyResources(resources)).state, "broken");
        rmSync(join(resources, "app.asar"));
        assert.equal((await classifyResources(resources)).state, "broken");
        put("_app.asar", discordAsar());
        const c = await classifyResources(resources);
        assert.equal(c.state, "broken");
        assert.match(c.reason, /restore/);
    });

    it("foreign-loader: another mod's loader is never taken for ours", async () => {
        put("app.asar", foreignLoader());
        put("_app.asar", discordAsar());
        const c = await classifyResources(resources);
        assert.equal(c.state, "foreign-loader");
        assert.equal(c.loader?.ours, false);
    });

    it("does not take a marker in the middle of the file for ours", async () => {
        const text = "console.log(1);\n/* amiricord-loader v1 */\nrequire(\"C:\\\\x.js\")";
        put("app.asar", buildAsar({ "index.js": text, "package.json": JSON.stringify({ main: "index.js" }) }));
        put("_app.asar", discordAsar());
        assert.equal((await classifyResources(resources)).state, "foreign-loader");
    });

    it("desynced: a normal app.asar next to an _app.asar", async () => {
        put("app.asar", discordAsar());
        put("_app.asar", discordAsar());
        assert.equal((await classifyResources(resources)).state, "desynced");
    });

    it("a big file is never a loader, even if it contains loader text", async () => {
        put("app.asar", buildAsar({ "index.js": "require(\"x\")", "package.json": JSON.stringify({ main: "index.js" }), "pad.bin": Buffer.alloc(100 * 1024) }));
        assert.equal((await classifyResources(resources)).state, "pristine");
    });

    it("a file that is not an asar counts as Discord's own, not as a loader", async () => {
        put("app.asar", "this is not an asar file at all");
        assert.equal((await classifyResources(resources)).state, "pristine");
    });

    it("unsupported: folders and links in place of the files", async () => {
        mkdirSync(join(resources, "app.asar"));
        assert.equal((await classifyResources(resources)).state, "unsupported");
        rmSync(join(resources, "app.asar"), { recursive: true });
        put("app.asar", discordAsar());
        mkdirSync(join(resources, "_app.asar"));
        assert.equal((await classifyResources(resources)).state, "unsupported");
        rmSync(join(resources, "_app.asar"), { recursive: true });
        try {
            symlinkSync(join(resources, "app.asar"), join(resources, "_app.asar"));
        } catch {
            return; // Windows without the right to make links: the folder cases above are enough.
        }
        assert.equal((await classifyResources(resources)).state, "unsupported");
    });

    it("lists temporary files left by an interrupted operation", async () => {
        put("app.asar", discordAsar());
        put("app.asar.amiricord-new", "x");
        put("_app.asar.amiricord-restore", "x");
        assert.deepEqual((await classifyResources(resources)).leftovers, ["app.asar.amiricord-new", "_app.asar.amiricord-restore"]);
    });
});
