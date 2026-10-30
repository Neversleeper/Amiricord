/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PermissionFreeWill (author lewisakura) as found in TestCord's copy of Vencord's plugins. Same two patches. The original switches each patch on or off with `predicate`, which the engine does not have; here the patched code asks the plugin when it runs, so the options work without a restart. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    lockout: { type: "boolean", default: true, description: "Skip the lockout check (\"Pretty sure you don't want to do this\")" },
    onboarding: { type: "boolean", default: true, description: "Skip the onboarding requirements (\"Making this change will make your server incompatible [...]\")" }
});

const plugin: PluginCode & { lockout(): boolean; onboarding<T>(original: T): T | (() => Promise<boolean>); } = {
    settings,
    patches: [
        {
            // Lockout check: make the condition true
            find: "#{intl::STAGE_CHANNEL_CANNOT_OVERWRITE_PERMISSION}",
            lazy: true,
            required: false,
            replacements: [{ match: /case"DENY":.{0,50}if\((?=\i\.\i\.can)/, replace: "$&$self.lockout()||" }]
        },
        {
            // Onboarding: the exported getters give functions that always say yes
            find: "#{intl::ONBOARDING_CHANNEL_THRESHOLD_WARNING}",
            lazy: true,
            required: false,
            replacements: [{
                match: /{(?:\i:\(\)=>\i,?){2}}/,
                replace: (whole: string) => whole.replaceAll(/\(\)=>([A-Za-z_$][\w$]*)/g, "()=>$self.onboarding($1)")
            }]
        }
    ],

    lockout() {
        return settings.store.lockout;
    },

    onboarding(original) {
        return settings.store.onboarding ? () => Promise.resolve(true) : original;
    }
};

export default plugin;
