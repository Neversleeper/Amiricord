/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DNS_TEXT_MAX, emptyNetworkCounts, NETWORK_KINDS, parseDnsText, parseFirewallAnswer, parseNetworkCounts, SHIELD_IDS } from "../src/shared/shields";

const good = { cancelled: { "usage-reports": 4, metrics: 0, "crash-reports": 1, "telemetry-host": 2, "host-rules": 0, "token-stripped": 0 } };

describe("the counters the page may read", () => {
    it("rebuilds them field by field", () => {
        assert.deepEqual(parseNetworkCounts(good), good.cancelled);
        assert.deepEqual(parseNetworkCounts({ ...good, extra: "ignored" }), good.cancelled);
        assert.deepEqual(parseNetworkCounts({ cancelled: { ...good.cancelled, sneaky: 1 } }), good.cancelled);
    });

    it("starts at zero for every shield and for the owner's host rules", () => {
        assert.deepEqual([...NETWORK_KINDS], [...SHIELD_IDS, "host-rules", "token-stripped"]);
        assert.deepEqual(Object.keys(emptyNetworkCounts()), [...NETWORK_KINDS]);
        assert.ok(Object.values(emptyNetworkCounts()).every(count => count === 0));
    });

    it("refuses anything that is not plain counts", () => {
        for (const value of [null, undefined, 3, "x", [], {}, { cancelled: null }, { cancelled: [] }, { cancelled: "x" },
            { cancelled: { ...good.cancelled, metrics: -1 } }, { cancelled: { ...good.cancelled, metrics: 1.5 } }, { cancelled: { ...good.cancelled, metrics: "1" } },
            { cancelled: { ...good.cancelled, metrics: NaN } }, { cancelled: { ...good.cancelled, metrics: Infinity } }, { cancelled: { ...good.cancelled, metrics: 2 ** 60 } },
            { cancelled: { "usage-reports": 1 } }]) {
            assert.equal(parseNetworkCounts(value), null, JSON.stringify(value));
        }
    });

    it("does not let a count reach through the prototype", () => {
        const sneaky = { cancelled: Object.create({ "usage-reports": 1, metrics: 1, "crash-reports": 1, "telemetry-host": 1, "host-rules": 0, "token-stripped": 0 }) };
        assert.equal(parseNetworkCounts(sneaky), null);
    });
});

describe("the encrypted DNS line and the whole answer", () => {
    it("keeps at most 300 characters of the line", () => {
        assert.equal(DNS_TEXT_MAX, 300);
        assert.equal(parseDnsText("x".repeat(300)).length, 300);
        assert.equal(parseDnsText("x".repeat(301)).length, 300);
    });

    it("keeps plain printable text and drops the rest, and cuts a long line", () => {
        assert.equal(parseDnsText("Configured: Quad9, automatic, answered in 38 ms"), "Configured: Quad9, automatic, answered in 38 ms");
        assert.equal(parseDnsText("a\u0000b\nc\u001bd\u00e9e"), "abcde");
        assert.equal(parseDnsText("x".repeat(DNS_TEXT_MAX + 50)).length, DNS_TEXT_MAX);
        for (const value of [undefined, null, 5, {}, [], true]) assert.equal(parseDnsText(value), "");
    });

    it("rebuilds the counters and the line together, and refuses an answer whose counters are not plain counts", () => {
        const whole = { cancelled: { "usage-reports": 1, metrics: 2, "crash-reports": 3, "telemetry-host": 4, "host-rules": 5, "token-stripped": 6 }, dns: "Off" };
        assert.deepEqual(parseFirewallAnswer(whole), { counts: whole.cancelled, dns: "Off" });
        assert.deepEqual(parseFirewallAnswer({ cancelled: whole.cancelled })!.dns, "");
        assert.equal(parseFirewallAnswer({ cancelled: { ...whole.cancelled, metrics: -1 }, dns: "Off" }), null);
        assert.equal(parseFirewallAnswer(null), null);
        assert.equal(parseFirewallAnswer("x"), null);
    });
});
