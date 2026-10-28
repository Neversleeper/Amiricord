/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CompactCompose (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord. The description is reworded: the original said the buttons were hidden, but its
// style sheet only fades them (35 % opacity) until the message box is hovered or focused.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord CompactCompose - slimmer message bar */
[class*="channelTextArea"] {
    margin-top: 0 !important;
    margin-bottom: 6px !important;
}

[class*="channelTextArea"] [class*="scrollableContainer"] {
    min-height: 40px;
}

/* fade the left-side attach button + right-side gift/gif/sticker buttons
   until the compose area is hovered or focused */
[class*="channelTextArea"] [class*="buttons"],
[class*="channelTextArea"] button[class*="attachButton"] {
    opacity: 0.35;
    transition: opacity 0.15s ease;
}

[class*="channelTextArea"]:hover [class*="buttons"],
[class*="channelTextArea"]:focus-within [class*="buttons"],
[class*="channelTextArea"]:hover button[class*="attachButton"],
[class*="channelTextArea"]:focus-within button[class*="attachButton"] {
    opacity: 1;
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
