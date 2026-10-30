/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// `#{intl::KEY}` in a find or a match: Discord names its texts by a short hash of the key (`t.intl.string(t.t.Zk3dQp)`), and the hash changes with every
// text, never with the build. Plugins write the key (`#{intl::COPY_MESSAGE_LINK}`) and the engine turns it into the hash when it looks in a module.
// The hash is the one Discord's own build tool makes (xxHash64 of the key, the first 5 bytes written as 6 base64 characters); written from scratch from
// the published xxHash algorithm. The same notation as in Vencord's patches, so the plugins that use it can be ported as they are.

const MASK = 0xffffffffffffffffn;
const PRIME1 = 11400714785074694791n;
const PRIME2 = 14029467366897019727n;
const PRIME3 = 1609587929392839161n;
const PRIME4 = 9650029242287828579n;
const PRIME5 = 2870177450012600261n;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const rotateLeft = (value: bigint, bits: bigint): bigint => ((value << bits) | (value >> (64n - bits))) & MASK;
const round = (accumulator: bigint, input: bigint): bigint => (rotateLeft((accumulator + input * PRIME2) & MASK, 31n) * PRIME1) & MASK;
const mergeRound = (accumulator: bigint, value: bigint): bigint => (((accumulator ^ round(0n, value)) * PRIME1) + PRIME4) & MASK;

function read(bytes: Uint8Array, at: number, count: number): bigint {
    let value = 0n;
    for (let index = count - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[at + index]);
    return value;
}

/** xxHash64 of the UTF-8 bytes of the text, with seed 0. */
export function xxhash64(text: string): bigint {
    const bytes = new TextEncoder().encode(text);
    const length = bytes.length;
    let at = 0;
    let hash: bigint;
    if (length >= 32) {
        let v1 = (PRIME1 + PRIME2) & MASK;
        let v2 = PRIME2;
        let v3 = 0n;
        let v4 = (0n - PRIME1) & MASK;
        for (; at + 32 <= length; at += 32) {
            v1 = round(v1, read(bytes, at, 8));
            v2 = round(v2, read(bytes, at + 8, 8));
            v3 = round(v3, read(bytes, at + 16, 8));
            v4 = round(v4, read(bytes, at + 24, 8));
        }
        hash = (rotateLeft(v1, 1n) + rotateLeft(v2, 7n) + rotateLeft(v3, 12n) + rotateLeft(v4, 18n)) & MASK;
        hash = mergeRound(hash, v1);
        hash = mergeRound(hash, v2);
        hash = mergeRound(hash, v3);
        hash = mergeRound(hash, v4);
    } else {
        hash = PRIME5;
    }
    hash = (hash + BigInt(length)) & MASK;
    for (; at + 8 <= length; at += 8) {
        hash ^= round(0n, read(bytes, at, 8));
        hash = (rotateLeft(hash, 27n) * PRIME1 + PRIME4) & MASK;
    }
    if (at + 4 <= length) {
        hash ^= (read(bytes, at, 4) * PRIME1) & MASK;
        hash = (rotateLeft(hash, 23n) * PRIME2 + PRIME3) & MASK;
        at += 4;
    }
    for (; at < length; at++) {
        hash ^= (BigInt(bytes[at]) * PRIME5) & MASK;
        hash = (rotateLeft(hash, 11n) * PRIME1) & MASK;
    }
    hash ^= hash >> 33n;
    hash = (hash * PRIME2) & MASK;
    hash ^= hash >> 29n;
    hash = (hash * PRIME3) & MASK;
    hash ^= hash >> 32n;
    return hash;
}

const cache = new Map<string, string>();

/** The name Discord's build gives a text key, for example "COPY_MESSAGE_LINK" → six characters. The lowest byte of the hash comes first. */
export function hashMessageKey(key: string): string {
    const known = cache.get(key);
    if (known !== undefined) return known;
    const hash = xxhash64(key);
    const byte = (index: number) => Number((hash >> BigInt(8 * index)) & 0xffn);
    const hashed = BASE64[byte(0) >> 2]
        + BASE64[((byte(0) & 0x03) << 4) | (byte(1) >> 4)]
        + BASE64[((byte(1) & 0x0f) << 2) | (byte(2) >> 6)]
        + BASE64[byte(2) & 0x3f]
        + BASE64[byte(3) >> 2]
        + BASE64[((byte(3) & 0x03) << 4) | (byte(4) >> 4)];
    cache.set(key, hashed);
    return hashed;
}

const INTL = /#\{intl::([\w$+/]*)(?:::(\w+))?\}/g;

/**
 * Turn every `#{intl::KEY}` in a find or a match into what Discord's code has there: `.hash` (or `["hash"]` when the hash starts with a digit or has + or /).
 * `#{intl::KEY::hash}` gives only the hash and `#{intl::KEY::raw}` keeps the key as it is. For the source of a regular expression pass `regexSource: true`.
 */
export function expandIntl(text: string, regexSource: boolean): string {
    if (!text.includes("#{intl::")) return text;
    return text.replace(INTL, (_whole, key: string, modifier: string | undefined) => {
        const hashed = modifier === "raw" ? key : hashMessageKey(key);
        if (modifier === "hash") return regexSource ? `(?:${hashed.replaceAll("+", "\\+")})` : hashed;
        const special = !Number.isNaN(Number(hashed[0])) || hashed.includes("+") || hashed.includes("/");
        if (special) return regexSource ? `(?:\\["${hashed.replaceAll("+", "\\+")}"\\])` : `["${hashed}"]`;
        return regexSource ? `(?:\\.${hashed})` : `.${hashed}`;
    });
}
