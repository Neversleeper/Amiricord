/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProfileBadges, createProfileBadgeHub, MAX_PROFILE_BADGES_PER_PLUGIN } from "../src/api/profileBadges";

const provider = (id: string, info = { description: "hi", iconSrc: "data:x" }) => ({ id, badge: () => info });

describe("profile badges", () => {
    it("lists the badges of every provider for a person, in the order they were added", () => {
        const hub = createProfileBadgeHub();
        assert.equal(hub.add("A", provider("one")), true);
        assert.equal(hub.add("B", provider("two", { description: "two", iconSrc: "data:y" })), true);
        assert.deepEqual(hub.forUser("1").map(badge => badge.id), ["A_one", "B_two"]);
    });

    it("skips a provider that gives nothing, a broken answer, or a throw, and reports the throw", () => {
        const hub = createProfileBadgeHub();
        hub.add("A", { id: "none", badge: () => undefined });
        hub.add("A", provider("empty", { description: "x", iconSrc: "" }));
        hub.add("B", { id: "boom", badge() { throw new Error("no"); } });
        hub.add("C", provider("fine"));
        const errors: string[] = [];
        assert.deepEqual(hub.forUser("1", plugin => errors.push(plugin)).map(badge => badge.id), ["C_fine"]);
        assert.deepEqual(errors, ["B"]);
    });

    it("refuses a bad id, a repeated id and more than the limit per plugin", () => {
        const hub = createProfileBadgeHub();
        assert.equal(hub.add("A", provider("")), false);
        assert.equal(hub.add("A", provider("has space")), false);
        assert.equal(hub.add("A", { id: "x", badge: "no" } as never), false);
        assert.equal(hub.add("A", provider("a")), true);
        assert.equal(hub.add("A", provider("a")), false);
        for (let index = 1; index < MAX_PROFILE_BADGES_PER_PLUGIN; index++) assert.equal(hub.add("A", provider(`n${index}`)), true);
        assert.equal(hub.add("A", provider("over")), false);
        assert.equal(hub.add("B", provider("a")), true);
    });

    it("takes a plugin's badges away when it stops", () => {
        const hub = createProfileBadgeHub();
        let dispose: (() => void) | undefined;
        const mine = buildProfileBadges(hub, "A", callback => { dispose = callback; });
        assert.equal(mine.add(provider("a")), true);
        hub.add("B", provider("b"));
        dispose?.();
        assert.deepEqual(hub.forUser("1").map(badge => badge.id), ["B_b"]);
    });

    it("cuts a long hover text", () => {
        const hub = createProfileBadgeHub();
        hub.add("A", provider("long", { description: "x".repeat(500), iconSrc: "data:z" }));
        assert.equal(hub.forUser("1")[0].description.length, 120);
    });
});
