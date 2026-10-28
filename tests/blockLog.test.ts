/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBlockLog, EXPORT_NOTE, exportName, exportText, groupBlocks, RawBlock, stamp } from "../src/main/blockLog";
import { BLOCK_MAX_GROUPS, BlockGroup, parseBlockLog } from "../src/shared/blocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into made-up answers and break them on purpose
type Loose = Record<string, any>;

const block = (change: Partial<RawBlock> = {}): RawBlock => ({ at: 1000, kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", ...change });

describe("grouping the recent blocks", () => {
    it("puts the same kind, method, host and path shape together, with the count and the time of the last one", () => {
        const groups = groupBlocks([block({ at: 1000 }), block({ at: 3000 }), block({ at: 2000 })], 10_000);
        assert.deepEqual(groups, [{ kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 3, agoMs: 7000 }]);
    });

    it("keeps apart what differs in the kind, the method, the host or the path", () => {
        const groups = groupBlocks([
            block(), block({ kind: "metrics" }), block({ method: "GET" }), block({ host: "other.test" }), block({ path: "/api/*/other" })
        ], 2000);
        assert.equal(groups.length, 5);
        assert.ok(groups.every(group => group.count === 1));
    });

    it("does not mix entries whose parts only look the same when glued together", () => {
        const groups = groupBlocks([block({ host: "a.test", path: "/b" }), block({ host: "a.test/b", path: "" })], 2000);
        assert.equal(groups.length, 2);
    });

    it("puts the newest group first, and keeps the order of equal times as they came", () => {
        const groups = groupBlocks([block({ host: "old.test", at: 1000 }), block({ host: "new.test", at: 5000 }), block({ host: "mid.test", at: 3000 })], 6000);
        assert.deepEqual(groups.map(group => group.host), ["new.test", "mid.test", "old.test"]);
        assert.deepEqual(groups.map(group => group.agoMs), [1000, 3000, 5000]);
    });

    it("sorts a group by its last block, not by its first", () => {
        const groups = groupBlocks([block({ host: "a.test", at: 1000 }), block({ host: "b.test", at: 2000 }), block({ host: "a.test", at: 9000 })], 10_000);
        assert.deepEqual(groups.map(group => [group.host, group.count]), [["a.test", 2], ["b.test", 1]]);
    });

    it("cuts the list at the most groups, keeping the newest", () => {
        const entries = Array.from({ length: 5 }, (_, i) => block({ host: `h${i}.test`, at: i * 100 }));
        assert.deepEqual(groupBlocks(entries, 1000, 3).map(group => group.host), ["h4.test", "h3.test", "h2.test"]);
        assert.equal(groupBlocks(Array.from({ length: BLOCK_MAX_GROUPS + 50 }, (_, i) => block({ host: `h${i}.test`, at: i })), 10_000).length, BLOCK_MAX_GROUPS);
    });

    it("never gives a negative age, and rounds to whole milliseconds", () => {
        assert.equal(groupBlocks([block({ at: 5000 })], 1000)[0]!.agoMs, 0);
        assert.equal(groupBlocks([block({ at: 1000.4 })], 2000)[0]!.agoMs, 1000);
    });

    it("gives nothing for nothing, and does not change what it was given", () => {
        assert.deepEqual(groupBlocks([], 1000), []);
        const entries = [block({ at: 2 }), block({ at: 1 })];
        const copy = JSON.parse(JSON.stringify(entries));
        groupBlocks(entries, 1000);
        assert.deepEqual(entries, copy);
    });
});

describe("the recent blocks of the firewall and the token guard together", () => {
    it("names the firewall's shield as the kind and the token removals as token-stripped", () => {
        const log = buildBlockLog({
            firewall: [{ at: 1000, shield: "telemetry-host", method: "GET", host: "dc-telemetry.net", path: "/" }],
            token: [{ at: 2000, method: "POST", host: "stranger.test", path: "/api" }]
        }, 2, 3000);
        assert.deepEqual(log.groups.map(group => [group.kind, group.host, group.agoMs]), [["token-stripped", "stranger.test", 1000], ["telemetry-host", "dc-telemetry.net", 2000]]);
    });

    it("carries the version as a whole number that is never negative", () => {
        const none = { firewall: [], token: [] };
        assert.equal(buildBlockLog(none, 41.9, 0).version, 41);
        assert.equal(buildBlockLog(none, -3, 0).version, 0);
    });

    it("gives a list that the page accepts", () => {
        const log = buildBlockLog({ firewall: [{ at: 1, shield: "metrics", method: "POST", host: "discord.com", path: "/api/*/metrics" }], token: [] }, 1, 5);
        assert.deepEqual(parseBlockLog(JSON.parse(JSON.stringify(log))), log);
    });
});

describe("the two files", () => {
    const groups: BlockGroup[] = [
        { kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 3, agoMs: 5000 },
        { kind: "host-rules", method: "GET", host: "m.stripe.com", path: "/", count: 1, agoMs: 0 }
    ];
    const at = Date.UTC(2026, 9, 26, 3, 14, 7);

    it("names a file by the time in UTC and the format", () => {
        assert.equal(stamp(at), "20261026-031407");
        assert.equal(exportName("json", at), "recent-blocks-20261026-031407.json");
        assert.equal(exportName("csv", at), "recent-blocks-20261026-031407.csv");
        assert.equal(stamp(Date.UTC(2027, 0, 2, 4, 5, 6)), "20270102-040506", "single digits are padded");
    });

    it("writes JSON with a note on what is in it, the time, and every group with the time of its last block", () => {
        const data = JSON.parse(exportText("json", groups, at));
        assert.equal(data.about, EXPORT_NOTE);
        assert.equal(data.exportedAt, "2026-10-26T03:14:07.000Z");
        assert.deepEqual(data.blocks, [
            { kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 3, last: "2026-10-26T03:14:02.000Z" },
            { kind: "host-rules", method: "GET", host: "m.stripe.com", path: "/", count: 1, last: "2026-10-26T03:14:07.000Z" }
        ]);
        assert.ok(exportText("json", groups, at).endsWith("\n"));
    });

    it("writes CSV with a header, one quoted line per group and Windows line ends", () => {
        const text = exportText("csv", groups, at);
        assert.equal(text, "\"kind\",\"method\",\"host\",\"path\",\"count\",\"last\"\r\n\"usage-reports\",\"POST\",\"discord.com\",\"/api/*/science\",\"3\",\"2026-10-26T03:14:02.000Z\"\r\n\"host-rules\",\"GET\",\"m.stripe.com\",\"/\",\"1\",\"2026-10-26T03:14:07.000Z\"\r\n");
    });

    it("makes a cell harmless to a spreadsheet and doubles a quote", () => {
        const odd: BlockGroup[] = [{ kind: "host-rules", method: "GET", host: "=cmd.test", path: "/\"x\"", count: 1, agoMs: 0 }];
        const line = exportText("csv", odd, at).split("\r\n")[1]!;
        assert.ok(line.includes("\"'=cmd.test\""));
        assert.ok(line.includes("\"/\"\"x\"\"\""));
        for (const lead of ["+", "-", "@"]) assert.ok(exportText("csv", [{ ...odd[0]!, host: `${lead}x.test` }], at).includes(`"'${lead}x.test"`), lead);
        assert.ok(exportText("csv", [{ ...odd[0]!, host: "ok.test" }], at).includes("\"ok.test\""), "a plain value is left as it is");
    });

    it("never carries a query, a header, a body or a token, and says so", () => {
        assert.match(EXPORT_NOTE, /No query values/);
        assert.match(EXPORT_NOTE, /no tokens/);
        for (const format of ["json", "csv"] as const) assert.doesNotMatch(exportText(format, groups, at), /authorization|bearer|cookie|\?/i);
    });

    it("writes only the header for an empty list, and an empty list of blocks in JSON", () => {
        assert.equal(exportText("csv", [], at), "\"kind\",\"method\",\"host\",\"path\",\"count\",\"last\"\r\n");
        assert.deepEqual(JSON.parse(exportText("json", [], at)).blocks, []);
    });

    it("never puts a time before 1970 when an age is larger than the time itself", () => {
        const old: BlockGroup[] = [{ ...groups[0]!, agoMs: 10 ** 15 }];
        assert.equal(JSON.parse(exportText("json", old, 5))?.blocks[0].last, "1970-01-01T00:00:00.000Z");
    });
});

describe("reading the list of blocks in the page", () => {
    const good = () => ({ version: 4, groups: [{ kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 2, agoMs: 1500 }] });

    it("rebuilds a good answer field by field", () => {
        const input = good() as Loose;
        input.extra = 1;
        input.groups[0].secret = "x";
        assert.deepEqual(parseBlockLog(input), good());
    });

    it("accepts a root path and an empty list", () => {
        assert.deepEqual(parseBlockLog({ version: 0, groups: [] }), { version: 0, groups: [] });
        const input = good();
        input.groups[0]!.path = "/";
        assert.equal(parseBlockLog(input)!.groups[0]!.path, "/");
    });

    it("gives null for anything that is not the expected shape", () => {
        for (const value of [null, undefined, 1, "x", [], {}, { version: 1 }, { groups: [] }, { version: -1, groups: [] }, { version: 1.5, groups: [] }, { version: "1", groups: [] }, { version: 1, groups: {} }]) {
            assert.equal(parseBlockLog(value), null, JSON.stringify(value));
        }
        const bad = (change: (group: Loose) => void) => { const input = good() as Loose; change(input.groups[0]); return parseBlockLog(input); };
        assert.equal(bad(g => { g.kind = "other"; }), null, "kind");
        assert.equal(bad(g => { g.method = "post"; }), null, "method case");
        assert.equal(bad(g => { g.method = 5; }), null, "method type");
        assert.equal(bad(g => { g.method = "A".repeat(13); }), null, "method length");
        assert.equal(bad(g => { g.host = "Upper.test"; }), null, "host case");
        assert.equal(bad(g => { g.host = "a b.test"; }), null, "host space");
        assert.equal(bad(g => { g.host = ""; }), null, "host empty");
        assert.equal(bad(g => { g.host = "a".repeat(254); }), null, "host length");
        assert.equal(bad(g => { g.host = 5; }), null, "host type");
        assert.equal(bad(g => { g.path = "/api?x=1"; }), null, "a query");
        assert.equal(bad(g => { g.path = "api"; }), null, "no leading slash");
        assert.equal(bad(g => { g.path = "/Upper"; }), null, "path case");
        assert.equal(bad(g => { g.path = "/a/b/c/d/e/f/g/h/i"; }), null, "path parts");
        assert.equal(bad(g => { g.path = "/" + "a".repeat(25); }), null, "path part length");
        assert.equal(bad(g => { g.path = ""; }), null, "path empty");
        assert.equal(bad(g => { g.path = 5; }), null, "path type");
        assert.equal(bad(g => { g.count = 0; }), null, "count zero");
        assert.equal(bad(g => { g.count = 1.5; }), null, "count fraction");
        assert.equal(bad(g => { g.count = "2"; }), null, "count type");
        assert.equal(bad(g => { g.agoMs = -1; }), null, "age negative");
        assert.equal(bad(g => { g.agoMs = 1.5; }), null, "age fraction");
        assert.equal(bad(g => { g.agoMs = "1"; }), null, "age type");
        assert.equal(bad(g => { Object.keys(g).forEach(key => { delete g[key]; }); }), null, "empty group");
        const notAGroup = good() as Loose;
        notAGroup.groups = [null];
        assert.equal(parseBlockLog(notAGroup), null);
    });

    it("limits the number of groups to two hundred", () => {
        assert.equal(BLOCK_MAX_GROUPS, 200);
        const group = good().groups[0]!;
        assert.equal(parseBlockLog({ version: 1, groups: Array.from({ length: BLOCK_MAX_GROUPS }, () => group) })!.groups.length, BLOCK_MAX_GROUPS);
        assert.equal(parseBlockLog({ version: 1, groups: Array.from({ length: BLOCK_MAX_GROUPS + 1 }, () => group) }), null);
    });

    it("keeps every kind the firewall and the token guard can name, and nothing else", () => {
        for (const kind of ["usage-reports", "metrics", "crash-reports", "telemetry-host", "host-rules", "token-stripped"]) {
            const input = good();
            input.groups[0]!.kind = kind;
            assert.equal(parseBlockLog(input)!.groups[0]!.kind, kind);
        }
    });
});
