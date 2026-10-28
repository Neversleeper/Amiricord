/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DnsConfig } from "../src/main/dns/config";
import { ChangerDeps, makePrivacyChanger, PAUSE_DETAIL, Question, weakensTelemetry } from "../src/main/privacyChange";
import type { HostRule } from "../src/shared/hostRules";
import { parseChangeResult, parsePrivacyChange, RULE_INPUT_MAX, TelemetryKey } from "../src/shared/privacyChange";

function setup(options: { telemetry?: Partial<Record<TelemetryKey, boolean>>; dns?: DnsConfig; agree?: boolean; setError?: string | null; saveError?: string | null; exportName?: string | null; paused?: boolean; resetError?: string | null; startFails?: boolean; } = {}) {
    const switches: Record<TelemetryKey, boolean> = { disableAnalytics: true, disableCrashReports: true, ...options.telemetry };
    let dns: DnsConfig = options.dns ?? { mode: "off", provider: "", custom: "" };
    const questions: Question[] = [];
    const saved: DnsConfig[] = [];
    const sets: Array<[TelemetryKey, boolean]> = [];
    const exports: string[] = [];
    let paused = options.paused ?? false;
    const pauseCalls: string[] = [];
    const resets: TelemetryKey[] = [];
    let release: (agree: boolean) => void = () => undefined;
    const deps: ChangerDeps = {
        telemetry: key => switches[key],
        setTelemetry: (key, value) => { sets.push([key, value]); if (options.setError) return options.setError; switches[key] = value; return null; },
        dns: () => dns,
        saveDns: config => { if (options.saveError) return options.saveError; saved.push(config); dns = config; return null; },
        exportBlocks: format => { exports.push(format); return options.exportName === undefined ? `recent-blocks-x.${format}` : options.exportName; },
        rules: () => ({ rules: [], editable: true }),
        saveRules: () => null,
        now: () => 0,
        paused: () => paused,
        startPause: () => { pauseCalls.push("start"); if (options.startFails) return false; paused = true; return true; },
        stopPause: () => { pauseCalls.push("stop"); paused = false; },
        resetTelemetry: key => { resets.push(key); if (options.resetError) return options.resetError; switches[key] = true; return null; },
        confirm: question => {
            questions.push(question);
            if (options.agree !== undefined) return Promise.resolve(options.agree);
            return new Promise(resolve => { release = resolve; });
        }
    };
    return { run: makePrivacyChanger(deps), questions, saved, sets, exports, switches, pauseCalls, resets, isPaused: () => paused, answer: (agree: boolean) => { release(agree); } };
}

describe("reading a change that came from the page", () => {
    it("rebuilds the two kinds field by field", () => {
        assert.deepEqual(parsePrivacyChange({ type: "telemetry", key: "disableAnalytics", value: false, extra: 1 }), { type: "telemetry", key: "disableAnalytics", value: false });
        assert.deepEqual(parsePrivacyChange({ type: "dns", mode: "strict", provider: "quad9", extra: 1 }), { type: "dns", mode: "strict", provider: "quad9" });
        assert.deepEqual(parsePrivacyChange({ type: "dns", mode: "off", provider: "" }), { type: "dns", mode: "off", provider: "" });
    });

    it("gives null for anything else", () => {
        const values = [
            null, undefined, 1, "x", [], {}, { type: "other" },
            { type: "telemetry", key: "somethingElse", value: true }, { type: "telemetry", key: "disableAnalytics", value: "no" }, { type: "telemetry", key: "disableAnalytics" },
            { type: "dns", mode: "maybe", provider: "quad9" }, { type: "dns", mode: "off", provider: 5 }, { type: "dns", mode: "off", provider: "Has Space" }, { type: "dns", mode: "off", provider: "Quad9" },
            { type: "dns", mode: "automatic", provider: "https://evil.test/dns-query" }, { type: "dns", mode: "off", provider: "a".repeat(41) }, { type: "dns", provider: "quad9" }
        ];
        for (const value of values) assert.equal(parsePrivacyChange(value), null, JSON.stringify(value));
        assert.notEqual(parsePrivacyChange({ type: "dns", mode: "off", provider: "a".repeat(40) }), null);
    });

    it("reads the answer to a change", () => {
        assert.deepEqual(parseChangeResult({ status: "applied", message: "ok", extra: 1 }), { status: "applied", message: "ok" });
        for (const status of ["cancelled", "refused"]) assert.equal(parseChangeResult({ status, message: "x" })!.status, status);
        for (const value of [null, 1, [], {}, { status: "maybe", message: "x" }, { status: "applied" }, { status: "applied", message: 5 }]) assert.equal(parseChangeResult(value), null);
        assert.equal(parseChangeResult({ status: "applied", message: "a\u0000b" + "z".repeat(400) })!.message.length, 300);
        assert.ok(parseChangeResult({ status: "applied", message: "a\u0000b\u007f" })!.message === "ab");
    });
});

