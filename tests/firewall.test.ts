/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FIREWALL_NAME, hostIs, LOG_DEFAULT_ENTRIES, makeFirewall, Rule, RULES, ShieldSwitch } from "../src/main/firewall";
import type { RequestDetails } from "../src/main/requestHub";

const get = (url: string, extra: Partial<RequestDetails> = {}): RequestDetails => ({ url, method: "GET", resourceType: "xhr", ...extra });

function setup(on: Partial<Record<ShieldSwitch, boolean>> = {}, extra: { maxLog?: number; rules?: readonly Rule[]; enabled?: (name: ShieldSwitch) => boolean; blockedBy?: (hostname: string) => { host: string; } | null; } = {}) {
    let clock = 5000;
    const asked: ShieldSwitch[] = [];
    const firewall = makeFirewall({
        now: () => clock,
        enabled: extra.enabled ?? (name => { asked.push(name); return on[name] ?? true; }),
        ...(extra.maxLog === undefined ? {} : { maxLog: extra.maxLog }),
        ...(extra.rules ? { rules: extra.rules } : {}),
        ...(extra.blockedBy ? { blockedBy: extra.blockedBy } : {})
    });
    const see = (details: RequestDetails) => firewall.handler.beforeRequest!(details);
    return { firewall, see, asked, tick: (ms: number) => { clock += ms; } };
}

const CANCEL = { cancel: true };

describe("the host test", () => {
    it("accepts the host and its subdomains, and nothing that only contains the name", () => {
        assert.equal(hostIs("sentry.io", "sentry.io"), true);
        assert.equal(hostIs("o1.ingest.sentry.io", "sentry.io"), true);
        assert.equal(hostIs("notsentry.io", "sentry.io"), false);
        assert.equal(hostIs("sentry.io.evil.test", "sentry.io"), false);
        assert.equal(hostIs("evil-sentry.io", "sentry.io"), false);
        assert.equal(hostIs("sentry.io", "o1.sentry.io"), false);
    });
});

