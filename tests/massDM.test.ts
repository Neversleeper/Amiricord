/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmationText, DEFAULT_DELAY_MS, delayOf, MIN_DELAY_MS, parseIds, recipients } from "../src/testcordplugins/MassDM/index";

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";
const ME = "100000000000000009";

describe("MassDM: the wait between messages", () => {
    it("takes what was asked for when it is at least a second, rounded down", () => {
        assert.equal(delayOf(2500), 2500);
        assert.equal(delayOf(1000), 1000);
        assert.equal(delayOf(1999.9), 1999);
    });

    it("never goes below a second, and uses 1.5 seconds when none was given or it is not a number", () => {
        for (const value of [0, 100, -5, 999]) assert.equal(delayOf(value), MIN_DELAY_MS, String(value));
        for (const value of [undefined, null, "500", Number.NaN, Number.POSITIVE_INFINITY, {}]) assert.equal(delayOf(value), DEFAULT_DELAY_MS, String(value));
    });
});

describe("MassDM: the list of ids", () => {
    it("reads ids separated by commas, semicolons, spaces or new lines, each once, and leaves out what is not an id", () => {
        assert.deepEqual(parseIds(`${A}, ${B};${C}\n${A} nope 12 ${B}`), [A, B, C]);
        assert.deepEqual(parseIds(""), []);
        assert.deepEqual(parseIds("abc, 123"), []);
    });
});

describe("MassDM: who gets the message", () => {
    const sources = { friendIds: [A, B, ME], openDmUserIds: [B, C, ME], selfId: ME };
    const rules = { friends: true, allOpenDMs: false, useWhitelist: false, userIds: "" };

    it("sends to the friends, never to yourself", () => {
        assert.deepEqual(recipients(sources, rules), [A, B]);
    });

    it("sends to everyone with an open chat when asked, instead of the friends", () => {
        assert.deepEqual(recipients(sources, { ...rules, allOpenDMs: true }), [B, C]);
    });

    it("sends to nobody when friends are left out and open chats are not asked for", () => {
        assert.deepEqual(recipients(sources, { ...rules, friends: false }), []);
    });

    it("leaves out the people of the list (blacklist) or keeps only them (whitelist)", () => {
        assert.deepEqual(recipients(sources, { ...rules, userIds: A }), [B]);
        assert.deepEqual(recipients(sources, { ...rules, userIds: `${B}, ${C}`, useWhitelist: true }), [B]);
        assert.deepEqual(recipients(sources, { ...rules, userIds: "not an id" }), [A, B], "a list with no valid id filters nothing");
    });

    it("gives each person once", () => {
        assert.deepEqual(recipients({ friendIds: [A, A, B], openDmUserIds: [], selfId: undefined }, rules), [A, B]);
    });
});

describe("MassDM: the question before sending", () => {
    it("says how many people, to whom, the text, and how long it takes", () => {
        const text = confirmationText(3, "my new account is X", 1500, false);
        assert.match(text, /3 people/);
        assert.match(text, /your friends/);
        assert.match(text, /my new account is X/);
        assert.match(text, /about 5 seconds/);
        assert.match(text, /\/massdm-stop/);
    });

    it("says one person in the singular, names the open chats, and cuts a very long text", () => {
        assert.match(confirmationText(1, "hi", 1000, true), /1 person \(everyone you have an open chat with\)/);
        const long = confirmationText(2, "x".repeat(500), 1000, false);
        assert.ok(long.includes(`${"x".repeat(200)}...`));
        assert.equal(long.includes("x".repeat(201)), false);
    });
});
