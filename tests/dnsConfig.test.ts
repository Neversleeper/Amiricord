/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { chooseDns, DNS_FILE_SCHEMA, DNS_MODES, MAX_DNS_FILE_CHARS, parseDnsConfig, serializeDnsConfig } from "../src/main/dns/config";
import { checkAddress, CUSTOM_PROVIDER, DNS_PROVIDERS, findProvider, MAX_ADDRESS_CHARS } from "../src/main/dns/providers";
import { DNS_FILE, dnsConfigPath, loadDnsConfig, saveDnsConfig } from "../src/main/dnsConfigFile";

const file = (extra: Record<string, unknown>) => JSON.stringify({ schema: 1, mode: "automatic", provider: "quad9", custom: "", ...extra });

describe("the providers", () => {
    it("are the four chosen ones, as data, and Google is not among them", () => {
        assert.deepEqual(DNS_PROVIDERS.map(p => p.id), ["quad9", "mullvad-base", "cloudflare", "adguard-unfiltered"]);
        assert.ok(!DNS_PROVIDERS.some(p => /google|opendns|control|ecs/i.test(p.id + p.name + p.address)));
        for (const p of DNS_PROVIDERS) {
            assert.match(p.id, /^[a-z0-9-]{1,40}$/);
            assert.equal(checkAddress(p.address), p.address, p.id + " passes its own check");
            assert.ok(p.note.length > 20 && p.name.length > 2);
            assert.ok(p.filters === "none" || p.filters === "malware");
        }
        assert.equal(new Set(DNS_PROVIDERS.map(p => p.id)).size, DNS_PROVIDERS.length);
        assert.equal(findProvider("quad9")!.filters, "malware");
        assert.equal(findProvider("mullvad-base")!.filters, "none");
    });

    it("are found by exact id only", () => {
        assert.equal(findProvider("Quad9"), undefined);
        assert.equal(findProvider("quad"), undefined);
        assert.equal(findProvider(undefined), undefined);
        assert.equal(findProvider(5), undefined);
        assert.equal(findProvider(CUSTOM_PROVIDER), undefined);
    });
});

describe("the address typed by hand", () => {
    it("accepts https, a plain host name or an IPv4 number, a port and a short path, and the template ending", () => {
        for (const [input, plain] of [
            ["https://dns.example.org/dns-query", "https://dns.example.org/dns-query"],
            ["  HTTPS://DNS.Example.org/dns-query  ", "https://dns.example.org/dns-query"],
            ["https://dns.example.org", "https://dns.example.org/"],
            ["https://dns.example.org:8443/q", "https://dns.example.org:8443/q"],
            ["https://192.0.2.5/dns-query", "https://192.0.2.5/dns-query"],
            ["https://dns.example.org/dns-query{?dns}", "https://dns.example.org/dns-query{?dns}"],
            ["https://dns.example.org/a/b-c_d.e~f", "https://dns.example.org/a/b-c_d.e~f"]
        ] as const) {
            assert.equal(checkAddress(input), plain, input);
        }
    });

    it("refuses an address that is not written as https:// with two slashes, and one that is too long with a short path", () => {
        for (const bad of ["https:dns.example.org/q", "https:/dns.example.org/q", "https:\\dns.example.org/q", "https//dns.example.org/q", "xhttps://dns.example.org/q"]) assert.equal(checkAddress(bad), null, bad);
        const host = Array.from({ length: 4 }, () => "a".repeat(60)).join(".") + ".test";
        assert.ok(host.length < 253);
        assert.equal(checkAddress("https://" + host + "/q"), null);
    });

    it("refuses everything else", () => {
        for (const bad of [
            "", "   ", "http://dns.example.org/q", "ftp://dns.example.org/q", "dns.example.org/q", "//dns.example.org/q", "https://",
            "https://user:pass@dns.example.org/q", "https://user@dns.example.org/q", "https://dns.example.org/q?x=1", "https://dns.example.org/q#f",
            "https://dns.example.org/q r", "https://dns.example.org/q\"x", "https://dns.example.org/q<x>", "https://dns.example.org/q\\x", "https://dns example.org/q",
            "https://localhost/q", "https://[::1]/q", "https://*.example.org/q", "https://dns.example.org:0/q", "https://dns.example.org:99999/q", "https://dns.example.org:abc/q",
            "https://999.1.1.1/q", "https://1.2.3/q", "https://01.2.3.4/q", "https://0x7f.0.0.1/q", "https://2130706433/q", "https://1.2.3.4.5/q", "https://bücher.example/q", "https://dns.example.org/q%00", "https://dns.example.org/" + "a".repeat(101),
            "https://dns.example.org/q{?dns}{?dns}", "https://dns.example.org/{x}", null, undefined, 5, {}, []
        ]) {
            assert.equal(checkAddress(bad), null, JSON.stringify(bad));
        }
    });

    it("keeps the limits of length", () => {
        const long = "https://dns.example.org/" + "a".repeat(MAX_ADDRESS_CHARS);
        assert.equal(checkAddress(long), null);
        const path = "/" + "a".repeat(99);
        assert.equal(checkAddress("https://dns.example.org" + path), "https://dns.example.org" + path);
        assert.equal(checkAddress("https://dns.example.org" + path + "a"), null);
    });
});

