/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type BackupChannel, canWriteTo, channelBody, type CopyOptions, creationOrder, guildIdFromTarget, mapOverwrites, PERMISSIONS, requiredPermissions, retryAfterMs } from "../src/testcordplugins/GuildCopier/index";

const none: CopyOptions = { copyRoles: false, copyChannels: false, copyEmojis: false, copyStickers: false, copyBots: false };

describe("GuildCopier: who may receive a transfer", () => {
    it("asks only for what the copy will do", () => {
        assert.equal(requiredPermissions(none), 0n);
        assert.equal(requiredPermissions({ ...none, copyRoles: true }), PERMISSIONS.MANAGE_ROLES);
        assert.equal(requiredPermissions({ ...none, copyBots: true }), PERMISSIONS.MANAGE_CHANNELS);
        assert.equal(requiredPermissions({ ...none, copyEmojis: true }), PERMISSIONS.MANAGE_GUILD_EXPRESSIONS);
        assert.equal(requiredPermissions({ copyRoles: true, copyChannels: true, copyEmojis: false, copyStickers: true, copyBots: true }), PERMISSIONS.MANAGE_ROLES | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_GUILD_EXPRESSIONS);
    });

    it("lets the owner and an administrator in, and anyone else only with every permission asked for", () => {
        const required = PERMISSIONS.MANAGE_ROLES | PERMISSIONS.MANAGE_CHANNELS;
        assert.equal(canWriteTo(0n, true, required), true);
        assert.equal(canWriteTo(PERMISSIONS.ADMINISTRATOR, false, required), true);
        assert.equal(canWriteTo(required, false, required), true);
        assert.equal(canWriteTo(PERMISSIONS.MANAGE_ROLES, false, required), false);
        assert.equal(canWriteTo(0n, false, required), false);
    });

    it("the permission bits are the ones Discord documents (8, 16, 2^28 and 2^30)", () => {
        assert.deepEqual([PERMISSIONS.ADMINISTRATOR, PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.MANAGE_GUILD_EXPRESSIONS], [8n, 16n, 268435456n, 1073741824n]);
    });
});

describe("GuildCopier: the permission overrides of a channel", () => {
    it("changes the role ids to the new server's, keeps the others, and writes the numbers as text", () => {
        const result = mapOverwrites([{ id: "10", type: 0, allow: 1024n, deny: 0n }, { id: "20", type: 1, allow: "8", deny: "16" }], { "10": "99" });
        assert.deepEqual(result, [{ id: "99", type: 0, allow: "1024", deny: "0" }, { id: "20", type: 1, allow: "8", deny: "16" }]);
        assert.doesNotThrow(() => JSON.stringify(result));
    });

    it("drops what has no id and gives an empty list for what is not a list", () => {
        assert.deepEqual(mapOverwrites([{ type: 0 }, null, 5], {}), []);
        for (const value of [undefined, null, {}, "x"]) assert.deepEqual(mapOverwrites(value, {}), []);
    });
});

const channel = (over: Partial<BackupChannel> & { id: string; }): BackupChannel => ({ name: `c${over.id}`, type: 0, position: 0, permission_overwrites: [], ...over });

describe("GuildCopier: what is sent to create a channel", () => {
    it("sends a category with its name, type and overrides only", () => {
        assert.deepEqual(channelBody(channel({ id: "1", type: 4, name: "Cat", topic: "ignored", parent_id: "7" }), {}, {}), { name: "Cat", type: 4, permission_overwrites: [] });
    });

    it("sends only the fields that have a value, puts the channel in the new category, and uses the defaults for voice and announcement channels", () => {
        const text = channelBody(channel({ id: "2", name: "general", topic: "hi", nsfw: false, parent_id: "1", rate_limit_per_user: 5 }), {}, { "1": "100" });
        assert.deepEqual(text, { name: "general", type: 0, permission_overwrites: [], parent_id: "100", topic: "hi", nsfw: false, rate_limit_per_user: 5 });
        assert.equal(channelBody(channel({ id: "3", type: 2 }), {}, {}).bitrate, 96000);
        assert.equal(channelBody(channel({ id: "4", type: 2, bitrate: 64000, user_limit: 4 }), {}, {}).bitrate, 64000);
        assert.equal(channelBody(channel({ id: "5", type: 5 }), {}, {}).default_auto_archive_duration, 1440);
        assert.equal(channelBody(channel({ id: "6" }), {}, {}).parent_id, null);
    });
});

describe("GuildCopier: the order channels are created in", () => {
    it("creates the categories first, then each group by position with forums last", () => {
        const list = [
            channel({ id: "t2", position: 2, parent_id: "c1" }), channel({ id: "f", type: 15, position: 0, parent_id: "c1" }), channel({ id: "t1", position: 1, parent_id: "c1" }),
            channel({ id: "c2", type: 4, position: 5 }), channel({ id: "c1", type: 4, position: 1 }), channel({ id: "free", position: 3 })
        ];
        assert.deepEqual(creationOrder(list).map(item => item.id), ["c1", "c2", "t1", "t2", "f", "free"]);
    });

    it("leaves the given list as it was", () => {
        const list = [channel({ id: "b", position: 2 }), channel({ id: "a", position: 1 })];
        creationOrder(list);
        assert.deepEqual(list.map(item => item.id), ["b", "a"]);
    });
});

describe("GuildCopier: waiting when Discord says too many requests", () => {
    it("waits what Discord asked for, at most 15 seconds, from its body or its text", () => {
        assert.equal(retryAfterMs({ body: { retry_after: 3.5 } }), 3500);
        assert.equal(retryAfterMs({ text: "{\"retry_after\": 7.2}" }), 7200);
        assert.equal(retryAfterMs({ body: { retry_after: 99 } }), 15_000);
    });

    it("waits 10 seconds when it did not say or said something that is not a number", () => {
        for (const error of [undefined, null, {}, { body: { retry_after: "soon" } }, { body: { retry_after: -1 } }, new Error("x")]) assert.equal(retryAfterMs(error), 10_000);
    });
});

describe("GuildCopier: which server was clicked", () => {
    const icon = (attribute: string | null) => ({ closest: () => ({ getAttribute: () => attribute }) });
    it("reads the server id from the icon in the server list and ignores anything else", () => {
        assert.equal(guildIdFromTarget(icon("guildsnav___1564847328794382408")), "1564847328794382408");
        for (const value of ["guildsnav___home", "guildsnav___", null]) assert.equal(guildIdFromTarget(icon(value)), undefined);
        assert.equal(guildIdFromTarget({ closest: () => null }), undefined);
        assert.equal(guildIdFromTarget(undefined), undefined);
    });
});
