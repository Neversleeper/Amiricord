/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { idFromAvatarUrl, MAX_MEMBER_DECORATIONS_PER_PLUGIN, MemberDecorHub, type MemberDecorPage, userIdOfRow } from "../src/api/memberDecor";
import { buildNotices, cleanNotice, MAX_NOTICE_TEXT, MAX_NOTICES_ON_SCREEN, MAX_NOTICES_PER_PLUGIN, NOTICE_ATTRIBUTE, NoticesHub, type NoticesPage } from "../src/api/notices";
import { fakePage } from "./helpers/fakeDom";

function hubOf() {
    const { page, document } = fakePage();
    const errors: string[] = [];
    let styles = 0;
    const hub = new NoticesHub(page as unknown as NoticesPage, () => { styles++; }, (plugin, source) => { errors.push(`${plugin}:${source}`); });
    return { hub, document, errors, styles: () => styles };
}

const shown = (document: ReturnType<typeof fakePage>["document"]) => document.querySelectorAll(`[${NOTICE_ATTRIBUTE}]`);

describe("notices", () => {
    it("cleans a definition", () => {
        assert.equal(cleanNotice(undefined), undefined);
        assert.equal(cleanNotice({ id: "", text: "x" }), undefined);
        assert.equal(cleanNotice({ id: "a", text: "   " }), undefined);
        assert.equal(cleanNotice({ id: "a", text: 5 }), undefined);
        const notice = cleanNotice({ id: "a", text: "  hello ", kind: "nope", buttons: [{ label: "ok", onClick: () => undefined }, { label: " ", onClick: () => undefined }, { label: "b", onClick: () => undefined }, { label: "c", onClick: () => undefined }] });
        assert.equal(notice?.text, "hello");
        assert.equal(notice?.kind, "info");
        assert.equal(notice?.closable, true);
        assert.deepEqual(notice?.buttons.map(button => button.label), ["ok", "b"]);
        const long = cleanNotice({ id: "a", text: "x".repeat(1000) });
        assert.equal(long?.text.length, MAX_NOTICE_TEXT);
    });

    it("shows a bar, replaces it by id and takes it away", () => {
        const { hub, document, styles } = hubOf();
        assert.equal(hub.show("P", { id: "one", text: "First" }), true);
        assert.equal(shown(document).length, 1);
        assert.equal(styles(), 1);
        assert.equal(hub.show("P", { id: "one", text: "Second" }), true);
        assert.equal(shown(document).length, 1);
        assert.match(shown(document)[0].textContent, /Second/);
        hub.dismiss("P", "one");
        assert.equal(shown(document).length, 0);
        hub.dismiss("P", "never-there");
    });

    it("runs a button, then closes the bar", () => {
        const { hub, document } = hubOf();
        let clicked = 0;
        hub.show("P", { id: "one", text: "Hi", buttons: [{ label: "Go", onClick: () => { clicked++; } }] });
        const button = shown(document)[0].querySelector("button")!;
        button.dispatchEvent({ type: "click", target: button });
        assert.equal(clicked, 1);
        assert.equal(shown(document).length, 0);
    });

    it("reports a button that throws and still closes the bar", () => {
        const { hub, document, errors } = hubOf();
        hub.show("P", { id: "one", text: "Hi", buttons: [{ label: "Go", onClick: () => { throw new Error("no"); } }] });
        const button = shown(document)[0].querySelector("button")!;
        button.dispatchEvent({ type: "click", target: button });
        assert.deepEqual(errors, ["P:notice one"]);
        assert.equal(shown(document).length, 0);
    });

    it("has a close button unless the plugin says no", () => {
        const { hub, document } = hubOf();
        hub.show("P", { id: "a", text: "A" });
        hub.show("P", { id: "b", text: "B", closable: false });
        assert.equal(document.querySelectorAll("[data-notice-close]").length, 1);
    });

    it("limits what one plugin keeps and how many show at once; the rest wait", () => {
        const { hub, document } = hubOf();
        for (let index = 0; index < MAX_NOTICES_PER_PLUGIN; index++) assert.equal(hub.show("P", { id: `n${index}`, text: "x" }), true);
        assert.equal(hub.show("P", { id: "extra", text: "x" }), false);
        assert.equal(hub.show("Q", { id: "q1", text: "x" }), true);
        assert.equal(hub.show("R", { id: "r1", text: "x" }), true);
        assert.equal(shown(document).length, MAX_NOTICES_ON_SCREEN);
        hub.dismiss("Q", "q1");
        assert.equal(shown(document).length, MAX_NOTICES_ON_SCREEN);
        assert.ok(shown(document).some(element => element.getAttribute(NOTICE_ATTRIBUTE) === "R:r1"));
    });

    it("takes every bar of a plugin away when it stops", () => {
        const { hub, document } = hubOf();
        let dispose = () => undefined as void;
        const notices = buildNotices(hub, "P", callback => { dispose = callback; });
        notices.show({ id: "a", text: "A" });
        hub.show("Q", { id: "q", text: "Q" });
        dispose();
        assert.deepEqual(shown(document).map(element => element.getAttribute(NOTICE_ATTRIBUTE)), ["Q:q"]);
        notices.dismiss("a");
    });
});

