/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceDownload (author puv) as found in TestCord's copy of Vencord's plugins. The patch is the original's, with Discord's
// translation key VOICE_MESSAGES_PLAYBACK_RATE_LABEL written as its hash (`LgCPMt`). Amiricord only runs in Discord's desktop app, so the link always opens outside
// (as the original did there). The plugin's CSS goes in when the first voice message is drawn: the plugin starts before the page has a place for styles.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const CSS = `
.ac-voice-download { width: 24px; height: 24px; color: var(--interactive-icon-default, currentColor); cursor: pointer; position: relative; }
.ac-voice-download:hover { color: var(--interactive-icon-active, currentColor); }
`;

const ARROW = "M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z";

let context: EnginePluginContext | undefined;
let styled = false;

const plugin: PluginCode & { renderDownload(src: unknown): unknown; } = {
    patches: [
        {
            find: ".t.LgCPMt",
            lazy: true,
            replacements: [{ match: /(?<=onVolumeHide:\i\}\))/, replace: ",$self.renderDownload(arguments[0].src)" }]
        }
    ],

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
        styled = false;
    },

    renderDownload(src) {
        if (typeof src !== "string" || !/^https?:/i.test(src)) return null;
        if (!styled && context) {
            styled = true;
            context.addStyle(CSS, "voice-download");
        }
        const react = currentReact() as { createElement(...args: unknown[]): unknown; };
        return react.createElement("a", {
            className: "ac-voice-download",
            href: src,
            target: "_blank",
            rel: "noreferrer noopener",
            onClick: (event: { stopPropagation(): void; }) => event.stopPropagation(),
            "aria-label": "Download voice message"
        }, react.createElement("svg", { height: 24, width: 24, viewBox: "0 0 24 24", fill: "currentColor" }, react.createElement("path", { d: ARROW })));
    }
};

export default plugin;
