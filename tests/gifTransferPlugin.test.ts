/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import type { EnginePluginContext } from "../src/renderer/engine";
import { BUTTONS_ID, type ButtonsPage, buttonStyle, FALLBACK_COLOR, HOLDER_STYLE, HOVER_BACKGROUND, makeButtons, usableColor } from "../src/testcordplugins/GifTransfer/buttons";
import plugin, { ADD_FAVOURITE_SNIPPETS, holdsFavourites, REMOVE_FAVOURITE_SNIPPETS, settings } from "../src/testcordplugins/GifTransfer/index";
import manifest from "../src/testcordplugins/GifTransfer/plugin.json";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";
import { FakeElement, fakePage } from "./helpers/fakeDom";

const names = ["document", "MutationObserver", "requestAnimationFrame", "setInterval", "clearInterval", "setTimeout", "clearTimeout"];
const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

afterEach(() => {
    plugin.stop!(undefined as never);
    settings.unbind();
    for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
});

/** The GIF picker: a tab bar with the GIF tab open, and the element that tells the picker is open. */
function picker(open = "GIF") {
    const world = fakePage();
    const tab = new FakeElement("div", { id: "gif-picker-tab" });
    const bar = new FakeElement("div", { role: "tablist", "aria-label": "Expression picker tabs" });
    const gif = new FakeElement("button", { role: "tab", "aria-selected": open === "GIF" ? "true" : "false" }, "GIF");
    const emoji = new FakeElement("button", { role: "tab", "aria-selected": open === "GIF" ? "false" : "true" }, "Emoji");
    bar.append(gif, emoji);
    world.document.body.append(tab, bar);
    return { ...world, bar, gif, emoji, tab };
}