describe("the general settings route may not switch a telemetry switch off", () => {
    it("recognises exactly that change", () => {
        assert.equal(weakensTelemetry({ type: "plugin-setting", plugin: "NoTrack", key: "disableAnalytics", value: false }), true);
        assert.equal(weakensTelemetry({ type: "plugin-setting", plugin: "NoTrack", key: "disableCrashReports", value: false }), true);
    });

    it("lets everything else through: switching on, removing the key, other keys, other plugins, other kinds", () => {
        const others = [
            { type: "plugin-setting", plugin: "NoTrack", key: "disableAnalytics", value: true },
            { type: "plugin-setting", plugin: "NoTrack", key: "disableAnalytics" },
            { type: "plugin-setting", plugin: "NoTrack", key: "somethingElse", value: false },
            { type: "plugin-setting", plugin: "Other", key: "disableAnalytics", value: false },
            { type: "plugin-enabled", plugin: "NoTrack", key: "disableAnalytics", value: false },
            { type: "plugin-reset", plugin: "NoTrack" }, null, undefined, {}
        ];
        for (const change of others) assert.equal(weakensTelemetry(change as never), false, JSON.stringify(change));
    });
});

describe("a telemetry switch", () => {
    it("is switched on without asking, and the answer says when it finishes", async () => {
        const t = setup({ telemetry: { disableAnalytics: false }, agree: false });
        const result = await t.run({ type: "telemetry", key: "disableAnalytics", value: true });
        assert.equal(result.status, "applied");
        assert.match(result.message, /after Discord restarts/);
        assert.deepEqual([t.sets, t.questions], [[["disableAnalytics", true]], []]);
    });

    it("asks before it is switched off, names what it lets through, and keeps it only if the person agrees", async () => {
        const yes = setup({ agree: true });
        assert.equal((await yes.run({ type: "telemetry", key: "disableAnalytics", value: false })).status, "applied");
        assert.deepEqual(yes.sets, [["disableAnalytics", false]]);
        assert.equal(yes.questions.length, 1);
        assert.match(yes.questions[0]!.title, /usage reports and metrics/);
        assert.match(yes.questions[0]!.detail, /record and send/);
        assert.equal(yes.questions[0]!.button, "Stop blocking");

        const no = setup({ agree: false });
        assert.deepEqual(await no.run({ type: "telemetry", key: "disableCrashReports", value: false }), { status: "cancelled", message: "Nothing was changed." });
        assert.deepEqual(no.sets, []);
        assert.match(no.questions[0]!.title, /crash reports/);
    });

    it("keeps the crash switch under its own key when the person agrees", async () => {
        const t = setup({ agree: true });
        assert.equal((await t.run({ type: "telemetry", key: "disableCrashReports", value: false })).status, "applied");
        assert.deepEqual(t.sets, [["disableCrashReports", false]]);
        const on = setup({ telemetry: { disableCrashReports: false }, agree: false });
        await on.run({ type: "telemetry", key: "disableCrashReports", value: true });
        assert.deepEqual(on.sets, [["disableCrashReports", true]]);
    });

    it("does nothing, and asks nothing, when it already is what was asked", async () => {
        const t = setup({ telemetry: { disableAnalytics: false }, agree: false });
        assert.deepEqual(await t.run({ type: "telemetry", key: "disableAnalytics", value: false }), { status: "applied", message: "Nothing to change." });
        assert.deepEqual(await setup().run({ type: "telemetry", key: "disableAnalytics", value: true }), { status: "applied", message: "Nothing to change." });
        assert.deepEqual([t.sets, t.questions], [[], []]);
    });

    it("says so when it could not be saved", async () => {
        const t = setup({ agree: true, setError: "disk full" });
        const result = await t.run({ type: "telemetry", key: "disableAnalytics", value: false });
        assert.deepEqual(result, { status: "refused", message: "the change could not be saved" });
        assert.doesNotMatch(result.message, /disk/);
    });
});

