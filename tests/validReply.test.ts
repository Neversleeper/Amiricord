/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickMessage, previewText, referenceInFiber } from "../src/vencordplugins/ValidReply/index";

describe("ValidReply", () => {
    it("reads what a reply answers from the component's props, a few levels up", () => {
        const reply = { memoizedProps: { baseMessage: { channel_id: "9", messageReference: { channel_id: "7", message_id: "5" } } }, return: null };
        const leaf = { memoizedProps: {}, return: { memoizedProps: null, return: reply } };
        assert.deepEqual(referenceInFiber(leaf), { channelId: "7", messageId: "5" });
        const noChannel = { memoizedProps: { baseMessage: { channel_id: "9", messageReference: { message_id: "5" } } } };
        assert.deepEqual(referenceInFiber(noChannel), { channelId: "9", messageId: "5" });
        assert.equal(referenceInFiber({ memoizedProps: { baseMessage: { messageReference: null } } }), undefined);
        assert.equal(referenceInFiber({ memoizedProps: {} }), undefined);
        assert.equal(referenceInFiber(undefined), undefined);
    });

    it("writes the preview as name and text on one line", () => {
        assert.equal(previewText({ content: "hello\n  there", author: { username: "ana", global_name: "Ana" } }), "Ana: hello there");
        assert.equal(previewText({ content: "hi", author: { username: "ana", global_name: null } }), "ana: hi");
        assert.equal(previewText({ content: "", attachments: [{}], author: { username: "ana" } }), "ana: [attachment]");
        assert.equal(previewText({ content: " ", embeds: [{}], author: { username: "ana" } }), "ana: [embed]");
        assert.equal(previewText({ content: "", sticker_items: [{}], author: { username: "ana" } }), "ana: [sticker]");
        assert.equal(previewText({ content: "hi" }), "hi");
        assert.equal(previewText({ content: "", author: { username: "ana" } }), "ana");
        const long = previewText({ content: "x".repeat(500), author: { username: "ana" } });
        assert.ok(long.length <= 165 && long.endsWith("…"));
    });

    it("picks the asked message and nothing else", () => {
        assert.equal(pickMessage([{ id: "1" }, { id: "2" }], "2")?.id, "2");
        assert.equal(pickMessage([{ id: "1" }], "2"), undefined);
        assert.equal(pickMessage({ id: "2" }, "2"), undefined);
        assert.equal(pickMessage(undefined, "2"), undefined);
    });
});
