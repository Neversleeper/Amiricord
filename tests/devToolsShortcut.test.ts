/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NativeDevToolsApi, NativeHostApi } from "../src/main/nativeHost";
import { asksForDevTools } from "../src/plugins/DevToolsShortcut/keys";
import { open } from "../src/plugins/DevToolsShortcut/native";

describe("asksForDevTools", () => {
    it("accepts F12 and Ctrl+Shift+I (any case, Cmd too)", () => {
        assert.equal(asksForDevTools({ key: "F12" }), true);
        assert.equal(asksForDevTools({ key: "I", ctrlKey: true, shiftKey: true }), true);
        assert.equal(asksForDevTools({ key: "i", metaKey: true, shiftKey: true }), true);
    });

    it("refuses other keys, missing or extra modifiers, key repeat and a key already handled", () => {
        assert.equal(asksForDevTools({ key: "i" }), false);
        assert.equal(asksForDevTools({ key: "i", ctrlKey: true }), false);
        assert.equal(asksForDevTools({ key: "i", shiftKey: true }), false);
        assert.equal(asksForDevTools({ key: "i", ctrlKey: true, shiftKey: true, altKey: true }), false);
        assert.equal(asksForDevTools({ key: "F12", ctrlKey: true }), false);
        assert.equal(asksForDevTools({ key: "F12", shiftKey: true }), false);
        assert.equal(asksForDevTools({ key: "F11" }), false);
        assert.equal(asksForDevTools({ key: "F12", repeat: true }), false);
        assert.equal(asksForDevTools({ key: "F12", defaultPrevented: true }), false);
        assert.equal(asksForDevTools({}), false);
        assert.equal(asksForDevTools({ key: undefined, ctrlKey: true, shiftKey: true }), false);
    });
});

describe("open (native side)", () => {
    const host = (api: Partial<NativeDevToolsApi>) => ({ ...api }) as unknown as NativeHostApi & Partial<NativeDevToolsApi>;

    it("opens the tools when the window can", async () => {
        let opened = 0;
        assert.equal(await open(host({ canOpenDevTools: async () => true, openDevTools: async () => { opened++; return true; } })), true);
        assert.equal(opened, 1);
    });

    it("answers false, and does not try to open, when the window cannot or the permission is missing", async () => {
        let opened = 0;
        assert.equal(await open(host({ canOpenDevTools: async () => false, openDevTools: async () => { opened++; return true; } })), false);
        assert.equal(opened, 0);
        assert.equal(await open(host({})), false);
    });

    it("passes on false when the tools closed again at once", async () => {
        assert.equal(await open(host({ canOpenDevTools: async () => true, openDevTools: async () => false })), false);
    });
});
