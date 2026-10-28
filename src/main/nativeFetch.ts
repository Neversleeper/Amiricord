/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The network call that the main-process code of a plugin uses (`host.fetch` of `nativeHost.ts`). Requests made this way do not pass the request hub (that only sees what the
// browser engine sends), so the owner's rules would not reach them. This wrapper puts them back: before every request, and so before every redirect hop, the address is checked
// against the owner's blocked sites, and a hit stops the request, is counted, and appears in the list of recent blocks. Like the firewall it fails open: a check that fails lets
// the request go on. The request itself is made by Chromium's network stack (`net.fetch` in the program), so it also follows the encrypted DNS choice.
// Design: docs/analysis-41-native-requests-and-the-privacy-engine.md.

import type { NativeHostOptions } from "./nativeHost";

type NativeFetch = NativeHostOptions["fetch"];

export interface NativeFetchDeps {
    /** The real request. */
    fetch: NativeFetch;
    /** The owner's rule that covers a host name, or null. */
    blockedBy(hostname: string): { host: string; } | null;
    /** Tell the firewall that a request was stopped by the owner's rule `ruleHost`, so it is counted and listed. Never throws into the request. */
    onBlocked(ruleHost: string, method: unknown, pathname: string): void;
}

export function makeNativeFetch(deps: NativeFetchDeps): NativeFetch {
    return async (url, init) => {
        let address: URL;
        try {
            address = new URL(url);
        } catch {
            throw new Error("Invalid URL.");
        }
        let rule: { host: string; } | null = null;
        try {
            rule = deps.blockedBy(address.hostname);
        } catch {
            rule = null;
        }
        if (rule) {
            try {
                deps.onBlocked(rule.host, init.method, address.pathname);
            } catch {
                // Counting must never change the answer.
            }
            throw new Error(`${address.hostname} is on the list of sites you blocked.`);
        }
        return deps.fetch(url, init);
    };
}
