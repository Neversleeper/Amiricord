/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoEditedTimestamp (author Sharp) as found in TestCord. The original patched a function of Discord's code to draw nothing; here a style hides the label, so nothing of Discord's code is touched and it cannot break when Discord changes. The class of the label (`edited_c19a55` in build 655747) was read in the style sheets of her running Discord; it was NOT seen on a real edited message. The label hides again the moment the plugin stops.

import type { PluginCode } from "../../renderer/engine";

// The class name ends in a hash that changes with every build, so only the word before it is matched.
// The span around the label is hidden too: left empty it keeps its own line height (22px), taller than the one-line reply preview (18px), and pushed the preview text down so its lower part was cut off (seen live in a reply).
export const CSS = `[class^="edited_"], [class*=" edited_"] { display: none !important; }
[class*="timestamp_"]:has(time > [class*="edited_"]) { display: none !important; }`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS, "no-edited-label");
    }
};

export default plugin;
