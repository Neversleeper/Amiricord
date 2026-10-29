/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUserArea, createUserAreaHub, MAX_USER_AREA_BUTTONS_PER_PLUGIN } from "../src/api/userArea";
import { tagFor, TAGS } from "../src/equicordplugins/MoreUserTags/index";
import { viewUrls } from "../src/vencordplugins/ViewIcons/index";

const make = (component: unknown, key: string, plugin: string) => ({ component, key, plugin });
const A = () => null;
const B = () => null;
const C = () => null;

describe("buttons in the user panel", () => {
    it("gives the buttons lowest priority first and then in the order they were added", () => {
        const hub = createUserAreaHub();
        hub.add("P", A, 5);
        hub.add("Q", B, 0);
        hub.add("Q", C, 0);
        const drawn = hub.render(make) as ReturnType<typeof make>[];
        assert.deepEqual(drawn.map(entry => entry.component), [B, C, A]);
        assert.equal(new Set(drawn.map(entry => entry.key)).size, 3);
    });

    it("refuses what is not a component, repeats, and too many from one plugin", () => {
        const hub = createUserAreaHub();
        assert.equal(hub.add("P", "nope", 0), false);
        assert.equal(hub.add("P", A, 0), true);
        assert.equal(hub.add("P", A, 0), true);
        assert.equal((hub.render(make) as unknown[]).length, 1);
        for (let i = 1; i < MAX_USER_AREA_BUTTONS_PER_PLUGIN; i++) hub.add("P", () => null, 0);
        assert.equal(hub.add("P", () => null, 0), false);
    });

    it("tells listeners about each change and takes a plugin's buttons back when it stops", () => {
        const hub = createUserAreaHub();
        let calls = 0;
        hub.subscribe(() => { calls++; });
        let stop: () => void = () => undefined;
        const api = buildUserArea(hub, "P", callback => { stop = callback; });
        api.add(A);
        assert.equal(calls, 1);
        const before = hub.version();
        stop();
        assert.equal(calls, 2);
        assert.notEqual(hub.version(), before);
        assert.deepEqual(hub.render(make), []);
    });
});

describe("ViewIcons addresses", () => {
    it("asks for the chosen format and size, and gives the 4096 one as the original", () => {
        const { shown, original } = viewUrls("https://cdn.discordapp.com/avatars/1/abc.webp?size=128", "https://discord.com/app", "png", "1024");
        assert.equal(shown, "https://cdn.discordapp.com/avatars/1/abc.png?size=1024");
        assert.equal(original, "https://cdn.discordapp.com/avatars/1/abc.png?size=4096");
    });

    it("keeps webp for pictures that move, and png for addresses of the app itself", () => {
        assert.match(viewUrls("https://cdn.discordapp.com/avatars/1/a_abc.webp?animated=true", "https://discord.com/app", "jpg", "512").shown, /a_abc\.webp\?animated=true&size=512$/);
        assert.match(viewUrls("/assets/default.jpg", "https://discord.com/app", "webp", "256").shown, /^https:\/\/discord\.com\/assets\/default\.png\?size=256$/);
    });
});

describe("MoreUserTags", () => {
    const guild = { ownerId: "owner" };
    const channel = { guild_id: "g", permissionOverwrites: {} };
    const read = (off: string[] = [], bots = false) => (key: string) => key === "dontShowForBots" ? bots : !off.includes(key);
    const bits = (value: bigint) => () => value;

    // `guilds` inside the plugin is only set at start; the owner tag therefore needs a started plugin and is not tried here.
    it("gives the first tag whose permission the person has, in the order of the list", () => {
        const names = TAGS.map(tag => tag.name);
        assert.deepEqual(names.slice(0, 3), ["OWNER", "ADMINISTRATOR", "MODERATOR_STAFF"]);
        const admin = tagFor({ id: "u" }, channel, read(), bits(1n << 3n));
        assert.equal(TAGS[admin]?.name, "ADMINISTRATOR");
        const mod = tagFor({ id: "u" }, channel, read(), bits(1n << 13n));
        assert.equal(TAGS[mod]?.name, "MODERATOR");
        const timeout = tagFor({ id: "u" }, channel, read(), bits(1n << 40n));
        assert.equal(TAGS[timeout]?.name, "CHAT_MODERATOR");
    });

    it("gives no tag without a permission, in a direct message, for a switched-off tag or for a bot when asked", () => {
        assert.equal(tagFor({ id: "u" }, channel, read(), bits(0n)), -1);
        assert.equal(tagFor({ id: "u" }, { permissionOverwrites: {} }, read(), bits(1n << 3n)), -1);
        assert.equal(tagFor({ id: "u" }, channel, read(["show_ADMINISTRATOR"]), bits(1n << 3n)), -1);
        assert.equal(tagFor({ id: "u", bot: true }, channel, read([], true), bits(1n << 3n)), -1);
        assert.equal(guild.ownerId, "owner");
    });
});
