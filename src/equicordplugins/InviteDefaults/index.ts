/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin InviteDefaults (author VillainsRule) as found in Equicord's copy of Vencord's plugins. Same patch; the original reads `$self.settings.store` inside the patch, which the engine does not allow, so small methods answer instead.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    inviteDuration: {
        type: "select", default: 0, description: "How long a new invite lasts",
        options: [
            { label: "30 minutes", value: 1800 },
            { label: "1 hour", value: 3600 },
            { label: "6 hours", value: 21600 },
            { label: "12 hours", value: 43200 },
            { label: "1 day", value: 86400 },
            { label: "7 days", value: 604800 },
            { label: "Forever", value: 0 }
        ]
    },
    maxUses: {
        type: "select", default: 0, description: "How many times a new invite can be used",
        options: [
            { label: "Infinite", value: 0 },
            { label: "1", value: 1 },
            { label: "5", value: 5 },
            { label: "10", value: 10 },
            { label: "25", value: 25 },
            { label: "50", value: 50 },
            { label: "100", value: 100 }
        ]
    },
    temporaryMembership: { type: "boolean", default: false, description: "People who join with the invite are removed when they go offline, unless they get a role" }
});

const plugin: PluginCode & { duration(): number; uses(): number; temporary(): boolean; } = {
    settings,
    patches: [
        {
            find: ".GUILD_CREATE_INVITE_SUGGESTION,defaultMaxAge",
            lazy: true,
            required: false,
            replacements: [
                { match: /(?<=maxAge:)\i\?\?\i\?\?\i/, replace: "$self.duration()" },
                { match: /(?<=maxUses:)null!=\i&&0!==\i\?\i:\i.value/, replace: "$self.uses()" },
                { match: /(?<=temporary:)\i\?\?!1/, replace: "$self.temporary()" }
            ]
        }
    ],

    duration() {
        return Number(settings.store.inviteDuration);
    },
    uses() {
        return Number(settings.store.maxUses);
    },
    temporary() {
        return settings.store.temporaryMembership;
    }
};

export default plugin;