describe("the encrypted DNS choice", () => {
    const quad9 = (mode: DnsConfig["mode"]): DnsConfig => ({ mode, provider: "quad9", custom: "typed" });

    it("goes from off to automatic without asking, and keeps the other fields of the file", async () => {
        const t = setup({ agree: false });
        const result = await t.run({ type: "dns", mode: "automatic", provider: "quad9" });
        assert.deepEqual(result, { status: "applied", message: "Saved. Encrypted DNS takes effect the next time Discord starts." });
        assert.deepEqual(t.saved, [{ mode: "automatic", provider: "quad9", custom: "" }]);
        assert.deepEqual(t.questions, []);
    });

    it("keeps the typed address of the file when the choice changes", async () => {
        const t = setup({ dns: { mode: "off", provider: "", custom: "https://x.test/q" }, agree: true });
        await t.run({ type: "dns", mode: "automatic", provider: "mullvad-base" });
        assert.equal(t.saved[0]!.custom, "https://x.test/q");
    });

    it("picks a provider while off without asking (it only prepares the choice)", async () => {
        const t = setup({ agree: false });
        assert.equal((await t.run({ type: "dns", mode: "off", provider: "cloudflare" })).status, "applied");
        assert.deepEqual(t.saved, [{ mode: "off", provider: "cloudflare", custom: "" }]);
    });

    it("asks before entering Strict and says what the risk is and how to undo it", async () => {
        for (const from of [setup({ dns: quad9("off"), agree: false }), setup({ dns: quad9("automatic"), agree: false })]) {
            assert.equal((await from.run({ type: "dns", mode: "strict", provider: "quad9" })).status, "cancelled");
            assert.equal(from.questions[0]!.title, "Use Strict encrypted DNS?");
            assert.match(from.questions[0]!.detail, /never falls back/);
            assert.match(from.questions[0]!.detail, /safe mode/);
            assert.match(from.questions[0]!.detail, /dns\.json/);
            assert.equal(from.questions[0]!.button, "Use Strict");
            assert.deepEqual(from.saved, []);
        }
        const yes = setup({ dns: quad9("automatic"), agree: true });
        assert.equal((await yes.run({ type: "dns", mode: "strict", provider: "quad9" })).status, "applied");
        assert.equal(yes.saved[0]!.mode, "strict");
    });

    it("asks again when the provider changes while in Strict, but not when nothing changes", async () => {
        const change = setup({ dns: quad9("strict"), agree: false });
        assert.equal((await change.run({ type: "dns", mode: "strict", provider: "cloudflare" })).status, "cancelled");
        assert.equal(change.questions.length, 1);
        const same = setup({ dns: quad9("strict"), agree: false });
        assert.deepEqual(await same.run({ type: "dns", mode: "strict", provider: "quad9" }), { status: "applied", message: "Nothing to change." });
        assert.deepEqual([same.questions, same.saved], [[], []]);
    });

    it("asks before lowering: Strict to Automatic, and anything to Off, and says the lookups are in the open again", async () => {
        const down = setup({ dns: quad9("strict"), agree: false });
        assert.equal((await down.run({ type: "dns", mode: "automatic", provider: "quad9" })).status, "cancelled");
        assert.equal(down.questions[0]!.title, "Use Automatic instead of Strict?");
        assert.match(down.questions[0]!.detail, /in the open/);
        assert.equal(down.questions[0]!.button, "Use Automatic");

        for (const from of ["automatic", "strict"] as const) {
            const off = setup({ dns: quad9(from), agree: false });
            assert.equal((await off.run({ type: "dns", mode: "off", provider: "quad9" })).status, "cancelled");
            assert.equal(off.questions[0]!.title, "Turn encrypted DNS off?");
            assert.match(off.questions[0]!.detail, /in the open/);
            assert.equal(off.questions[0]!.button, "Turn off");
            assert.deepEqual(off.saved, []);
        }
        const yes = setup({ dns: quad9("automatic"), agree: true });
        assert.equal((await yes.run({ type: "dns", mode: "off", provider: "quad9" })).status, "applied");
        assert.deepEqual(yes.saved, [{ mode: "off", provider: "quad9", custom: "typed" }]);
    });

    it("changes the provider in Automatic without asking", async () => {
        const t = setup({ dns: quad9("automatic"), agree: false });
        assert.equal((await t.run({ type: "dns", mode: "automatic", provider: "cloudflare" })).status, "applied");
        assert.deepEqual(t.questions, []);
        assert.equal(t.saved[0]!.provider, "cloudflare");
    });

    it("takes the address from its own table only: an id it does not know, or a mode without a provider, is refused", async () => {
        const t = setup({ agree: true });
        assert.deepEqual(await t.run({ type: "dns", mode: "automatic", provider: "nope" }), { status: "refused", message: "that provider is not in the list" });
        assert.deepEqual(await t.run({ type: "dns", mode: "off", provider: "custom" }), { status: "refused", message: "that provider is not in the list" });
        assert.deepEqual(await t.run({ type: "dns", mode: "automatic", provider: "" }), { status: "refused", message: "choose a provider first" });
        assert.deepEqual(await t.run({ type: "dns", mode: "strict", provider: "" }), { status: "refused", message: "choose a provider first" });
        assert.deepEqual([t.saved, t.questions], [[], []]);
        assert.equal((await t.run({ type: "dns", mode: "off", provider: "" })).message, "Nothing to change.");
    });

    it("says so when the file could not be written, without the system's words", async () => {
        const t = setup({ agree: true, saveError: "EPERM: C:\\somewhere" });
        const result = await t.run({ type: "dns", mode: "automatic", provider: "quad9" });
        assert.deepEqual(result, { status: "refused", message: "the choice could not be saved" });
    });
});

