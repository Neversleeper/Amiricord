/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main-process side of the Badges plugin: it reads the owners' badge list (`badges/badges.json`) and the pictures it names from the project's repository, and
// hands the page ready-made data addresses, so Discord's page never contacts GitHub itself. Everything goes through `host.fetch`, which reaches only the host in
// plugin.json, checks every redirect and caps the size. Only the exported functions are callable from the page, so nothing else may be exported here.

import type { NativeHostApi } from "../../main/nativeHost";
import { type BadgeList, iconsNeeded, iconTypeOf, MAX_BADGE_LIST_BYTES, MAX_ICON_BYTES, MAX_REGISTRY_BYTES, parseBadgeList, parseRegistry, USER_ID } from "../../shared/badgeList";
import { REGISTRY_URL, UPDATE_REPO } from "../../shared/project";

const RAW = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/badges`;

export interface LoadedBadge {
    tooltip: string;
    /** A data address, so the page needs no network to draw it. */
    src: string;
}

export interface LoadedList {
    badges: Record<string, LoadedBadge>;
    users: Record<string, string[]>;
}

/** Not exported: everything exported here can be called from the page. */
function toBase64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

async function bytesOf(host: NativeHostApi, url: string, maxBytes: number): Promise<Uint8Array> {
    const response = await host.fetch(url, { maxBytes });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("the file is bigger than expected");
    return bytes;
}

/**
 * The owners' list, with each picture that somebody uses turned into a data address. A picture that cannot be read leaves out its badge only. An error here
 * (no network, the repository not public yet, a damaged file) makes the page keep what it had; the badges that need no list still show.
 */
export async function loadList(host: NativeHostApi): Promise<LoadedList> {
    let text: unknown;
    try {
        text = JSON.parse(new TextDecoder().decode(await bytesOf(host, `${RAW}/badges.json`, MAX_BADGE_LIST_BYTES)));
    } catch (error) {
        throw new Error(`the badge list could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
    const list: BadgeList | string = parseBadgeList(text);
    if (typeof list === "string") throw new Error(list);
    const sources = new Map<string, string>();
    for (const file of iconsNeeded(list)) {
        const type = iconTypeOf(file);
        if (type === null) continue;
        try {
            const bytes = await bytesOf(host, `${RAW}/icons/${file}`, MAX_ICON_BYTES);
            sources.set(file, `data:${type};base64,${toBase64(bytes)}`);
        } catch {
            // This badge is left out; the others do not depend on it.
        }
    }
    const badges: Record<string, LoadedBadge> = {};
    const users: Record<string, string[]> = {};
    for (const [id, keys] of Object.entries(list.users)) {
        const shown = keys.filter(key => sources.has(list.badges[key].icon));
        for (const key of shown) badges[key] ??= { tooltip: list.badges[key].tooltip, src: sources.get(list.badges[key].icon)! };
        if (shown.length > 0) users[id] = shown;
    }
    return { badges, users };
}

/** The ids of everybody who has told the registry they use Amiricord. An error leaves the page with the list it had. */
export async function loadRegistry(host: NativeHostApi): Promise<string[]> {
    try {
        return parseRegistry(new TextDecoder().decode(await bytesOf(host, `${REGISTRY_URL}/users`, MAX_REGISTRY_BYTES)));
    } catch (error) {
        throw new Error(`the list of Amiricord users could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
}

/** Tells the registry that this account uses Amiricord. The id is the person's own Discord id; nothing else is sent. */
export async function registerSelf(host: NativeHostApi, id: string): Promise<void> {
    if (!USER_ID.test(id)) throw new Error("not a Discord id");
    const response = await host.fetch(`${REGISTRY_URL}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }), maxBytes: 1024 });
    if (!response.ok) throw new Error(`the registry answered ${response.status}`);
}
