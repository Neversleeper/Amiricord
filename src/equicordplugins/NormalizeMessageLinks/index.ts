/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NormalizeMessageLinks (author bb010g) as found in Equicord's copy of Vencord's plugins. Same patch, written with the `#{intl::}` key notation the engine now understands (src/webpack/intl.ts). Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode & { normalizeHost(host: string): string; } = {
    patches: [
        {
            find: "#{intl::COPY_MESSAGE_LINK}",
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=\/\/\$\{)location\.host/, replace: "$self.normalizeHost(location.host)" }]
        }
    ],

    normalizeHost(host) {
        return host.replace(/(^|\b)(canary\.|ptb\.)(discord.com)$/, "$1$3");
    }
};

export default plugin;
