/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BetterUploadButton (authors fawn and Ven) as found in TestCord's copy of Vencord's plugins. Same patch.
// Checked on build 653945: it matches once, in the module of the chat input buttons.

import type { PluginCode } from "../../renderer/engine";

interface ButtonProps {
    className?: string;
}

const plugin: PluginCode & { getOverrides(props: ButtonProps | undefined, onClick: unknown, onDoubleClick: unknown): object; } = {
    patches: [
        {
            find: ".CHAT_INPUT_BUTTON_NOTIFICATION,",
            lazy: true,
            replacements: [{
                match: /onClick:(\i\?void 0:\i)(?=,onDoubleClick:(\i\?void 0:\i),)/,
                replace: "$&,...$self.getOverrides(arguments[0],$1,$2)"
            }]
        }
    ],

    /** On the attach button: a single click does what a double click did (opens the file picker), and the right click opens the menu. */
    getOverrides(props, onClick, onDoubleClick) {
        if (typeof props?.className !== "string" || !props.className.includes("attachButton")) return {};
        return { onClick: onDoubleClick, onContextMenu: onClick };
    }
};

export default plugin;
