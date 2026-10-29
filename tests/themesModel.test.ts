/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addressProblem, buildExport, cssProblem, EXPORT_FORMAT, hostsQuestion, makeId, MAX_CSS_CHARS, MAX_THEMES, parseExport, parseHeader, parseLibrary, readIndex, remoteHosts, searchLibrary, thumbnailAddress } from "../src/plugins/Themes/model";

describe("theme header", () => {
    const css = "/**\n * @name Midnight\n * @author Someone\n * @description A dark theme\n *   with two lines\n * @version 1.2.0\n */\nbody{}";

    it("reads name, author, description (also on two lines) and version", () => {
        assert.deepEqual(parseHeader(css, "midnight.theme.css"), { name: "Midnight", author: "Someone", description: "A dark theme with two lines", version: "1.2.0" });
    });

    it("uses the file name when there is no header, and survives a BOM and odd input", () => {
        assert.equal(parseHeader("body{}", "my-theme.theme.css").name, "my-theme");
        assert.equal(parseHeader("﻿/** @name Bom */", "x.css").name, "Bom");
        assert.equal(parseHeader("/** never closed", "plain.css").name, "plain");
        assert.equal(parseHeader("", "").name, "Theme");
    });

    it("keeps only the first of a repeated field and cuts control characters", () => {
        assert.equal(parseHeader("/**\n * @name One\n * @name Two\n */", "x.css").name, "One");
        assert.equal(parseHeader("/** @name A\u0007B */", "x.css").name, "A B");
    });
});

describe("addresses a theme contacts", () => {
    it("finds hosts in @import and url(), once each, and ignores data and relative addresses", () => {
        const css = `@import url("https://fonts.googleapis.com/css?family=A");\n@import 'https://Example.com/a.css';\n.a{background:url(https://cdn.example.org/x.png)}\n.b{background:url(//cdn.example.org/y.png)}\n.c{background:url(data:image/png;base64,AAAA)}\n.d{background:url(/local.png)}`;
        assert.deepEqual(remoteHosts(css), ["fonts.googleapis.com", "example.com", "cdn.example.org"]);
    });

    it("finds none in a plain theme", () => {
        assert.deepEqual(remoteHosts("body{color:red}"), []);
    });

    it("asks with the hosts listed and cuts a long list", () => {
        const text = hostsQuestion("T", Array.from({ length: 20 }, (_, index) => `h${index}.test`));
        assert.ok(text.includes("h0.test") && text.includes("h14.test"));
        assert.equal(text.includes("h15.test"), false);
        assert.match(text, /and 5 more/);
    });
});

describe("the list of themes", () => {
    it("makes plain ids and never repeats one", () => {
        assert.equal(makeId("Midnight Blue!", []), "midnight-blue");
        assert.equal(makeId("Midnight Blue", ["midnight-blue"]), "midnight-blue-2");
        assert.equal(makeId("???", []), "theme");
    });

    it("reads the saved list: well-formed entries only, each id once", () => {
        const list = readIndex([{ id: "a", name: "A", enabled: true }, { id: "a", name: "again" }, { id: "Bad Id" }, null, { id: "b" }, "x"]);
        assert.deepEqual(list.map(entry => [entry.id, entry.name, entry.enabled]), [["a", "A", true], ["b", "b", false]]);
        assert.deepEqual(readIndex("nope"), []);
        assert.equal(readIndex(Array.from({ length: MAX_THEMES + 5 }, (_, index) => ({ id: `t${index}` }))).length, MAX_THEMES);
    });

    it("refuses a style that is not text or too big", () => {
        assert.equal(cssProblem("a{}"), null);
        assert.match(cssProblem("x".repeat(MAX_CSS_CHARS + 1)) ?? "", /too big/);
        assert.match(cssProblem(5) ?? "", /not text/);
    });
});

describe("the export file", () => {
    const settings = { schema: 1 as const, plugins: { Foo: { enabled: true, values: { size: 3 } } } };

    it("goes out and comes back with settings, quick CSS and themes", () => {
        const text = buildExport({ settings, quickCss: "a{}", themes: [{ name: "T", enabled: true, css: "b{}" }] }, "0.5.0", new Date("2026-10-29T10:00:00Z"));
        const parsed = JSON.parse(text);
        assert.equal(parsed.format, EXPORT_FORMAT);
        assert.equal(parsed.exportedAt, "2026-10-29T10:00:00.000Z");
        const back = parseExport(text);
        assert.ok(back.ok);
        if (back.ok) {
            assert.deepEqual(back.value.settings, settings);
            assert.equal(back.value.quickCss, "a{}");
            assert.deepEqual(back.value.themes, [{ name: "T", enabled: true, css: "b{}" }]);
            assert.deepEqual(back.value.problems, []);
        }
    });

    it("refuses what is not an Amiricord export, or comes from another version", () => {
        assert.deepEqual(parseExport("nope"), { ok: false, error: "the file is not valid JSON" });
        assert.equal(parseExport("{\"format\":\"other\"}").ok, false);
        assert.equal(parseExport(JSON.stringify({ format: EXPORT_FORMAT, version: 99 })).ok, false);
    });

    it("leaves out and reports what is not valid, keeping the rest", () => {
        const text = JSON.stringify({
            format: EXPORT_FORMAT, version: 1,
            settings: { schema: 1, plugins: { "bad id": { enabled: true }, Good: { enabled: false } } },
            quickCss: 5,
            themes: [{ name: "Ok", css: "a{}" }, { name: "", css: "a{}" }, { name: "Huge", css: "x".repeat(MAX_CSS_CHARS + 1) }, { name: "NoCss" }]
        });
        const back = parseExport(text);
        assert.ok(back.ok);
        if (back.ok) {
            assert.deepEqual(Object.keys(back.value.settings!.plugins), ["Good"]);
            assert.equal(back.value.quickCss, undefined);
            assert.deepEqual(back.value.themes.map(theme => theme.name), ["Ok"]);
            assert.equal(back.value.themes[0]!.enabled, false);
            assert.equal(back.value.problems.length >= 4, true);
        }
    });
});