describe("the shields", () => {
    it("is a handler of the hub named firewall that only answers before a request", () => {
        const t = setup();
        assert.equal(t.firewall.handler.name, FIREWALL_NAME);
        assert.equal(t.firewall.handler.beforeSendHeaders, undefined);
    });

    it("cancels the usage reports that were seen (science) and the ones that were not (track), on every Discord host", () => {
        const t = setup();
        for (const url of ["https://canary.discord.com/api/v9/science", "https://discord.com/api/v9/track", "https://ptb.discord.com/api/v10/science/", "https://discord.com/api/v9/science?source=x"]) {
            assert.deepEqual(t.see(get(url, { method: "POST" })), CANCEL, url);
        }
        assert.equal(t.firewall.status().cancelled["usage-reports"], 4);
    });

    it("cancels metrics, with or without v2", () => {
        const t = setup();
        assert.deepEqual(t.see(get("https://canary.discord.com/api/v9/metrics", { method: "POST" })), CANCEL);
        assert.deepEqual(t.see(get("https://discord.com/api/v9/metrics/v2")), CANCEL);
        assert.equal(t.firewall.status().cancelled.metrics, 2);
    });

    it("cancels Sentry on its parsed host, however the address looks", () => {
        const t = setup();
        assert.deepEqual(t.see(get("https://sentry.io/api/123/envelope/", { method: "POST" })), CANCEL);
        assert.deepEqual(t.see(get("https://o99.ingest.sentry.io/api/1/store/")), CANCEL);
        assert.equal(t.firewall.status().cancelled["crash-reports"], 2);
    });

    it("cancels Discord's telemetry ping whatever random label it carries", () => {
        const t = setup();
        assert.deepEqual(t.see(get("https://idt-krdy0j-mvo6hdlx.loc-en-us.chk-webapp.res-ok.dur-0.v1.dc-telemetry.net/", { resourceType: "other" })), CANCEL);
        assert.deepEqual(t.see(get("https://dc-telemetry.net/")), CANCEL);
        assert.equal(t.firewall.status().cancelled["telemetry-host"], 2);
    });

    it("lets through addresses that only look similar", () => {
        const t = setup();
        for (const url of [
            "https://discord.com/api/v9/tracking", "https://discord.com/api/v9/science-fair", "https://discord.com/api/v9/sciences", "https://discord.com/api/v9/users/science",
            "https://discord.com/api/science", "https://discord.com/api/v9/x/science", "https://discord.com/api/v9/metricsx", "https://discord.com/api/v9/metrics/v3",
            "https://discord.com/api/vx/science", "https://discord.com/api/v123/science", "https://discord.com/science",
            "https://notdiscord.com/api/v9/science", "https://discord.com.evil.test/api/v9/science", "https://evil.test/api/v9/science",
            "https://evil.test/?u=sentry.io", "https://evil.test/sentry.io/x", "https://sentry.io.evil.test/", "https://notsentry.io/",
            "https://dc-telemetry.net.evil.test/", "https://notdc-telemetry.net/", "https://evil.test/dc-telemetry.net",
            "https://discord.com/x/api/v9/science", "https://discord.com/x/api/v9/metrics", "https://discord.com/api/v123/metrics", "https://discord.com/api/v/metrics",
            "https://evil.test/api/v9/metrics", "https://notdiscord.com/api/v9/metrics", "https://discord.com.evil.test/api/v9/metrics", "https://evil.test/api/v9/track",
            "https://cdn.discordapp.com/avatars/1/2.png", "https://canary.discord.com/api/v9/users/@me", "https://js.stripe.com/v3/", "https://m.stripe.com/6"
        ]) {
            assert.equal(t.see(get(url)), undefined, url);
        }
        assert.equal(t.firewall.status().total, 0);
    });

    it("only judges web addresses and ignores what it cannot read", () => {
        const t = setup();
        for (const url of ["not an address", "wss://discord.com/api/v9/science", "ftp://discord.com/api/v9/science", "file:///api/v9/science", "data:text/plain,sentry.io", ""]) {
            assert.equal(t.see(get(url)), undefined, url);
        }
        assert.equal(t.firewall.status().total, 0);
    });

    it("does not look at the method, so a request of any kind to a shielded address is cancelled", () => {
        const t = setup();
        assert.deepEqual(t.see({ url: "https://discord.com/api/v9/science" }), CANCEL);
        assert.deepEqual(t.see(get("https://discord.com/api/v9/science", { method: "OPTIONS" })), CANCEL);
    });
});

describe("the switches", () => {
    it("lets usage reports, metrics and the telemetry ping through when analytics is off, and Sentry still gets cancelled", () => {
        const t = setup({ disableAnalytics: false });
        assert.equal(t.see(get("https://discord.com/api/v9/science")), undefined);
        assert.equal(t.see(get("https://discord.com/api/v9/metrics")), undefined);
        assert.equal(t.see(get("https://x.dc-telemetry.net/")), undefined);
        assert.deepEqual(t.see(get("https://sentry.io/x")), CANCEL);
        assert.equal(t.firewall.status().total, 1);
    });

    it("lets Sentry through when crash reports is off, and the rest still gets cancelled", () => {
        const t = setup({ disableCrashReports: false });
        assert.equal(t.see(get("https://sentry.io/x")), undefined);
        assert.deepEqual(t.see(get("https://discord.com/api/v9/science")), CANCEL);
    });

    it("asks the switch that belongs to the rule, only when an address matched", () => {
        const t = setup();
        t.see(get("https://example.test/"));
        assert.deepEqual(t.asked, []);
        t.see(get("https://sentry.io/x"));
        t.see(get("https://discord.com/api/v9/science"));
        assert.deepEqual(t.asked, ["disableCrashReports", "disableAnalytics"]);
    });

    it("lets the request through when asking the switch fails or does not answer exactly true", () => {
        for (const enabled of [(() => { throw new Error("no settings"); }) as () => boolean, (() => undefined) as unknown as () => boolean, (() => "yes") as unknown as () => boolean, (() => 1) as unknown as () => boolean]) {
            const t = setup({}, { enabled });
            assert.equal(t.see(get("https://discord.com/api/v9/science")), undefined);
            assert.equal(t.firewall.status().total, 0);
        }
    });

    it("lets the request through, and goes on with the next rule check, when a rule test throws", () => {
        const rules: Rule[] = [
            { id: "metrics", reason: "boom", evidence: "seen", switch: "disableAnalytics", host: "a.test", matches: () => { throw new Error("boom"); } },
            ...RULES
        ];
        const t = setup({}, { rules });
        assert.deepEqual(t.see(get("https://discord.com/api/v9/science")), CANCEL);
        assert.equal(t.see(get("https://example.test/")), undefined);
    });
});

