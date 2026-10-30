/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { channelIdFromTarget, guildIdFromTarget, messageFromTarget, userIdFromTarget } from "../src/api/clickTargets";
import { buildTimeouts, parseNumbers } from "../src/equicordplugins/CustomStatusTimeouts/index";
import { fixedName } from "../src/equicordplugins/FixFileExtensions/index";
import { fixQuery } from "../src/equicordplugins/SearchFix/index";
import { replaceUrl, replaceUrls } from "../src/testcordplugins/EmbeddedURLs/index";
import { matchesKeybind } from "../src/testcordplugins/QuickDelete/index";
import { replaceDigits } from "../src/testcordplugins/SafeNumbers/index";
import { altText } from "../src/vencordplugins/BetterGifAltText/index";
import { userUrl } from "../src/vencordplugins/CopyUserURLs/index";
import { idleMs } from "../src/vencordplugins/CustomIdle/index";
import { imageSource } from "../src/vencordplugins/FixImagesQuality/index";
import { imageTitle } from "../src/vencordplugins/ImageFilename/index";
import { searchUrl } from "../src/vencordplugins/ReverseImageSearch/index";
import { mayPlay } from "../src/vencordplugins/SuperReactionTweaks/index";
import { avatarStyles } from "../src/vencordplugins/ThemeAttributes/index";
import { flagsToggled, hasEmbedState } from "../src/vencordplugins/UnsuppressEmbeds/index";

const A = "111111111111111111";
const B = "222222222222222222";

function element(attributes: Record<string, string>, parent?: unknown, extra: Record<string, unknown> = {}) {
    return { getAttribute: (name: string) => attributes[name] ?? null, parentElement: parent, ...extra };
}

describe("what was clicked", () => {
    it("finds a message from the id Discord gives its list entry", () => {
        const li = element({}, undefined, { id: `chat-messages-${A}-${B}` });
        assert.deepEqual(messageFromTarget(element({}, li)), { channelId: A, messageId: B });
        assert.equal(messageFromTarget(element({})), undefined);
    });

    it("finds a server and a channel from the list entries", () => {
        assert.equal(guildIdFromTarget(element({}, element({ "data-list-item-id": `guildsnav___${A}` }))), A);
        assert.equal(channelIdFromTarget(element({ "data-list-item-id": `channels___${B}` })), B);
        assert.equal(guildIdFromTarget(element({ "data-list-item-id": `channels___${B}` })), undefined);
    });

    it("finds a person from an attribute, a list entry or a picture", () => {
        assert.equal(userIdFromTarget(element({ "data-user-id": A })), A);
        assert.equal(userIdFromTarget(element({ "data-list-item-id": `members___${B}` })), B);
        assert.equal(userIdFromTarget(element({}, undefined, { src: `https://cdn.discordapp.com/avatars/${A}/abc.png` })), A);
        assert.equal(userIdFromTarget(element({})), undefined);
    });
});

