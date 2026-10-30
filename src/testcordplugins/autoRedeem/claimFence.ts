/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * This file is pure logic: it needs nothing from `ctx`, so the code below the header is unchanged.
 */

const externalClaims = new Set<string>();
const releaseListeners = new Set<() => void>();

export function markExternalClaim(code: string) {
    externalClaims.add(code.toUpperCase());
}

export function releaseExternalClaim(code: string) {
    externalClaims.delete(code.toUpperCase());
    for (const listener of releaseListeners) {
        try { listener(); } catch (error) { void error; }
    }
}

export function onExternalClaimRelease(listener: () => void) {
    releaseListeners.add(listener);
    return () => releaseListeners.delete(listener);
}

export function isExternalClaimed(code: string) {
    return externalClaims.has(code.toUpperCase());
}
