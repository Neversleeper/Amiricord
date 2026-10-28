/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bytesToLatin1, FLAG_KEY, MAX_SCAN, readFlag, readFlagFrom, readFlagFromSuperProperties } from "../src/shared/modFlag";

/** A fragment of Erlang term format: a binary key, then an atom value (tag, length, letters). */
function etf(value: string, tag: 100 | 115 | 118 | 119 = 100, pad = 0): Uint8Array {
    const key = Buffer.from(FLAG_KEY, "latin1");
    const letters = Buffer.from(value, "latin1");
    const length = tag === 100 || tag === 118 ? Buffer.from([0, letters.length]) : Buffer.from([letters.length]);
    return new Uint8Array(Buffer.concat([Buffer.from([116, 0, 0, 0, 1, 109, 0, 0, 0, key.length]), key, Buffer.alloc(pad), Buffer.from([tag]), length, letters]));
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("readFlag: text form", () => {
    it("reads true and false, with or without spaces", () => {
        assert.equal(readFlag('{"os":"Windows","has_client_mods":false,"x":1}'), "false");
        assert.equal(readFlag('{"has_client_mods":true}'), "true");
        assert.equal(readFlag('{ "has_client_mods" :  false }'), "false");
    });

    it("says missing when the key is not there", () => {
        assert.equal(readFlag('{"os":"Windows"}'), "missing");
        assert.equal(readFlag(""), "missing");
    });

    it("never reads another field's value, nor a value that is not true or false", () => {
        assert.equal(readFlag('{"other":false,"has_client_mods":"no"}'), "unreadable");
        assert.equal(readFlag('{"has_client_mods":null}'), "unreadable");
        assert.equal(readFlag('{"has_client_mods_like":false}'), "unreadable");
    });
});

describe("readFlag: binary (Erlang term) form", () => {
    const text = (bytes: Uint8Array) => bytesToLatin1(bytes);

    it("reads the atoms false and true with each of the four atom tags", () => {
        for (const tag of [100, 115, 118, 119] as const) {
            assert.equal(readFlag(text(etf("false", tag))), "false", `tag ${tag}`);
            assert.equal(readFlag(text(etf("true", tag))), "true", `tag ${tag}`);
        }
    });

    it("allows a little slack between the key and the atom, and no more", () => {
        assert.equal(readFlag(text(etf("false", 100, 2))), "false");
        assert.equal(readFlag(text(etf("false", 100, 9))), "unreadable");
    });

    it("is unreadable for other atoms, wrong lengths, and a cut-off message", () => {
        assert.equal(readFlag(text(etf("maybe"))), "unreadable");
        assert.equal(readFlag(text(etf("fals"))), "unreadable");
        const cut = etf("false").slice(0, -3);
        assert.equal(readFlag(text(cut)), "unreadable");
        assert.equal(readFlag(FLAG_KEY), "unreadable");
    });
});

describe("limits", () => {
    it("does not look past the first 64 KB", () => {
        const far = "x".repeat(MAX_SCAN + 10) + '"has_client_mods":true';
        assert.equal(readFlag(far), "missing");
        const near = '"has_client_mods":false' + "x".repeat(MAX_SCAN * 2);
        assert.equal(readFlag(near), "false");
    });

    it("converts only the part that is scanned", () => {
        assert.equal(bytesToLatin1(new Uint8Array(MAX_SCAN * 3).fill(65)).length, MAX_SCAN);
        assert.equal(bytesToLatin1([104, 105]), "hi");
    });
});

describe("readFlagFrom", () => {
    it("reads text, array buffers and views of bytes", () => {
        assert.equal(readFlagFrom('{"has_client_mods":false}'), "false");
        const bytes = etf("true");
        assert.equal(readFlagFrom(bytes), "true");
        assert.equal(readFlagFrom(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), "true");
        assert.equal(readFlagFrom(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)), "true");
    });

    it("says unsupported for what cannot be read here, and never throws", () => {
        assert.equal(readFlagFrom(new Blob(["x"])), "unsupported");
        assert.equal(readFlagFrom(undefined), "unsupported");
        assert.equal(readFlagFrom(42), "unsupported");
        assert.equal(readFlagFrom({ get length() { throw new Error("boom"); } }), "unsupported");
    });
});

describe("readFlagFromSuperProperties", () => {
    it("decodes the base64 text and reads only the flag", () => {
        assert.equal(readFlagFromSuperProperties(b64('{"os":"Windows","has_client_mods":false}')), "false");
        assert.equal(readFlagFromSuperProperties(b64('{"has_client_mods":true}')), "true");
        assert.equal(readFlagFromSuperProperties(b64('{"os":"Windows"}')), "missing");
    });

    it("is unreadable for anything that is not a sensible base64 text, and never throws", () => {
        assert.equal(readFlagFromSuperProperties(undefined), "unreadable");
        assert.equal(readFlagFromSuperProperties(""), "unreadable");
        assert.equal(readFlagFromSuperProperties("not base64 !!!"), "unreadable");
        assert.equal(readFlagFromSuperProperties("A".repeat(MAX_SCAN * 3)), "unreadable");
    });
});