describe("GifTransfer buttons", () => {
    it("puts Export, Import and Verify in the tab bar while the GIF tab is open, once", () => {
        const world = picker();
        const actions: string[] = [];
        const buttons = makeButtons(world.page as unknown as ButtonsPage, action => { actions.push(action); });
        buttons.start();
        buttons.start();
        const holder = world.document.getElementById(BUTTONS_ID)!;
        assert.deepEqual(holder.children.map(button => button.textContent), ["Export", "Import", "Verify", "Delete all"]);
        assert.deepEqual(holder.children.map(button => button.getAttribute("data-gif-transfer-action")), ["export", "import", "verify", "clear"]);
        assert.equal(world.bar.style.display, "flex");
        assert.deepEqual(holder.children.map(button => [button.type, button.getAttribute("data-gif-transfer")]), [["button", "true"], ["button", "true"], ["button", "true"], ["button", "true"]]);
        assert.equal(world.observers.length, 1);
        world.mutate();
        world.runFrames();
        assert.equal(world.document.querySelectorAll(`#${BUTTONS_ID}`).length, 1, "not added twice");
        assert.deepEqual([...world.intervals.values()].map(timer => timer.ms), [10_000]);
        // The look is written on the elements themselves, in Discord's own colours, and does not wait for a style sheet.
        assert.equal(holder.getAttribute("style"), HOLDER_STYLE);
        for (const button of holder.children) assert.equal(button.getAttribute("style"), buttonStyle(FALLBACK_COLOR), "no way to read the tabs' colour here: the grey of Discord's muted text");
        assert.match(buttonStyle("red"), /color: red;/);
        assert.match(buttonStyle("red"), /border: 1px solid currentColor/);
        assert.match(buttonStyle("red"), /pointer-events: auto/);
        assert.match(HOLDER_STYLE, /pointer-events: auto/);
    });

    it("takes the text colour from a tab of the picker that is not the open one", () => {
        const world = picker();
        const asked: Array<string | null> = [];
        const page = { ...world.page, getComputedStyle: (element: { textContent: string; }) => { asked.push(element.textContent); return { color: "rgb(181, 186, 193)" }; } };
        makeButtons(page as unknown as ButtonsPage, () => undefined).start();
        const button = world.document.getElementById(BUTTONS_ID)!.children[0];
        assert.equal(button.getAttribute("style"), buttonStyle("rgb(181, 186, 193)"));
        assert.deepEqual(asked, ["Emoji"], "the tab that is not selected");
    });

    it("takes the colour of the first tab when all of them look selected, and falls back to grey when it is not a colour to draw with", () => {
        const world = picker();
        world.emoji.setAttribute("aria-selected", "true");
        const asked: string[] = [];
        const page = { ...world.page, getComputedStyle: (element: { textContent: string; }) => { asked.push(element.textContent); return { color: "rgba(0, 0, 0, 0)" }; } };
        makeButtons(page as unknown as ButtonsPage, () => undefined).start();
        assert.deepEqual(asked, ["GIF"]);
        assert.equal(world.document.getElementById(BUTTONS_ID)!.children[0].getAttribute("style"), buttonStyle(FALLBACK_COLOR));
        assert.deepEqual(["rgb(1, 2, 3)", "red", "#fff"].map(usableColor), ["rgb(1, 2, 3)", "red", "#fff"]);
        assert.deepEqual(["", undefined, "transparent", "rgba(0, 0, 0, 0)", "rgba(10, 20, 30, 0)"].map(usableColor), [undefined, undefined, undefined, undefined, undefined]);
        assert.equal(usableColor("rgba(10, 20, 30, 0.5)"), "rgba(10, 20, 30, 0.5)");
    });

    it("lights a button up when the mouse is over it, and puts it back when the mouse leaves", () => {
        const world = picker();
        makeButtons(world.page as unknown as ButtonsPage, () => undefined).start();
        const button = world.document.getElementById(BUTTONS_ID)!.children[0];
        button.dispatchEvent({ type: "mouseenter", target: button, bubbles: false });
        assert.equal(button.style.background, HOVER_BACKGROUND);
        button.dispatchEvent({ type: "mouseleave", target: button, bubbles: false });
        assert.equal(button.style.background, "transparent");
    });

    it("runs the action of the button that was clicked, and nothing for other clicks", () => {
        const world = picker();
        const actions: string[] = [];
        const buttons = makeButtons(world.page as unknown as ButtonsPage, action => { actions.push(action); });
        buttons.start();
        const holder = world.document.getElementById(BUTTONS_ID)!;
        const stopped: string[] = [];
        const click = (target: unknown) => world.document.dispatchEvent({ type: "click", target, preventDefault: () => { stopped.push("default"); }, stopPropagation: () => { stopped.push("stop"); } } as never);
        click(holder.children[1]);
        assert.deepEqual(actions, ["import"]);
        assert.deepEqual(stopped, ["default", "stop"]);
        click(world.gif);
        click(holder);
        click(null);
        click({});
        const stray = new FakeElement("button", { "data-gif-transfer-action": "export" });
        world.document.body.append(stray);
        click(stray);
        assert.deepEqual(actions, ["import"], "a look-alike outside the bar does nothing");
    });

    it("takes the buttons away when another tab is open or the picker closes, and brings them back", () => {
        const world = picker();
        const buttons = makeButtons(world.page as unknown as ButtonsPage, () => undefined);
        buttons.start();
        world.gif.setAttribute("aria-selected", "false");
        world.emoji.setAttribute("aria-selected", "true");
        world.mutate();
        world.runFrames();
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
        world.gif.setAttribute("aria-selected", "true");
        world.emoji.setAttribute("aria-selected", "false");
        world.mutate();
        world.runFrames();
        assert.notEqual(world.document.getElementById(BUTTONS_ID), null);
        world.tab.remove();
        world.mutate();
        world.runFrames();
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
    });

    it("recognises the GIF tab by its name or by where it is, and the bar by Spanish or English words", () => {
        for (const label of ["Selector de expresiones", "Categories", "Expression picker", "Emoji picker"]) {
            const world = fakePage();
            world.document.body.append(new FakeElement("div", { id: "gif-picker-tab" }));
            const bar = new FakeElement("div", { role: "tablist", "aria-label": label });
            bar.append(new FakeElement("button", { role: "tab", "aria-selected": "true" }, " gif "));
            world.document.body.append(bar);
            makeButtons(world.page as unknown as ButtonsPage, () => undefined).start();
            assert.notEqual(world.document.getElementById(BUTTONS_ID), null, label);
        }
        const byId = fakePage();
        byId.document.body.append(new FakeElement("div", { id: "gif-picker-tab" }));
        const bar = new FakeElement("div", { role: "tablist", "aria-label": "Expression picker" });
        bar.append(new FakeElement("button", { role: "tab", "aria-selected": "true", id: "other-tab" }, "Trending"));
        byId.document.body.append(bar);
        makeButtons(byId.page as unknown as ButtonsPage, () => undefined).start();
        assert.equal(byId.document.getElementById(BUTTONS_ID), null, "a tab with another name and place is not the GIF tab");
        const other = fakePage();
        other.document.body.append(new FakeElement("div", { id: "gif-picker-tab" }));
        const unrelated = new FakeElement("div", { role: "tablist", "aria-label": "Settings" });
        unrelated.append(new FakeElement("button", { role: "tab", "aria-selected": "true" }, "GIF"));
        other.document.body.append(unrelated);
        makeButtons(other.page as unknown as ButtonsPage, () => undefined).start();
        assert.equal(other.document.getElementById(BUTTONS_ID), null, "another tab bar is left alone");
    });

    it("knows the GIF tab by its id or by what holds it, even when its name is another", () => {
        for (const make of [
            () => new FakeElement("button", { role: "tab", "aria-selected": "true", id: "gif-picker-tab" }, "Trending"),
            () => { const holder = new FakeElement("div", { id: "x-gif-picker-y" }); const tab = new FakeElement("button", { role: "tab", "aria-selected": "true" }, "Trending"); holder.append(tab); return holder; }
        ]) {
            const world = fakePage();
            world.document.body.append(new FakeElement("div", { id: "gif-picker-tab" }));
            const bar = new FakeElement("div", { role: "tablist", "aria-label": "Expression picker" });
            bar.append(make());
            world.document.body.append(bar);
            makeButtons(world.page as unknown as ButtonsPage, () => undefined).start();
            assert.notEqual(world.document.getElementById(BUTTONS_ID), null);
        }
    });

    it("stops at the first tab bar that looks like the picker's", () => {
        const world = fakePage();
        world.document.body.append(new FakeElement("div", { id: "gif-picker-tab" }));
        const first = new FakeElement("div", { role: "tablist", "aria-label": "Expression picker" });
        first.append(new FakeElement("button", { role: "tab", "aria-selected": "true" }, "Emoji"));
        const second = new FakeElement("div", { role: "tablist", "aria-label": "Other picker" });
        second.append(new FakeElement("button", { role: "tab", "aria-selected": "true" }, "GIF"));
        world.document.body.append(first, second);
        makeButtons(world.page as unknown as ButtonsPage, () => undefined).start();
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
    });

    it("looks once for many changes in a row, and stops reacting to clicks when stopped", () => {
        const world = picker();
        const actions: string[] = [];
        const buttons = makeButtons(world.page as unknown as ButtonsPage, action => { actions.push(action); });
        buttons.start();
        world.mutate();
        world.mutate();
        world.mutate();
        assert.equal(world.frames.length, 1);
        const button = world.document.getElementById(BUTTONS_ID)!.children[0];
        buttons.stop();
        const holder = new FakeElement("div", { id: BUTTONS_ID });
        holder.append(button);
        world.document.body.append(holder);
        world.document.dispatchEvent({ type: "click", target: button, preventDefault: () => undefined, stopPropagation: () => undefined } as never);
        assert.deepEqual(actions, []);
    });

    it("looks again on the timer, not when the page is hidden, and removes everything when stopped", () => {
        const world = picker();
        const buttons = makeButtons(world.page as unknown as ButtonsPage, () => undefined);
        buttons.start();
        world.document.getElementById(BUTTONS_ID)!.remove();
        world.document.hidden = true;
        [...world.intervals.values()][0].run();
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
        world.document.hidden = false;
        [...world.intervals.values()][0].run();
        assert.notEqual(world.document.getElementById(BUTTONS_ID), null);
        buttons.stop();
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
        assert.equal(world.intervals.size, 0);
        assert.equal(world.observers[0].disconnected, true);
        buttons.stop();
    });
});

