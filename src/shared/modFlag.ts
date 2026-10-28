/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reads ONE fact from what Discord sends about itself: the value of `has_client_mods`. It works on the header `X-Super-Properties`
// (base64 of a JSON text) and on gateway messages, which are text (JSON) or binary (Erlang term format). Nothing else is read or kept.
// Pure and without Electron or the DOM, so the main process and the page can share it. Design: docs/analysis-13-has-client-mods-selftest.md.

export const FLAG_KEY = "has_client_mods";

/** Only this many characters of a message are looked at. */
export const MAX_SCAN = 64 * 1024;

/**
 * `false` is the good answer; `true` is the bad one; `unreadable` means the key is there but its value could not be read;
 * `missing` means the key is not in what was scanned; `unsupported` means the data is of a kind that cannot be read here (a `Blob`, for example).
 */
export type FlagValue = "false" | "true" | "unreadable" | "missing" | "unsupported";

const JSON_FORM = /"has_client_mods"\s*:\s*(true|false)/;
/** Erlang term format: atoms are a tag byte (100 or 118: 2-byte length, 115 or 119: 1-byte length) and the letters. */
const ATOM_SLACK = 3;

/** One character per byte, so nothing is decoded as a language. Only the part that is scanned is converted. */
export function bytesToLatin1(bytes: ArrayLike<number>, limit = MAX_SCAN): string {
    const n = Math.min(bytes.length, limit);
    let out = "";
    for (let i = 0; i < n; i += 4096) {
        const end = Math.min(n, i + 4096);
        const chunk: number[] = [];
        for (let j = i; j < end; j++) chunk.push(bytes[j] & 0xff);
        out += String.fromCharCode(...chunk);
    }
    return out;
}

/** Read the flag from text in which every character is one byte of the message. */
export function readFlag(text: string): FlagValue {
    const scanned = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
    const at = scanned.indexOf(FLAG_KEY);
    if (at < 0) return "missing";

    const json = JSON_FORM.exec(scanned.slice(Math.max(0, at - 1), at + FLAG_KEY.length + 24));
    if (json) return json[1] as "true" | "false";

    // Binary form: the atom follows the key, with a little slack for the key's own closing byte.
    const after = at + FLAG_KEY.length;
    for (let skip = 0; skip <= ATOM_SLACK; skip++) {
        const tagAt = after + skip;
        const tag = scanned.charCodeAt(tagAt);
        let length: number;
        let start: number;
        if (tag === 100 || tag === 118) {
            if (tagAt + 2 >= scanned.length) continue;
            length = (scanned.charCodeAt(tagAt + 1) << 8) | scanned.charCodeAt(tagAt + 2);
            start = tagAt + 3;
        } else if (tag === 115 || tag === 119) {
            if (tagAt + 1 >= scanned.length) continue;
            length = scanned.charCodeAt(tagAt + 1);
            start = tagAt + 2;
        } else continue;
        const atom = scanned.slice(start, start + length);
        if (atom === "true" || atom === "false") return atom;
    }
    return "unreadable";
}

/** Read the flag from a message of any kind the page can send: text, a block of bytes, or anything else (`unsupported`). */
export function readFlagFrom(data: unknown): FlagValue {
    try {
        if (typeof data === "string") return readFlag(data);
        if (data instanceof ArrayBuffer) return readFlag(bytesToLatin1(new Uint8Array(data)));
        if (ArrayBuffer.isView(data)) return readFlag(bytesToLatin1(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
    } catch {
        return "unsupported";
    }
    return "unsupported";
}

/** Read the flag from the base64 text of `X-Super-Properties`. Never throws. */
export function readFlagFromSuperProperties(base64: unknown): FlagValue {
    if (typeof base64 !== "string" || base64.length === 0 || base64.length > MAX_SCAN * 2) return "unreadable";
    try {
        const decode = (globalThis as { atob?: (s: string) => string; }).atob;
        if (!decode) return "unreadable";
        return readFlag(decode(base64));
    } catch {
        return "unreadable";
    }
}
