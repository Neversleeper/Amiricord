/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the button is drawn with React's createElement, which has no types here */

// Adapted for Amiricord (2026) from the plugin CopyFileContents (authors Obsidian, Nuckyz) as found in TestCord's copy of Vencord's plugins. Same two patches and the same rule (a file cut short because it is too big cannot be copied). The button is a plain element with a small label instead of Discord's icon set, and the text goes to the clipboard through the browser. Not checked against this Discord build.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";

const CSS = `
.amiricord-cfc-button { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 4px; cursor: pointer; color: var(--interactive-normal); font-size: 12px; font-weight: 600; }
.amiricord-cfc-button:hover { color: var(--interactive-hover); background: var(--background-modifier-hover); }
.amiricord-cfc-button[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }
`;

/** The tooltip text of the button. */
export function copyLabel(copied: boolean, bytesLeft: number): string {
    return copied ? "Copied!" : bytesLeft > 0 ? "File too large to copy" : "Copy File Contents";
}

const plugin: PluginCode & { addCopyButton(props: { fileContents: string; bytesLeft: number; }): unknown; } = {
    patches: [
        {
            find: "#{intl::PREVIEW_BYTES_LEFT}",
            lazy: true,
            required: false,
            replacements: [
                { match: /fileContents:(\i),bytesLeft:(\i)\}\):null,/, replace: "$&$self.addCopyButton({fileContents:$1,bytesLeft:$2})," },
                { match: /align:"\i"\}\),(?=\(0,\i\.jsx\)\(\i,\{wordWrap:\i,setWordWrap:\i)/, replace: "$&$self.addCopyButton(arguments[0])," }
            ]
        }
    ],
    start(ctx) {
        ctx.addStyle(CSS, "copy-file-contents");
    },
    addCopyButton(props) {
        const react = currentReact() as any;
        return react.createElement(CopyButton, props);
    }
};

function CopyButton({ fileContents, bytesLeft }: { fileContents: string; bytesLeft: number; }) {
    const react = currentReact() as any;
    const [copied, setCopied] = react.useState(false) as [boolean, (value: boolean) => void];
    return react.createElement("div", {
        className: "amiricord-cfc-button", role: "button", title: copyLabel(copied, bytesLeft), "aria-disabled": bytesLeft > 0,
        onClick: () => {
            if (copied || bytesLeft > 0) return;
            navigator.clipboard.writeText(fileContents).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => undefined);
        }
    }, copied ? "✓" : bytesLeft > 0 ? "⛔" : "Copy");
}

export default plugin;
