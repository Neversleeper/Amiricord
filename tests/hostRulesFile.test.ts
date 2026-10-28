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

import { BACKUP_SUFFIX, backupHostRules, HOST_RULES_FILE, hostRulesPath, loadHostRules, saveHostRules } from "../src/main/hostRulesFile";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-rules-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("the rules file on disk", () => {
    it("lives in the data folder under its own name", () => {
        assert.equal(HOST_RULES_FILE, "firewall.json");
        assert.equal(hostRulesPath(dir), join(dir, "firewall.json"));
    });

    it("gives no rules and no problem when the file does not exist yet", () => {
        assert.deepEqual(loadHostRules(hostRulesPath(dir)), { rules: [], problems: [] });
    });

    it("reads what was written, also with a byte order mark in front", () => {
        const path = hostRulesPath(dir);
        assert.equal(saveHostRules(path, [{ id: "r1", host: "a.test", subdomains: true, action: "block", reason: "x", created: 5 }]), null);
        assert.deepEqual(loadHostRules(path).rules.map(r => r.host), ["a.test"]);
        writeFileSync(path, "﻿" + readFileSync(path, "utf8"));
        assert.deepEqual(loadHostRules(path).rules.map(r => r.host), ["a.test"]);
    });

    it("says so, and gives no rules, when the file cannot be read as rules", () => {
        const path = hostRulesPath(dir);
        writeFileSync(path, "{ broken");
        const loaded = loadHostRules(path);
        assert.deepEqual(loaded.rules, []);
        assert.match(loaded.problems[0]!, /could not be read as JSON/);
    });

    it("says so when the path is a folder and cannot be read", () => {
        const path = hostRulesPath(dir);
        mkdirSync(path);
        const loaded = loadHostRules(path);
        assert.deepEqual(loaded.rules, []);
        assert.match(loaded.problems[0]!, /firewall\.json could not be read/);
    });

    it("writes through a temporary file that is gone afterwards, and creates the folder", () => {
        const path = join(dir, "nested", "firewall.json");
        assert.equal(saveHostRules(path, []), null);
        assert.deepEqual(readdirSync(join(dir, "nested")), ["firewall.json"]);
    });

    it("returns the error text, and keeps the old file, when the write fails", () => {
        const path = hostRulesPath(dir);
        saveHostRules(path, [{ id: "r1", host: "keep.test", subdomains: true, action: "block", reason: "", created: 0 }]);
        const before = readFileSync(path, "utf8");
        const blocked = join(dir, "firewall.json", "inside");
        assert.equal(typeof saveHostRules(blocked, []), "string");
        assert.equal(readFileSync(path, "utf8"), before);
    });
});

describe("the copy made before the tab rewrites the file", () => {
    it("names the copy after the file", () => {
        assert.equal(BACKUP_SUFFIX, ".before-tab");
    });

    it("copies the owner's file once, byte for byte", () => {
        const path = hostRulesPath(dir);
        writeFileSync(path, "{ hand written, with a mistake");
        assert.equal(backupHostRules(path), null);
        assert.equal(readFileSync(path + BACKUP_SUFFIX, "utf8"), "{ hand written, with a mistake");
        assert.equal(readFileSync(path, "utf8"), "{ hand written, with a mistake", "the file itself is untouched");
    });

    it("never replaces an older copy", () => {
        const path = hostRulesPath(dir);
        writeFileSync(path, "first");
        backupHostRules(path);
        writeFileSync(path, "second");
        assert.equal(backupHostRules(path), null);
        assert.equal(readFileSync(path + BACKUP_SUFFIX, "utf8"), "first");
    });

    it("needs no copy when there is no file, and makes none", () => {
        const path = hostRulesPath(dir);
        assert.equal(backupHostRules(path), null);
        assert.deepEqual(readdirSync(dir), []);
    });

    it("says what went wrong when the copy cannot be made", () => {
        const path = hostRulesPath(dir);
        mkdirSync(path);
        assert.equal(typeof backupHostRules(path), "string");
    });
});

describe("a file that cannot be used at all", () => {
    it("is marked broken when it is not JSON, not the expected shape, too large, or cannot be read", () => {
        const path = hostRulesPath(dir);
        writeFileSync(path, "{ broken");
        assert.equal(loadHostRules(path).broken, true);
        writeFileSync(path, JSON.stringify({ schema: 2, rules: [] }));
        assert.equal(loadHostRules(path).broken, true);
        writeFileSync(path, JSON.stringify({ schema: 1, rules: "x" }));
        assert.equal(loadHostRules(path).broken, true);
        writeFileSync(path, " ".repeat(2 * 1024 * 1024 + 1));
        assert.equal(loadHostRules(path).broken, true);
        rmSync(path);
        mkdirSync(path);
        assert.equal(loadHostRules(path).broken, true);
    });

    it("is not marked when it is fine, missing, or only had some rules dropped", () => {
        const path = hostRulesPath(dir);
        assert.equal(loadHostRules(path).broken, undefined);
        assert.equal(saveHostRules(path, [{ id: "r1", host: "a.test", subdomains: true, action: "block", reason: "", created: 1 }]), null);
        assert.equal(loadHostRules(path).broken, undefined);
        writeFileSync(path, JSON.stringify({ schema: 1, rules: [{ host: "not a host", action: "block" }, { host: "ok.test", action: "block" }] }));
        const loaded = loadHostRules(path);
        assert.equal(loaded.broken, undefined);
        assert.deepEqual(loaded.rules.map(r => r.host), ["ok.test"]);
        assert.equal(loaded.problems.length, 1);
    });
});
