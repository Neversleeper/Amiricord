/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main-process side of the Themes plugin: the three questions that go out to the network. Discord's page may not talk to other computers (its content security policy
// refuses it), so the page asks here, and `host.fetch` reaches only the hosts the manifest declares. Everything exported is callable from the page, so nothing else is exported.

import type { NativeHostApi } from "../../main/nativeHost";
import { addressProblem, LIBRARY_URL, type LibraryTheme, libraryThemeUrl, MAX_CSS_CHARS, parseLibrary, thumbnailAddress } from "./model";

/** The whole catalogue holds every theme's CSS, so it is big; the limit stops a runaway answer. */
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
/** CSS can use multi-byte letters: four bytes per character is the most. */
const MAX_CSS_BYTES = MAX_CSS_CHARS * 4;

/** The themes of the library (themes.equicord.org) without their CSS, which is asked for one at a time with `themeCss`. */
export async function library(host: NativeHostApi): Promise<LibraryTheme[]> {
    const answer = await host.fetch(LIBRARY_URL, { maxBytes: MAX_LIBRARY_BYTES });
    if (!answer.ok) throw new Error(`the library answered ${answer.status}`);
    return parseLibrary(await answer.json());
}

const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;

/** The preview picture of a theme as an embedded image (`data:` address): the page may not load pictures from other computers, so it is read here. Only the library's own pictures. */
export async function thumbnail(host: NativeHostApi, address: unknown): Promise<string> {
    const clean = thumbnailAddress(address);
    if (clean === "") throw new Error("that is not a picture of the library");
    const answer = await host.fetch(new URL(clean).href, { maxBytes: MAX_PICTURE_BYTES });
    if (!answer.ok) throw new Error(`the library answered ${answer.status}`);
    const type = (answer.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!PICTURE_TYPES.has(type)) throw new Error("that is not a picture");
    const bytes = new Uint8Array(await answer.arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return `data:${type};base64,${btoa(binary)}`;
}

/** The CSS of one theme of the library. */
export async function themeCss(host: NativeHostApi, id: unknown): Promise<string> {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) throw new Error("that is not the number of a theme");
    const answer = await host.fetch(libraryThemeUrl(id), { maxBytes: MAX_CSS_BYTES });
    if (!answer.ok) throw new Error(`the library answered ${answer.status}`);
    return answer.text();
}

/** The text at an address the person typed: https and one of the declared hosts only (`host.fetch` refuses any other, redirects included). */
export async function textAt(host: NativeHostApi, address: unknown): Promise<string> {
    if (typeof address !== "string") throw new Error("that is not an address");
    const problem = addressProblem(address);
    if (problem) throw new Error(problem);
    const answer = await host.fetch(address.trim(), { maxBytes: MAX_CSS_BYTES });
    if (!answer.ok) throw new Error(`the server answered ${answer.status}`);
    return answer.text();
}
