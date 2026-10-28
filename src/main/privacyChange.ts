/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The changes the Privacy & Security tab may ask for (design 05 piece P7b, docs/analysis-22-privacy-security-tab-build.md section 10). The page names a change with ids and
// booleans; this code checks it again, asks the person through the main process when the change would weaken protection (a window the page cannot answer for), and only then
// keeps it. A change that only strengthens protection is kept at once. Pure code: the question, the settings and the file come in from outside, so the tests need no Electron.

import { addRule, type HostRule, removeRule } from "../shared/hostRules";
import type { PrivacyDnsMode } from "../shared/privacy";
import { parsePrivacyChange, PrivacyChangeResult, TELEMETRY_KEYS, TelemetryKey } from "../shared/privacyChange";
import { EXPORT_NOTE, type ExportFormat } from "./blockLog";
import type { DnsConfig } from "./dns/config";
import { findProvider } from "./dns/providers";

export interface Question {
    title: string;
    /** What the change lets through or risks, in plain words. */
    detail: string;
    /** The label of the button that agrees; the other button always says Cancel. */
    button: string;
}

export interface ChangerDeps {
    /** NoTrack's switch as it is now. */
    telemetry(key: TelemetryKey): boolean;
    /** Keep a switch. Returns why it could not be kept, or null. */
    setTelemetry(key: TelemetryKey, value: boolean): string | null;
    /** What is saved in dns.json now. */
    dns(): DnsConfig;
    /** Write dns.json. Returns the error text, or null. */
    saveDns(config: DnsConfig): string | null;
    /** Write the list of recent blocks into the exports folder. Returns the file name, or null when it could not be written. */
    exportBlocks(format: ExportFormat): string | null;
    /** The owner's block rules as they are in force now, and whether the file can be rewritten (false when it could not be read at all: saving would replace what the owner wrote). */
    rules(): { rules: readonly HostRule[]; editable: boolean; };
    /** Keep the list: write the file and put the list in force at once. Returns the error text, or null. */
    saveRules(rules: readonly HostRule[]): string | null;
    /** Milliseconds since 1970, for the time a rule is made. */
    now(): number;
    /** Whether protection is paused right now. */
    paused(): boolean;
    /** Start the ten-minute pause. False when one is already running. */
    startPause(): boolean;
    /** End the pause now. */
    stopPause(): void;
    /** Forget the saved value of one telemetry switch, so its default (on) applies again. Returns why it could not, or null. */
    resetTelemetry(key: TelemetryKey): string | null;
    /** Ask the person. Resolves true only when they pressed the agreeing button. */
    confirm(question: Question): Promise<boolean>;
}

const RANK: Record<PrivacyDnsMode, number> = { off: 0, automatic: 1, strict: 2 };

/** What a pause lets through and what it leaves on, said in the window that asks. */
export const PAUSE_DETAIL = "For ten minutes Discord can send usage reports, the sites you blocked are reachable again, and the network telemetry shields stop cancelling. The token guard, crash report blocking and encrypted DNS stay as they are. It ends by itself after ten minutes, or when Discord restarts.";

const SWITCH_NAMES: Record<TelemetryKey, string> = { disableAnalytics: "usage reports and metrics", disableCrashReports: "crash reports" };

const RULE_REFUSALS = {
    "invalid-host": "That is not a plain site name (for example ads.example.com).",
    "protected-host": "Discord's own sites cannot be blocked from here: they would stop Discord.",
    duplicate: "That site is already in the list.",
    "too-many": "The list is full.",
    "reason-too-long": "The reason is too long (200 characters at most)."
} as const;

const result = (status: PrivacyChangeResult["status"], message: string): PrivacyChangeResult => ({ status, message });

/** True when a change that came by the general settings route would switch one of the two telemetry switches off. That route may not do it: only the confirmed one may. */
export function weakensTelemetry(change: { type?: unknown; plugin?: unknown; key?: unknown; value?: unknown; } | null | undefined): boolean {
    return !!change && change.type === "plugin-setting" && change.plugin === "NoTrack" && (change.key === "disableAnalytics" || change.key === "disableCrashReports") && change.value === false;
}

