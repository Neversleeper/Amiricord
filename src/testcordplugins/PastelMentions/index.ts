/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PastelMentions (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord PastelMentions - pastel mention/role pills */

/* '.mention' is the pill itself and is not a mangled class. Matching [class*="mention"] also
   hit the pinged message row (mentioned__hash), the unread-mentions bar and vc-mentionAvatars-*,
   so entire rows got the gradient. */
.mention {
    background: linear-gradient(90deg, rgba(255, 113, 206, 0.35), rgba(1, 205, 254, 0.35)) !important; /* overrides Discord's own .mention background */
    color: #fff0fb !important; /* same Discord rule sets the pill text colour */
    border-radius: 6px;
    transition: filter 0.15s ease;
}

.mention:hover {
    filter: brightness(1.2);
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
