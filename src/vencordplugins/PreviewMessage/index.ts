/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PreviewMessage (author Aria) as found in TestCord's copy of Vencord's plugins. The original puts a fake message in the chat, with the attachments, as it would look once sent. The engine cannot draw messages in the chat, so this version shows the text as plain text in a window (line breaks kept, mentions and emojis as written). The text is read from the message box on the page. Not tried in a real Discord.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

/** The text of the message box with its line breaks, trimmed. */
export function draftText(box: { innerText?: string; textContent?: string | null; } | null | undefined): string {
    return (box?.innerText ?? box?.textContent ?? "").replace(/​/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.chatBar.add({
            id: "preview-message",
            label: "Preview message",
            icon: { viewBox: "0 0 24 24", path: "M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" },
            onClick() {
                const text = draftText(document.querySelector<HTMLElement>("[class*=\"channelTextArea\"] [role=\"textbox\"][data-slate-editor]"));
                if (text === "") { ctx.toasts.show("There is nothing written to preview.", "failure"); return; }
                openPanelWindow(ctx, "Preview", kit => kit.panel(kit.card([kit.note(text), kit.note(`${[...text].length} characters`)])));
            }
        });
    }
};

export default plugin;