export function makePrivacyChanger(deps: ChangerDeps): (payload: unknown) => Promise<PrivacyChangeResult> {
    let waiting = false;
    return async payload => {
        const change = parsePrivacyChange(payload);
        if (!change) return result("refused", "that change is not one this tab can make");
        if (waiting) return result("refused", "another change is waiting for your answer");
        waiting = true;
        try {
            // Ending a pause only strengthens protection, so it asks nothing.
            if (change.type === "resume") {
                if (!deps.paused()) return result("applied", "Nothing to change.");
                deps.stopPause();
                return result("applied", "Protection is back on.");
            }
            // Pausing weakens protection for a while, so the person is asked first, in a window the page cannot answer.
            if (change.type === "pause") {
                if (deps.paused()) return result("refused", "Protection is already paused.");
                const agreed = await deps.confirm({ title: "Pause protection for ten minutes?", detail: PAUSE_DETAIL, button: "Pause for 10 minutes" });
                if (!agreed) return result("cancelled", "Nothing was changed.");
                return deps.startPause() ? result("applied", "Protection is paused for ten minutes. It ends by itself.") : result("refused", "Protection is already paused.");
            }
            // A reset changes several things at once, so it always asks, naming what it will do. The blocked sites are the owner's own choices and are never touched.
            if (change.type === "reset-defaults") {
                const telemetryOff = TELEMETRY_KEYS.filter(key => !deps.telemetry(key));
                const saved = deps.dns();
                const dnsOn = saved.mode !== "off" || saved.provider !== "";
                const paused = deps.paused();
                if (telemetryOff.length === 0 && !dnsOn && !paused) return result("applied", "Nothing to change.");
                const will: string[] = [];
                if (paused) will.push("the pause ends");
                if (telemetryOff.length) will.push("the blocking of " + telemetryOff.map(key => SWITCH_NAMES[key]).join(" and ") + " goes back on");
                if (dnsOn) will.push("encrypted DNS goes off and its provider is forgotten");
                const agreed = await deps.confirm({
                    title: "Reset to the defaults?",
                    detail: `${will.join("; ").replace(/^./, letter => letter.toUpperCase())}. ${telemetryOff.length || dnsOn ? "Discord must restart to finish that. " : ""}Your blocked sites are kept.`,
                    button: "Reset"
                });
                if (!agreed) return result("cancelled", "Nothing was changed.");
                const failed: string[] = [];
                if (paused) deps.stopPause();
                for (const key of telemetryOff) if (deps.resetTelemetry(key) !== null) failed.push(SWITCH_NAMES[key]);
                if (dnsOn && deps.saveDns({ mode: "off", provider: "", custom: saved.custom }) !== null) failed.push("encrypted DNS");
                if (failed.length) return result("refused", `Some steps could not be done: ${failed.join(", ")}. The others were done.`);
                return result("applied", `Back to the defaults. ${telemetryOff.length || dnsOn ? "Discord must restart to finish. " : ""}Your blocked sites were kept.`);
            }
            // A file of the main process's own data that the person asked for: it adds nothing that weakens protection, so it asks nothing.
            if (change.type === "export-blocks") {
                const name = deps.exportBlocks(change.format);
                return name === null ? result("refused", "the file could not be written") : result("applied", `Saved ${name} in the exports folder. ${EXPORT_NOTE}`);
            }
            if (change.type === "rule-add" || change.type === "rule-remove") {
                const { rules, editable } = deps.rules();
                if (!editable) return result("refused", "firewall.json could not be read. Fix or rename it first.");
                if (change.type === "rule-add") {
                    // Adding a block only strengthens protection, so it asks nothing.
                    const added = addRule(rules, { host: change.host, subdomains: change.subdomains, reason: change.reason }, deps.now());
                    if (!added.ok) return result("refused", RULE_REFUSALS[added.reason]);
                    return deps.saveRules(added.rules) === null ? result("applied", "Blocked. It takes effect at once.") : result("refused", "the list could not be saved");
                }
                const rule = rules.find(item => item.id === change.id);
                if (!rule) return result("refused", "That rule is not in the list.");
                // Removing a block lets a site through again, so the person is asked first. The name shown is the one the main process holds, never the page's.
                const agreed = await deps.confirm({
                    title: `Stop blocking ${rule.host}?`,
                    detail: "Discord and plugins will be able to reach it again. It takes effect at once.",
                    button: "Stop blocking"
                });
                if (!agreed) return result("cancelled", "Nothing was changed.");
                return deps.saveRules(removeRule(rules, rule.id)) === null ? result("applied", "Removed. It takes effect at once.") : result("refused", "the list could not be saved");
            }
            if (change.type === "telemetry") {
                const name = SWITCH_NAMES[change.key];
                if (deps.telemetry(change.key) === change.value) return result("applied", "Nothing to change.");
                if (!change.value) {
                    const agreed = await deps.confirm({
                        title: `Stop blocking ${name}?`,
                        detail: `Discord will be able to record and send ${name} again. The network shield stops at once; the part inside Discord stops after Discord restarts.`,
                        button: "Stop blocking"
                    });
                    if (!agreed) return result("cancelled", "Nothing was changed.");
                }
                const error = deps.setTelemetry(change.key, change.value);
                return error === null ? result("applied", `Saved. The network shield follows it now; the part inside Discord after Discord restarts.`) : result("refused", "the change could not be saved");
            }

            // Encrypted DNS: a mode other than off needs a provider of our own table; the address is never taken from the page.
            if (change.provider !== "" && !findProvider(change.provider)) return result("refused", "that provider is not in the list");
            if (change.mode !== "off" && change.provider === "") return result("refused", "choose a provider first");
            const current = deps.dns();
            if (current.mode === change.mode && current.provider === change.provider) return result("applied", "Nothing to change.");
            const lowers = RANK[change.mode] < RANK[current.mode];
            const entersStrict = change.mode === "strict" && (current.mode !== "strict" || current.provider !== change.provider);
            if (lowers || entersStrict) {
                const question: Question = entersStrict
                    ? {
                        title: "Use Strict encrypted DNS?",
                        detail: "Strict never falls back to the system's DNS. If the provider cannot be reached, Discord cannot connect until you change this. Amiricord checks the provider when Discord starts and does not use one that does not answer; to undo it, start in safe mode or edit dns.json in the data folder.",
                        button: "Use Strict"
                    }
                    : change.mode === "off"
                        ? { title: "Turn encrypted DNS off?", detail: "Discord will look up site names with your system's DNS again, in the open. It takes effect the next time Discord starts.", button: "Turn off" }
                        : { title: "Use Automatic instead of Strict?", detail: "If the provider cannot be reached, Discord will fall back to your system's DNS, in the open. It takes effect the next time Discord starts.", button: "Use Automatic" };
                if (!await deps.confirm(question)) return result("cancelled", "Nothing was changed.");
            }
            const error = deps.saveDns({ mode: change.mode, provider: change.provider, custom: current.custom });
            return error === null ? result("applied", "Saved. Encrypted DNS takes effect the next time Discord starts.") : result("refused", "the choice could not be saved");
        } catch {
            return result("refused", "the change could not be made");
        } finally {
            waiting = false;
        }
    };
}
