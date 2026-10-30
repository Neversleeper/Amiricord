/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countWords, mockText, randomInt, rollDice, toMorse, transformText, uwuify } from "../src/equicordplugins/MoreCommands/index";
import { highestRole } from "../src/equicordplugins/ShowRolesInChat/index";
import { clearStores } from "../src/testcordplugins/CacheResetButton/index";
import { prune, shortAgo } from "../src/testcordplugins/LastOnline/index";
import { relationshipMark } from "../src/testcordplugins/RelationshipIndicators/index";
import { roleBody } from "../src/testcordplugins/RoleDuplication/index";
import { isWebhookUrl, webhookBody } from "../src/testcordplugins/WebhookSend/index";
import { platformMarks } from "../src/vencordplugins/PlatformIndicators/index";
import { createdAt, guildFacts } from "../src/vencordplugins/ServerInfo/index";
import { usernameText } from "../src/vencordplugins/ShowMeYourName/index";

describe("ported plugins, fifth batch", () => {
    it("changes text in the ways MoreCommands offers", () => {
        assert.equal(toMorse("SOS hi"), "... --- ... / .... ..");
        assert.equal(toMorse("é"), "");
        assert.equal(mockText("hello world"), "hElLo WoRlD");
        assert.equal(uwuify("really nice"), "weawwy nyice uwu");
        assert.equal(transformText("abc", "reverse"), "cba");
        assert.equal(transformText("abc", "UPPER"), "ABC");
        assert.equal(transformText("abc", "nonsense"), "abc");
        assert.deepEqual(countWords("  two words "), { words: 2, characters: 12 });
        assert.deepEqual(countWords(""), { words: 0, characters: 0 });
    });

    it("picks whole numbers and rolls dice within limits", () => {
        assert.equal(randomInt(1, 6, () => 0), 1);
        assert.equal(randomInt(1, 6, () => 0.999), 6);
        assert.equal(randomInt(6, 1, () => 0), 1);
        assert.equal(rollDice(6, 3, () => 0).length, 3);
        assert.equal(rollDice(6, 500, () => 0).length, 20);
        assert.ok(rollDice(1, 1, () => 0.99)[0] <= 2);
    });

    it("builds a role copy and server facts", () => {
        assert.deepEqual(roleBody({ name: "Mod", color: 5, permissions: 8n, mentionable: true, hoist: false }), { name: "Mod", color: 5, permissions: "8", mentionable: true, hoist: false });
        assert.equal(roleBody({ name: "Mod", color: 0, permissions: "0", mentionable: false, hoist: false }, "  Copy ").name, "Copy");
        assert.equal(createdAt("175928847299117063").toISOString(), "2016-04-30T11:18:25.796Z");
        const facts = guildFacts({ id: "175928847299117063", name: "Test", features: new Set(["A", "B"]), premiumTier: 2 }, { roles: 4 });
        assert.deepEqual(facts.map(fact => fact[0]), ["Name", "Id", "Created", "Roles", "Boost level", "Features"]);
        assert.equal(facts.find(fact => fact[0] === "Features")?.[1], "A, B");
    });

    it("clears only the stores that can be cleared and survives one that throws", () => {
        let count = 0;
        const cleared = clearStores([
            { name: "A", store: { clearCache() { count++; } } },
            { name: "B", store: {} },
            { name: "C", store: undefined },
            { name: "D", store: { clearCache() { throw new Error("no"); } } }
        ]);
        assert.deepEqual(cleared, ["A"]);
        assert.equal(count, 1);
    });

    it("accepts only Discord webhook addresses and never pings", () => {
        assert.equal(isWebhookUrl("https://discord.com/api/webhooks/1/abc"), true);
        assert.equal(isWebhookUrl("http://discord.com/api/webhooks/1/abc"), false);
        assert.equal(isWebhookUrl("https://evil.example/api/webhooks/1/abc"), false);
        assert.equal(isWebhookUrl("https://discord.com/other"), false);
        assert.equal(isWebhookUrl("nope"), false);
        assert.deepEqual(webhookBody("hi", "  Bot ", "https://x/y.png"), { content: "hi", allowed_mentions: { parse: [] }, username: "Bot", avatar_url: "https://x/y.png" });
        assert.equal(webhookBody("hi", "", "http://x/y.png").avatar_url, undefined);
    });

    it("marks relationships, platforms, roles and usernames", () => {
        assert.equal(relationshipMark(1)?.title, "Friend");
        assert.equal(relationshipMark(2)?.title, "Blocked");
        assert.equal(relationshipMark(3), undefined);
        assert.equal(platformMarks({ desktop: "online", mobile: "offline", web: "idle" })?.text, "🖥 🌐");
        assert.equal(platformMarks({ desktop: "offline" }), undefined);
        assert.equal(platformMarks(undefined), undefined);
        const roles = [{ id: "3", name: "Admin" }, { id: "2", name: "Mod" }, { id: "1", name: "Member" }];
        assert.equal(highestRole(roles, ["1", "2"], [])?.name, "Mod");
        assert.equal(highestRole(roles, ["1", "2"], ["2"])?.name, "Member");
        assert.equal(highestRole(roles, [], []), undefined);
        assert.equal(usernameText("ana", "Ana!", true), "@ana");
        assert.equal(usernameText("ana", "ana", true), undefined);
        assert.equal(usernameText("ana", "ana", false), "@ana");
        assert.equal(usernameText(undefined, "x", false), undefined);
    });

    it("says how long ago and forgets old last-seen times", () => {
        assert.equal(shortAgo(10_000), "now");
        assert.equal(shortAgo(5 * 60_000), "5m");
        assert.equal(shortAgo(3 * 3_600_000), "3h");
        assert.equal(shortAgo(2 * 86_400_000), "2d");
        const now = 10 * 86_400_000;
        assert.deepEqual(prune({ a: now - 1000, b: now - 8 * 86_400_000 }, now), { a: now - 1000 });
    });
});
