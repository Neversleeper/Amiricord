/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoButtons (author Sharp) as found in TestCord. Each button has its own switch and a style hides it, as in the original. Changes: the original matched any element whose label merely contained the word "gift" (anywhere on the page); here each message-box button is matched by its exact label and only inside the row of buttons of the message box, so nothing else can disappear. The labels of the message box (Send a gift, Open GIF picker, Open sticker picker, Add Emoji, Apps) were read in her running Discord (build 655747, English). Boost, help and pop-out labels were taken from the original and NOT seen. A change of a switch applies within a second.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    hideGiftButton: { type: "boolean", default: true, description: "Hide the gift button in the message box" },
    hideGifButton: { type: "boolean", default: true, description: "Hide the GIF button in the message box" },
    hideStickerButton: { type: "boolean", default: true, description: "Hide the sticker button in the message box" },
    hideAppsButton: { type: "boolean", default: true, description: "Hide the Apps button in the message box" },
    hideEmojiButton: { type: "boolean", default: false, description: "Hide the emoji button in the message box" },
    hideBoostButton: { type: "boolean", default: true, description: "Hide the boost button" },
    hideHelpButton: { type: "boolean", default: false, description: "Hide the help button" },
    hidePopoutChatButton: { type: "boolean", default: false, description: "Hide the pop-out chat button" }
});

const BOX = "form [class*=\"buttons\"]";
const label = (text: string) => `[aria-label="${text}"]`;

/** Setting -> selectors of what it hides. The message box ones start with the row of buttons of the box. */
const BUTTONS: ReadonlyArray<{ setting: keyof typeof settings.store; selectors: readonly string[]; }> = [
    { setting: "hideGiftButton", selectors: [`${BOX} ${label("Send a gift")}`] },
    { setting: "hideGifButton", selectors: [`${BOX} ${label("Open GIF picker")}`] },
    { setting: "hideStickerButton", selectors: [`${BOX} ${label("Open sticker picker")}`] },
    { setting: "hideAppsButton", selectors: [`${BOX} ${label("Apps")}`] },
    { setting: "hideEmojiButton", selectors: [`${BOX} ${label("Add Emoji")}`, `${BOX} ${label("Select Emoji")}`] },
    { setting: "hideBoostButton", selectors: [label("Boost this server"), label("Boost")] },
    { setting: "hideHelpButton", selectors: [label("Help")] },
    { setting: "hidePopoutChatButton", selectors: [label("Popout chat"), label("Pop Out"), label("Pop out")] }
];

/** The style for the switches that are on. Empty when none is. */
export function cssFor(on: (setting: string) => boolean): string {
    const selectors = BUTTONS.filter(button => on(button.setting)).flatMap(button => button.selectors);
    return selectors.length === 0 ? "" : `${selectors.join(",\n")} { display: none !important; }`;
}

let stop: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        let last = cssFor(setting => settings.store[setting as keyof typeof settings.store] === true);
        const handle = ctx.addStyle(last || "/* nothing hidden */", "no-buttons");
        const view = (globalThis as unknown as { document: Document; }).document.defaultView!;
        const timer = view.setInterval(() => {
            const css = cssFor(setting => settings.store[setting as keyof typeof settings.store] === true);
            if (css === last) return;
            last = css;
            handle.update(css || "/* nothing hidden */");
        }, 1000);
        stop = () => view.clearInterval(timer);
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
