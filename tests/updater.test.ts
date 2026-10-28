/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createUpdater, fileUrl, manifestUrl, PREVIOUS_FOLDER, STAGING_FOLDER, type UpdaterDeps } from "../src/main/updater";
import { answerUpdateRequest, makeFetchBytes } from "../src/main/updatesGlue";
import { UPDATE_FILES } from "../src/shared/updates";

const REPO = "Owner/Repo";
const DIST = "C:/data/dist";
const encode = (text: string) => new TextEncoder().encode(text);
const norm = (path: string) => path.replaceAll("\\", "/");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function world(options: { current?: string; version?: string; tamper?: string; shortFile?: string; failDownload?: string; failRename?: { after: number; }; blocked?: boolean; news?: unknown[]; bigManifest?: boolean; } = {}) {
    const version = options.version ?? "0.3.0";
    const release = Object.fromEntries(UPDATE_FILES.map(name => [name, encode(`NEW ${name} ${version}`)]));
    const manifest = {
        schema: 1, version,
        files: Object.fromEntries(UPDATE_FILES.map(name => [name, { sha256: sha(release[name]), size: release[name].length }])),
        news: options.news ?? [{ version, date: "2026-11-01", title: "Title", notes: ["Note"] }, { version: "0.2.5", title: "Middle" }, { version: "0.2.0", title: "Current" }]
    };
    const requested: string[] = [];
    const disk = new Map<string, Uint8Array>(UPDATE_FILES.map(name => [`${DIST}/${name}`, encode(`OLD ${name}`)]));
    let renames = 0;
    const deps: UpdaterDeps = {
        repo: REPO,
        currentVersion: options.current ?? "0.2.0",
        distDir: DIST,
        isBlocked: host => options.blocked === true && host === "github.com",
        async fetchBytes(url, maxBytes) {
            requested.push(url);
            if (url === manifestUrl(REPO)) return options.bigManifest ? new Uint8Array(maxBytes + 1) : encode(JSON.stringify(manifest));
            const name = UPDATE_FILES.find(file => url === fileUrl(REPO, version, file));
            if (!name) throw new Error("unknown address");
            if (name === options.failDownload) throw new Error("the server answered 404");
            if (name === options.tamper) return encode("TAMPERED!!!!!!!!!!!!!!!!!!!!!!!!!".slice(0, release[name].length));
            if (name === options.shortFile) return release[name].slice(0, 3);
            return release[name];
        },
        files: {
            mkdir: async () => undefined,
            writeFile: async (path, bytes) => { disk.set(norm(path), bytes); },
            copyFile: async (from, to) => { disk.set(norm(to), disk.get(norm(from))!); },
            rename: async (from, to) => {
                if (options.failRename && renames++ >= options.failRename.after) throw new Error("file is in use");
                disk.set(norm(to), disk.get(norm(from))!);
                disk.delete(norm(from));
            },
            remove: async path => { for (const key of [...disk.keys()]) if (key === norm(path) || key.startsWith(`${norm(path)}/`)) disk.delete(key); },
            exists: async path => disk.has(norm(path))
        }
    };
    return { deps, disk, requested, release, text: (path: string) => new TextDecoder().decode(disk.get(path)) };
}

describe("looking for an update", () => {
    it("says there is a newer version, with the news of the versions between, newest first", async () => {
        const answer = await createUpdater(world().deps).check();
        assert.deepEqual(answer, { status: "available", current: "0.2.0", latest: "0.3.0", news: [
            { version: "0.3.0", date: "2026-11-01", title: "Title", notes: ["Note"] }, { version: "0.2.5", date: "", title: "Middle", notes: [] }
        ] });
    });

    it("says you have the newest, also when the release is older than the program, and changes nothing", async () => {
        const same = world({ current: "0.3.0" });
        assert.deepEqual(await createUpdater(same.deps).check(), { status: "up-to-date", current: "0.3.0", latest: "0.3.0" });
        const older = world({ current: "0.4.0" });
        assert.equal((await createUpdater(older.deps).check()).status, "up-to-date");
        assert.deepEqual(same.requested, [manifestUrl(REPO)], "only the small update file was asked for");
    });

    it("says why it could not, when the owner blocked GitHub, the source is wrong, the network fails, or the file is damaged", async () => {
        const message = async (deps: UpdaterDeps) => { const answer = await createUpdater(deps).check(); return answer.status === "error" ? answer.message : answer.status; };
        assert.match(await message(world({ blocked: true }).deps), /github\.com is on the list of sites you blocked/);
        assert.match(await message({ ...world().deps, repo: "not a repo" }), /not set up/);
        assert.match(await message({ ...world().deps, currentVersion: "dev" }), /no valid number/);
        assert.match(await message({ ...world().deps, fetchBytes: async () => { throw new Error("offline"); } }), /could not reach the updates \(offline\)/);
        assert.match(await message({ ...world().deps, fetchBytes: async () => encode("<html>") }), /not readable/);
        assert.match(await message({ ...world().deps, fetchBytes: async () => encode("{\"schema\":1}") }), /valid version/);
    });
});

