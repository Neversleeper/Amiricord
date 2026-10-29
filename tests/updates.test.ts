/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { makeRelease } from "../scripts/releaseManifest";
import { compareVersions, newsSince, parseManifest, parseNewsEntry, parseUpdateAnswer, parseUpdateRequest, releasedNews, UPDATE_FILES } from "../src/shared/updates";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const goodFiles = () => Object.fromEntries(UPDATE_FILES.map(name => [name, { sha256: hash(name), size: name.length + 10 }]));

describe("versions", () => {
    it("compares major, then minor, then patch, as numbers", () => {
        assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
        assert.ok(compareVersions("0.10.0", "0.9.0") > 0, "10 is more than 9");
        assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
        assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
        assert.equal(compareVersions("2.3.4", "2.3.4"), 0);
    });
});

describe("the update file", () => {
    it("is rebuilt with only the known fields, and the news is cleaned", () => {
        const manifest = parseManifest({
            schema: 1, version: "0.3.0", extra: "x", files: goodFiles(),
            news: [{ version: "0.3.0", date: "2026-11-01", title: "  A title\n", notes: ["one", "", 5, "two"], hidden: true }, { version: "bad", title: "no" }, "no"]
        });
        assert.ok(typeof manifest !== "string");
        assert.equal(manifest.version, "0.3.0");
        assert.deepEqual(manifest.news, [{ version: "0.3.0", date: "2026-11-01", title: "A title", notes: ["one", "two"] }]);
        assert.deepEqual(Object.keys(manifest).sort(), ["files", "news", "version"]);
    });

    it("is refused, with a sentence, when anything about it is wrong", () => {
        const base = { schema: 1, version: "0.3.0", files: goodFiles(), news: [] };
        const bad = (change: Record<string, unknown>) => parseManifest({ ...base, ...change });
        assert.equal(typeof parseManifest(null), "string");
        assert.match(bad({ schema: 2 }) as string, /kind this version does not know/);
        assert.match(bad({ version: "0.3" }) as string, /valid version/);
        assert.match(bad({ version: "../../x" }) as string, /valid version/);
        assert.match(bad({ files: undefined }) as string, /lists no files/);
        const missing = goodFiles() as Record<string, unknown>;
        delete missing["renderer.js"];
        assert.match(bad({ files: missing }) as string, /renderer\.js/);
        assert.match(bad({ files: { ...goodFiles(), "main.js": { sha256: "ABC", size: 5 } } }) as string, /main\.js/);
        assert.match(bad({ files: { ...goodFiles(), "main.js": { sha256: hash("x"), size: 0 } } }) as string, /main\.js/);
        assert.match(bad({ files: { ...goodFiles(), "main.js": { sha256: hash("x"), size: 99 * 1024 * 1024 } } }) as string, /main\.js/);
    });

    it("keeps the news entries between the version running and the newest, newest first", () => {
        const entry = (version: string) => parseNewsEntry({ version, title: `T${version}` })!;
        const all = [entry("0.1.0"), entry("0.2.0"), entry("0.4.0"), entry("0.3.0"), entry("0.5.0")];
        assert.deepEqual(newsSince(all, "0.1.0", "0.4.0").map(item => item.version), ["0.4.0", "0.3.0", "0.2.0"]);
        assert.deepEqual(newsSince(all, "0.5.0", "0.5.0"), []);
    });
});

describe("the patch notes inside the program", () => {
    it("keeps the entries up to the running version, newest first, and drops what is not an entry", () => {
        const raw = [{ version: "0.3.0", title: "Future" }, { version: "0.1.0", title: "First" }, "no", { version: "0.2.0", title: "Now", notes: ["a"] }, { title: "no version" }];
        assert.deepEqual(releasedNews(raw, "0.2.0").map(entry => entry.version), ["0.2.0", "0.1.0"]);
        assert.deepEqual(releasedNews({}, "0.2.0"), []);
        assert.deepEqual(releasedNews(null, "0.2.0"), []);
    });
});

