/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeFirewall } from "../src/main/firewall";
import { makeNativeFetch } from "../src/main/nativeFetch";
import type { NativeResponse } from "../src/main/nativeHost";
import { makeHostMatcher } from "../src/shared/hostRules";

const answer = (status = 200): NativeResponse => ({
    status, ok: status < 400, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "", json: async () => ({})
});

const init = (extra: Record<string, unknown> = {}) => ({ method: "GET", redirect: "manual" as const, signal: AbortSignal.timeout(1000), ...extra });

function setup(options: { blocked?: string[]; blockedByThrows?: boolean; onBlockedThrows?: boolean; } = {}) {
    const sent: Array<{ url: string; init: unknown; }> = [];
    const noted: Array<[string, unknown, string]> = [];
    const fetch = makeNativeFetch({
        fetch: async (url, requestInit) => { sent.push({ url, init: requestInit }); return answer(); },
        blockedBy: host => {
            if (options.blockedByThrows) throw new Error("matcher broke");
            return options.blocked?.includes(host) ? { host } : null;
        },
        onBlocked: (ruleHost, method, pathname) => {
            if (options.onBlockedThrows) throw new Error("counter broke");
            noted.push([ruleHost, method, pathname]);
        }
    });
    return { fetch, sent, noted };
}

describe("the network call of a plugin's main-process code", () => {
    it("passes a request that no rule covers to the real call, unchanged", async () => {
        const t = setup({ blocked: ["blocked.test"] });
        const requestInit = init({ headers: { Accept: "x" } });
        const response = await t.fetch("https://ok.test/a?b=1", requestInit);
        assert.equal(response.status, 200);
        assert.deepEqual(t.sent, [{ url: "https://ok.test/a?b=1", init: requestInit }]);
        assert.deepEqual(t.noted, []);
    });

    it("stops a request to a site the owner blocked, before anything is sent, and says which site", async () => {
        const t = setup({ blocked: ["blocked.test"] });
        await assert.rejects(() => t.fetch("https://blocked.test/secret/path?q=1", init({ method: "POST" })), /blocked\.test is on the list of sites you blocked/);
        assert.deepEqual(t.sent, []);
    });

    it("matches on the host name alone, so a port does not get a request past the rule", async () => {
        const t = setup({ blocked: ["blocked.test"] });
        await assert.rejects(() => t.fetch("https://blocked.test:8443/x", init()), /on the list of sites you blocked/);
        assert.deepEqual(t.sent, []);
    });

    it("tells the firewall which rule stopped it, with the method and the path only, never the query", async () => {
        const t = setup({ blocked: ["blocked.test"] });
        await assert.rejects(() => t.fetch("https://blocked.test/secret/path?token=abc", init({ method: "POST" })));
        assert.deepEqual(t.noted, [["blocked.test", "POST", "/secret/path"]]);
        assert.ok(!JSON.stringify(t.noted).includes("abc"));
    });

    it("asks about the host of the address, so the check follows each redirect the host makes", async () => {
        const t = setup({ blocked: ["next.test"] });
        await t.fetch("https://first.test/", init());
        await assert.rejects(() => t.fetch("https://next.test/landing", init()));
        assert.deepEqual(t.sent.map(call => call.url), ["https://first.test/"]);
    });

    it("refuses an address that is not an address, with the host's own words", async () => {
        const t = setup();
        await assert.rejects(() => t.fetch("not an address", init()), /Invalid URL\./);
        assert.deepEqual(t.sent, []);
    });

    it("lets the request go on when the check itself fails, like the firewall", async () => {
        const t = setup({ blockedByThrows: true });
        assert.equal((await t.fetch("https://any.test/", init())).status, 200);
        assert.equal(t.sent.length, 1);
    });

    it("still stops the request when only the counting fails", async () => {
        const t = setup({ blocked: ["blocked.test"], onBlockedThrows: true });
        await assert.rejects(() => t.fetch("https://blocked.test/", init()), /on the list of sites you blocked/);
        assert.deepEqual(t.sent, []);
    });

    it("keeps the error of the real call, and the answer of a redirect as it came", async () => {
        const failing = makeNativeFetch({ fetch: async () => { throw new Error("offline"); }, blockedBy: () => null, onBlocked: () => undefined });
        await assert.rejects(() => failing("https://x.test/", init()), /offline/);
        const redirect = makeNativeFetch({ fetch: async () => answer(302), blockedBy: () => null, onBlocked: () => undefined });
        assert.equal((await redirect("https://x.test/", init())).status, 302);
    });
});

describe("a request of a plugin that the owner's rule stops, in the firewall", () => {
    it("is counted as one cancelled by the owner's rules and listed with the rule's host, the method and the path shape", () => {
        let clock = 9000;
        const firewall = makeFirewall({ now: () => clock, enabled: () => true });
        firewall.noteOwnBlock("blocked.test", "post", "/api/12345/search");
        assert.deepEqual(firewall.status().cancelled["host-rules"], 1);
        assert.equal(firewall.status().total, 1);
        assert.deepEqual(firewall.log(), [{ at: 9000, shield: "host-rules", method: "POST", host: "blocked.test", path: "/api/*/search" }]);
        clock += 10;
        firewall.noteOwnBlock("blocked.test", undefined, "/");
        assert.equal(firewall.status().cancelled["host-rules"], 2);
        assert.deepEqual(firewall.log().map(entry => [entry.method, entry.path, entry.at]), [["POST", "/api/*/search", 9000], ["?", "/", 9010]]);
    });

    it("does not touch the counters of the shields", () => {
        const firewall = makeFirewall({ now: () => 1, enabled: () => true });
        firewall.noteOwnBlock("blocked.test", "GET", "/");
        const { "host-rules": own, ...others } = firewall.status().cancelled;
        assert.equal(own, 1);
        assert.ok(Object.values(others).every(count => count === 0));
    });

    it("works with the owner's real matcher and keeps the log bounded", () => {
        const matcher = makeHostMatcher([{ id: "r1", host: "blocked.test", subdomains: true, action: "block", reason: "", created: 0 }]);
        const firewall = makeFirewall({ now: () => 1, enabled: () => true, maxLog: 2 });
        const fetch = makeNativeFetch({
            fetch: async () => answer(),
            blockedBy: host => matcher(host),
            onBlocked: (ruleHost, method, pathname) => { firewall.noteOwnBlock(ruleHost, method, pathname); }
        });
        return Promise.all([1, 2, 3].map(i => assert.rejects(() => fetch(`https://deep.blocked.test/p${i}`, init())))).then(() => {
            assert.equal(firewall.status().cancelled["host-rules"], 3);
            assert.equal(firewall.log().length, 2);
            assert.ok(firewall.log().every(entry => entry.host === "blocked.test"), "the rule's host, not the sub-host asked");
        });
    });
});
