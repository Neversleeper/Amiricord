/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anyWindowOption, applyWindowOptions, type BackgroundMaterial, type InputLike, isCtrlQ, MATERIALS, OPTION_KEYS, type WindowLike, type WindowOptions, windowOptionsOf } from "../src/main/windowOptions";

const none: WindowOptions = { removeMinimumSize: false, ctrlQ: false, material: "none" };

describe("reading the three window options", () => {
    it("has everything off when nothing was saved", () => {
        assert.deepEqual(windowOptionsOf(() => undefined), none);
        assert.equal(anyWindowOption(none), false);
    });

    it("reads the saved choices by the names the Settings plugin saves them under", () => {
        const saved: Record<string, unknown> = { [OPTION_KEYS.removeMinimumSize]: true, [OPTION_KEYS.ctrlQ]: true, [OPTION_KEYS.material]: "mica" };
        assert.deepEqual(windowOptionsOf(key => saved[key]), { removeMinimumSize: true, ctrlQ: true, material: "mica" });
        assert.deepEqual(OPTION_KEYS, { removeMinimumSize: "removeMinimumSize", ctrlQ: "ctrlQToQuit", material: "backgroundMaterial" });
    });

    it("turns a switch on only when it is exactly true, and takes a material that is not one of the four as none", () => {
        for (const odd of ["true", 1, "yes", null, {}, [true], "on"]) {
            assert.deepEqual(windowOptionsOf(() => odd), none, String(odd));
        }
        for (const material of ["MICA", "glass", "", 3, null, undefined, "auto"]) {
            assert.equal(windowOptionsOf(key => (key === OPTION_KEYS.material ? material : undefined)).material, "none", String(material));
        }
        for (const material of MATERIALS) assert.equal(windowOptionsOf(key => (key === OPTION_KEYS.material ? material : undefined)).material, material);
        assert.deepEqual([...MATERIALS], ["none", "mica", "tabbed", "acrylic"]);
    });

    it("says whether any option is on, so Discord's windows can be left alone when none is", () => {
        assert.equal(anyWindowOption({ ...none, removeMinimumSize: true }), true);
        assert.equal(anyWindowOption({ ...none, ctrlQ: true }), true);
        assert.equal(anyWindowOption({ ...none, material: "acrylic" }), true);
    });
});

describe("Ctrl+Q", () => {
    const press = (over: InputLike): InputLike => ({ type: "keyDown", key: "q", control: true, alt: false, shift: false, meta: false, ...over });

    it("is Ctrl and Q pressed, in either case", () => {
        assert.equal(isCtrlQ(press({})), true);
        assert.equal(isCtrlQ(press({ key: "Q" })), true);
    });

    it("is not Q alone, nor Q with another modifier, nor another key, nor the key being released", () => {
        assert.equal(isCtrlQ(press({ control: false })), false);
        assert.equal(isCtrlQ(press({ control: undefined })), false);
        assert.equal(isCtrlQ(press({ alt: true })), false);
        assert.equal(isCtrlQ(press({ shift: true })), false);
        assert.equal(isCtrlQ(press({ meta: true })), false);
        assert.equal(isCtrlQ(press({ key: "w" })), false);
        assert.equal(isCtrlQ(press({ key: undefined })), false);
        assert.equal(isCtrlQ(press({ type: "keyUp" })), false);
        assert.equal(isCtrlQ({}), false);
    });
});

/** A window that records what it was asked, as Electron's does. */
function fakeWindow(over: Partial<WindowLike> = {}) {
    const calls: string[] = [];
    const listeners: Array<(event: { preventDefault(): void; }, input: InputLike) => void> = [];
    const win: WindowLike = {
        setMinimumSize: (w, h) => { calls.push(`min ${w}x${h}`); },
        setBackgroundMaterial: (m: BackgroundMaterial) => { calls.push(`material ${m}`); },
        close: () => { calls.push("close"); },
        isDestroyed: () => false,
        webContents: { on: (event, listener) => { calls.push(`on ${event}`); listeners.push(listener); } },
        ...over
    };
    return { win, calls, listeners };
}

function setup(options: WindowOptions, over: Partial<WindowLike> = {}) {
    const w = fakeWindow(over);
    const trace: string[] = [];
    applyWindowOptions(w.win, options, text => { trace.push(text); });
    return { ...w, trace };
}

