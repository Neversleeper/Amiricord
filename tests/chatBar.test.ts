/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatBar, type ChatBarButton, ChatBarHub, type ChatBarPage, MAX_BUTTONS_PER_PLUGIN, planSync } from "../src/api/chatBar";
import { buildMessageEvents, createMessageEventHub } from "../src/api/messageEvents";
import { reverseText } from "../src/equicordplugins/TalkInReverse/index";
import { messageBody, SUPPRESS_NOTIFICATIONS } from "../src/testcordplugins/QuickMsg/index";

const button = (id: string, extra: Partial<ChatBarButton> = {}): ChatBarButton => ({ id, label: `Button ${id}`, icon: { viewBox: "0 0 24 24", path: "M0 0h24v24H0z" }, onClick: () => undefined, ...extra });

function fakePage() {
    const state = { observers: 0, disconnected: 0, timers: [] as Array<() => void> };
    class FakeObserver {
        observe() { state.observers++; }
        disconnect() { state.disconnected++; }
    }
    const page = {
        document: { body: {}, querySelectorAll: () => [] },
        MutationObserver: FakeObserver,
        setTimeout: (run: () => void) => { state.timers.push(run); return state.timers.length; },
        clearTimeout: () => undefined
    } as unknown as ChatBarPage;
    return { page, state };
}

describe("chat bar buttons", () => {
    it("says which buttons a row needs and which it has too many of", () => {
        assert.deepEqual(planSync(["a:1"], ["a:1", "b:1"]), { add: ["b:1"], remove: [] });
        assert.deepEqual(planSync(["a:1", "old:1"], ["a:1"]), { add: [], remove: ["old:1"] });
        assert.deepEqual(planSync([], []), { add: [], remove: [] });
    });

    it("refuses a bad button and a repeated id, and keeps a limit per plugin", () => {
        const { page } = fakePage();
        const hub = new ChatBarHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", button("one")), true);
        assert.equal(hub.add("P", button("one")), false);
        assert.equal(hub.add("Q", button("one")), true);
        assert.equal(hub.add("P", { ...button("two"), id: "" }), false);
        assert.equal(hub.add("P", { ...button("two"), onClick: undefined as unknown as () => void }), false);
        assert.equal(hub.add("P", { ...button("two"), label: "" }), false);
        assert.equal(hub.add("P", { ...button("two"), icon: { viewBox: "0 0 1 1" } as never }), false);
        for (let index = 1; index < MAX_BUTTONS_PER_PLUGIN; index++) assert.equal(hub.add("P", button(`n${index}`)), true);
        assert.equal(hub.add("P", button("too-many")), false);
    });

    it("watches the page while there are buttons and stops when the last plugin leaves", () => {
        const { page, state } = fakePage();
        const hub = new ChatBarHub(page, () => undefined, () => undefined);
        let dispose = () => undefined as void;
        const bar = buildChatBar(hub, "P", callback => { dispose = callback; });
        assert.equal(bar.add(button("one")), true);
        assert.equal(bar.add(button("two")), true);
        assert.equal(state.observers, 1);
        dispose();
        assert.equal(state.disconnected, 1);
        assert.equal(bar.add(button("again")), true);
        assert.equal(state.observers, 2);
    });
});

describe("chat bar before the page has a body", () => {
    it("waits for the body and then starts watching", () => {
        const { page, state } = fakePage();
        const document = page.document as unknown as { body: unknown; };
        const body = document.body;
        document.body = null;
        const hub = new ChatBarHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", button("one")), true);
        assert.equal(state.observers, 0);
        document.body = body;
        for (const run of state.timers.splice(0)) run();
        assert.equal(state.observers, 1);
    });
});

describe("quick message", () => {
    it("sends nothing for an empty draft and a silent message by default", () => {
        assert.equal(messageBody(undefined, true, "1"), undefined);
        assert.equal(messageBody("   \n", true, "1"), undefined);
        assert.deepEqual(messageBody("hi", true, "7"), { content: "hi", flags: SUPPRESS_NOTIFICATIONS, nonce: "7", tts: false });
        assert.equal(messageBody("hi", false, "7")?.flags, 0);
    });
});

describe("talk in reverse", () => {
    it("turns the text backwards by whole characters", () => {
        assert.equal(reverseText("abc"), "cba");
        assert.equal(reverseText("a😀b"), "b😀a");
        assert.equal(reverseText(""), "");
    });
});

describe("before send handlers", () => {
    const channel = { id: "1" };

    it("gives the text to each handler in turn and keeps it when a handler says nothing", () => {
        const hub = createMessageEventHub();
        const events = buildMessageEvents(hub, "P", () => undefined, () => undefined);
        events.onBeforeSend(content => content + "!");
        events.onBeforeSend(() => undefined);
        events.onBeforeSend(content => content.toUpperCase());
        assert.equal(hub.transform("hi", channel), "HI!");
    });

    it("skips a handler that throws, reports it and ignores an empty answer", () => {
        const hub = createMessageEventHub();
        const reported: string[] = [];
        const events = buildMessageEvents(hub, "P", () => undefined, source => reported.push(source));
        events.onBeforeSend(() => { throw new Error("broken"); });
        events.onBeforeSend(() => "");
        events.onBeforeSend(content => content + "?");
        assert.equal(hub.transform("hi", channel), "hi?");
        assert.deepEqual(reported, ["message before send"]);
    });

    it("takes a plugin's handlers back when it stops", () => {
        const hub = createMessageEventHub();
        let dispose = () => undefined as void;
        const events = buildMessageEvents(hub, "P", callback => { dispose = callback; }, () => undefined);
        events.onBeforeSend(() => "changed");
        assert.equal(hub.transform("hi", channel), "changed");
        dispose();
        assert.equal(hub.transform("hi", channel), "hi");
    });
});
