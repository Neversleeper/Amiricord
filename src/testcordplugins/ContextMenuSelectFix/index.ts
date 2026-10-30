/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ContextMenuSelectFix (author x2b) as found in TestCord. Same behaviour (a right press that lasts more than 120 ms and is released over a menu entry clicks it). The original finds the menu with a Discord class name; here the menu is recognised by its accessibility role, which does not change with builds.

import type { PluginCode } from "../../renderer/engine";

const HOLD_MS = 120;
let lastRightPress = 0;

function onDown(event: PointerEvent): void {
    if (event.button === 2) lastRightPress = Date.now();
}

function onUp(event: PointerEvent): void {
    if (event.button !== 2 || Date.now() - lastRightPress < HOLD_MS) return;
    let target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest("[role=\"menu\"]")) return;
    while (target && typeof target.click !== "function") target = target.parentElement;
    target?.click();
}

const plugin: PluginCode = {
    start() {
        document.body.addEventListener("pointerdown", onDown);
        document.body.addEventListener("pointerup", onUp);
    },
    stop() {
        document.body.removeEventListener("pointerdown", onDown);
        document.body.removeEventListener("pointerup", onUp);
    }
};

export default plugin;