describe("the changer as a whole", () => {
    it("refuses what is not a change", async () => {
        const t = setup({ agree: true });
        for (const value of [null, 5, "x", {}, { type: "telemetry", key: "x", value: true }]) {
            assert.deepEqual(await t.run(value), { status: "refused", message: "that change is not one this tab can make" });
        }
        assert.deepEqual([t.sets, t.saved, t.questions], [[], [], []]);
    });

    it("handles one change at a time while a question is open, and again after the answer", async () => {
        const t = setup();
        const first = t.run({ type: "telemetry", key: "disableAnalytics", value: false });
        const second = await t.run({ type: "telemetry", key: "disableCrashReports", value: false });
        assert.deepEqual(second, { status: "refused", message: "another change is waiting for your answer" });
        t.answer(true);
        assert.equal((await first).status, "applied");
        const third = t.run({ type: "telemetry", key: "disableCrashReports", value: false });
        t.answer(false);
        assert.equal((await third).status, "cancelled");
        assert.equal(t.questions.length, 2);
    });

    it("does not stay blocked when the question fails, and says so", async () => {
        let calls = 0;
        const run = makePrivacyChanger({
            telemetry: () => true, setTelemetry: () => null, dns: () => ({ mode: "off", provider: "", custom: "" }), saveDns: () => null, exportBlocks: () => null, rules: () => ({ rules: [], editable: true }), saveRules: () => null, now: () => 0,
            paused: () => false, startPause: () => true, stopPause: () => undefined, resetTelemetry: () => null,
            confirm: () => { calls++; throw new Error("no window"); }
        });
        assert.deepEqual(await run({ type: "telemetry", key: "disableAnalytics", value: false }), { status: "refused", message: "the change could not be made" });
        assert.deepEqual(await run({ type: "telemetry", key: "disableAnalytics", value: false }), { status: "refused", message: "the change could not be made" });
        assert.equal(calls, 2);
    });
});

