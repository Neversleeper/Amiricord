/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mentionOf, userIdFromTarget } from "../src/equicordplugins/CopyUserMention/index";
import { confirmationText as bulkText, MAX_SHOWN, parseIds as bulkIds, split } from "../src/testcordplugins/BulkFriendRemove/index";
import { confirmationText as scrapperText, parseIds, plan } from "../src/testcordplugins/ChatsScrapper/index";
import { confirmationText as closeText, oneToOneIds } from "../src/testcordplugins/CloseAllDms/index";

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";

describe("CloseAllDms", () => {
    it("takes only one-to-one chats (type 1), in order, and leaves out groups and unknown ids", () => {
        const known: Record<string, { id: string; type: number; }> = { a: { id: "a", type: 1 }, g: { id: "g", type: 3 }, b: { id: "b", type: 1 } };
        assert.deepEqual(oneToOneIds(["a", "g", "x", "b"], id => known[id]), ["a", "b"]);
    });

    it("says how many chats, that groups are kept, and that messages stay", () => {
        assert.match(closeText(1), /Close 1 direct-message chat\?/);
        assert.match(closeText(4), /Close 4 direct-message chats\?/);
        assert.match(closeText(2), /Group chats are kept/);
        assert.match(closeText(2), /\/close-all-dms-stop/);
    });
});

describe("ChatsScrapper", () => {
    const channels = [
        { id: "1", type: 1, recipients: [A] },
        { id: "2", type: 1, recipients: [B] },
        { id: "3", type: 3, recipients: [A, B] },
        { id: "4", type: 1 }
    ];

    it("keeps the chats of the people in the list and closes the other one-to-one chats, never groups", () => {
        assert.deepEqual(plan(channels, [A]), { close: ["2", "4"], kept: 1 });
        assert.deepEqual(plan(channels, []), { close: ["1", "2", "4"], kept: 0 });
    });

    it("reads a list of ids with commas, spaces and new lines, each once, leaving out what is not an id", () => {
        assert.deepEqual(parseIds(`${A}, ${B}\n${A} nope 12`), [A, B]);
        assert.deepEqual(parseIds(""), []);
    });

    it("says how many are closed and how many kept", () => {
        assert.match(scrapperText(3, 2), /Close 3 direct-message chats and keep 2\?/);
        assert.match(scrapperText(1, 0), /Close 1 direct-message chat and keep 0\?/);
    });
});

describe("BulkFriendRemove", () => {
    it("separates the ids that are friends from those that are not, in the order given", () => {
        assert.deepEqual(split([C, A, B], [A, C]), { friends: [C, A], others: [B] });
    });

    it("reads ids the same way as the other plugins", () => {
        assert.deepEqual(bulkIds(`${A};${B} ${A}`), [A, B]);
    });

    it("lists the names, cuts a long list, and says how many ids were skipped", () => {
        const names = Array.from({ length: MAX_SHOWN + 5 }, (_, index) => `friend${index}`);
        const text = bulkText(names, 2);
        assert.match(text, /Remove 35 friends\?/);
        assert.ok(text.includes("friend0"));
        assert.equal(text.includes(`friend${MAX_SHOWN}`), false);
        assert.match(text, /and 5 more/);
        assert.match(text, /2 of the ids you gave are not your friend/);
        assert.match(bulkText(["x"], 1), /1 of the ids you gave is not your friend/);
        assert.match(bulkText(["x"], 0), /Remove 1 friend\?/);
    });
});

describe("CopyUserMention", () => {
    const element = (attributes: Record<string, string>, parent?: unknown, src?: string) => ({ getAttribute: (name: string) => attributes[name] ?? null, parentElement: parent, src });

    it("writes the mention", () => {
        assert.equal(mentionOf(A), `<@${A}>`);
    });

    it("finds the person from the clicked element, a parent, a list item or an avatar address", () => {
        assert.equal(userIdFromTarget(element({ "data-user-id": A })), A);
        assert.equal(userIdFromTarget(element({}, element({ "data-author-id": B }))), B);
        assert.equal(userIdFromTarget(element({ "data-list-item-id": `members___${C}` })), C);
        assert.equal(userIdFromTarget(element({}, undefined, `https://cdn.discordapp.com/avatars/${A}/abc.png`)), A);
    });

    it("gives nothing when the click says nothing about a person", () => {
        assert.equal(userIdFromTarget(element({ "data-user-id": "not-an-id" })), undefined);
        assert.equal(userIdFromTarget(null), undefined);
    });
});