describe("reading dns.json", () => {
    it("reads a good file", () => {
        assert.deepEqual(parseDnsConfig(file({})), { config: { mode: "automatic", provider: "quad9", custom: "" }, problems: [] });
        assert.deepEqual(parseDnsConfig(file({ mode: "strict", provider: CUSTOM_PROVIDER, custom: "https://d.example.org/q" })).config, { mode: "strict", provider: "custom", custom: "https://d.example.org/q" });
        assert.equal(parseDnsConfig(file({ mode: "off", provider: "" })).config.mode, "off");
        assert.deepEqual([...DNS_MODES], ["off", "automatic", "strict"]);
    });

    it("says that a file is too large when it is valid but over the limit", () => {
        const parsed = parseDnsConfig(file({ pad: "x".repeat(MAX_DNS_FILE_CHARS) }));
        assert.equal(parsed.config.mode, "off");
        assert.match(parsed.problems[0]!, /too large/);
    });

    it("gives off, and says why, for anything wrong", () => {
        const wrong = [
            "", "not json", "[]", "null", "5", "{}", JSON.stringify({ schema: 2, mode: "automatic", provider: "quad9" }), file({ mode: "STRICT" }), file({ mode: "on" }), file({ mode: 1 }), file({ mode: undefined }),
            file({ provider: "Quad9" }), file({ provider: "a b" }), file({ provider: 5 }), file({ provider: "x".repeat(41) }), file({ provider: undefined }),
            "x".repeat(MAX_DNS_FILE_CHARS + 1)
        ];
        for (const text of wrong) {
            const parsed = parseDnsConfig(text);
            assert.equal(parsed.config.mode, "off", text.slice(0, 40));
            assert.equal(parsed.problems.length, 1, text.slice(0, 40));
            assert.match(parsed.problems[0]!, /encrypted DNS stays off/);
        }
    });

    it("ignores a custom address that is too long or not text, and keeps the rest", () => {
        assert.equal(parseDnsConfig(file({ custom: "x".repeat(201) })).config.custom, "");
        assert.equal(parseDnsConfig(file({ custom: 5 })).config.custom, "");
        assert.equal(parseDnsConfig(file({ custom: "x".repeat(200) })).config.custom.length, 200);
    });

    it("ignores the fields it does not know", () => {
        assert.deepEqual(parseDnsConfig(file({ extra: "x", __proto__: { mode: "strict" } })).config, { mode: "automatic", provider: "quad9", custom: "" });
    });

    it("writes text that reads back the same", () => {
        const config = { mode: "strict" as const, provider: "custom", custom: "https://d.example.org/q" };
        assert.deepEqual(parseDnsConfig(serializeDnsConfig(config)), { config, problems: [] });
        assert.equal(JSON.parse(serializeDnsConfig(config)).schema, DNS_FILE_SCHEMA);
        assert.ok(serializeDnsConfig(config).endsWith("\n"));
    });
});