describe("the export of the recent blocks", () => {
    it("is read as a change only for the two formats", () => {
        assert.deepEqual(parsePrivacyChange({ type: "export-blocks", format: "json", extra: 1 }), { type: "export-blocks", format: "json" });
        assert.deepEqual(parsePrivacyChange({ type: "export-blocks", format: "csv" }), { type: "export-blocks", format: "csv" });
        for (const format of ["xml", "JSON", "", 5, null, undefined]) assert.equal(parsePrivacyChange({ type: "export-blocks", format }), null, String(format));
        assert.equal(parsePrivacyChange({ type: "export-blocks", format: "json", path: "C:\\x" })!.type, "export-blocks");
    });

    it("writes the file without asking, and says its name and what is in it", async () => {
        const t = setup({ agree: false });
        const result = await t.run({ type: "export-blocks", format: "csv" });
        assert.equal(result.status, "applied");
        assert.match(result.message, /recent-blocks-x\.csv/);
        assert.match(result.message, /No query values/);
        assert.deepEqual([t.exports, t.questions], [["csv"], []]);
        assert.deepEqual((await t.run({ type: "export-blocks", format: "json" })).message.includes("recent-blocks-x.json"), true);
        assert.deepEqual(t.exports, ["csv", "json"]);
    });

    it("says so when the file could not be written, without the system's words", async () => {
        const t = setup({ exportName: null });
        assert.deepEqual(await t.run({ type: "export-blocks", format: "json" }), { status: "refused", message: "the file could not be written" });
    });

    it("waits its turn like every other change", async () => {
        const t = setup();
        const first = t.run({ type: "telemetry", key: "disableAnalytics", value: false });
        assert.equal((await t.run({ type: "export-blocks", format: "json" })).status, "refused");
        t.answer(false);
        await first;
        assert.equal((await t.run({ type: "export-blocks", format: "json" })).status, "applied");
    });
});

