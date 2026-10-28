/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQuery, MAX_ANSWER_BYTES, readAnswer } from "../src/main/dns/message";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map(c => c.charCodeAt(0));
const nameBytes = (name: string) => [...name.split(".").flatMap(label => [label.length, ...ascii(label)]), 0];

interface Reply {
    id?: number;
    flags?: number;
    questions?: number;
    answers?: number;
    name?: string;
    type?: number;
    cls?: number;
    /** Raw record bytes; by default `count` records of an A answer that point back to the name of the question. */
    records?: number[];
    count?: number;
}

/** A DNS answer made by hand. */
function reply(options: Reply = {}): Uint8Array {
    const name = options.name ?? "discord.com";
    const answers = options.answers ?? options.count ?? 1;
    const record = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 162, 159, 135, 232];
    const records = options.records ?? Array.from({ length: options.count ?? answers }, () => record).flat();
    return bytes(
        (options.id ?? 0) >> 8, (options.id ?? 0) & 0xff, (options.flags ?? 0x8180) >> 8, (options.flags ?? 0x8180) & 0xff,
        0, options.questions ?? 1, answers >> 8, answers & 0xff, 0, 0, 0, 0,
        ...nameBytes(name), 0, options.type ?? 1, 0, options.cls ?? 1,
        ...records
    );
}

