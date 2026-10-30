/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findProps, messageColor } from "../src/vencordplugins/RoleColorEverywhere/index";

describe("RoleColorEverywhere", () => {
    it("finds the props that hold what is asked, going up from the element's React node", () => {
        const top = { memoizedProps: { user: { id: "5" }, guildId: "9" }, return: null };
        const middle = { memoizedProps: { className: "x" }, return: top };
        const element = { __reactFiber$abc: { memoizedProps: null, return: middle }, other: 1 };
        assert.equal(findProps(element, props => "user" in props)?.guildId, "9");
        assert.equal(findProps(element, props => "nothing" in props), undefined);
        assert.equal(findProps(element, props => "user" in props, 2), undefined);
        assert.equal(findProps({}, () => true), undefined);
    });

    it("mixes a role colour into the text colour by a percentage", () => {
        assert.equal(messageColor("#ff0000", 30), "color-mix(in oklab, #ff0000 30%, var(--text-default))");
        assert.equal(messageColor("#ff0000", 250), "color-mix(in oklab, #ff0000 100%, var(--text-default))");
        assert.equal(messageColor("#ff0000", 0), undefined);
        assert.equal(messageColor(null, 30), undefined);
        assert.equal(messageColor("red; background: url(x)", 30), undefined);
    });

});