describe("adding and removing blocked sites", () => {
    const rule = (id: string, host: string, extra: Partial<HostRule> = {}): HostRule => ({ id, host, subdomains: true, action: "block", reason: "", created: 7, ...extra });
    const rulesSetup = (options: { rules?: HostRule[]; editable?: boolean; saveError?: string | null; agree?: boolean; } = {}) => {
        let rules: HostRule[] = options.rules ?? [];
        const saves: HostRule[][] = [];
        const questions: Question[] = [];
        let release: (agree: boolean) => void = () => undefined;
        const run = makePrivacyChanger({
            telemetry: () => true, setTelemetry: () => null, dns: () => ({ mode: "off", provider: "", custom: "" }), saveDns: () => null, exportBlocks: () => null,
            rules: () => ({ rules, editable: options.editable !== false }),
            saveRules: list => { if (options.saveError) return options.saveError; saves.push([...list]); rules = [...list]; return null; },
            now: () => 1_700_000_000_000,
            paused: () => false, startPause: () => true, stopPause: () => undefined, resetTelemetry: () => null,
            confirm: question => {
                questions.push(question);
                if (options.agree !== undefined) return Promise.resolve(options.agree);
                return new Promise(resolve => { release = resolve; });
            }
        });
        return { run, saves, questions, rules: () => rules, answer: (agree: boolean) => { release(agree); } };
    };

    it("reads the two kinds field by field, with the limits of what a page may send", () => {
        assert.equal(RULE_INPUT_MAX, 300);
        assert.deepEqual(parsePrivacyChange({ type: "rule-add", host: "ads.test", subdomains: false, reason: "x", extra: 1 }), { type: "rule-add", host: "ads.test", subdomains: false, reason: "x" });
        assert.deepEqual(parsePrivacyChange({ type: "rule-remove", id: "r12", extra: 1 }), { type: "rule-remove", id: "r12" });
        const add = (change: Record<string, unknown>) => parsePrivacyChange({ type: "rule-add", host: "a.test", subdomains: true, reason: "", ...change });
        assert.notEqual(add({ host: "a".repeat(RULE_INPUT_MAX) }), null);
        assert.equal(add({ host: "a".repeat(RULE_INPUT_MAX + 1) }), null);
        assert.notEqual(add({ reason: "a".repeat(RULE_INPUT_MAX) }), null);
        assert.equal(add({ reason: "a".repeat(RULE_INPUT_MAX + 1) }), null);
        for (const change of [{ host: 5 }, { host: undefined }, { reason: 5 }, { reason: undefined }, { subdomains: "yes" }, { subdomains: undefined }]) assert.equal(add(change), null, JSON.stringify(change));
        assert.notEqual(parsePrivacyChange({ type: "rule-remove", id: "a".repeat(40) }), null);
        for (const id of ["", "a".repeat(41), "r 1", "r/1", 5, null, undefined]) assert.equal(parsePrivacyChange({ type: "rule-remove", id }), null, String(id));
    });

    it("adds a site without asking, keeps the typed words, makes the id and the time itself, and says it takes effect at once", async () => {
        const t = rulesSetup({ agree: false, rules: [rule("r4", "old.test")] });
        const result = await t.run({ type: "rule-add", host: "  Ads.Example.COM ", subdomains: false, reason: "tracks me" });
        assert.deepEqual(result, { status: "applied", message: "Blocked. It takes effect at once." });
        assert.deepEqual(t.questions, []);
        assert.deepEqual(t.saves.at(-1), [rule("r4", "old.test"), { id: "r5", host: "ads.example.com", subdomains: false, action: "block", reason: "tracks me", created: 1_700_000_000_000 }]);
        assert.equal(t.rules().length, 2);
    });

    it("refuses what the editor refuses, each with its own sentence, and saves nothing", async () => {
        const t = rulesSetup({ rules: [rule("r1", "dup.test")] });
        const add = (host: string, reason = "") => t.run({ type: "rule-add", host, subdomains: true, reason });
        assert.deepEqual(await add("not a host"), { status: "refused", message: "That is not a plain site name (for example ads.example.com)." });
        assert.deepEqual(await add("https://x.test/path"), { status: "refused", message: "That is not a plain site name (for example ads.example.com)." });
        assert.deepEqual(await add("discord.com"), { status: "refused", message: "Discord's own sites cannot be blocked from here: they would stop Discord." });
        assert.deepEqual(await add("cdn.discordapp.com"), { status: "refused", message: "Discord's own sites cannot be blocked from here: they would stop Discord." });
        assert.deepEqual(await add("dup.test"), { status: "refused", message: "That site is already in the list." });
        assert.deepEqual(await add("a.test", "r".repeat(201)), { status: "refused", message: "The reason is too long (200 characters at most)." });
        assert.deepEqual(t.saves, []);
    });

    it("says the list is full when it is", async () => {
        const full = Array.from({ length: 10_000 }, (_, i) => rule(`r${i + 1}`, `h${i}.test`));
        const t = rulesSetup({ rules: full });
        assert.deepEqual(await t.run({ type: "rule-add", host: "one-more.test", subdomains: true, reason: "" }), { status: "refused", message: "The list is full." });
    });

    it("never repeats what was typed in a sentence", async () => {
        const t = rulesSetup();
        const text = (await t.run({ type: "rule-add", host: "<script>x</script>", subdomains: true, reason: "" })).message;
        assert.doesNotMatch(text, /script/);
    });

    it("refuses to touch a file that could not be read at all, for both kinds, and asks nothing", async () => {
        const t = rulesSetup({ editable: false, rules: [rule("r1", "a.test")], agree: true });
        const sentence = "firewall.json could not be read. Fix or rename it first.";
        assert.deepEqual(await t.run({ type: "rule-add", host: "b.test", subdomains: true, reason: "" }), { status: "refused", message: sentence });
        assert.deepEqual(await t.run({ type: "rule-remove", id: "r1" }), { status: "refused", message: sentence });
        assert.deepEqual([t.saves, t.questions], [[], []]);
    });

    it("asks before taking a site off, naming it from its own list, and takes it off only when the person agrees", async () => {
        const yes = rulesSetup({ rules: [rule("r1", "a.test"), rule("r2", "b.test")], agree: true });
        assert.deepEqual(await yes.run({ type: "rule-remove", id: "r2" }), { status: "applied", message: "Removed. It takes effect at once." });
        assert.deepEqual(yes.saves.at(-1)!.map(r => r.id), ["r1"]);
        assert.deepEqual(yes.questions, [{ title: "Stop blocking b.test?", detail: "Discord and plugins will be able to reach it again. It takes effect at once.", button: "Stop blocking" }]);

        const no = rulesSetup({ rules: [rule("r1", "a.test")], agree: false });
        assert.deepEqual(await no.run({ type: "rule-remove", id: "r1" }), { status: "cancelled", message: "Nothing was changed." });
        assert.deepEqual([no.saves, no.rules().length], [[], 1]);
    });

    it("says so when the rule is not there, without asking", async () => {
        const t = rulesSetup({ rules: [rule("r1", "a.test")], agree: true });
        assert.deepEqual(await t.run({ type: "rule-remove", id: "r99" }), { status: "refused", message: "That rule is not in the list." });
        assert.deepEqual(t.questions, []);
    });

    it("says so when the list could not be saved, and the list in force is the one that was saved", async () => {
        const add = rulesSetup({ saveError: "EPERM: C:\\somewhere" });
        assert.deepEqual(await add.run({ type: "rule-add", host: "a.test", subdomains: true, reason: "" }), { status: "refused", message: "the list could not be saved" });
        assert.equal(add.rules().length, 0);
        const remove = rulesSetup({ rules: [rule("r1", "a.test")], agree: true, saveError: "disk full" });
        assert.deepEqual(await remove.run({ type: "rule-remove", id: "r1" }), { status: "refused", message: "the list could not be saved" });
        assert.equal(remove.rules().length, 1);
    });

    it("waits its turn while a removal is being asked", async () => {
        const t = rulesSetup({ rules: [rule("r1", "a.test")] });
        const first = t.run({ type: "rule-remove", id: "r1" });
        assert.deepEqual(await t.run({ type: "rule-add", host: "b.test", subdomains: true, reason: "" }), { status: "refused", message: "another change is waiting for your answer" });
        t.answer(true);
        assert.equal((await first).status, "applied");
        assert.equal((await t.run({ type: "rule-add", host: "b.test", subdomains: true, reason: "" })).status, "applied");
    });
});

