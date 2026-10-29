/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import clickableRoles, { avatarOf, MAX_VISIBLE_MEMBERS, memberIdsUrl, readMemberIds, splitVisible } from "../src/equicordplugins/ClickableRoles/index";
import newUserIndicator, { accountAgeDays, indicatorText } from "../src/testcordplugins/NewUserIndicator/index";
import wordCount, { countOf } from "../src/testcordplugins/WordCount/index";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const real = "probe/screen-modules-653945.json";
const modules = existsSync(real) ? JSON.parse(readFileSync(real, "utf8")) as Record<string, string> : {};

const registered = (plugin: { patches?: unknown[]; }, index: number, name: string): RegisteredPatch => ({ ...(plugin.patches![index] as object), plugin: name }) as RegisteredPatch;

describe("WordCount", () => {
    it("counts words and characters and shows nothing for five words or fewer", () => {
        assert.deepEqual(countOf("one two three four five six"), { words: 6, characters: 27 });
        assert.equal(countOf("one two three four five"), undefined);
        assert.equal(countOf("  \n "), undefined);
        assert.equal(countOf(undefined), undefined);
        assert.equal(countOf(5), undefined);
    });

    it("takes its patch in the real message content of build 653945 (only when the probe dump is on this machine)", { skip: !existsSync(real) }, () => {
        const patch = wordCount.patches![0]!;
        const text = modules["438729"]!;
        assert.ok(text.includes(patch.find as string));
        assert.equal(Object.values(modules).filter(code => code.includes(patch.find as string)).length, 1, "the find is in one module");
        const result = compileModule("438729", text, [registered(wordCount, 0, "WordCount")]);
        assert.equal(result.outcomes[0]!.replacements[0]!.status, "applied");
        assert.match(result.code, /WITH_CONTENT\}\),\$self\.wordCount|wordCount\(arguments\[0\]\.message\)\]/);
    });
});

describe("NewUserIndicator", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const idMadeAt = (iso: string) => String((BigInt(Date.parse(iso) - 1_420_070_400_000) << 22n));

    it("reads the age of an account from its id", () => {
        assert.equal(accountAgeDays(idMadeAt("2026-10-27T11:00:00Z"), now), 2);
        assert.equal(accountAgeDays(idMadeAt("2026-10-29T11:00:00Z"), now), 0);
        assert.equal(accountAgeDays("123456789012345678", now) !== undefined, true);
        assert.equal(accountAgeDays("nope", now), undefined);
        assert.equal(accountAgeDays(5, now), undefined);
    });

    it("marks only young accounts that are not bots, and says how old they are", () => {
        assert.equal(indicatorText({ id: idMadeAt("2026-10-27T11:00:00Z") }, 30, now), "Account created 2 days ago");
        assert.equal(indicatorText({ id: idMadeAt("2026-10-28T11:00:00Z") }, 30, now), "Account created 1 day ago");
        assert.equal(indicatorText({ id: idMadeAt("2026-08-01T00:00:00Z") }, 30, now), undefined);
        assert.equal(indicatorText({ id: idMadeAt("2026-10-27T11:00:00Z"), bot: true }, 30, now), undefined);
        assert.equal(indicatorText(undefined, 30, now), undefined);
        assert.equal(indicatorText({ id: "x" }, 30, now), undefined);
    });

    it("takes its two patches in the real message header and member list row of build 653945 (only when the probe dump is on this machine)", { skip: !existsSync(real) }, () => {
        const header = compileModule("799162", modules["799162"]!, [registered(newUserIndicator, 0, "NewUserIndicator")]);
        assert.equal(header.outcomes[0]!.replacements[0]!.status, "applied");
        assert.match(header.code, /null!=ev\?ev:null,[^\n]{0,40}messageIndicator\(arguments\[0\]\.message\),null==eI/);
        const row = compileModule("589158", modules["589158"]!, [registered(newUserIndicator, 1, "NewUserIndicator")]);
        assert.equal(row.outcomes[0]!.replacements[0]!.status, "applied");
        assert.equal(row.code.split("memberIndicator(arguments[0])").length - 1, 1);
    });
});

describe("ClickableRoles", () => {
    it("keeps only well-formed ids, each once, and splits the first ones from the rest", () => {
        assert.deepEqual(readMemberIds(["123456789012345678", "123456789012345678", "abc", 5, "223456789012345678"]), ["123456789012345678", "223456789012345678"]);
        assert.deepEqual(readMemberIds({ not: "a list" }), []);
        const ids = Array.from({ length: 25 }, (_, index) => String(100000000000000000n + BigInt(index)));
        assert.deepEqual(splitVisible(ids).more, 25 - MAX_VISIBLE_MEMBERS);
        assert.equal(splitVisible(ids).visible.length, MAX_VISIBLE_MEMBERS);
        assert.deepEqual(splitVisible(["1"], 20), { visible: ["1"], more: 0 });
    });

    it("builds the address Discord uses and the picture of a person", () => {
        assert.equal(memberIdsUrl("111111111111111111", "222222222222222222"), "/guilds/111111111111111111/roles/222222222222222222/member-ids");
        assert.equal(avatarOf({ id: "123456789012345678", avatar: "0123456789abcdef0123456789abcdef" }), "https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png?size=48");
        assert.match(avatarOf({ id: "123456789012345678", avatar: "../evil" }), /embed\/avatars\/[0-5]\.png$/);
        assert.match(avatarOf(undefined), /embed\/avatars\/0\.png$/);
    });

    it("takes its two patches in the real role pill and member list of build 653945 (only when the probe dump is on this machine)", { skip: !existsSync(real) }, () => {
        const pillPatch = clickableRoles.patches![0]!;
        assert.equal(Object.values(modules).filter(code => code.includes(pillPatch.find as string)).length, 1);
        const pill = compileModule("166005", modules["166005"]!, [registered(clickableRoles, 0, "ClickableRoles")]);
        assert.equal(pill.outcomes[0]!.replacements[0]!.status, "applied");
        assert.match(pill.code, /\.colorString\?\?\w+;return \$self\.wrapRolePill|wrapRolePill\(arguments\[0\],\(\)=>\(0,/);
        const groups = compileModule("527053", modules["527053"]!, [registered(clickableRoles, 1, "ClickableRoles")]);
        assert.equal(groups.outcomes[0]!.replacements[0]!.status, "applied");
        assert.equal(groups.code.split("RoleGroup,{Original:").length - 1, 2, "both group titles that use a section key");
    });
});

describe("WordCount while typing", () => {
    it("says words and characters from the first letter, and nothing for an empty box", async () => {
        const { typedLine } = await import("../src/testcordplugins/WordCount/index");
        assert.equal(typedLine("hola"), "1 word, 4 characters");
        assert.equal(typedLine("hola que tal"), "3 words, 12 characters");
        assert.equal(typedLine(""), "");
        assert.equal(typedLine("   "), "");
        assert.equal(typedLine("﻿​"), "");
    });
});