describe("the counters and the log", () => {
    it("counts per shield, and gives copies", () => {
        const t = setup();
        t.see(get("https://discord.com/api/v9/science"));
        t.see(get("https://discord.com/api/v9/metrics"));
        t.see(get("https://discord.com/api/v9/metrics"));
        const status = t.firewall.status();
        assert.deepEqual(status.cancelled, { "usage-reports": 1, metrics: 2, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 });
        assert.equal(status.total, 3);
        status.cancelled.metrics = 999;
        assert.equal(t.firewall.status().cancelled.metrics, 2);
    });

    it("keeps in the log the time, the shield, the method, the rule's host and the shape of the path, and nothing else", () => {
        const t = setup();
        t.tick(250);
        t.see(get("https://canary.discord.com/api/v9/science?token=SECRET&user=123456789012345678", { method: "post", requestHeaders: { Authorization: "SECRET-TOKEN" } }));
        t.see(get("https://idt-abc123-def456.loc-en-us.chk-webapp.res-ok.dur-0.v1.dc-telemetry.net/", { resourceType: "other" }));
        const log = t.firewall.log();
        assert.deepEqual(log[0], { at: 5250, shield: "usage-reports", method: "POST", host: "discord.com", path: "/api/v9/science" });
        assert.deepEqual(log[1], { at: 5250, shield: "telemetry-host", method: "GET", host: "dc-telemetry.net", path: "/" });
        assert.doesNotMatch(JSON.stringify(log), /SECRET|123456789012345678|token|user|Authorization|idt-abc123|chk-webapp|canary/);
    });

    it("stores only a plain word as the method", () => {
        const t = setup();
        t.see({ url: "https://discord.com/api/v9/science", method: "POST /x?token=1" });
        assert.equal(t.firewall.log()[0]!.method, "?");
    });

    it("is bounded: the oldest entries go, the counters keep counting", () => {
        const t = setup({}, { maxLog: 3 });
        for (let i = 0; i < 10; i++) { t.tick(1); t.see(get("https://discord.com/api/v9/science")); }
        const log = t.firewall.log();
        assert.equal(log.length, 3);
        assert.deepEqual(log.map(entry => entry.at), [5008, 5009, 5010]);
        assert.equal(t.firewall.status().total, 10);
    });

    it("keeps 500 entries by default and never fewer than one", () => {
        assert.equal(LOG_DEFAULT_ENTRIES, 500);
        const t = setup();
        for (let i = 0; i < 501; i++) t.see(get("https://discord.com/api/v9/science"));
        assert.equal(t.firewall.log().length, 500);
        const small = setup({}, { maxLog: 0 });
        small.see(get("https://discord.com/api/v9/science"));
        small.see(get("https://discord.com/api/v9/science"));
        assert.equal(small.firewall.log().length, 1);
    });

    it("hands out copies of the log, so a reader cannot change it", () => {
        const t = setup();
        t.see(get("https://discord.com/api/v9/science"));
        t.firewall.log()[0]!.shield = "metrics";
        assert.equal(t.firewall.log()[0]!.shield, "usage-reports");
    });

    it("does not count or log what it lets through", () => {
        const t = setup({ disableAnalytics: false });
        t.see(get("https://discord.com/api/v9/science"));
        assert.equal(t.firewall.log().length, 0);
        assert.equal(t.firewall.status().total, 0);
    });
});

