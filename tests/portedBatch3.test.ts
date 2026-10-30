/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uniqueNames } from "../src/equicordplugins/DownloadAllAttachments/index";
import { followAction } from "../src/equicordplugins/FollowVoiceUser/index";
import { searchMessage } from "../src/equicordplugins/GoogleThat/index";
import { repeatContent } from "../src/equicordplugins/RepeatMessages/index";
import { mutedIds, silence } from "../src/equicordplugins/SilenceUsers/index";
import { wasMoved } from "../src/testcordplugins/AntiMoveDeco/index";
import { muteSettings } from "../src/testcordplugins/MuteUnmuteServers/index";
import { reactionBody } from "../src/testcordplugins/ReactionLogger/index";
import { delayMs } from "../src/testcordplugins/TimeDelete/index";
import { cleanMessage, cleanUrl } from "../src/vencordplugins/ClearURLs/index";
import { emojiMarkdown } from "../src/vencordplugins/CopyEmojiMarkdown/index";
import { stickerFromSrc, stickerUrl } from "../src/vencordplugins/CopyStickerLinks/index";
import { mentionText } from "../src/vencordplugins/QuickMention/index";
import { unreadEntries } from "../src/vencordplugins/ReadAllNotificationsButton/index";
import { silently } from "../src/vencordplugins/SilentMessageToggle/index";

describe("ported plugins, third batch", () => {
    it("knows when you were moved out of the protected channel", () => {
        assert.equal(wasMoved([{ userId: "1", channelId: "b" }], "1", "a"), true);
        assert.equal(wasMoved([{ userId: "1", channelId: null }], "1", "a"), true);
        assert.equal(wasMoved([{ userId: "1", channelId: "a" }], "1", "a"), false);
        assert.equal(wasMoved([{ userId: "2", channelId: "b" }], "1", "a"), false);
    });

    it("writes a mention, a silent message and a delay", () => {
        assert.equal(mentionText("5"), "<@5> ");
        assert.equal(silently("hi"), "@silent hi");
        assert.equal(silently("@silent hi"), "@silent hi");
        assert.equal(delayMs(0), 1000);
        assert.equal(delayMs(Number.NaN), 5000);
        assert.equal(delayMs(30), 30000);
    });

    it("cleans tracking from links with the rules it is given", () => {
        const rules = [{ urlPattern: /example\.com/i, rules: [/^utm_/i] }];
        assert.equal(cleanUrl("https://example.com/a?utm_source=x&keep=1", rules), "https://example.com/a?keep=1");
        assert.equal(cleanUrl("https://other.test/a?utm_source=x", rules), "https://other.test/a?utm_source=x");
        assert.equal(cleanMessage("see https://example.com/a?utm_x=1 ok", rules), "see https://example.com/a ok");
        assert.equal(cleanMessage("no link", rules), "no link");
    });

    it("words the reaction notices", () => {
        assert.equal(reactionBody("heart", [{ username: "ana" }]), "ana reacted with heart to your message");
        assert.equal(reactionBody("heart", [{}, {}]), "You received 2 reactions of heart");
    });

    it("builds the notification settings to mute or unmute", () => {
        assert.equal(muteSettings(true).muted, true);
        assert.equal(muteSettings(true).message_notifications, 2);
        assert.equal(muteSettings(false).mute_config, null);
        assert.equal(muteSettings(false).mobile_push, true);
    });

    it("takes the pings out of silenced people's messages", () => {
        const muted = mutedIds("1, 2,,3");
        assert.deepEqual([...muted], ["1", "2", "3"]);
        const event = { type: "MESSAGE_CREATE", message: { author: { id: "2" }, mentions: [1], mention_roles: [1], mention_everyone: true } };
        assert.equal(silence(event, muted), undefined);
        assert.deepEqual(event.message.mentions, []);
        assert.equal(event.message.mention_everyone, false);
        assert.equal(silence({ type: "NOTIFICATION_CREATE", message: { author: { id: "3" } } }, muted), false);
        assert.equal(silence({ type: "NOTIFICATION_CREATE", message: { author: { id: "9" } } }, muted), undefined);
        assert.equal(silence({ type: "NOTIFICATION_CREATE", message: { author: { id: "3" } } }, new Set()), undefined);
    });

    it("writes emoji markdown, search links and sticker links", () => {
        assert.equal(emojiMarkdown({ id: "9", name: "cat~1", animated: true }, true, () => undefined), "<a:cat:9>");
        assert.equal(emojiMarkdown({ name: "alien", animated: false }, true, () => "👽"), "👽");
        assert.equal(emojiMarkdown({ name: "alien", animated: false }, false, () => "👽"), ":alien:");
        const store = { hyperlink: false, embed: true, defaultEngine: "Bing", customEngineURL: "" };
        assert.equal(searchMessage("a b", store), "https://www.bing.com/search?q=a%20b");
        assert.equal(searchMessage("a", { ...store, embed: false }), "<https://www.bing.com/search?q=a>");
        assert.equal(searchMessage("a", { ...store, hyperlink: true }), "[a](https://www.bing.com/search?q=a)");
        assert.equal(stickerUrl("12", 4), "https://cdn.discordapp.com/stickers/12.gif?size=512&lossless=true");
        assert.deepEqual(stickerFromSrc("https://media.discordapp.net/stickers/123456789012345678.png?size=160"), { id: "123456789012345678", format: 1 });
        assert.equal(stickerFromSrc("https://x.test/a.png"), undefined);
    });

    it("decides what to do for the person being followed, and which channels are unread", () => {
        assert.equal(followAction({ userId: "1", channelId: "b" }, "1", "a", false), "b");
        assert.equal(followAction({ userId: "1", channelId: "a" }, "1", "a", false), undefined);
        assert.equal(followAction({ userId: "1", channelId: null }, "1", "a", true), null);
        assert.equal(followAction({ userId: "1", channelId: null }, "1", "a", false), undefined);
        assert.equal(followAction({ userId: "2", channelId: "b" }, "1", "a", true), undefined);
        assert.deepEqual(unreadEntries(["a", "b"], id => id === "b", id => `m${id}`), [{ channelId: "b", messageId: "mb", readStateType: 0 }]);
    });

    it("repeats a message with its files and numbers repeated file names", () => {
        assert.equal(repeatContent({ content: "hi" }), "hi");
        assert.equal(repeatContent({ content: "hi", attachments: [{ filename: "a.png", url: "u" }] }), "hi\nAttachments:\n - a.png (u)");
        assert.deepEqual(uniqueNames(["a.png", "a.png", "b", "b"]), ["a.png", "a_1.png", "b", "b_1"]);
    });
});
