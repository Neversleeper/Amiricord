/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCommon, type CommonFinders, STORE_NAMES } from "../src/api/commonStores";
import type { Finder } from "../src/webpack/finders";

/** Finders that only remember what was asked, so the test sees which finder each name became. */
function fakeFinders() {
    const asked: string[] = [];
    const make = (description: string) => {
        asked.push(description);
        return { description } as unknown as Finder<never>;
    };
    const finders: CommonFinders = {
        byStore: (name: string) => make(`store:${name}`) as Finder<never>,
        byProps: (...props: string[]) => make(`props:${props.join(",")}`) as Finder<never>
    };
    return { finders, asked };
}

describe("buildCommon", () => {
    it("makes a finder by store name for every store, and finds the dispatcher by its two methods", () => {
        const { finders } = fakeFinders();
        const common = buildCommon(finders) as unknown as Record<string, Finder<unknown>>;
        for (const name of STORE_NAMES) assert.equal(common[name].description, `store:${name}`);
        assert.equal(common.FluxDispatcher.description, "props:dispatch,subscribe");
    });

    it("creates no finder until a name is read, and keeps the same finder after that", () => {
        const { finders, asked } = fakeFinders();
        const common = buildCommon(finders);
        assert.deepEqual(asked, []);
        const first = common.UserStore;
        assert.deepEqual(asked, ["store:UserStore"]);
        assert.equal(common.UserStore, first);
        assert.deepEqual(asked, ["store:UserStore"]);
    });

    it("lists every name, so a plugin or a test can see what is there", () => {
        const { finders } = fakeFinders();
        assert.deepEqual(Object.keys(buildCommon(finders)), [...STORE_NAMES, "FluxDispatcher"]);
    });

    it("offers the stores TestCord plugins ask for most, by Discord's own names", () => {
        assert.deepEqual([...STORE_NAMES], ["UserStore", "ChannelStore", "GuildStore", "GuildMemberStore", "SelectedChannelStore", "SelectedGuildStore",
            "RelationshipStore", "PresenceStore", "MessageStore", "PermissionStore", "ReadStateStore", "VoiceStateStore"]);
    });

    it("keeps the names unique", () => {
        assert.equal(new Set(STORE_NAMES).size, STORE_NAMES.length);
    });
});