/** Everything the plugin touches, with timers that run at once, except the first one (the wait before the buttons show). */
function plugged(config: Record<string, unknown> = { delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false }) {
    const world = picker();
    const idle: Array<() => void> = [];
    const cleared: unknown[] = [];
    const delays: number[] = [];
    define("document", world.document);
    define("MutationObserver", world.page.MutationObserver);
    define("requestAnimationFrame", world.page.requestAnimationFrame);
    define("setInterval", world.page.setInterval);
    define("clearInterval", world.page.clearInterval);
    define("setTimeout", (run: () => void, ms: number) => {
        delays.push(ms);
        if (ms === 500) { idle.push(run); return idle.length; }
        queueMicrotask(run);
        return 0;
    });
    define("clearTimeout", (handle: unknown) => { cleared.push(handle); });
    settings.unbind();
    settings.bind(new SettingsClient({ schema: 1, plugins: { GifTransfer: { values: config as never } } }, () => undefined), "GifTransfer");

    const favourites: Record<string, { src?: string; order?: number; }> = { old: { src: "old", order: 7 } };
    const updates: Array<{ name: string; delay: number; }> = [];
    const loads: string[] = [];
    const toasts: Array<[string, string | undefined]> = [];
    const errors: string[] = [];
    const styles: Array<{ css: string; name?: string; removed: boolean; }> = [];
    const finders: Record<string, unknown> = {
        creators: {
            get: () => ({
                FrecencyUserSettingsActionCreators: {
                    updateAsync: async (name: string, update: (value: { gifs?: Record<string, unknown>; } | undefined) => void, delay: number) => {
                        updates.push({ name, delay });
                        const value = { gifs: favourites as Record<string, unknown> };
                        update(value);
                    },
                    loadIfNecessary: () => { loads.push("load"); }
                }
            })
        },
        store: { get: () => ({ frecencyWithoutFetchingLatest: { favoriteGifs: { gifs: favourites } } }) },
        generic: { get: () => undefined as unknown },
        adder: { get: () => undefined as unknown },
        remover: { get: () => undefined as unknown }
    };
    const ctx = {
        finders: {
            byProps: (...names2: string[]) => {
                if (names2.length === 3) { assert.deepEqual(names2, ["updateAsync", "getCurrentValue", "loadIfNecessary"]); return finders.generic; }
                assert.deepEqual(names2, ["FrecencyUserSettingsActionCreators"]);
                return finders.creators;
            },
            byCode: (...snippets: string[]) => {
                if (snippets.includes("GIF_UNFAVORITED")) { assert.deepEqual(snippets, [...REMOVE_FAVOURITE_SNIPPETS]); return finders.remover; }
                assert.deepEqual(snippets, [...ADD_FAVOURITE_SNIPPETS]);
                return finders.adder;
            },
            byStore: (name: string) => { assert.equal(name, "UserSettingsProtoStore"); return finders.store; }
        },
        toasts: { show: (message: string, kind?: string) => { toasts.push([message, kind]); } },
        reportError: (source: string) => { errors.push(source); },
        addStyle: (css: string, name?: string) => { const entry = { css, name, removed: false }; styles.push(entry); return { remove: () => { entry.removed = true; }, update: () => undefined }; }
    };
    plugin.start!(ctx as unknown as EnginePluginContext);
    return { ...world, delays, idle, cleared, favourites, updates, loads, toasts, errors, styles, finders };
}

