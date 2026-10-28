/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The two halves of a DNS question over HTTPS (design 05, piece P6a; RFC 8484 uses the ordinary binary DNS message): build the question "what is the address of this name?"
// and read the answer enough to say whether a real DNS server answered it. Pure code with no network and no Electron, so it is tested with made-up messages.
// It never trusts the length fields of an answer: every read is checked against the end of the data, a name may jump at most a few times and nothing allocates by the sizes it reads.
// Design: docs/analysis-21-encrypted-dns.md section 5.

const TYPE_A = 1;
const CLASS_IN = 1;
const MAX_NAME = 253;
const MAX_JUMPS = 10;
const MAX_RECORDS = 64;
/** The most we read from a provider's answer (the caller cuts at this size; a longer one is refused here too). */
export const MAX_ANSWER_BYTES = 4096;

/** The question for the A records of `name`: id 0 (as RFC 8484 asks, so answers can be cached), "recursion desired", one question. */
export function buildQuery(name: string): Uint8Array {
    const labels = name.toLowerCase().replace(/\.$/, "").split(".");
    if (name.length > MAX_NAME || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        throw new Error("the name is not a plain host name");
    }
    const parts: number[] = [0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for (const label of labels) {
        parts.push(label.length);
        for (let i = 0; i < label.length; i++) parts.push(label.charCodeAt(i));
    }
    parts.push(0, 0, TYPE_A, 0, CLASS_IN);
    return Uint8Array.from(parts);
}

export interface DnsAnswer {
    ok: boolean;
    /** In plain words; empty when `ok`. */
    reason: string;
    /** How many answer records the message holds. */
    answers: number;
}

const fail = (reason: string): DnsAnswer => ({ ok: false, reason, answers: 0 });

/** Read a name starting at `at`: returns the name (lowercase, dots) and where the bytes of the name end (after a jump, where the jump was). Null when it is not well formed. */
function readName(bytes: Uint8Array, at: number): { name: string; next: number; } | null {
    const labels: string[] = [];
    let position = at;
    let next = -1;
    let jumps = 0;
    for (let guard = 0; guard < 200; guard++) {
        if (position >= bytes.length) return null;
        const length = bytes[position]!;
        if (length === 0) return { name: labels.join("."), next: next >= 0 ? next : position + 1 };
        if ((length & 0xc0) === 0xc0) {
            if (position + 1 >= bytes.length) return null;
            if (next < 0) next = position + 2;
            if (++jumps > MAX_JUMPS) return null;
            position = ((length & 0x3f) << 8) | bytes[position + 1]!;
            continue;
        }
        // What is left after the jump (`11`) is the plain label (`00`); `01` and `10` are reserved kinds and the length of a plain label is at most 63.
        if ((length & 0xc0) !== 0 || position + 1 + length > bytes.length) return null;
        labels.push(String.fromCharCode(...bytes.subarray(position + 1, position + 1 + length)).toLowerCase());
        if (labels.join(".").length > MAX_NAME) return null;
        position += 1 + length;
    }
    return null;
}

/** Say whether `bytes` is a real, successful answer to `buildQuery(name)`: right id, marked as an answer, not cut short, no error code, the same question, and at least one record. */
export function readAnswer(bytes: Uint8Array, name: string): DnsAnswer {
    if (bytes.length > MAX_ANSWER_BYTES) return fail("the answer is too large to be a DNS answer");
    if (bytes.length < 12) return fail("the answer is too short to be a DNS message");
    const word = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
    const flags = word(2);
    if (word(0) !== 0) return fail("the answer does not belong to the question that was sent");
    if ((flags & 0x8000) === 0) return fail("the message is a question, not an answer");
    if (((flags >> 11) & 0xf) !== 0) return fail("the answer is of an unexpected kind");
    if ((flags & 0x0200) !== 0) return fail("the answer was cut short");
    const code = flags & 0xf;
    if (code !== 0) return fail(code === 3 ? "the server says the name does not exist" : code === 5 ? "the server refused the question" : `the server answered with the error code ${code}`);
    if (word(4) !== 1) return fail("the answer does not repeat the question");
    const count = word(6);
    if (count === 0) return fail("the answer has no records");
    if (count > MAX_RECORDS) return fail("the answer has too many records");

    const question = readName(bytes, 12);
    if (!question || question.next + 4 > bytes.length) return fail("the question in the answer is damaged");
    const expected = name.toLowerCase().replace(/\.$/, "");
    if (question.name !== expected || word(question.next) !== TYPE_A || word(question.next + 2) !== CLASS_IN) return fail("the answer is about another question");

    let at = question.next + 4;
    for (let i = 0; i < count; i++) {
        const record = readName(bytes, at);
        if (!record || record.next + 10 > bytes.length) return fail("a record of the answer is damaged");
        const length = word(record.next + 8);
        at = record.next + 10 + length;
        if (at > bytes.length) return fail("a record of the answer is cut short");
    }
    return { ok: true, reason: "", answers: count };
}