describe("installing an update", () => {
    it("checks every file against the release, keeps the old ones, and puts the four new ones in place", async () => {
        const w = world();
        const answer = await createUpdater(w.deps).install();
        assert.deepEqual(answer, { status: "installed", current: "0.2.0", installed: "0.3.0" });
        for (const name of UPDATE_FILES) {
            assert.equal(w.text(`${DIST}/${name}`), `NEW ${name} 0.3.0`);
            assert.equal(w.text(`${DIST}/${PREVIOUS_FOLDER}/${name}`), `OLD ${name}`, "the old file is kept");
        }
        assert.ok(![...w.disk.keys()].some(key => key.includes(STAGING_FOLDER)), "the staging folder is gone");
    });

    it("installs nothing when a file does not match its fingerprint, has the wrong size, or cannot be downloaded", async () => {
        for (const [options, pattern] of [
            [{ tamper: "renderer.js" }, /renderer\.js does not match its fingerprint/],
            [{ shortFile: "main.js" }, /main\.js has not the size/],
            [{ failDownload: "registry.json" }, /could not download registry\.json \(the server answered 404\)/]
        ] as const) {
            const w = world(options);
            const answer = await createUpdater(w.deps).install();
            assert.equal(answer.status, "error");
            assert.match(answer.status === "error" ? answer.message : "", pattern);
            for (const name of UPDATE_FILES) assert.equal(w.text(`${DIST}/${name}`), `OLD ${name}`, `${name} stays as it was`);
            assert.ok(![...w.disk.keys()].some(key => key.includes(STAGING_FOLDER)), "no staging left");
        }
    });

    it("puts the old files back when it fails half way", async () => {
        const w = world({ failRename: { after: 2 } });
        const answer = await createUpdater(w.deps).install();
        assert.equal(answer.status, "error");
        assert.match(answer.status === "error" ? answer.message : "", /the old ones were put back/);
        for (const name of UPDATE_FILES) assert.equal(w.text(`${DIST}/${name}`), `OLD ${name}`, `${name} is the old one again`);
    });

    it("refuses when there is nothing newer, and works the release out again instead of trusting an earlier look", async () => {
        const w = world({ current: "0.3.0" });
        const answer = await createUpdater(w.deps).install();
        assert.deepEqual(answer, { status: "error", message: "there is no newer version to install" });
        assert.deepEqual(w.requested, [manifestUrl(REPO)]);
    });

    it("builds the addresses only from the repository and a version of digits, never from the page", () => {
        assert.equal(manifestUrl("A/b"), "https://github.com/A/b/releases/latest/download/update.json");
        assert.equal(fileUrl("A/b", "1.2.3", "main.js"), "https://github.com/A/b/releases/download/v1.2.3/main.js");
    });

    it("does not start a second install while one runs", async () => {
        const w = world();
        const updater = createUpdater(w.deps);
        const first = updater.install();
        const second = await updater.install();
        assert.deepEqual(second, { status: "error", message: "an update is already being installed" });
        assert.equal((await first).status, "installed");
    });
});

describe("what the main process does with the page's request", () => {
    it("answers check and install, and ignores any address or file the page adds", async () => {
        const w = world();
        const updater = createUpdater(w.deps);
        assert.equal((await answerUpdateRequest(updater, { type: "check", url: "https://evil.example/x.js" }))?.status, "available");
        assert.ok(w.requested.every(url => url.startsWith("https://github.com/Owner/Repo/")));
        assert.equal(await answerUpdateRequest(updater, { type: "delete" }), null);
        assert.equal(await answerUpdateRequest(updater, undefined), null);
        assert.equal((await answerUpdateRequest(updater, { type: "install" }))?.status, "installed");
    });

    it("reads an answer only when it is a success and not bigger than allowed", async () => {
        const answer = (body: Uint8Array, init: { ok?: boolean; status?: number; length?: string | null; } = {}) => makeFetchBytes(async () => ({
            ok: init.ok ?? true, status: init.status ?? 200, headers: { get: () => init.length ?? null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer
        }));
        assert.deepEqual([...await answer(encode("abc"))("https://x", 10)], [97, 98, 99]);
        await assert.rejects(answer(encode("abc"), { ok: false, status: 404 })("https://x", 10), /answered 404/);
        await assert.rejects(answer(encode("abc"), { length: "999" })("https://x", 10), /bigger than expected/);
        await assert.rejects(answer(encode("abcdefghijklmnop"))("https://x", 10), /bigger than expected/);
    });
});
