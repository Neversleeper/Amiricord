/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adjustCreation, anyCreationChoice, CREATION_KEYS, type CreationChoices, creationChoicesOf, hookBrowserWindow, isDiscordWindow, type ModuleHost } from "../src/main/windowHook";

const off: CreationChoices = { nativeTitleBar: false, transparent: false, noMinimumSize: false };
const discord = () => ({ title: "Discord", frame: false, titleBarStyle: "hidden", titleBarOverlay: true, width: 900, webPreferences: { preload: "C:\\x\\preload.js" } });

describe("reading the two creation options", () => {
    it("has both off when nothing was saved, and turns one on only when it is exactly true", () => {
        assert.deepEqual(creationChoicesOf(() => undefined), off);
        assert.equal(anyCreationChoice(off), false);
        for (const odd of ["true", 1, "yes", null, {}, [true]]) assert.deepEqual(creationChoicesOf(() => odd), off, String(odd));
        const saved: Record<string, unknown> = { [CREATION_KEYS.nativeTitleBar]: true, [CREATION_KEYS.transparent]: true, [CREATION_KEYS.noMinimumSize]: true };
        assert.deepEqual(creationChoicesOf(key => saved[key]), { nativeTitleBar: true, transparent: true, noMinimumSize: true });
        assert.deepEqual(CREATION_KEYS, { nativeTitleBar: "nativeTitleBar", transparent: "transparentWindow", noMinimumSize: "removeMinimumSize" });
    });
});

describe("which windows are Discord's own", () => {
    it("has a preload script and a title, and nothing else is touched", () => {
        assert.equal(isDiscordWindow(discord()), true);
        for (const other of [undefined, null, "x", 5, [], {}, { title: "x" }, { webPreferences: { preload: "a" } }, { title: "x", webPreferences: {} }, { title: 4, webPreferences: { preload: "a" } },
            { title: "x", webPreferences: { preload: "" } }]) assert.equal(isDiscordWindow(other), false, JSON.stringify(other));
    });
});

describe("adjusting the options of a window", () => {
    const quiet = () => undefined;

    it("gives the options back as they are when both are off or the window is not Discord's", () => {
        const options = discord();
        assert.equal(adjustCreation(options, off, quiet), options);
        const other = { frame: false };
        assert.equal(adjustCreation(other, { nativeTitleBar: true, transparent: true, noMinimumSize: false }, quiet), other);
    });

    it("the Windows title bar takes away the frame settings and nothing else, without changing the given object", () => {
        const options = discord();
        const result = adjustCreation(options, { nativeTitleBar: true, transparent: false, noMinimumSize: false }, quiet) as Record<string, unknown>;
        assert.equal("frame" in result, false);
        assert.equal("titleBarStyle" in result, false);
        assert.equal("titleBarOverlay" in result, false);
        assert.equal(result.width, 900);
        assert.equal(result.title, "Discord");
        assert.deepEqual(options, discord(), "the original is untouched");
    });

    it("no minimum size ALONE changes nothing at creation (the window is not swapped; it is applied after the window is built)", () => {
        const options = { ...discord(), minWidth: 940, minHeight: 500 };
        assert.equal(adjustCreation(options, { ...off, noMinimumSize: true }, quiet), options);
        assert.equal(anyCreationChoice({ ...off, noMinimumSize: true }), false);
    });

    it("with a creation option on, no minimum size builds the window with a small minimum (320 by 200, not zero) and changes no other option", () => {
        const options = { ...discord(), minWidth: 940, minHeight: 500 };
        const result = adjustCreation(options, { nativeTitleBar: true, transparent: false, noMinimumSize: true }, quiet) as Record<string, unknown>;
        assert.equal(result.minWidth, 320);
        assert.equal(result.minHeight, 200);
        assert.equal(result.frame, undefined, "the title bar option still applies");
        assert.equal(result.width, 900);
        assert.equal(options.minWidth, 940, "the original is untouched");
        const other = { minWidth: 940 };
        assert.equal(adjustCreation(other, { nativeTitleBar: true, transparent: false, noMinimumSize: true }, quiet), other, "a window that is not Discord's is left alone");
    });

    it("transparent makes a frameless see-through window", () => {
        const result = adjustCreation(discord(), { nativeTitleBar: false, transparent: true, noMinimumSize: false }, quiet) as Record<string, unknown>;
        assert.equal(result.transparent, true);
        assert.equal(result.frame, false);
        assert.equal(result.backgroundColor, "#00000000");
        assert.equal(result.titleBarStyle, "hidden");
    });

    it("transparent wins when both are on, and the trace says so", () => {
        const lines: string[] = [];
        const result = adjustCreation(discord(), { nativeTitleBar: true, transparent: true, noMinimumSize: false }, text => { lines.push(text); }) as Record<string, unknown>;
        assert.equal(result.transparent, true);
        assert.equal(result.frame, false);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /title bar is not used/);
    });
});

