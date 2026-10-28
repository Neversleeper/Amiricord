/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's web client puts its build number in the page, in an inline script that runs before its bundle:
// `window.GLOBAL_ENV.BUILD_NUMBER`, written as text (for example "650101"). That script has not run yet when
// our page script starts, so the number is read later, when Discord's Webpack is found.

/** The build number, or null when it is missing or does not look like one. Never throws. */
export function readBuildNumber(clientGlobal: unknown): number | null {
    try {
        const env = (clientGlobal as { GLOBAL_ENV?: unknown; } | null | undefined)?.GLOBAL_ENV;
        if (typeof env !== "object" || env === null) return null;
        const value = (env as { BUILD_NUMBER?: unknown; }).BUILD_NUMBER;
        const text = typeof value === "number" ? String(value) : value;
        if (typeof text !== "string" || !/^[1-9]\d{0,9}$/.test(text)) return null;
        const number = Number(text);
        return Number.isSafeInteger(number) ? number : null;
    } catch {
        return null;
    }
}
