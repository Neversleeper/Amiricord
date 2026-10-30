/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AutoCorrect (author x2b) as found in TestCord. The original rewrites any place in Discord's code that says autocorrect, autocomplete or autocapitalize is off. Here each of the three settings decides at the moment the box is drawn whether to say on or off, so changing a setting does not need a restart. Whether Chromium actually corrects text in the box also depends on the spell-check language of Discord. Not checked against this Discord build.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    autoCorrect: { type: "boolean", default: true, description: "Turn on automatic correction" },
    autoComplete: { type: "boolean", default: true, description: "Turn on automatic completion" },
    autoCapitalize: { type: "boolean", default: true, description: "Turn on automatic capital letters" }
});

/** The value of an attribute: "on" when the setting is on, the value it had ("off") when it is not. */
export function attributeValue(enabled: boolean, original: string): string {
    return enabled ? "on" : original;
}

const plugin: PluginCode & { attribute(name: "autoCorrect" | "autoComplete" | "autoCapitalize", original: string): string; } = {
    settings,
    patches: [
        { find: /autocorrect:"?(off|false|none)"?/i, all: true, lazy: true, required: false, replacements: [{ match: /autocorrect:"?(off|false|none)"?/i, replace: "autoCorrect:$self.attribute(\"autoCorrect\",\"off\")" }] },
        { find: /autocomplete:"?(off|false|none|list)"?/i, all: true, lazy: true, required: false, replacements: [{ match: /autocomplete:"?(off|false|none|list)"?/i, replace: "autoComplete:$self.attribute(\"autoComplete\",\"off\")" }] },
        { find: /autocapitalize:"?(off|false|none)"?/i, all: true, lazy: true, required: false, replacements: [{ match: /autocapitalize:"?(off|false|none)"?/i, replace: "autoCapitalize:$self.attribute(\"autoCapitalize\",\"off\")" }] }
    ],
    attribute(name, original) {
        return attributeValue(settings.store[name], original);
    }
};

export default plugin;