describe("what the page asks and gets", () => {
    it("understands only check and install, and drops anything else it sent", () => {
        assert.deepEqual(parseUpdateRequest({ type: "check", url: "https://evil.example/", file: "../x" }), { type: "check" });
        assert.deepEqual(parseUpdateRequest({ type: "install" }), { type: "install" });
        for (const bad of [null, "check", 3, {}, { type: "download" }, { type: "Check" }]) assert.equal(parseUpdateRequest(bad), null);
    });

    it("rebuilds each kind of answer, and refuses one it does not know", () => {
        assert.deepEqual(parseUpdateAnswer({ status: "up-to-date", current: "0.2.0", latest: "0.2.0", x: 1 }), { status: "up-to-date", current: "0.2.0", latest: "0.2.0" });
        assert.deepEqual(parseUpdateAnswer({ status: "available", current: "0.2.0", latest: "0.3.0", news: [{ version: "0.3.0", title: "T" }, 7] }), { status: "available", current: "0.2.0", latest: "0.3.0", news: [{ version: "0.3.0", date: "", title: "T", notes: [] }] });
        assert.deepEqual(parseUpdateAnswer({ status: "installed", current: "0.2.0", installed: "0.3.0" }), { status: "installed", current: "0.2.0", installed: "0.3.0" });
        assert.deepEqual(parseUpdateAnswer({ status: "error", message: "a\nb" }), { status: "error", message: "a b" });
        assert.deepEqual(parseUpdateAnswer({ status: "error" }), { status: "error", message: "something went wrong" });
        for (const bad of [null, "x", {}, { status: "up-to-date", current: "x", latest: "1.0.0" }, { status: "other" }]) assert.equal(parseUpdateAnswer(bad), null);
    });
});

describe("pnpm release", () => {
    const files = () => Object.fromEntries(UPDATE_FILES.map(name => [name, new TextEncoder().encode(`content of ${name}`)]));
    const news = JSON.stringify([{ version: "0.2.0", date: "2026-10-28", title: "Hello", notes: ["a"] }, { version: "0.1.0", title: "Old" }]);

    it("writes an update file the app itself accepts, with the hash and size of each file", () => {
        const release = makeRelease({ version: "0.2.0", files: files(), newsText: news });
        assert.ok(!Array.isArray(release));
        assert.equal(release.manifest.version, "0.2.0");
        assert.equal(release.manifest.files["main.js"].sha256, hash("content of main.js"));
        assert.equal(release.manifest.files["main.js"].size, "content of main.js".length);
        assert.deepEqual(release.manifest.news.map(item => item.version), ["0.2.0", "0.1.0"]);
        assert.deepEqual(parseManifest(JSON.parse(release.manifestText)), release.manifest);
    });

    it("makes no release, and says why, when a file is missing, the news is missing or damaged, or the version is wrong", () => {
        const say = (input: Partial<Parameters<typeof makeRelease>[0]>) => {
            const result = makeRelease({ version: "0.2.0", files: files(), newsText: news, ...input });
            return Array.isArray(result) ? result.join(" | ") : "made";
        };
        assert.match(say({ files: { ...files(), "main.js": new Uint8Array() } }), /main\.js is missing or empty/);
        assert.match(say({ newsText: "[]" }), /no entry for version 0\.2\.0/);
        assert.match(say({ newsText: "{" }), /not valid JSON/);
        assert.match(say({ newsText: "{}" }), /must be a list/);
        assert.match(say({ newsText: JSON.stringify([{ version: "0.2.0" }]) }), /entry 1 needs a version/);
        assert.match(say({ newsText: JSON.stringify([{ version: "0.3.0", title: "Future" }, { version: "0.2.0", title: "Now" }]) }), /newer than 0\.2\.0/);
        assert.match(say({ version: "0.2" }), /not major\.minor\.patch/);
    });
});

describe("who published a version", () => {
    it("keeps the GitHub name of the author and drops anything that is not one", () => {
        assert.equal(parseNewsEntry({ version: "0.4.1", title: "T", author: "Neversleeper" })?.author, "Neversleeper");
        assert.equal(parseNewsEntry({ version: "0.4.1", title: "T", author: "some-one-1" })?.author, "some-one-1");
        assert.equal("author" in (parseNewsEntry({ version: "0.4.1", title: "T" }) ?? {}), false);
        for (const bad of ["", "-start", "end-", "has space", "a/b", "<b>x</b>", "x".repeat(40), 5]) {
            assert.equal(parseNewsEntry({ version: "0.4.1", title: "T", author: bad })?.author, undefined, `author ${String(bad)}`);
        }
    });

    it("stops a release whose note is longer than the app shows", () => {
        const files = Object.fromEntries(UPDATE_FILES.map(name => [name, new TextEncoder().encode(`content of ${name}`)]));
        const long = JSON.stringify([{ version: "0.2.0", title: "Hello", notes: ["x".repeat(241)] }]);
        const refused = makeRelease({ version: "0.2.0", files, newsText: long });
        assert.ok(Array.isArray(refused));
        assert.match(refused.join("\n"), /longer than 240 characters/);
        const fine = JSON.stringify([{ version: "0.2.0", title: "Hello", notes: ["x".repeat(240)] }]);
        assert.ok(!Array.isArray(makeRelease({ version: "0.2.0", files, newsText: fine })));
    });
});
