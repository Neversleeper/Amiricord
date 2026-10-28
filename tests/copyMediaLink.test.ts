/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ContextClick, ContextMenuItem, ContextMenuProvider } from "../src/api/contextMenus";
import type { EnginePluginContext } from "../src/renderer/engine";
import plugin from "../src/testcordplugins/CopyMediaLink/index";
import manifest from "../src/testcordplugins/CopyMediaLink/plugin.json";

const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => { if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete (globalThis as Record<string, unknown>).navigator; });

function setup(copy: (text: string) => Promise<void>) {
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: copy } }, configurable: true, writable: true });
    const providers = new Map<string, ContextMenuProvider>();
    const toasts: Array<[string, string | undefined]> = [];
    const errors: string[] = [];
    const ctx = {
        menuItems: { add: (id: string, provider: ContextMenuProvider) => { providers.set(id, provider); } },
        toasts: { show: (message: string, kind?: string) => { toasts.push([message, kind]); } },
        reportError: (source: string) => { errors.push(source); }
    };
    plugin.start!(ctx as unknown as EnginePluginContext);
    const click = (extra: Partial<ContextClick>) => providers.get("media-link")!({ target: {} as Element, src: undefined, href: undefined, ...extra }) as ContextMenuItem | null;
    return { click, toasts, errors, providers };
}

describe("CopyMediaLink", () => {
    it("adds its item for a picture, GIF or video, and for nothing else", () => {
        const world = setup(async () => undefined);
        assert.equal(world.providers.size, 1);
        assert.equal(world.click({ src: "https://i.example/a.png" })?.label, "Copy Media Link");
        assert.equal(world.click({ src: "https://i.example/a.png", href: "https://a.example/x" })?.label, "Copy Media Link");
        assert.equal(world.click({}), null);
        assert.equal(world.click({ href: "https://a.example/x" }), null, "Discord's own menu has Copy Link for plain links");
    });

    it("copies the address of the media and says so", async () => {
        const copied: string[] = [];
        const world = setup(async text => { copied.push(text); });
        await world.click({ src: "https://i.example/a.png" })!.action();
        assert.deepEqual(copied, ["https://i.example/a.png"]);
        assert.deepEqual(world.toasts, [["Media link copied!", "success"]]);
        assert.deepEqual(world.errors, []);
    });

    it("says it could not copy, and reports why, when the clipboard refuses", async () => {
        const world = setup(async () => { throw new Error("denied"); });
        await world.click({ src: "https://i.example/a.png" })!.action();
        assert.deepEqual(world.toasts, [["Could not copy the link", "failure"]]);
        assert.deepEqual(world.errors, ["CopyMediaLink"]);
    });

    it("declares the clipboard and nothing else", () => {
        assert.deepEqual(manifest.permissions, { system: { clipboard: true } });
        assert.equal(manifest.startAt, "domReady");
    });
});
