/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin DoubleEmoji (author Nightcord) as found in TestCord. Discord's emoji picker closes after a pick unless Shift is held; the
// original made every click in the picker look like a Shift click and marked the emoji with a border. Not verified in a real Discord: the picker's class names are matched
// by part of their name, as the original did, so a Discord update can stop it.

import type { PluginCode } from "../../renderer/engine";

const ITEM = "[class*='emojiItem'], [class*='EmojiItem']";
const PICKER = "[class*='emojiPicker'], #emoji-picker-tab-panel, [class*='expressionPicker']";

let listener: ((event: MouseEvent) => void) | undefined;

const plugin: PluginCode = {
    start() {
        listener = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const item = target.closest<HTMLElement>(ITEM);
            if (!item || !target.closest(PICKER)) return;
            item.style.border = "1px solid #5865f2";
            item.style.borderRadius = "4px";
            item.style.background = "rgba(88, 101, 242, 0.05)";
            try {
                Object.defineProperty(event, "shiftKey", { get: () => true, configurable: true });
            } catch {
                // The event cannot be changed: the picker simply closes as usual.
            }
        };
        document.addEventListener("click", listener, { capture: true });
    },
    stop() {
        if (listener) document.removeEventListener("click", listener, { capture: true });
        listener = undefined;
    }
};

export default plugin;