describe("notice time and x", () => {
    it("keeps a time inside its limits and runs onClose only for the x", () => {
        assert.equal(cleanNotice({ id: "a", text: "x", timeoutMs: 10 })?.timeoutMs, 500);
        assert.equal(cleanNotice({ id: "a", text: "x", timeoutMs: 9e9 })?.timeoutMs, 60000);
        assert.equal(cleanNotice({ id: "a", text: "x", timeoutMs: Number.NaN })?.timeoutMs, undefined);
        const { page, document } = fakePage();
        const hub = new NoticesHub(page as unknown as NoticesPage, () => undefined, () => undefined);
        let closed = 0;
        hub.show("P", { id: "a", text: "x", onClose: () => { closed++; } });
        const close = document.querySelector("[data-notice-close]")!;
        close.dispatchEvent({ type: "click", target: close });
        assert.equal(closed, 1);
        assert.equal(document.querySelectorAll(`[${NOTICE_ATTRIBUTE}]`).length, 0);
        hub.show("P", { id: "b", text: "x", onClose: () => { closed++; } });
        hub.dismiss("P", "b");
        assert.equal(closed, 1);
    });

    it("takes the bar away by itself after its time", () => {
        const { page, document, timers } = fakePage();
        const hub = new NoticesHub(page as unknown as NoticesPage, () => undefined, () => undefined);
        hub.show("P", { id: "a", text: "x", timeoutMs: 3000 });
        assert.equal(document.querySelectorAll(`[${NOTICE_ATTRIBUTE}]`).length, 1);
        const waiting = [...timers.values()].find(timer => timer.ms === 3000)!;
        waiting.run();
        assert.equal(document.querySelectorAll(`[${NOTICE_ATTRIBUTE}]`).length, 0);
    });
});

describe("member list decorations", () => {
    it("reads the person from an avatar address", () => {
        assert.equal(idFromAvatarUrl("https://cdn.discordapp.com/avatars/1554145234173034508/c42877c.webp?size=32"), "1554145234173034508");
        assert.equal(idFromAvatarUrl("https://cdn.discordapp.com/embed/avatars/3.png"), undefined);
        assert.equal(idFromAvatarUrl(null), undefined);
        assert.equal(idFromAvatarUrl(undefined), undefined);
    });

    it("reads the person of a row from the avatar, or from the component that drew it", () => {
        const withAvatar = { querySelector: () => ({ getAttribute: () => "https://cdn.discordapp.com/avatars/1554145234173034508/x.webp" }) } as unknown as Element;
        assert.equal(userIdOfRow(withAvatar), "1554145234173034508");
        const row = { querySelector: () => null, __reactFiber$abc: { memoizedProps: {}, return: { memoizedProps: { user: { id: "175928847299117063" } }, return: null } } } as unknown as Element;
        assert.equal(userIdOfRow(row), "175928847299117063");
        assert.equal(userIdOfRow({ querySelector: () => null } as unknown as Element), undefined);
    });

    it("refuses a bad decoration and too many from one plugin", () => {
        const page = { document: { body: {}, querySelectorAll: () => [] }, MutationObserver: class { observe() { /* nothing */ } disconnect() { /* nothing */ } }, setTimeout: () => 1 } as unknown as MemberDecorPage;
        const hub = new MemberDecorHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", { id: "", text: () => "x" }), false);
        assert.equal(hub.add("P", { id: "a", text: undefined as unknown as () => string }), false);
        for (let index = 0; index < MAX_MEMBER_DECORATIONS_PER_PLUGIN; index++) assert.equal(hub.add("P", { id: `d${index}`, text: () => "x" }), true);
        assert.equal(hub.add("P", { id: "extra", text: () => "x" }), false);
        assert.equal(hub.add("P", { id: "d0", text: () => "x" }), false);
    });
});