describe("the rule table", () => {
    it("has one rule per shield, each with a reason and the evidence it stands on", () => {
        assert.deepEqual(RULES.map(rule => rule.id), ["usage-reports", "metrics", "crash-reports", "telemetry-host"]);
        for (const rule of RULES) {
            assert.ok(rule.reason.length > 20, rule.id);
            assert.ok(["seen", "partly", "not-seen"].includes(rule.evidence), rule.id);
            assert.match(rule.host, /^[a-z.-]+$/);
        }
        assert.equal(RULES.find(rule => rule.id === "telemetry-host")!.evidence, "seen");
        assert.equal(RULES.find(rule => rule.id === "crash-reports")!.evidence, "not-seen");
    });

    it("ties the shields to NoTrack's two switches", () => {
        const of = (id: string) => RULES.find(rule => rule.id === id)!.switch;
        assert.equal(of("usage-reports"), "disableAnalytics");
        assert.equal(of("metrics"), "disableAnalytics");
        assert.equal(of("telemetry-host"), "disableAnalytics");
        assert.equal(of("crash-reports"), "disableCrashReports");
    });
});

describe("the owner's host rules inside the firewall", () => {
    const blockedBy = (hostname: string) => (hostname === "m.stripe.com" || hostname.endsWith(".m.stripe.com") ? { host: "m.stripe.com" } : null);

    it("cancels a request to a host the owner blocked, counts it apart and logs the rule's host", () => {
        const t = setup({}, { blockedBy });
        assert.deepEqual(t.see(get("https://m.stripe.com/6?secret=1", { method: "POST" })), CANCEL);
        assert.deepEqual(t.see(get("https://x.m.stripe.com/a/b/c/d")), CANCEL);
        const status = t.firewall.status();
        assert.equal(status.cancelled["host-rules"], 2);
        assert.equal(status.total, 2);
        assert.equal(status.cancelled["telemetry-host"], 0);
        assert.deepEqual(t.firewall.log()[0], { at: 5000, shield: "host-rules", method: "POST", host: "m.stripe.com", path: "/*" });
        assert.equal(t.firewall.log()[1]!.host, "m.stripe.com");
        assert.doesNotMatch(JSON.stringify(t.firewall.log()), /secret|x\.m/);
    });

    it("works whatever NoTrack's switches say", () => {
        const t = setup({ disableAnalytics: false, disableCrashReports: false }, { blockedBy });
        assert.deepEqual(t.see(get("https://m.stripe.com/6")), CANCEL);
        assert.deepEqual(t.asked, [], "the switches are not even asked");
    });

    it("comes before the shields, so a host that both match counts as the owner's rule", () => {
        const t = setup({}, { blockedBy: hostname => (hostname === "sentry.io" ? { host: "sentry.io" } : null) });
        assert.deepEqual(t.see(get("https://sentry.io/x")), CANCEL);
        assert.equal(t.firewall.status().cancelled["host-rules"], 1);
        assert.equal(t.firewall.status().cancelled["crash-reports"], 0);
    });

    it("leaves other hosts to the shields, and to Discord", () => {
        const t = setup({}, { blockedBy });
        assert.equal(t.see(get("https://js.stripe.com/v3/")), undefined);
        assert.deepEqual(t.see(get("https://discord.com/api/v9/science")), CANCEL);
        assert.equal(t.firewall.status().cancelled["host-rules"], 0);
    });

    it("lets the request through when looking up the rule fails, and the shields still work", () => {
        const t = setup({}, { blockedBy: () => { throw new Error("boom"); } });
        assert.equal(t.see(get("https://m.stripe.com/6")), undefined);
        assert.deepEqual(t.see(get("https://discord.com/api/v9/science")), CANCEL);
    });

    it("only judges web addresses", () => {
        const t = setup({}, { blockedBy: () => ({ host: "x.test" }) });
        assert.equal(t.see(get("wss://m.stripe.com/")), undefined);
        assert.equal(t.see(get("not an address")), undefined);
        assert.equal(t.firewall.status().total, 0);
    });

    it("does nothing without rules", () => {
        const t = setup();
        assert.equal(t.see(get("https://m.stripe.com/6")), undefined);
    });
});
