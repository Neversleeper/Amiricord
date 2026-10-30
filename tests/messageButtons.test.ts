/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMessageButtons, MAX_MESSAGE_BUTTONS_PER_PLUGIN, type MessageButton, MessageButtonsHub, type MessageButtonsPage, messageOfId } from "../src/api/messageButtons";

const button = (id: string, extra: Partial<MessageButton> = {}): MessageButton => ({ id, label: `Button ${id}`, icon: { viewBox: "0 0 24 24", path: "M0 0h24v24H0z" }, onClick: () => undefined, ...extra });

function fakePage() {
    const state = { observers: 0, disconnected: 0, timers: [] as Array<() => void>, styles: 0 };
    class FakeObserver {
        observe() { state.observers++; }
        disconnect() { state.disconnected++; }
    }
    const page = {
        document: { body: {}, querySelectorAll: () => [] },
        MutationObserver: FakeObserver,
        setTimeout: (run: () => void) => { state.timers.push(run); return state.timers.length; },
        clearTimeout: () => undefined
    } as unknown as MessageButtonsPage;
    return { page, state };
}

const A = "111111111111111111";
const B = "222222222222222222";

describe("message bar buttons", () => {
    it("reads the channel and message from the id of a message entry", () => {
        assert.deepEqual(messageOfId(`chat-messages-${A}-${B}`), { channelId: A, messageId: B });
        assert.deepEqual(messageOfId(`chat-messages-${B}-${A}-${B}`), { channelId: A, messageId: B });
        assert.equal(messageOfId("chat-messages-nope"), undefined);
        assert.equal(messageOfId(undefined), undefined);
    });

    it("refuses a bad button and a repeated id, and keeps a limit per plugin", () => {
        const { page } = fakePage();
        const hub = new MessageButtonsHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", button("one")), true);
        assert.equal(hub.add("P", button("one")), false);
        assert.equal(hub.add("Q", button("one")), true);
        assert.equal(hub.add("P", { ...button("two"), id: "" }), false);
        assert.equal(hub.add("P", { ...button("two"), onClick: undefined as unknown as () => void }), false);
        assert.equal(hub.add("P", { ...button("two"), label: "" }), false);
        assert.equal(hub.add("P", { ...button("two"), icon: { viewBox: "0 0 1 1" } as never }), false);
        for (let index = 1; index < MAX_MESSAGE_BUTTONS_PER_PLUGIN; index++) assert.equal(hub.add("P", button(`n${index}`)), true);
        assert.equal(hub.add("P", button("too-many")), false);
    });

    it("watches the page while there are buttons and stops when the last plugin leaves", () => {
        const { page, state } = fakePage();
        const hub = new MessageButtonsHub(page, () => { state.styles++; }, () => undefined);
        let dispose = () => undefined as void;
        const bar = buildMessageButtons(hub, "P", callback => { dispose = callback; });
        assert.equal(bar.add(button("one")), true);
        assert.equal(bar.add(button("two")), true);
        assert.equal(state.observers, 1);
        assert.equal(state.styles, 1);
        dispose();
        assert.equal(state.disconnected, 1);
        assert.equal(bar.add(button("again")), true);
        assert.equal(state.observers, 2);
        assert.equal(state.styles, 1);
    });

    it("waits for the body when the plugin starts before the page has one", () => {
        const { page, state } = fakePage();
        const document = page.document as unknown as { body: unknown; };
        const body = document.body;
        document.body = null;
        const hub = new MessageButtonsHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", button("one")), true);
        assert.equal(state.observers, 0);
        document.body = body;
        for (const run of state.timers.splice(0)) run();
        assert.equal(state.observers, 1);
    });
});