describe("the DNS question", () => {
    it("is the standard message for the A records of the name, with id 0 and recursion desired", () => {
        assert.deepEqual([...buildQuery("discord.com")], [
            0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0,
            7, ...ascii("discord"), 3, ...ascii("com"), 0,
            0, 1, 0, 1
        ]);
    });

    it("writes the name in lowercase and without a final dot", () => {
        assert.deepEqual([...buildQuery("Discord.COM.")], [...buildQuery("discord.com")]);
    });

    it("refuses a name that is not a plain host name", () => {
        for (const name of ["", "a..b", "-.com", "a b.com", "a/b.com", "x".repeat(64) + ".com", "a.".repeat(130) + "com", "bücher.example", "a_b.com"]) {
            assert.throws(() => buildQuery(name), /plain host name/, JSON.stringify(name));
        }
    });

    it("accepts a label of 63 characters and a name of 253", () => {
        assert.doesNotThrow(() => buildQuery("a".repeat(63) + ".com"));
        assert.doesNotThrow(() => buildQuery(["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(57), "com"].join(".")));
    });
});

describe("reading a DNS answer", () => {
    it("accepts a normal answer and counts its records", () => {
        assert.deepEqual(readAnswer(reply(), "discord.com"), { ok: true, reason: "", answers: 1 });
        assert.equal(readAnswer(reply({ count: 3 }), "discord.com").answers, 3);
    });

    it("compares the name without caring about case or a final dot", () => {
        assert.equal(readAnswer(reply(), "Discord.COM.").ok, true);
        assert.equal(readAnswer(reply({ name: "DISCORD.com" }), "discord.com").ok, true);
    });

    it("follows a name that points back, and a name written in full", () => {
        const full = [...nameBytes("discord.com"), 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 1, 2, 3, 4];
        assert.equal(readAnswer(reply({ records: full }), "discord.com").ok, true);
        const alias = [0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 60, 0, 7, ...nameBytes("x.com")];
        assert.equal(readAnswer(reply({ records: alias }), "discord.com").ok, true);
    });

    it("refuses an answer with another id", () => {
        const r = readAnswer(reply({ id: 7 }), "discord.com");
        assert.equal(r.ok, false);
        assert.match(r.reason, /does not belong to the question/);
    });

    it("refuses a message that is a question and not an answer", () => {
        assert.match(readAnswer(reply({ flags: 0x0100 }), "discord.com").reason, /a question, not an answer/);
    });

    it("refuses an answer of another kind, a cut-short one, and an error code, saying which", () => {
        assert.match(readAnswer(reply({ flags: 0x8980 }), "discord.com").reason, /unexpected kind/);
        assert.match(readAnswer(reply({ flags: 0x8380 }), "discord.com").reason, /cut short/);
        assert.match(readAnswer(reply({ flags: 0x8183 }), "discord.com").reason, /does not exist/);
        assert.match(readAnswer(reply({ flags: 0x8185 }), "discord.com").reason, /refused/);
        assert.match(readAnswer(reply({ flags: 0x8182 }), "discord.com").reason, /error code 2/);
    });

    it("refuses an answer with no records, with too many, or that repeats no question", () => {
        assert.match(readAnswer(reply({ answers: 0, records: [] }), "discord.com").reason, /no records/);
        assert.match(readAnswer(reply({ count: 65 }), "discord.com").reason, /too many records/);
        assert.equal(readAnswer(reply({ count: 64 }), "discord.com").ok, true);
        assert.match(readAnswer(reply({ questions: 0 }), "discord.com").reason, /does not repeat the question/);
        assert.match(readAnswer(reply({ questions: 2 }), "discord.com").reason, /does not repeat the question/);
    });

    it("refuses an answer about another name, another type or another class", () => {
        for (const options of [{ name: "evil.test" }, { type: 28 }, { cls: 3 }]) {
            assert.match(readAnswer(reply(options), "discord.com").reason, /another question/, JSON.stringify(options));
        }
    });

    it("refuses what is too short or too large", () => {
        assert.match(readAnswer(bytes(), "discord.com").reason, /too short/);
        assert.match(readAnswer(bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0), "discord.com").reason, /too short/);
        assert.match(readAnswer(new Uint8Array(MAX_ANSWER_BYTES + 1), "discord.com").reason, /too large/);
    });

    it("refuses a damaged question, a damaged record and a record that runs past the end", () => {
        const good = reply();
        assert.match(readAnswer(good.subarray(0, 14), "discord.com").reason, /question in the answer is damaged/);
        assert.match(readAnswer(good.subarray(0, good.length - 20 + 7), "discord.com").reason, /record of the answer is (damaged|cut short)/);
        assert.match(readAnswer(good.subarray(0, good.length - 1), "discord.com").reason, /cut short/);
    });

    it("refuses a name that jumps in circles, or jumps too many times, without hanging", () => {
        const loop = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1, 0xc0, 28, 0, 1, 0, 1, 0, 0, 0, 60, 0, 0];
        // the answer's name points at itself: byte 28 is where the pointer is
        assert.equal(readAnswer(Uint8Array.from(loop), "discord.com").ok, false);
        const many = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1];
        const start = many.length;
        for (let i = 0; i < 15; i++) many.push(0xc0, start + 2 * (i + 1));
        many.push(0, 0, 1, 0, 1, 0, 0, 0, 60, 0, 0);
        assert.equal(readAnswer(Uint8Array.from(many), "discord.com").ok, false);
    });

    it("refuses a label longer than 63 and a name that is too long", () => {
        const bigLabel = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), 64, ...ascii("a".repeat(64)), 0, 0, 1, 0, 1];
        assert.equal(readAnswer(Uint8Array.from(bigLabel), "discord.com").ok, false);
        const longName = ["a".repeat(60), "a".repeat(60), "a".repeat(60), "a".repeat(60), "a".repeat(60)].join(".");
        const raw = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes(longName), 0, 1, 0, 1, 0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 0];
        assert.equal(readAnswer(Uint8Array.from(raw), "discord.com").ok, false);
    });

    it("does not accept a reserved kind of label in a record name, even when the bytes are all there", () => {
        for (const kind of [0x41, 0x81]) {
            // the kind byte is also a length: a damaged reader that took it for one would find all of these bytes and a closing zero
            const raw = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1, kind, ...new Array<number>(kind).fill(97), 0, 0, 1, 0, 1, 0, 0, 0, 60, 0, 0];
            assert.equal(readAnswer(Uint8Array.from(raw), "discord.com").ok, false, "kind " + kind.toString(16));
        }
        const plain = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1, ...nameBytes("a".repeat(63) + ".com"), 0, 1, 0, 1, 0, 0, 0, 60, 0, 0];
        assert.equal(readAnswer(Uint8Array.from(plain), "discord.com").ok, true, "a label of 63 is fine");
    });

    it("does not accept the reserved kinds of label", () => {
        const odd = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), 0x41, ...ascii("a"), 0, 0, 1, 0, 1];
        assert.equal(readAnswer(Uint8Array.from(odd), "discord.com").ok, false);
    });

    it("accepts an answer of exactly the largest size and refuses one byte more", () => {
        const record = (extra: number) => [0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60, extra >> 8, extra & 0xff, ...new Array<number>(extra).fill(65)];
        const header = reply({ records: [] }).length;
        const room = MAX_ANSWER_BYTES - header - 12;
        const exact = reply({ records: record(room) });
        assert.equal(exact.length, MAX_ANSWER_BYTES);
        assert.equal(readAnswer(exact, "discord.com").ok, true);
        assert.match(readAnswer(reply({ records: record(room + 1) }), "discord.com").reason, /too large/);
    });

    it("says that a record cut inside its fixed part is damaged, and one cut inside its data is cut short", () => {
        const good = reply();
        assert.match(readAnswer(good.subarray(0, good.length - 14), "discord.com").reason, /record of the answer is damaged/);
        assert.match(readAnswer(good.subarray(0, good.length - 2), "discord.com").reason, /record of the answer is cut short/);
    });

    it("lets a name jump ten times and refuses the eleventh", () => {
        // a question, then one record whose name is a pointer to a chain of pointers that ends at a real name placed after the record: `hops` jumps in all
        const build = (hops: number) => {
            const head = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1];
            const first = head.length + 2 + 10;
            const pointer = (to: number) => [0xc0 | (to >> 8), to & 0xff];
            const chain: number[] = [];
            for (let i = 0; i < hops - 1; i++) chain.push(...pointer(first + 2 * (i + 1)));
            return Uint8Array.from([...head, ...pointer(first), 0, 1, 0, 1, 0, 0, 0, 60, 0, 0, ...chain, ...nameBytes("x.com")]);
        };
        assert.equal(readAnswer(build(1), "discord.com").ok, true);
        assert.equal(readAnswer(build(10), "discord.com").ok, true);
        assert.equal(readAnswer(build(11), "discord.com").ok, false);
    });

    it("refuses a record name that is longer than a name can be", () => {
        const long = Array.from({ length: 5 }, () => "a".repeat(60)).join(".");
        const raw = [...bytes(0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0), ...nameBytes("discord.com"), 0, 1, 0, 1, ...nameBytes(long), 0, 1, 0, 1, 0, 0, 0, 60, 0, 0];
        assert.equal(readAnswer(Uint8Array.from(raw), "discord.com").ok, false);
    });

    it("never throws, whatever it is given", () => {
        let seed = 12345;
        const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
        for (let i = 0; i < 2000; i++) {
            const data = Uint8Array.from({ length: next() % 80 }, () => next() & 0xff);
            assert.doesNotThrow(() => readAnswer(data, "discord.com"));
        }
        const good = reply({ count: 2 });
        for (let at = 0; at < good.length; at++) {
            const damaged = Uint8Array.from(good);
            damaged[at] = (damaged[at]! + 1 + (at % 7)) & 0xff;
            assert.doesNotThrow(() => readAnswer(damaged, "discord.com"));
        }
    });
});