describe("pausing protection and going back to the defaults", () => {
    it("reads the three new kinds with nothing else from the page", () => {
        assert.deepEqual(parsePrivacyChange({ type: "pause", minutes: 999 }), { type: "pause" });
        assert.deepEqual(parsePrivacyChange({ type: "resume", extra: 1 }), { type: "resume" });
        assert.deepEqual(parsePrivacyChange({ type: "reset-defaults", keep: false }), { type: "reset-defaults" });
    });

    it("ends a pause without asking anything, because that only strengthens protection", async () => {
        const t = setup({ paused: true });
        assert.deepEqual(await t.run({ type: "resume" }), { status: "applied", message: "Protection is back on." });
        assert.deepEqual([t.questions.length, t.pauseCalls, t.isPaused()], [0, ["stop"], false]);
    });

    it("has nothing to end when it is not paused, and touches nothing", async () => {
        const t = setup();
        assert.deepEqual(await t.run({ type: "resume" }), { status: "applied", message: "Nothing to change." });
        assert.deepEqual([t.questions.length, t.pauseCalls], [0, []]);
    });

    it("asks first, in the main process's own window, before it pauses", async () => {
        const t = setup({ agree: true });
        assert.deepEqual(await t.run({ type: "pause" }), { status: "applied", message: "Protection is paused for ten minutes. It ends by itself." });
        assert.deepEqual(t.questions, [{ title: "Pause protection for ten minutes?", detail: PAUSE_DETAIL, button: "Pause for 10 minutes" }]);
        assert.deepEqual([t.pauseCalls, t.isPaused()], [["start"], true]);
    });

    it("names what stays on in the question", () => {
        for (const word of ["token guard", "crash report", "encrypted DNS", "ten minutes", "restarts"]) assert.ok(PAUSE_DETAIL.includes(word), word);
    });

    it("pauses nothing when the person says no", async () => {
        const t = setup({ agree: false });
        assert.deepEqual(await t.run({ type: "pause" }), { status: "cancelled", message: "Nothing was changed." });
        assert.deepEqual(t.pauseCalls, []);
    });

    it("refuses a second pause without asking, and says so when the start itself is refused", async () => {
        const t = setup({ paused: true, agree: true });
        assert.deepEqual(await t.run({ type: "pause" }), { status: "refused", message: "Protection is already paused." });
        assert.equal(t.questions.length, 0);
        const late = setup({ agree: true, startFails: true });
        assert.deepEqual(await late.run({ type: "pause" }), { status: "refused", message: "Protection is already paused." });
    });

    it("answers only one question at a time, pause included", async () => {
        const t = setup();
        const first = t.run({ type: "pause" });
        assert.deepEqual(await t.run({ type: "pause" }), { status: "refused", message: "another change is waiting for your answer" });
        t.answer(false);
        assert.equal((await first).status, "cancelled");
    });

    it("has nothing to reset when everything is already at the defaults", async () => {
        const t = setup({ agree: true });
        assert.deepEqual(await t.run({ type: "reset-defaults" }), { status: "applied", message: "Nothing to change." });
        assert.deepEqual([t.questions.length, t.resets, t.saved, t.pauseCalls], [0, [], [], []]);
    });

    it("always asks before it resets, naming each step and saying the blocked sites are kept", async () => {
        const t = setup({ agree: false, paused: true, telemetry: { disableAnalytics: false, disableCrashReports: false }, dns: { mode: "strict", provider: "quad9", custom: "" } });
        assert.equal((await t.run({ type: "reset-defaults" })).status, "cancelled");
        const question = t.questions[0]!;
        assert.equal(question.title, "Reset to the defaults?");
        assert.equal(question.button, "Reset");
        for (const part of ["The pause ends", "usage reports", "crash reports", "encrypted DNS goes off", "must restart", "Your blocked sites are kept."]) assert.ok(question.detail.includes(part), part);
        assert.deepEqual([t.resets, t.saved, t.pauseCalls], [[], [], []], "nothing is done after a no");
    });

    it("does every step after a yes: the pause ends, the switches go back on, DNS goes off and forgets its provider", async () => {
        const t = setup({ agree: true, paused: true, telemetry: { disableAnalytics: false, disableCrashReports: true }, dns: { mode: "automatic", provider: "quad9", custom: "x.test" } });
        const answer = await t.run({ type: "reset-defaults" });
        assert.deepEqual(answer, { status: "applied", message: "Back to the defaults. Discord must restart to finish. Your blocked sites were kept." });
        assert.deepEqual([t.pauseCalls, t.resets, t.saved], [["stop"], ["disableAnalytics"], [{ mode: "off", provider: "", custom: "x.test" }]]);
    });

    it("asks for a restart only when something besides the pause changed", async () => {
        const t = setup({ agree: true, paused: true });
        const answer = await t.run({ type: "reset-defaults" });
        assert.deepEqual(answer, { status: "applied", message: "Back to the defaults. Your blocked sites were kept." });
        assert.ok(!t.questions[0]!.detail.includes("restart"));
        assert.deepEqual([t.pauseCalls, t.resets, t.saved], [["stop"], [], []]);
    });

    it("treats DNS with a provider but no mode as something to forget", async () => {
        const t = setup({ agree: true, dns: { mode: "off", provider: "quad9", custom: "" } });
        assert.equal((await t.run({ type: "reset-defaults" })).status, "applied");
        assert.deepEqual(t.saved, [{ mode: "off", provider: "", custom: "" }]);
    });

    it("names the steps that failed and says the others were done", async () => {
        const t = setup({ agree: true, resetError: "disk full", paused: true, telemetry: { disableAnalytics: false, disableCrashReports: false } });
        const answer = await t.run({ type: "reset-defaults" });
        assert.equal(answer.status, "refused");
        assert.ok(answer.message.includes("usage reports") && answer.message.includes("crash reports") && answer.message.includes("The others were done"), answer.message);
        assert.deepEqual(t.pauseCalls, ["stop"], "the pause still ended");
        const dns = setup({ agree: true, saveError: "no file", dns: { mode: "strict", provider: "quad9", custom: "" } });
        const failed = await dns.run({ type: "reset-defaults" });
        assert.deepEqual(failed, { status: "refused", message: "Some steps could not be done: encrypted DNS. The others were done." });
    });
});
