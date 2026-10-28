/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Images imported by the page script are inlined by the build as data URLs (the page loads nothing from the network for them).

declare module "*.webp" {
    const url: string;
    export default url;
}
