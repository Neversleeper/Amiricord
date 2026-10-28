/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BACKUP_MANIFEST, createBackup, listBackups, readBackup, timestamp, verifyBackup } from "../src/installer/backup";
import { hashFile } from "../src/installer/hash";

let root: string;
let resources: string;
let backups: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "amiricord-backup-"));
    resources = join(root, "resources");
    backups = join(root, "backups");
    mkdirSync(resources);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const args = (extra: Record<string, unknown> = {}) =>
    ({ resources, backupRoot: backups, branch: "canary", appVersion: "app-1.0.1281", state: "pristine", now: new Date(Date.UTC(2026, 9, 24, 10, 30, 45)), ...extra });

describe("createBackup", () => {
    it("copies the files that exist, checks them, and writes a manifest", async () => {
        writeFileSync(join(resources, "app.asar"), "discord original");
        writeFileSync(join(resources, "build_info.json"), "{}");
        const info = await createBackup(args());

        assert.equal(info.dir, join(backups, "canary-app-1.0.1281-20261024-103045"));
        assert.deepEqual(info.manifest.files.map(f => f.name), ["app.asar", "build_info.json"]);
        assert.equal(readFileSync(join(info.dir, "app.asar"), "utf8"), "discord original");
        assert.equal(info.manifest.files[0].sha256, await hashFile(join(resources, "app.asar")));
        assert.equal(info.manifest.state, "pristine");
        assert.deepEqual(await verifyBackup(info), []);
    });

    it("backs up both asar files of a patched install", async () => {
        writeFileSync(join(resources, "app.asar"), "loader");
        writeFileSync(join(resources, "_app.asar"), "original");
        assert.deepEqual((await createBackup(args({ state: "patched" }))).manifest.files.map(f => f.name), ["app.asar", "_app.asar"]);
    });

    it("stops and leaves no half backup when there is nothing to copy", async () => {
        await assert.rejects(createBackup(args()), /nothing to back up/);
        assert.deepEqual(existsSync(backups) ? readdirSync(backups) : [], []);
    });

    it("stops, removes the copy and keeps the original when a copy does not match", async () => {
        writeFileSync(join(resources, "app.asar"), "original");
        const corrupting = async (from: string, to: string) => { writeFileSync(to, readFileSync(from, "utf8") + " damaged"); };
        await assert.rejects(createBackup(args({ copy: corrupting })), /does not match the original/);
        assert.deepEqual(existsSync(backups) ? readdirSync(backups) : [], []);
        assert.equal(readFileSync(join(resources, "app.asar"), "utf8"), "original");
    });

    it("never writes over an earlier backup, even one made in the same second", async () => {
        writeFileSync(join(resources, "app.asar"), "first");
        const first = await createBackup(args());
        writeFileSync(join(resources, "app.asar"), "second");
        const second = await createBackup(args());
        assert.notEqual(first.dir, second.dir);
        assert.equal(second.dir, `${first.dir}-2`);
        assert.equal(readFileSync(join(first.dir, "app.asar"), "utf8"), "first");
        assert.equal(readFileSync(join(second.dir, "app.asar"), "utf8"), "second");
    });

    it("never changes the original files", async () => {
        writeFileSync(join(resources, "app.asar"), "keep me");
        const before = await hashFile(join(resources, "app.asar"));
        await createBackup(args());
        assert.equal(await hashFile(join(resources, "app.asar")), before);
    });
});

describe("verifyBackup", () => {
    it("finds a changed copy and a missing one", async () => {
        writeFileSync(join(resources, "app.asar"), "one");
        writeFileSync(join(resources, "_app.asar"), "two");
        const info = await createBackup(args({ state: "patched" }));
        writeFileSync(join(info.dir, "app.asar"), "changed");
        rmSync(join(info.dir, "_app.asar"));
        const problems = await verifyBackup(info);
        assert.equal(problems.length, 2);
        assert.match(problems[0], /app\.asar does not match/);
        assert.match(problems[1], /_app\.asar is missing/);
    });
});

describe("listBackups and readBackup", () => {
    it("lists readable backups newest first and skips damaged or foreign folders", async () => {
        writeFileSync(join(resources, "app.asar"), "x");
        const older = await createBackup(args({ now: new Date(Date.UTC(2026, 9, 1)) }));
        const newer = await createBackup(args({ now: new Date(Date.UTC(2026, 9, 2)) }));
        mkdirSync(join(backups, "junk"));
        mkdirSync(join(backups, "damaged"));
        writeFileSync(join(backups, "damaged", BACKUP_MANIFEST), "{ not json");
        mkdirSync(join(backups, "wrong-shape"));
        writeFileSync(join(backups, "wrong-shape", BACKUP_MANIFEST), JSON.stringify({ schema: 1, files: "no" }));
        writeFileSync(join(backups, "a-file.txt"), "x");

        assert.deepEqual((await listBackups(backups)).map(b => b.dir), [newer.dir, older.dir]);
        assert.equal(await readBackup(join(backups, "damaged")), null);
    });

    it("gives an empty list when there is no backup folder yet", async () => {
        assert.deepEqual(await listBackups(join(root, "nothing")), []);
    });
});

describe("timestamp", () => {
    it("is UTC, sortable and safe in a folder name", () => {
        assert.equal(timestamp(new Date(Date.UTC(2026, 0, 5, 3, 4, 5))), "20260105-030405");
    });
});