describe("the library of themes", () => {
    const b64 = (text: string) => text;
    const entry = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, type: "theme", description: "d", author: { discord_name: "Someone", github_name: "some" }, tags: ["dark"], downloads: id, likes: 1, release_date: "2026-01-01", content: b64("a{}"), ...extra });

    it("reads the themes of an answer (an object or a list) and leaves out what is not a theme or is not whole", () => {
        const answer = { 1: entry(1, "One"), 2: entry(2, "Snippet", { type: "snippet" }), 3: entry(3, ""), 4: entry(4, "NoCss", { content: "" }), 5: entry(5, "Five", { type: undefined }), 6: null, 7: entry(7, "Huge", { content: "x".repeat(MAX_CSS_CHARS * 2 + 1) }) };
        assert.deepEqual(parseLibrary(answer).map(theme => theme.name), ["One", "Five"]);
        assert.deepEqual(parseLibrary([entry(1, "One")]).map(theme => theme.author), ["Someone"]);
        assert.deepEqual(parseLibrary("nope"), []);
    });

    it("searches every word in name, author, description and tags, and sorts", () => {
        const list = parseLibrary([entry(1, "Midnight", { downloads: 5, likes: 9, release_date: "2026-03-01" }), entry(2, "Sunrise", { downloads: 50, likes: 1, tags: ["light"], release_date: "2026-05-01" }), entry(3, "Aqua", { downloads: 10, likes: 3, release_date: "2026-04-01" })]);
        assert.deepEqual(searchLibrary(list, "", "downloads").map(theme => theme.name), ["Sunrise", "Aqua", "Midnight"]);
        assert.deepEqual(searchLibrary(list, "", "likes").map(theme => theme.name), ["Midnight", "Aqua", "Sunrise"]);
        assert.deepEqual(searchLibrary(list, "", "newest").map(theme => theme.name), ["Sunrise", "Aqua", "Midnight"]);
        assert.deepEqual(searchLibrary(list, "", "name").map(theme => theme.name), ["Aqua", "Midnight", "Sunrise"]);
        assert.deepEqual(searchLibrary(list, "light sun", "name").map(theme => theme.name), ["Sunrise"]);
        assert.deepEqual(searchLibrary(list, "zzz", "name"), []);
    });

    it("accepts an address only on https and on the hosts the plugin declares", () => {
        assert.equal(addressProblem("https://raw.githubusercontent.com/a/b/main/t.theme.css"), null);
        assert.equal(addressProblem("https://themes.equicord.org/api/12"), null);
        assert.match(addressProblem("http://raw.githubusercontent.com/a.css") ?? "", /https/);
        assert.match(addressProblem("https://evil.example/a.css") ?? "", /only/);
        assert.match(addressProblem("https://raw.githubusercontent.com.evil.example/a.css") ?? "", /only/);
        assert.match(addressProblem("nope") ?? "", /not an address/);
    });
});

describe("the preview picture of a library theme", () => {
    it("is kept only when it is on the library's own server, in its pictures folder", () => {
        assert.equal(thumbnailAddress("https://themes.equicord.org/thumbnails/Midnight_1.png"), "https://themes.equicord.org/thumbnails/Midnight_1.png");
        for (const value of ["https://evil.example/thumbnails/a.png", "http://themes.equicord.org/thumbnails/a.png", "https://themes.equicord.org/api/1", "https://themes.equicord.org.evil.example/thumbnails/a.png", 5, undefined, "https://themes.equicord.org/thumbnails/a\u0000.png"]) assert.equal(thumbnailAddress(value), "");
        const [theme] = parseLibrary([{ id: 1, name: "One", content: "a{}", thumbnail_url: "https://themes.equicord.org/thumbnails/One_1.png" }]);
        assert.equal(theme?.thumbnail, "https://themes.equicord.org/thumbnails/One_1.png");
        assert.equal(parseLibrary([{ id: 2, name: "Two", content: "a{}", thumbnail_url: "https://evil.example/x.png" }])[0]?.thumbnail, "");
    });
});