describe("ported plugins: the plain rules", () => {
    it("names an image from its address", () => {
        assert.equal(imageTitle("https://example.com/a/cat.png", false), "cat.png");
        assert.equal(imageTitle("https://example.com/a/cat.png", true), "https://example.com/a/cat.png");
        assert.equal(imageTitle("https://tenor.com/view/x", false), "https://tenor.com/view/x");
        assert.equal(imageTitle("https://example.com/a/page.html", false), undefined);
        assert.equal(imageTitle("not a url", false), undefined);
    });

    it("gives a GIF an alt text from its name", () => {
        assert.equal(altText({ src: "https://x.test/funny-cat_dance123.gif" }), "GIF - funny cat dance");
        assert.equal(altText({ alt: "mine", src: "https://x.test/a.gif" }), "mine");
        assert.equal(altText({ contentType: "image/png", alt: "p" }), "p");
    });

    it("fixes a search that asks past 5000 results", () => {
        const query = { offset: 6000, sort_order: "asc" };
        fixQuery(query);
        assert.deepEqual(query, { offset: 0, sort_order: "desc" });
        const near = { offset: 10, sort_order: "asc" };
        fixQuery(near);
        assert.deepEqual(near, { offset: 10, sort_order: "asc" });
    });

    it("renames files to a format Discord can show", () => {
        assert.equal(fixedName("clip.avi"), "clip.mp4");
        assert.equal(fixedName("photo.bmp"), "photo.jpg");
        assert.equal(fixedName("notes.txt"), "notes.txt");
        assert.equal(fixedName("noextension"), "noextension");
        assert.equal(fixedName("backup.tar.gz"), "backup.tar.gz");
    });

    it("swaps social links for ones that embed, and leaves other text alone", () => {
        assert.equal(replaceUrl("https://x.com/a/status/1?s=2"), "https://www.fxtwitter.com/a/status/1?s=2");
        assert.equal(replaceUrl("https://example.com/x"), "https://example.com/x");
        assert.equal(replaceUrls("look https://x.com/a and <https://x.com/b> ok"), "look https://www.fxtwitter.com/a and <https://x.com/b> ok");
    });

    it("writes digits as look-alikes but not inside links or markup", () => {
        assert.equal(replaceDigits("call 123"), "call 𝟷𝟸𝟹");
        assert.equal(replaceDigits("see https://a.test/12 and <@123>"), "see https://a.test/12 and <@123>");
    });

    it("builds a user link and a search address", () => {
        assert.equal(userUrl("5"), "<https://discord.com/users/5>");
        assert.equal(searchUrl("IQDB", "https://a.test/i.png?x=1"), "https://iqdb.org/?url=https%3A%2F%2Fa.test%2Fi.png%3Fx%3D1");
    });

    it("toggles the embed bit of a message and says when a message has previews to switch", () => {
        assert.equal(flagsToggled(0), 4);
        assert.equal(flagsToggled(4), 0);
        assert.equal(flagsToggled(5), 1);
        assert.equal(hasEmbedState({ flags: 4 }), true);
        assert.equal(hasEmbedState({ embeds: [{}] }), true);
        assert.equal(hasEmbedState({ messageSnapshots: [{ message: { embeds: [{}] } }] }), true);
        assert.equal(hasEmbedState({ embeds: [] }), false);
    });

    it("makes avatar variables for each size and none for data addresses", () => {
        const styles = avatarStyles("https://cdn.test/avatars/1/a.png?size=128");
        assert.equal(styles["--avatar-url-512"], "url(https://cdn.test/avatars/1/a.png?size=512)");
        assert.equal(Object.keys(styles).length, 6);
        assert.deepEqual(avatarStyles("data:image/png;base64,AA"), {});
        assert.deepEqual(avatarStyles(null), {});
    });

    it("picks the address of an image for the quality fix", () => {
        const base = { src: "https://media.discordapp.net/attachments/1/2/a.png", width: 4000, height: 3000, contentType: "image/png" };
        const inChat = imageSource(base, false, false);
        assert.ok(inChat?.includes("width=") && inChat.includes("height="));
        assert.ok(imageSource({ ...base, trigger: "x" }, false, false)?.startsWith("https://cdn.discordapp.com/attachments/"));
        assert.equal(imageSource({ ...base, contentType: "video/mp4" }, false, false), undefined);
        assert.equal(imageSource({ ...base, src: "https://other.test/a.png" }, false, false), undefined);
        assert.equal(imageSource(undefined, false, false), undefined);
    });

    it("decides how many super reactions play and when Discord goes idle", () => {
        assert.equal(mayPlay(19, false, 20), true);
        assert.equal(mayPlay(20, false, 20), false);
        assert.equal(mayPlay(500, true, 0), true);
        assert.equal(idleMs(0), Infinity);
        assert.equal(idleMs(10), 600000);
    });

    it("tells the keyboard shortcut of quick delete", () => {
        assert.equal(matchesKeybind({ altKey: true, ctrlKey: false, shiftKey: false, key: "Delete" }, "altDelete"), true);
        assert.equal(matchesKeybind({ altKey: true, ctrlKey: true, shiftKey: false, key: "Delete" }, "altDelete"), false);
        assert.equal(matchesKeybind({ altKey: false, ctrlKey: true, shiftKey: true, key: "Delete" }, "ctrlShiftDelete"), true);
        assert.equal(matchesKeybind({ altKey: false, ctrlKey: false, shiftKey: false, key: "x" }, "unknown"), false);
    });

    it("adds the status timeouts in order, with forever where the person wants it", () => {
        assert.deepEqual(parseNumbers("5, 10, x, 0, 30"), [5, 10, 30]);
        const store = { showForeverOnTop: true, extraSeconds: "", extraMinutes: "5", extraHours: "", extraDays: "" };
        const result = buildTimeouts([{ label: () => "Forever" }, { duration: 36e5, label: () => "1 hour" }], store);
        assert.equal(result[0].duration, undefined);
        const durations = result.map(item => item.duration).filter((value): value is number => value !== undefined);
        assert.deepEqual(durations, [...durations].sort((a, b) => a - b));
        assert.equal(result.find(item => item.duration === 3e5)?.label(), "For 5 Minutes");
        const bottom = buildTimeouts([{ label: () => "Forever" }], { ...store, showForeverOnTop: false });
        assert.equal(bottom[bottom.length - 1].duration, undefined);
    });
});
