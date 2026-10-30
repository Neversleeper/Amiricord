/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PinIcon (author iamme) as found in Equicord's copy of Vencord's plugins. Same patch. The original draws Discord's own pin icon component; here a small pin picture is drawn with a plain element (Discord's component is found by a piece of its source that changes). Not checked live.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";

const PIN_PATH = "M16 3a1 1 0 0 1 .7 1.7L15.4 6l1.6 5 1.7 1.7a1 1 0 0 1-.7 1.7H13v6a1 1 0 1 1-2 0v-6H6a1 1 0 0 1-.7-1.7L7 11l1.6-5-1.3-1.3A1 1 0 0 1 8 3h8Z";

const plugin: PluginCode & { renderPinIcon(message: { pinned?: boolean; } | undefined): unknown; } = {
    patches: [
        {
            find: "isUnsupported})",
            lazy: true,
            required: false,
            replacements: [{ match: /WITH_CONTENT\}\)/, replace: "$&,$self.renderPinIcon(arguments[0].message)" }]
        }
    ],

    renderPinIcon(message) {
        if (!message?.pinned) return null;
        try {
            const h = (currentReact() as unknown as { createElement(type: string, props: unknown, ...children: unknown[]): unknown; }).createElement;
            return h("svg", { viewBox: "0 0 24 24", width: 16, height: 16, "aria-label": "Pinned", style: { position: "absolute", right: 0, top: 0, color: "var(--interactive-icon-default, currentColor)" } }, h("path", { d: PIN_PATH, fill: "currentColor" }));
        } catch {
            return null;
        }
    }
};

export default plugin;