/** A fake Electron whose BrowserWindow records the options it was built with. */
function fakeHost(over: { exports?: unknown; missing?: boolean; } = {}) {
    const built: unknown[] = [];
    class BrowserWindow {
        static getAllWindows() { return ["all"]; }
        constructor(options?: unknown) { built.push(options); }
    }
    const entry = { exports: over.exports ?? { BrowserWindow, app: "the app" } as unknown };
    const host: ModuleHost = { resolve: id => `/path/${id}`, cache: over.missing ? {} : { "/path/electron": entry } };
    return { host, entry, built };
}

describe("putting the window constructor in place", () => {
    it("does nothing when both options are off", () => {
        const t = fakeHost();
        const before = t.entry.exports;
        assert.equal(hookBrowserWindow(t.host, off, () => undefined), false);
        assert.equal(t.entry.exports, before);
    });

    it("does nothing either when only the minimum size is on: swapping the window made Discord's own window buttons stop answering", () => {
        const t = fakeHost();
        const before = t.entry.exports;
        assert.equal(hookBrowserWindow(t.host, { ...off, noMinimumSize: true }, () => undefined), false);
        assert.equal(t.entry.exports, before);
    });

    it("swaps BrowserWindow for modules that ask for electron afterwards, keeps everything else of Electron, and keeps the static functions", () => {
        const t = fakeHost();
        assert.equal(hookBrowserWindow(t.host, { nativeTitleBar: true, transparent: false, noMinimumSize: false }, () => undefined), true);
        const swapped = t.entry.exports as { BrowserWindow: new (o?: unknown) => object; app: string; };
        assert.equal(swapped.app, "the app");
        assert.deepEqual((swapped.BrowserWindow as unknown as { getAllWindows(): string[]; }).getAllWindows(), ["all"]);
        new swapped.BrowserWindow(discord());
        const options = t.built[0] as Record<string, unknown>;
        assert.equal("frame" in options, false);
        assert.equal(options.width, 900);
    });

    it("builds a window that is not Discord's with exactly the options it was given", () => {
        const t = fakeHost();
        hookBrowserWindow(t.host, { nativeTitleBar: true, transparent: true, noMinimumSize: false }, () => undefined);
        const given = { frame: false, width: 3 };
        new (t.entry.exports as { BrowserWindow: new (o?: unknown) => object; }).BrowserWindow(given);
        assert.equal(t.built[0], given);
    });

    it("says so in the trace and leaves things alone when Electron is not loaded or has no BrowserWindow", () => {
        const lines: string[] = [];
        assert.equal(hookBrowserWindow(fakeHost({ missing: true }).host, { nativeTitleBar: true, transparent: false, noMinimumSize: false }, text => { lines.push(text); }), false);
        assert.equal(hookBrowserWindow(fakeHost({ exports: {} }).host, { nativeTitleBar: true, transparent: false, noMinimumSize: false }, text => { lines.push(text); }), false);
        assert.equal(lines.length, 2);
    });

    it("never throws: a cache that fails is written in the trace", () => {
        const lines: string[] = [];
        const host: ModuleHost = { resolve: () => { throw new Error("cannot resolve"); }, cache: {} };
        assert.equal(hookBrowserWindow(host, { nativeTitleBar: true, transparent: false, noMinimumSize: false }, text => { lines.push(text); }), false);
        assert.match(lines[0], /could not be put in place: cannot resolve/);
    });
});
