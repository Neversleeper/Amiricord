/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildToasts, TOAST_CSS, TOAST_MAX_LENGTH, TOAST_MS, type ToastPage } from "../src/api/toasts";
import { fakePage } from "./helpers/fakeDom";

function setup() {
    const world = fakePage();
    const styles: string[] = [];
    const undo: Array<() => void> = [];
    const toasts = buildToasts(world.page as unknown as ToastPage, css => { styles.push(css); }, fn => { undo.push(fn); });
    const shown = () => world.document.querySelectorAll(".amiricord-toast");
    return { ...world, toasts, styles, undo, shown };
}

describe("toasts", () => {
    it("shows a message as text in a box at the bottom, with the style added once", () => {
        const world = setup();
        world.toasts.show("<b>Copied</b>");
        world.toasts.show("Second");
        const [first, second] = world.shown();
        assert.equal(first.textContent, "<b>Copied</b>");
        assert.equal(first.className, "amiricord-toast");
        assert.equal(first.getAttribute("role"), "status");
        assert.equal(second.textContent, "Second");
        assert.equal(world.document.querySelectorAll(".amiricord-toasts").length, 1, "one box for all");
        assert.deepEqual(world.styles, [TOAST_CSS]);
    });

    it("marks success and failure, and takes a message away after a few seconds", () => {
        const world = setup();
        world.toasts.show("Good", "success");
        world.toasts.show("Bad", "failure");
        assert.deepEqual(world.shown().map(toast => toast.className), ["amiricord-toast amiricord-toast-success", "amiricord-toast amiricord-toast-failure"]);
        assert.deepEqual([...world.timers.values()].map(timer => timer.ms), [TOAST_MS, TOAST_MS]);
        world.runTimers();
        assert.equal(world.shown().length, 0);
    });

    it("cuts a very long message", () => {
        const world = setup();
        world.toasts.show("x".repeat(350));
        assert.equal(world.shown()[0].textContent.length, 300);
        assert.equal(TOAST_MAX_LENGTH, 300);
        world.toasts.show(undefined as never);
        assert.equal(world.shown()[1].textContent, "undefined");
    });

    it("removes what is on the screen, and its timers, when the plugin stops", () => {
        const world = setup();
        world.toasts.show("One");
        world.toasts.show("Two");
        assert.equal(world.undo.length, 1);
        world.undo[0]();
        assert.equal(world.shown().length, 0);
        assert.equal(world.timers.size, 0);
    });
});
