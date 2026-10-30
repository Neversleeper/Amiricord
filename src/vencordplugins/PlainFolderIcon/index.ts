/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PlainFolderIcon (author botato) as found in TestCord's copy of Vencord's plugins. Same patch and same style. The patch uses the `#{intl::}` key notation. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const CSS = `
.vc-plainFolderIcon-plain {
    /* Without this, they are a bit laggier */
    transition: none !important;

    /* Do not show the mini server icons */
    transform: translateZ(0);

    /* The new icons are fully transparent. A sane default to match the old behaviour */
    background-color: color-mix(in oklab, var(--custom-folder-color, var(--badge-background-default)) 40%, transparent);
}
`;

const plugin: PluginCode = {
    patches: [
        {
            find: "#{intl::GUILD_FOLDER_TOOLTIP_A11Y_LABEL}",
            lazy: true,
            required: false,
            // Discord always draws both the plain and the server-icons folder and uses a transition to switch between them
            replacements: [{
                match: /\.slice\(0,4\).+?\]:(\i),\[\i\.\i\]:!\1/,
                replace: (whole: string, hasFolderButtonContent: string) => `${whole},"vc-plainFolderIcon-plain":!${hasFolderButtonContent}`
            }]
        }
    ],

    start(ctx) {
        ctx.addStyle(CSS, "plain-folder-icon");
    }
};

export default plugin;