describe("what to apply", () => {
    it("is nothing when the mode is off, and no problem is told", () => {
        assert.deepEqual(chooseDns({ mode: "off", provider: "quad9", custom: "" }, false), { choice: { mode: "off", address: null, name: "" }, problems: [] });
        assert.deepEqual(chooseDns({ mode: "off", provider: "quad9", custom: "" }, true).problems, []);
    });

    it("is the chosen provider in the chosen mode", () => {
        const automatic = chooseDns({ mode: "automatic", provider: "mullvad-base", custom: "" }, false);
        assert.deepEqual(automatic, { choice: { mode: "automatic", address: "https://base.dns.mullvad.net/dns-query", name: "Mullvad (base)" }, problems: [] });
        assert.equal(chooseDns({ mode: "strict", provider: "quad9", custom: "" }, false).choice.mode, "strict");
    });

    it("is the typed address when the provider is custom, and nothing when it is not acceptable", () => {
        const good = chooseDns({ mode: "automatic", provider: "custom", custom: "https://D.example.org/q" }, false);
        assert.deepEqual(good.choice, { mode: "automatic", address: "https://d.example.org/q", name: "your own address" });
        const bad = chooseDns({ mode: "strict", provider: "custom", custom: "http://d.example.org/q" }, false);
        assert.equal(bad.choice.mode, "off");
        assert.match(bad.problems[0]!, /not acceptable/);
    });

    it("is nothing in safe mode, for both modes, and says so", () => {
        for (const mode of ["automatic", "strict"] as const) {
            const chosen = chooseDns({ mode, provider: "quad9", custom: "" }, true);
            assert.deepEqual(chosen.choice, { mode: "off", address: null, name: "" });
            assert.match(chosen.problems[0]!, /safe mode keeps encrypted DNS off/);
        }
    });

    it("is nothing when no provider was chosen or it is unknown, and says which", () => {
        assert.match(chooseDns({ mode: "automatic", provider: "", custom: "" }, false).problems[0]!, /no provider was chosen/);
        assert.match(chooseDns({ mode: "automatic", provider: "nope", custom: "" }, false).problems[0]!, /does not know/);
        assert.equal(chooseDns({ mode: "strict", provider: "google", custom: "" }, false).choice.mode, "off");
    });
});

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-dns-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("dns.json on disk", () => {
    it("lives in the folder of its Discord under its own name", () => {
        assert.equal(DNS_FILE, "dns.json");
        assert.equal(dnsConfigPath(dir), join(dir, "dns.json"));
    });

    it("is off, with no problem, when the file does not exist", () => {
        assert.deepEqual(loadDnsConfig(dnsConfigPath(dir)), { config: { mode: "off", provider: "", custom: "" }, problems: [] });
    });

    it("reads what was written, also with a byte order mark in front", () => {
        const path = dnsConfigPath(dir);
        assert.equal(saveDnsConfig(path, { mode: "automatic", provider: "quad9", custom: "" }), null);
        assert.equal(loadDnsConfig(path).config.provider, "quad9");
        writeFileSync(path, "﻿" + readFileSync(path, "utf8"));
        assert.equal(loadDnsConfig(path).config.mode, "automatic");
    });

    it("says so and stays off when the file is damaged or is a folder", () => {
        const path = dnsConfigPath(dir);
        writeFileSync(path, "{ broken");
        assert.match(loadDnsConfig(path).problems[0]!, /could not be read as JSON/);
        rmSync(path);
        mkdirSync(path);
        const folder = loadDnsConfig(path);
        assert.equal(folder.config.mode, "off");
        assert.match(folder.problems[0]!, /dns\.json could not be read/);
    });

    it("writes through a temporary file that is gone afterwards, and creates the folder", () => {
        const path = join(dir, "nested", "dns.json");
        assert.equal(saveDnsConfig(path, { mode: "off", provider: "", custom: "" }), null);
        assert.deepEqual(readdirSync(join(dir, "nested")), ["dns.json"]);
    });

    it("returns the error text and keeps the old file when the write fails", () => {
        const path = dnsConfigPath(dir);
        saveDnsConfig(path, { mode: "automatic", provider: "quad9", custom: "" });
        const before = readFileSync(path, "utf8");
        assert.equal(typeof saveDnsConfig(join(dir, "dns.json", "inside"), { mode: "off", provider: "", custom: "" }), "string");
        assert.equal(readFileSync(path, "utf8"), before);
    });
});