describe("applying the options to a window", () => {
    it("does nothing at all to a window when every option is off", () => {
        const t = setup(none);
        assert.deepEqual(t.calls, []);
        assert.deepEqual(t.trace, []);
    });

    it("removes the minimum size by asking for zero by zero, and only that", () => {
        const t = setup({ ...none, removeMinimumSize: true });
        assert.deepEqual(t.calls, ["min 0x0"]);
        assert.equal(t.trace.length, 1);
    });

    it("turns a later minimum size that Discord sets itself into zero by zero, so it does not undo the option", () => {
        const t = setup({ ...none, removeMinimumSize: true });
        t.win.setMinimumSize!(940, 500);
        assert.deepEqual(t.calls, ["min 0x0", "min 0x0"]);
        const untouched = setup(none);
        untouched.win.setMinimumSize!(940, 500);
        assert.deepEqual(untouched.calls, ["min 940x500"]);
    });

    it("writes in the trace what Discord asked for and, later, the minimum size the window really has", async () => {
        const { mock } = await import("node:test");
        mock.timers.enable({ apis: ["setTimeout"] });
        try {
            const t = setup({ ...none, removeMinimumSize: true }, { getMinimumSize: () => [123, 45] });
            t.win.setMinimumSize!(940, 500);
            assert.ok(t.trace.some(line => line.includes("Discord asked for a minimum size of 940 by 500; it was kept at 0 by 0")));
            mock.timers.tick(6000);
            assert.ok(t.trace.some(line => line.includes("the minimum size of a window is now 123 by 45")));
            const unknown = setup({ ...none, removeMinimumSize: true });
            mock.timers.tick(6000);
            assert.ok(unknown.trace.some(line => line.includes("is now unknown")));
        } finally {
            mock.timers.reset();
        }
    });

    it("asks for the chosen background effect, and not for none", () => {
        for (const material of ["mica", "tabbed", "acrylic"] as const) assert.deepEqual(setup({ ...none, material }).calls, [`material ${material}`]);
        assert.deepEqual(setup(none).calls, []);
    });

    it("listens to the keys of the window only when Ctrl+Q is on", () => {
        assert.deepEqual(setup({ ...none, ctrlQ: true }).calls, ["on before-input-event"]);
        assert.deepEqual(setup({ ...none, removeMinimumSize: true }).calls.filter(call => call.startsWith("on ")), []);
    });

    it("closes the window, as Alt+F4 does, and keeps the key from reaching Discord, for Ctrl+Q only", () => {
        const t = setup({ ...none, ctrlQ: true });
        let prevented = 0;
        const event = { preventDefault: () => { prevented++; } };
        t.listeners[0](event, { type: "keyDown", key: "q", control: true });
        assert.equal(prevented, 1);
        assert.ok(t.calls.includes("close"));
        const before = t.calls.length;
        t.listeners[0](event, { type: "keyDown", key: "q", control: false });
        t.listeners[0](event, { type: "keyDown", key: "w", control: true });
        t.listeners[0](event, { type: "keyUp", key: "q", control: true });
        assert.equal(prevented, 1, "no other key is taken");
        assert.equal(t.calls.length, before);
    });

    it("does not touch a window that is already gone when Ctrl+Q is pressed", () => {
        const t = setup({ ...none, ctrlQ: true }, { isDestroyed: () => true });
        let prevented = 0;
        t.listeners[0]({ preventDefault: () => { prevented++; } }, { type: "keyDown", key: "q", control: true });
        assert.equal(prevented, 0);
        assert.ok(!t.calls.includes("close"));
    });

    it("applies all three to one window, each in its own step", () => {
        const t = setup({ removeMinimumSize: true, ctrlQ: true, material: "mica" });
        assert.deepEqual(t.calls, ["min 0x0", "material mica", "on before-input-event"]);
    });

    it("never throws: a step that fails is written in the trace and the next steps still run", () => {
        const t = setup({ removeMinimumSize: true, ctrlQ: true, material: "acrylic" }, {
            setMinimumSize: () => { throw new Error("no minimum size"); },
            setBackgroundMaterial: () => { throw new Error("not Windows 11"); }
        });
        assert.ok(t.trace.some(line => line.includes("removing the minimum size FAILED: no minimum size")));
        assert.ok(t.trace.some(line => line.includes("the background effect FAILED: not Windows 11")));
        assert.deepEqual(t.calls, ["on before-input-event"], "Ctrl+Q was still added");
    });

    it("says so in the trace when an Electron or a window lacks a function, instead of failing", () => {
        const t = setup({ removeMinimumSize: true, ctrlQ: true, material: "mica" }, { setMinimumSize: undefined, setBackgroundMaterial: undefined, webContents: undefined });
        assert.deepEqual(t.calls, []);
        assert.equal(t.trace.length, 3);
        assert.ok(t.trace.some(line => line.includes("cannot have its minimum size removed")));
        assert.ok(t.trace.some(line => line.includes("Windows 11 is needed")));
    });

    it("reports a key handler that throws, and does not let it reach Discord", () => {
        const t = setup({ ...none, ctrlQ: true }, { close: () => { throw new Error("cannot close"); } });
        assert.doesNotThrow(() => t.listeners[0]({ preventDefault: () => undefined }, { type: "keyDown", key: "q", control: true }));
        assert.ok(t.trace.some(line => line.includes("Ctrl+Q FAILED: cannot close")));
    });

    it("reports a window whose key listener cannot be added", () => {
        const t = setup({ ...none, ctrlQ: true }, { webContents: { on: () => { throw new Error("destroyed"); } } });
        assert.ok(t.trace.some(line => line.includes("adding Ctrl+Q FAILED: destroyed")));
    });
});
