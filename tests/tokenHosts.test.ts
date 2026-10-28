/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostAllowed, normalizePattern, tokenHostsFromRegistry, TokenHostsInput } from "../src/main/tokenHosts";

interface P { id: string; core?: boolean; enabledByDefault?: boolean; dependencies?: string[]; token?: boolean; hosts?: unknown[]; permissions?: unknown; }
const plugin = (p: P) => ({
    id: p.id, core: p.core ?? false, enabledByDefault: p.enabledByDefault ?? true, dependencies: p.dependencies ?? [],
    permissions: p.permissions ?? { token: p.token ?? false, network: (p.hosts ?? []).map(host => ({ host, from: "main", why: "x" })) }
});
const registry = (plugins: unknown[], startOrder?: string[]) => JSON.stringify({ plugins, startOrder: startOrder ?? plugins.map(p => (p as { id: string; }).id) });
const input = (plugins: unknown[], extra: Partial<TokenHostsInput> = {}): TokenHostsInput => ({ registryText: registry(plugins), safeMode: false, quarantine: [], choices: {}, ...extra });

describe("a declared host", () => {
    it("is a plain lowercase name or a star and a domain", () => {
        assert.equal(normalizePattern("API.Example.com"), "api.example.com");
        assert.equal(normalizePattern(" *.Example.com "), "*.example.com");
        for (const bad of ["*", "*.", "*.*.com", "https://example.com", "example.com/x", "example.com:8080", "", "x", 5, null, undefined, "*example.com", "ex*ample.com", "127.0.0.1", "*.127.0.0.1"]) assert.equal(normalizePattern(bad), null, JSON.stringify(bad));
    });

    it("matches the exact name, or the names under a star domain and never the domain itself", () => {
        assert.equal(hostAllowed("api.example.com", ["api.example.com"]), true);
        assert.equal(hostAllowed("x.api.example.com", ["api.example.com"]), false, "no subdomains without a star");
        assert.equal(hostAllowed("example.com", ["api.example.com"]), false);
        assert.equal(hostAllowed("a.example.com", ["*.example.com"]), true);
        assert.equal(hostAllowed("a.b.example.com", ["*.example.com"]), true);
        assert.equal(hostAllowed("example.com", ["*.example.com"]), false);
        assert.equal(hostAllowed("badexample.com", ["*.example.com"]), false);
        assert.equal(hostAllowed("example.com.evil.test", ["*.example.com"]), false);
        assert.equal(hostAllowed("a.example.com", []), false);
    });
});

describe("which hosts may get the token", () => {
    it("is nobody when no plugin asks for the token", () => {
        const result = tokenHostsFromRegistry(input([plugin({ id: "Core", core: true }), plugin({ id: "A", hosts: ["a.example.com"] })]));
        assert.deepEqual(result, { patterns: [], problems: [] });
    });

    it("takes the hosts of an enabled plugin that declares the token, and no others", () => {
        const result = tokenHostsFromRegistry(input([
            plugin({ id: "A", token: true, hosts: ["api.a.test", "*.cdn.a.test"] }),
            plugin({ id: "B", token: false, hosts: ["b.test"] }),
            plugin({ id: "C", token: true, hosts: ["c.test"], enabledByDefault: false })
        ]));
        assert.deepEqual(result.patterns, ["api.a.test", "*.cdn.a.test"]);
        assert.deepEqual(result.problems, []);
    });

    it("follows what the owner chose: a plugin switched on gets its hosts, one switched off loses them", () => {
        const plugins = [plugin({ id: "A", token: true, hosts: ["a.test"] }), plugin({ id: "C", token: true, hosts: ["c.test"], enabledByDefault: false })];
        assert.deepEqual(tokenHostsFromRegistry(input(plugins, { choices: { C: true } })).patterns, ["a.test", "c.test"]);
        assert.deepEqual(tokenHostsFromRegistry(input(plugins, { choices: { A: false } })).patterns, []);
    });

    it("gives nothing in safe mode (only core plugins run) and nothing for a quarantined plugin", () => {
        const plugins = [plugin({ id: "A", token: true, hosts: ["a.test"] }), plugin({ id: "Core", core: true, token: true, hosts: ["core.test"] })];
        assert.deepEqual(tokenHostsFromRegistry(input(plugins, { safeMode: true })).patterns, ["core.test"]);
        assert.deepEqual(tokenHostsFromRegistry(input(plugins, { quarantine: ["A"] })).patterns, ["core.test"]);
    });

    it("counts the hosts of a plugin that runs only because another one needs it", () => {
        const plugins = [plugin({ id: "Lib", token: true, hosts: ["lib.test"], enabledByDefault: false }), plugin({ id: "A", dependencies: ["Lib"] })];
        assert.deepEqual(tokenHostsFromRegistry(input(plugins, { choices: { A: true } })).patterns, ["lib.test"]);
    });

    it("lists a host once, and drops one that is not a plain host name, saying which plugin", () => {
        const result = tokenHostsFromRegistry(input([
            plugin({ id: "A", token: true, hosts: ["a.test", "A.test", "*", "https://x.test", 5] }),
            plugin({ id: "B", token: true, hosts: ["a.test"] })
        ]));
        assert.deepEqual(result.patterns, ["a.test"]);
        assert.equal(result.problems.length, 3);
        assert.match(result.problems[0]!, /plugin A declares a host that is not a plain host name/);
    });

    it("needs the token to be exactly true", () => {
        for (const token of ["true", 1, "yes", {}, [], null]) {
            const result = tokenHostsFromRegistry(input([plugin({ id: "A", permissions: { token, network: [{ host: "a.test" }] } })]));
            assert.deepEqual(result.patterns, [], JSON.stringify(token));
        }
    });

    it("gives nobody the token, and says why, when the registry is missing, broken or odd", () => {
        for (const text of ["", "not json", "[]", "null", "{}", JSON.stringify({ plugins: [] }), JSON.stringify({ plugins: {}, startOrder: [] }), JSON.stringify({ plugins: [], startOrder: [1] })]) {
            const result = tokenHostsFromRegistry({ ...input([]), registryText: text });
            assert.deepEqual(result.patterns, [], text.slice(0, 20));
            assert.equal(result.problems.length, 1, text.slice(0, 20));
            assert.match(result.problems[0]!, /no plugin may receive the token/);
        }
    });

    it("skips an entry that is not a plugin, and an odd permissions shape, without failing", () => {
        const odd = [5, null, "x", { id: 7 }, { id: "A", permissions: 5 }, { id: "B", permissions: { token: true, network: "no" } }, { id: "C", permissions: { token: true, network: [5, null, { host: "c.test" }] } }];
        const result = tokenHostsFromRegistry({ registryText: JSON.stringify({ plugins: odd, startOrder: ["A", "B", "C"] }), safeMode: false, quarantine: [], choices: {} });
        assert.deepEqual(result.patterns, ["c.test"]);
    });
});
