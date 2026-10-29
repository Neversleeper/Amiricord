/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin OpenInApp (authors Ven and surgedevs) as found in TestCord's copy of Vencord's plugins.
// The main-process side: short links (Spotify's and Steam's) do not allow the page to read where they lead, so this asks from here. Amiricord's `host.fetch` follows the
// redirects itself and refuses every host that is not in plugin.json, so a short link that leads somewhere else is simply left as it was. NOT tried on a live link.

import type { NativeHostApi } from "../../main/nativeHost";

const SHORT_LINK = /^https:\/\/(spotify\.link|s\.team)\/.+$/;

export async function resolveRedirect(host: NativeHostApi, url: unknown): Promise<string> {
    if (typeof url !== "string") return "";
    if (!SHORT_LINK.test(url)) return url;
    try {
        const response = await host.fetch(url, { method: "HEAD", maxBytes: 1024 });
        return response.url ?? url;
    } catch {
        return url;
    }
}
