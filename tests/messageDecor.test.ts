/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMessageDecor, cleanDecorationText, MAX_DECORATION_TEXT, MAX_DECORATIONS_PER_PLUGIN, type MessageDecoration, MessageDecorHub, type MessageDecorPage } from "../src/api/messageDecor";

const decoration = (id: string, extra: Partial<MessageDecoration> = {}): MessageDecoration => ({ id, text: () => "x", ...extra });

function fakePage() {
    const state = { observers: 0, disconnected: 0, timers: [] as Array<() => void>, styles: 0 };
    class FakeObserver {
        observe() { state.observers++; }
        disconnect() { state.disconnected++; }
    }
    const page = {
        document: { body: {}, querySelectorAll: () => [] },
        MutationObserver: FakeObserver,
        setTimeout: (run: () => void) => { state.timers.push(run); return state.timers.length; }
    } as unknown as MessageDecorPage;
    return { page, state };
}

describe("message decorations", () => {
    it("cleans the text: only text, trimmed, cut to the limit", () => {
        assert.equal(cleanDecorationText("  hi  "), "hi");
        assert.equal(cleanDecorationText(""), undefined);
        assert.equal(cleanDecorationText("   "), undefined);
        assert.equal(cleanDecorationText(5), undefined);
        assert.equal(cleanDecorationText(undefined), undefined);
        const long = cleanDecorationText("a".repeat(200));
        assert.equal(long?.length, MAX_DECORATION_TEXT);
        assert.ok(long?.endsWith("…"));
    });

    it("refuses a bad decoration, a repeated id and too many from one plugin", () => {
        const { page } = fakePage();
        const hub = new MessageDecorHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", decoration("one")), true);
        assert.equal(hub.add("P", decoration("one")), false);
        assert.equal(hub.add("Q", decoration("one")), true);
        assert.equal(hub.add("P", { ...decoration("two"), id: "" }), false);
        assert.equal(hub.add("P", { ...decoration("two"), text: undefined as unknown as () => string }), false);
        for (let index = 1; index < MAX_DECORATIONS_PER_PLUGIN; index++) assert.equal(hub.add("P", decoration(`n${index}`)), true);
        assert.equal(hub.add("P", decoration("too-many")), false);
    });

    it("watches the page while there are decorations and stops when the last plugin leaves", () => {
        const { page, state } = fakePage();
        const hub = new MessageDecorHub(page, () => { state.styles++; }, () => undefined);
        let dispose = () => undefined as void;
        const decor = buildMessageDecor(hub, "P", callback => { dispose = callback; });
        assert.equal(decor.add(decoration("one")), true);
        assert.equal(decor.add(decoration("two")), true);
        assert.equal(state.observers, 1);
        assert.equal(state.styles, 1);
        dispose();
        assert.equal(state.disconnected, 1);
    });

    it("waits for the page body when it does not exist yet", () => {
        const state = { timers: [] as Array<() => void>, observers: 0 };
        const document = { body: null as unknown, querySelectorAll: () => [] };
        class FakeObserver { observe() { state.observers++; } disconnect() { /* nothing */ } }
        const page = { document, MutationObserver: FakeObserver, setTimeout: (run: () => void) => { state.timers.push(run); return 1; } } as unknown as MessageDecorPage;
        const hub = new MessageDecorHub(page, () => undefined, () => undefined);
        assert.equal(hub.add("P", decoration("one")), true);
        assert.equal(state.observers, 0);
        document.body = {};
        for (const run of state.timers.splice(0)) run();
        assert.equal(state.observers, 1);
    });
});
