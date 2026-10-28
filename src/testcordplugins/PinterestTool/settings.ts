/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository).
// The settings of the plugin, declared the way Amiricord's settings layer wants them. The six of the original are here with the same names, choices and
// defaults. The cookie is NOT a setting: it is a secret of the plugin (`secrets` in plugin.json), kept encrypted by the main process and never shown to the page.

import { definePluginSettings } from "../../api/pluginSettings";
import { PINTEREST_THEMES } from "./theme";

export const settings = definePluginSettings({
    colorTheme: {
        type: "select",
        description: "Color theme used by Pinterest Tool",
        default: "pinterest",
        options: [...PINTEREST_THEMES.map(theme => ({ label: theme.label, value: theme.value as string })), { label: "Custom", value: "custom" }]
    },
    customAccent: {
        type: "string",
        description: "Custom Pinterest Tool accent color (hex, like #f59e0b)",
        default: "#f59e0b",
        maxLength: 7
    },
    appearance: {
        type: "select",
        description: "Light or dark look for the Pinterest Tool window. Auto follows Discord's own theme and keeps text readable on either.",
        default: "AUTO",
        options: [
            { label: "Auto (follow Discord)", value: "AUTO" },
            { label: "Dark", value: "DARK" },
            { label: "Light", value: "LIGHT" }
        ]
    },
    randomizeSearch: {
        type: "boolean",
        description: "Add a random style keyword to manual Pinterest searches (less precise, more variety)",
        default: false
    },
    effectsStep: {
        type: "boolean",
        description: "Show the Effects & filters step (colors, presets, tint) before Discord's image editor. Not used for animated GIFs, which would lose their animation.",
        default: true
    },
    editBeforeApply: {
        type: "boolean",
        description: "Open Discord's image editor before applying a Pinterest avatar or banner",
        default: true
    }
});