/** Clicks a button and gives the file input it opens. */
function pick(world: ReturnType<typeof plugged>, action: string) {
    const created: FakeElement[] = [];
    const create = world.document.createElement.bind(world.document);
    world.document.createElement = (tag: string) => { const element = create(tag); created.push(element); return element; };
    const holder = world.document.getElementById(BUTTONS_ID)!;
    const button = holder.children.find(child => child.getAttribute("data-gif-transfer-action") === action)!;
    world.document.dispatchEvent({ type: "click", target: button, preventDefault: () => undefined, stopPropagation: () => undefined } as never);
    return created.find(element => element.tagName === "input")!;
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const fileText = (text: string) => [{ text: async () => text }];
const exportText = (...urls: string[]) => JSON.stringify({ version: 2, exportedAt: "x", totalGifs: urls.length, gifs: urls.map(url => ({ url, src: `${url}.src`, width: 4, height: 5, format: 1, order: 1 })) });

describe("GifTransfer plugin", () => {
    it("shows the buttons only after the first wait, and asks Discord to load the settings", () => {
        const world = plugged();
        assert.deepEqual(world.styles, [], "no style sheet: the buttons carry their own look");
        assert.equal(world.document.getElementById(BUTTONS_ID), null);
        assert.equal(world.idle.length, 1);
        world.idle[0]();
        assert.notEqual(world.document.getElementById(BUTTONS_ID), null);
        assert.deepEqual(world.loads, ["load"]);
    });

    it("does not show the buttons when it was stopped before the wait ended, and cleans up when stopped", () => {
        const early = plugged();
        plugin.stop!(undefined as never);
        early.idle[0]();
        assert.equal(early.document.getElementById(BUTTONS_ID), null);
        assert.equal(early.cleared.length, 1);
        const late = plugged();
        late.idle[0]();
        plugin.stop!(undefined as never);
        assert.equal(late.document.getElementById(BUTTONS_ID), null);
        assert.equal(late.observers.every(observer => observer.disconnected), true);
        plugin.stop!(undefined as never);
    });

    it("saves the favourites as a file, and says so; with none it says there is nothing", async () => {
        const world = plugged();
        world.idle[0]();
        const revoked: string[] = [];
        const url = URL as unknown as { createObjectURL(blob: Blob): string; revokeObjectURL(address: string): void; };
        const originals = { create: url.createObjectURL, revoke: url.revokeObjectURL };
        url.createObjectURL = () => "blob:fake";
        url.revokeObjectURL = address => { revoked.push(address); };
        const created: FakeElement[] = [];
        const create = world.document.createElement.bind(world.document);
        world.document.createElement = (tag: string) => { const element = create(tag); created.push(element); return element; };
        try {
            const holder = world.document.getElementById(BUTTONS_ID)!;
            world.document.dispatchEvent({ type: "click", target: holder.children[0], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
            const link = created.find(element => element.tagName === "a")!;
            assert.equal(link.href, "blob:fake");
            assert.match(link.download, /^gif-favorites-\d+\.json$/);
            assert.equal(link.clicks, 1);
            await settle();
            assert.deepEqual(revoked, ["blob:fake"], "the address is released a little later");
            assert.equal(link.parentElement, null, "the link is taken away again");
            assert.deepEqual(world.toasts, [["Exported 1 GIFs successfully!", "success"]]);
            world.favourites.old = undefined as never;
            delete world.favourites.old;
            world.document.dispatchEvent({ type: "click", target: holder.children[0], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
            assert.deepEqual(world.toasts.at(-1), ["No favorite GIFs found to export.", "failure"]);
            assert.equal(created.filter(element => element.tagName === "a").length, 1, "nothing was saved the second time");
        } finally {
            url.createObjectURL = originals.create;
            url.revokeObjectURL = originals.revoke;
        }
    });

    it("imports from the file the person picks, through Discord's own update, placing each after the last one", async () => {
        const world = plugged();
        world.idle[0]();
        const input = pick(world, "import");
        assert.equal(input.type, "file");
        assert.equal(input.accept, ".json");
        assert.equal(input.clicks, 1);
        input.files = fileText(exportText("https://a", "https://b", "old"));
        input.onchange!();
        await settle();
        assert.deepEqual(Object.keys(world.favourites), ["old", "https://a", "https://b"]);
        assert.deepEqual(world.favourites["https://a"], { src: "https://a.src", width: 4, height: 5, format: 1, order: 8 });
        assert.equal((world.favourites["https://b"] as { order: number; }).order, 9);
        assert.deepEqual(world.updates, [{ name: "favoriteGifs", delay: 3 }, { name: "favoriteGifs", delay: 3 }]);
        assert.deepEqual(world.errors, []);
    });

    it("places each GIF after the last even when Discord's list has not caught up yet, and ignores an update with nothing to change", async () => {
        const world = plugged();
        world.idle[0]();
        const written: Record<string, unknown> = {};
        (world.finders.creators as { get(): unknown; }).get = () => ({
            FrecencyUserSettingsActionCreators: {
                updateAsync: async (_name: string, update: (value: { gifs?: Record<string, unknown>; } | undefined) => void) => {
                    update(undefined);
                    update({ gifs: written });
                }
            }
        });
        const input = pick(world, "import");
        input.files = fileText(exportText("https://a", "https://b"));
        input.onchange!();
        await settle();
        assert.deepEqual(Object.keys(written), ["https://a", "https://b"]);
        assert.deepEqual([(written["https://a"] as { order: number; }).order, (written["https://b"] as { order: number; }).order], [8, 9]);
    });

    it("exports nothing when Discord's store has no favourites at all", () => {
        const world = plugged();
        world.idle[0]();
        (world.finders.store as { get(): unknown; }).get = () => undefined;
        const holder = world.document.getElementById(BUTTONS_ID)!;
        world.document.dispatchEvent({ type: "click", target: holder.children[0], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
        assert.deepEqual(world.toasts, [["No favorite GIFs found to export.", "failure"]]);
    });

    it("puts the download link in the page while it is clicked, and lets go of the address after ten seconds", () => {
        const world = plugged();
        world.idle[0]();
        const url = URL as unknown as { createObjectURL(blob: Blob): string; revokeObjectURL(address: string): void; };
        const originals = { create: url.createObjectURL, revoke: url.revokeObjectURL };
        url.createObjectURL = () => "blob:fake";
        url.revokeObjectURL = () => undefined;
        let attached: boolean | undefined;
        const create = world.document.createElement.bind(world.document);
        world.document.createElement = (tag: string) => {
            const element = create(tag);
            if (tag === "a") element.click = () => { attached = element.parentElement !== null; };
            return element;
        };
        try {
            const holder = world.document.getElementById(BUTTONS_ID)!;
            world.document.dispatchEvent({ type: "click", target: holder.children[0], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
            assert.equal(attached, true);
            assert.ok(world.delays.includes(10_000));
        } finally {
            url.createObjectURL = originals.create;
            url.revokeObjectURL = originals.revoke;
        }
    });

    it("does not overwrite a favourite that Discord already has when the update runs", async () => {
        const world = plugged({ delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false, skipDuplicates: false });
        world.idle[0]();
        const input = pick(world, "import");
        input.files = fileText(exportText("old"));
        input.onchange!();
        await settle();
        assert.deepEqual(world.favourites.old, { src: "old", order: 7 });
    });

    it("verifies against the file the person picks", async () => {
        const world = plugged();
        world.idle[0]();
        const input = pick(world, "verify");
        input.files = fileText(exportText("old", "missing"));
        const log = console.info;
        console.info = () => undefined;
        try {
            input.onchange!();
            await settle();
        } finally { console.info = log; }
        assert.deepEqual(world.toasts, [["Missing 1 GIFs. Press Import again to retry. Check console for details.", "failure"]]);
    });

    it("does nothing when the person closes the file picker without choosing", async () => {
        const world = plugged();
        world.idle[0]();
        const input = pick(world, "import");
        input.files = [];
        input.onchange!();
        input.files = undefined;
        input.onchange!();
        await settle();
        assert.deepEqual(world.toasts, []);
    });

    it("reports an import that cannot start, and tells the person when Discord's function is missing", async () => {
        const world = plugged();
        world.idle[0]();
        (world.finders.creators as { get(): unknown; }).get = () => undefined;
        const input = pick(world, "import");
        input.files = fileText(exportText("https://a"));
        const warn = console.warn;
        const warned: unknown[][] = [];
        console.warn = (...args: unknown[]) => { warned.push(args); };
        try {
            input.onchange!();
            await settle();
        } finally { console.warn = warn; }
        assert.match(String((warned.find(args => args[2] instanceof Error)![2] as Error).message), /Could not find Discord's internal GIF function/);
        assert.deepEqual(world.toasts.at(-1), ["Import complete! 0 GIFs added, 0 duplicates skipped, 1 errors.", "failure"]);
        const bad = pick(world, "import");
        bad.files = fileText("not json");
        bad.onchange!();
        await settle();
        assert.deepEqual(world.toasts.at(-1), ["Invalid file format.", "failure"]);
    });

    it("adds each GIF with Discord's own function when it is found, and does not go round it", async () => {
        const world = plugged();
        world.idle[0]();
        const added: unknown[] = [];
        (world.finders.adder as { get(): unknown; }).get = () => (gif: unknown) => { added.push(gif); };
        const input = pick(world, "import");
        input.files = fileText(exportText("https://one", "https://two"));
        input.onchange!();
        await settle();
        assert.deepEqual(added, [
            { url: "https://one", src: "https://one.src", width: 4, height: 5, format: 1 },
            { url: "https://two", src: "https://two.src", width: 4, height: 5, format: 1 }
        ]);
        assert.deepEqual(world.updates, [], "Discord's own function writes the favourites, not this plugin");
        assert.deepEqual(ADD_FAVOURITE_SNIPPETS, ['updateAsync("favoriteGifs"', "order:"]);
    });

    it("deletes all the favourites through Discord's own function, after asking, and not before", async () => {
        const world = plugged({ delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false, maxRetryPasses: 0 });
        world.idle[0]();
        const asked: string[] = [];
        const removed: string[] = [];
        Object.defineProperty(globalThis, "confirm", { value: (message: string) => { asked.push(message); return asked.length > 1; }, configurable: true, writable: true });
        (world.finders.remover as { get(): unknown; }).get = () => (url: string) => { removed.push(url); delete world.favourites[url]; };
        const holder = world.document.getElementById(BUTTONS_ID)!;
        const click = () => world.document.dispatchEvent({ type: "click", target: holder.children[3], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
        try {
            click();
            await settle();
            assert.match(asked[0], /Delete ALL 1 of your favorite GIFs\? This cannot be undone/);
            assert.deepEqual(removed, [], "the person said no");
            world.favourites.extra = { src: "x", order: 1 };
            click();
            await settle();
            assert.deepEqual(removed, ["old", "extra"]);
            assert.deepEqual(world.toasts.at(-1), ["Deleted all 2 favorite GIFs.", "success"]);
            assert.deepEqual(world.updates, []);
        } finally { delete (globalThis as Record<string, unknown>).confirm; }
    });

    it("reports, and does not break, when the question before deleting cannot be asked", async () => {
        const world = plugged();
        world.idle[0]();
        Object.defineProperty(globalThis, "confirm", { value: () => { throw new Error("no dialogs here"); }, configurable: true, writable: true });
        try {
            const holder = world.document.getElementById(BUTTONS_ID)!;
            world.document.dispatchEvent({ type: "click", target: holder.children[3], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
            await settle();
            assert.deepEqual(world.errors, ["GifTransfer delete all"]);
            assert.deepEqual(Object.keys(world.favourites), ["old"], "nothing was deleted");
        } finally { delete (globalThis as Record<string, unknown>).confirm; }
    });

    it("deletes through the favourites' action set when Discord's own function is not found", async () => {
        const world = plugged({ delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false, maxRetryPasses: 0 });
        world.idle[0]();
        Object.defineProperty(globalThis, "confirm", { value: () => true, configurable: true, writable: true });
        const holder = world.document.getElementById(BUTTONS_ID)!;
        try {
            world.document.dispatchEvent({ type: "click", target: holder.children[3], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
            await settle();
            assert.deepEqual(world.favourites, {});
            assert.deepEqual(world.updates, [{ name: "favoriteGifs", delay: 3 }]);
            // nothing to find: said in the log and the console, the deletion fails without breaking
            const lost = plugged({ delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false, maxRetryPasses: 0 });
            lost.idle[0]();
            (lost.finders.creators as { get(): unknown; }).get = () => undefined;
            const warn = console.warn;
            console.warn = () => undefined;
            try {
                lost.document.dispatchEvent({ type: "click", target: lost.document.getElementById(BUTTONS_ID)!.children[3], preventDefault: () => undefined, stopPropagation: () => undefined } as never);
                await settle();
            } finally { console.warn = warn; }
            assert.deepEqual(lost.toasts.at(-1), ["Deleted 0 of 1 favorite GIFs; 1 are still there (1 failed). Press Delete all again to retry.", "failure"]);
        } finally { delete (globalThis as Record<string, unknown>).confirm; }
    });

    it("falls back to the action set found by its three methods, when it holds the favourite GIFs, and by name first", async () => {
        const world = plugged();
        world.idle[0]();
        const written: string[] = [];
        (world.finders.creators as { get(): unknown; }).get = () => ({});
        (world.finders.generic as { get(): unknown; }).get = () => ({
            getCurrentValue: () => ({ favoriteGifs: { gifs: {} } }),
            updateAsync: async (_name: string, update: (value: { gifs?: Record<string, unknown>; } | undefined) => void) => { const value = { gifs: {} }; update(value); written.push(...Object.keys(value.gifs)); }
        });
        const input = pick(world, "import");
        input.files = fileText(exportText("https://via-methods"));
        input.onchange!();
        await settle();
        assert.deepEqual(written, ["https://via-methods"]);
        assert.deepEqual(world.errors, []);
    });

    it("does not take an action set that is not the favourites' one, and says what it saw by name only", async () => {
        const world = plugged();
        world.idle[0]();
        (world.finders.creators as { get(): unknown; }).get = () => undefined;
        (world.finders.generic as { get(): unknown; }).get = () => ({ getCurrentValue: () => ({ theme: 1 }), updateAsync: async () => { throw new Error("must not be used"); }, secret: "do not print" });
        const logged: unknown[][] = [];
        const warn = console.warn;
        console.warn = (...args: unknown[]) => { logged.push(args); };
        try {
            const input = pick(world, "import");
            input.files = fileText(exportText("https://a"));
            input.onchange!();
            await settle();
        } finally { console.warn = warn; }
        const [message, details] = logged[0] as [string, Record<string, unknown>];
        assert.match(message, /What was found instead/);
        assert.deepEqual(details, {
            byName: "undefined", byNameFrecency: "undefined", byMethods: ["getCurrentValue", "updateAsync", "secret"], byMethodsHoldsFavourites: false, discordAdd: "undefined", discordRemove: "undefined",
            store: ["frecencyWithoutFetchingLatest"], storeFrecency: ["favoriteGifs"]
        });
        assert.equal(JSON.stringify(details).includes("do not print"), false, "names only, never values");
    });

    it("tells the favourites' action set from the others by what it holds", () => {
        assert.equal(holdsFavourites(undefined), false);
        assert.equal(holdsFavourites({} as never), false);
        assert.equal(holdsFavourites({ updateAsync: async () => undefined } as never), false, "nothing to read from");
        assert.equal(holdsFavourites({ updateAsync: async () => undefined, getCurrentValue: () => ({ favoriteGifs: {} }) } as never), true);
        assert.equal(holdsFavourites({ updateAsync: async () => undefined, getCurrentValue: () => ({}) } as never), false);
        assert.equal(holdsFavourites({ updateAsync: async () => undefined, getCurrentValue: () => undefined } as never), false);
        assert.equal(holdsFavourites({ updateAsync: async () => undefined, getCurrentValue: () => { throw new Error("no"); } } as never), false);
        assert.equal(holdsFavourites({ updateAsync: "x", getCurrentValue: () => ({ favoriteGifs: {} }) } as never), false);
    });

    it("reports what goes wrong in an import that nobody planned for", async () => {
        const world = plugged({ delayBetweenImports: 0, ensureCompleteImport: false, settleWatch: false });
        world.idle[0]();
        (world.finders.store as { get(): unknown; }).get = () => { throw new Error("store broke"); };
        const input = pick(world, "import");
        input.files = fileText(exportText("https://a"));
        input.onchange!();
        await settle();
        assert.deepEqual(world.errors, ["GifTransfer import"]);
    });
});

describe("GifTransfer settings, patch and manifest", () => {
    it("keeps the numbers inside their limits", () => {
        settings.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "GifTransfer");
        const store = settings.store as unknown as Record<string, unknown>;
        for (const [key, bad] of [["delayBetweenImports", -1], ["delayBetweenImports", 60_001], ["maxRetryPasses", 21], ["maxRetryPasses", 1.5], ["retryPassDelay", -5], ["settleWatchDuration", 120_001]] as const) {
            assert.throws(() => { store[key] = bad; }, TypeError, `${key} ${bad}`);
        }
        assert.deepEqual({ ...settings.store }, {
            skipDuplicates: true, delayBetweenImports: 800, autoIncreaseDelay: true, ensureCompleteImport: true, maxRetryPasses: 3, retryPassDelay: 2000, settleWatch: true, settleWatchDuration: 15_000
        });
    });

    it("lifts the limit on favourites in the module that checks it, whatever name Discord gave the value", () => {
        const patch: RegisteredPatch = { ...plugin.patches![0], plugin: "GifTransfer" };
        const source = "function(e,t,n){function f(t,a){return a.toBinary(t).length>262144?1:0}}";
        const result = compileModule("5", source, [patch]);
        assert.match(result.code, /a\.toBinary\(t\)\.length>Number\.MAX_SAFE_INTEGER\?1:0/);
        const renamed = compileModule("5", "function(e,t,n){function f(t,a){return a.toBinary(zz).length>1024?1:0}}", [{ ...patch, find: "toBinary(zz).length>" }]);
        assert.match(renamed.code, /toBinary\(zz\)\.length>Number\.MAX_SAFE_INTEGER/);
        assert.equal(compileModule("5", "function(e,t,n){return 1}", [patch]).outcomes.length, 0);
    });

    it("declares that it changes the favourites of the account and reads a file the person picks", () => {
        assert.deepEqual(manifest.permissions, { account: { write: ["favorite-gifs"] }, files: "user-chosen" });
        assert.equal(manifest.startAt, "init");
        assert.equal(manifest.origin, "testcord");
    });
});
