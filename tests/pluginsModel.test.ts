/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginCard } from "../src/api/pluginCards";
import {
    applyFilter, cardBadges, cardFooter, cardStatus, compatibilityNote, countCards, DEFAULT_FILTER, emptyText, filterOptions, hasProblem, isFilterActive, isOn, matchesSearch,
    originLabel, outcomeOf, type PluginsFilter, reasonText, statusText, waitingForRestart, warningBeforeEnabling, warningText
} from "../src/plugins/Settings/pluginsModel";

type Overrides = Partial<Omit<PluginCard, "state" | "risk">> & { state?: Partial<PluginCard["state"]>; risk?: Partial<PluginCard["risk"]>; };

/** A full card with neutral values, a few of them changed. */
function card(over: Overrides = {}): PluginCard {
    const base: PluginCard = {
        id: "plug", name: "Plug", version: "1.0.0", description: "Does a thing.", origin: "amiricord", license: "GPL-3.0-or-later", authors: [{ name: "Mixi" }], credits: [],
        tags: [], dependencies: [], core: false, experimental: false, legacy: false, replacedBy: null, requiresRestart: "auto", restartToToggle: false, hasSettings: false, riskySettings: [],
        risk: { level: "low", label: null, reasons: [] }, hosts: [], telemetryHosts: [], compatibility: "ok",
        state: { chosen: undefined, wanted: true, running: true, lifecycle: "started", error: null, reason: "default", neededBy: [], skipped: undefined, restartNeeded: false }
    };
    return { ...base, ...over, risk: { ...base.risk, ...over.risk }, state: { ...base.state, ...over.state } };
}

const filter = (over: Partial<PluginsFilter> = {}): PluginsFilter => ({ ...DEFAULT_FILTER, ...over });
const ids = (cards: PluginCard[]) => cards.map(c => c.id);

describe("matchesSearch", () => {
    const folders = card({ id: "betterFolders", name: "BetterFolders", description: "Folders in the server list.", authors: [{ name: "Nuckyz" }], tags: ["ui"], origin: "vencord" });

    it("matches everything for an empty search or one of spaces", () => {
        assert.equal(matchesSearch(folders, ""), true);
        assert.equal(matchesSearch(folders, "   "), true);
    });

    it("finds a plugin by name, id, description, author, tag or origin, in any case", () => {
        for (const text of ["betterf", "BETTERFOLDERS", "server list", "nucky", "ui", "vencord"]) assert.equal(matchesSearch(folders, text), true, text);
    });

    it("ignores spaces in the name, and finds the capital letters of the name", () => {
        assert.equal(matchesSearch(folders, "better folders"), true);
        assert.equal(matchesSearch(folders, "bf"), true);
    });

    it("does not match what is nowhere in the card", () => {
        assert.equal(matchesSearch(folders, "zzz"), false);
        assert.equal(matchesSearch(folders, "chat"), false);
    });
});

describe("applyFilter", () => {
    const list = [
        card({ id: "zeta", name: "Zeta", state: { wanted: false, running: false, reason: undefined } }),
        card({ id: "alpha", name: "alpha" }),
        card({ id: "settings", name: "Settings", core: true, state: { reason: "core" } }),
        card({ id: "mid", name: "Mid", origin: "equicord", tags: ["chat"], risk: { level: "medium" }, state: { restartNeeded: true } }),
        card({ id: "danger", name: "Danger", risk: { level: "high", label: "High risk" }, state: { error: "boom", running: false, lifecycle: "failed" } })
    ];

    it("sorts by name without caring about case, and keeps the core plugins apart", () => {
        const result = applyFilter(list, DEFAULT_FILTER);
        assert.deepEqual(ids(result.plugins), ["alpha", "danger", "mid", "zeta"]);
        assert.deepEqual(ids(result.core), ["settings"]);
    });

    it("sorts two plugins with the same name by id", () => {
        const twins = [card({ id: "b", name: "Same" }), card({ id: "a", name: "Same" })];
        assert.deepEqual(ids(applyFilter(twins, DEFAULT_FILTER).plugins), ["a", "b"]);
    });

    it("treats names that differ only in capitals as the same name, and then sorts by id", () => {
        const twins = [card({ id: "b", name: "same" }), card({ id: "a", name: "Same" })];
        assert.deepEqual(ids(applyFilter(twins, DEFAULT_FILTER).plugins), ["a", "b"]);
    });

    it("never changes the list it is given", () => {
        const copy = [...list];
        applyFilter(list, DEFAULT_FILTER);
        assert.deepEqual(list, copy);
    });

    it("filters by state: on, off, needs a restart, with problems", () => {
        assert.deepEqual(ids(applyFilter(list, filter({ state: "on" })).plugins), ["alpha", "danger", "mid"]);
        assert.deepEqual(ids(applyFilter(list, filter({ state: "off" })).plugins), ["zeta"]);
        assert.deepEqual(ids(applyFilter(list, filter({ state: "restart" })).plugins), ["mid"]);
        assert.deepEqual(ids(applyFilter(list, filter({ state: "problems" })).plugins), ["danger"]);
    });

    it("applies the state filter to the core plugins too", () => {
        assert.deepEqual(ids(applyFilter(list, filter({ state: "off" })).core), []);
        assert.deepEqual(ids(applyFilter(list, filter({ state: "on" })).core), ["settings"]);
    });

    it("filters by origin and by tag", () => {
        assert.deepEqual(ids(applyFilter(list, filter({ origin: "equicord" })).plugins), ["mid"]);
        assert.deepEqual(ids(applyFilter(list, filter({ tag: "chat" })).plugins), ["mid"]);
        assert.deepEqual(ids(applyFilter(list, filter({ tag: "voice" })).plugins), []);
    });

    it("filters by author, by the exact name, and also finds a plugin that has several authors", () => {
        const team = [
            card({ id: "solo", name: "Solo", authors: [{ name: "Ana" }] }),
            card({ id: "duo", name: "Duo", authors: [{ name: "Bruno" }, { name: "Ana" }] }),
            card({ id: "other", name: "Other", authors: [{ name: "Anabel" }] }),
            card({ id: "nobody", name: "Nobody", authors: [] })
        ];
        assert.deepEqual(ids(applyFilter(team, filter({ author: "Ana" })).plugins), ["duo", "solo"]);
        assert.deepEqual(ids(applyFilter(team, filter({ author: "Bruno" })).plugins), ["duo"]);
        assert.deepEqual(ids(applyFilter(team, filter({ author: "ana" })).plugins), [], "the name must match exactly");
        assert.deepEqual(ids(applyFilter(team, DEFAULT_FILTER).plugins), ["duo", "nobody", "other", "solo"]);
    });

    it("filters by risk: medium or higher keeps medium and high, high only keeps high", () => {
        assert.deepEqual(ids(applyFilter(list, filter({ risk: "medium" })).plugins), ["danger", "mid"]);
        assert.deepEqual(ids(applyFilter(list, filter({ risk: "high" })).plugins), ["danger"]);
    });

    it("combines the search with the filters", () => {
        assert.deepEqual(ids(applyFilter(list, filter({ search: "an", state: "on" })).plugins), ["danger"]);
        assert.deepEqual(ids(applyFilter(list, filter({ search: "zet", state: "on" })).plugins), [], "zeta matches the search but is off");
        assert.deepEqual(ids(applyFilter(list, filter({ search: "mid", origin: "amiricord" })).plugins), []);
    });
});

describe("counts, restart list and filter options", () => {
    const list = [
        card({ id: "a", name: "Beta", origin: "vencord", tags: ["ui", "chat"], state: { restartNeeded: true } }),
        card({ id: "b", name: "Alpha", state: { wanted: false, running: false, restartNeeded: true } }),
        card({ id: "c", name: "Core", core: true, origin: "amiricord", state: { error: "x" } })
    ];

    it("counts the plugins that can be turned off apart from the core ones", () => {
        assert.deepEqual(countCards(list), { plugins: 2, pluginsOn: 1, core: 1, problems: 1 });
        assert.deepEqual(countCards([]), { plugins: 0, pluginsOn: 0, core: 0, problems: 0 });
    });

    it("lists by name the plugins waiting for a restart", () => {
        assert.deepEqual(waitingForRestart(list), ["Alpha", "Beta"]);
        assert.deepEqual(waitingForRestart([card()]), []);
    });

    it("offers only the origins, tags and authors that cards have, each once, in order", () => {
        assert.deepEqual(filterOptions(list), { origins: ["amiricord", "vencord"], tags: ["chat", "ui"], authors: ["Mixi"] });
        assert.deepEqual(filterOptions([]), { origins: [], tags: [], authors: [] });
        const many = [card({ id: "x", authors: [{ name: "zoe" }, { name: "Bea" }] }), card({ id: "y", authors: [{ name: "Bea" }, { name: "Adam" }] })];
        assert.deepEqual(filterOptions(many).authors, ["Adam", "Bea", "zoe"]);
    });

    it("says whether a card is on and whether it has a problem", () => {
        assert.equal(isOn(card({ state: { wanted: false } })), false);
        assert.equal(isOn(card()), true);
        assert.equal(hasProblem(card()), false);
        assert.equal(hasProblem(card({ state: { error: "x" } })), true);
        assert.equal(hasProblem(card({ state: { skipped: { kind: "quarantined", message: "q" } as never } })), true);
    });
});

describe("isFilterActive and emptyText", () => {
    it("is active when any part differs from the default", () => {
        assert.equal(isFilterActive(DEFAULT_FILTER), false);
        assert.equal(isFilterActive(filter({ search: " x " })), true);
        assert.equal(isFilterActive(filter({ search: "   " })), false);
        for (const part of [{ state: "on" }, { origin: "vencord" }, { risk: "high" }, { tag: "ui" }, { author: "Mixi" }] as Array<Partial<PluginsFilter>>) assert.equal(isFilterActive(filter(part)), true);
    });

    it("says nothing when something is shown", () => {
        assert.equal(emptyText({ plugins: 3, pluginsOn: 1, core: 1, problems: 0 }, 2, DEFAULT_FILTER), "");
    });

    it("says there are no plugins at all, whatever the filters", () => {
        assert.match(emptyText({ plugins: 0, pluginsOn: 0, core: 2, problems: 0 }, 0, DEFAULT_FILTER), /No plugins are installed yet/);
        assert.match(emptyText({ plugins: 0, pluginsOn: 0, core: 2, problems: 0 }, 0, filter({ search: "x" })), /No plugins are installed yet/);
    });

    it("blames the filters when plugins exist but none shows", () => {
        assert.match(emptyText({ plugins: 3, pluginsOn: 1, core: 1, problems: 0 }, 0, filter({ search: "x" })), /No plugin matches/);
        assert.equal(emptyText({ plugins: 3, pluginsOn: 1, core: 1, problems: 0 }, 0, DEFAULT_FILTER), "No plugins to show.");
    });
});

describe("the words of a card", () => {
    it("says why a plugin runs", () => {
        assert.equal(reasonText(card({ state: { reason: "core" } })), "Core plugin: always on");
        assert.equal(reasonText(card({ state: { reason: "chosen" } })), "On because you turned it on");
        assert.equal(reasonText(card({ state: { reason: "default" } })), "On by default");
        assert.equal(reasonText(card({ state: { reason: "dependency", neededBy: ["a"] } })), "Running because a needs it");
        assert.equal(reasonText(card({ state: { reason: "dependency", neededBy: ["a", "b"] } })), "Running because a, b need it");
        assert.equal(reasonText(card({ state: { reason: "dependency", neededBy: [] } })), "Running because another plugin needs it");
        assert.equal(reasonText(card({ state: { reason: undefined } })), "");
    });

    it("says an error first, then why it could not run, then the restart, then the reason, then off", () => {
        const skipped = { kind: "quarantined", message: "In quarantine after three failed starts" } as never;
        assert.equal(statusText(card({ state: { error: "boom", skipped, restartNeeded: true } })), "Failed to start: boom");
        assert.equal(statusText(card({ state: { skipped, restartNeeded: true } })), "In quarantine after three failed starts");
        assert.equal(statusText(card({ state: { restartNeeded: true, wanted: true } })), "Will turn on after a restart");
        assert.equal(statusText(card({ state: { restartNeeded: true, wanted: false } })), "Will turn off after a restart");
        assert.equal(statusText(card({ state: { running: true, reason: "chosen" } })), "On because you turned it on");
        assert.equal(statusText(card({ state: { running: false, wanted: true, reason: undefined } })), "On, but not started");
        assert.equal(statusText(card({ state: { running: false, wanted: false, reason: undefined } })), "Off");
    });

    it("tells when Discord is too old or too new for a plugin", () => {
        assert.equal(compatibilityNote(card({ compatibility: "ok" })), undefined);
        assert.equal(compatibilityNote(card({ compatibility: "unknown" })), undefined);
        assert.match(compatibilityNote(card({ compatibility: "discord-too-old" })) ?? "", /newer Discord/);
        assert.match(compatibilityNote(card({ compatibility: "discord-too-new" })) ?? "", /older Discord/);
    });

    it("names the origins, and an unknown one as it is", () => {
        assert.equal(originLabel("testcord"), "TestCord");
        assert.equal(originLabel("betterdiscord"), "BetterDiscord");
        assert.equal(originLabel("something"), "something");
    });

    it("shows the marks in order: origin, risk, experimental, legacy, restart, tags", () => {
        const marks = cardBadges(card({
            origin: "vencord", risk: { level: "high", label: "High risk" }, experimental: true, legacy: true, restartToToggle: true, tags: ["ui", "chat"]
        })).map(badge => badge.text);
        assert.deepEqual(marks, ["Vencord", "High risk", "Experimental", "Legacy", "Restart to change", "ui", "chat"]);
    });

    it("marks a medium risk, and nothing for a low one", () => {
        assert.deepEqual(cardBadges(card({ risk: { level: "medium" } })).map(b => [b.text, b.tone]), [["Amiricord", "neutral"], ["Medium risk", "warn"]]);
        assert.deepEqual(cardBadges(card()).map(b => b.text), ["Amiricord"]);
    });

    it("uses the engine's own words for the highest risk, and the tones that go with them", () => {
        const badges = cardBadges(card({ risk: { level: "high", label: "High risk" }, experimental: true, restartToToggle: true }));
        assert.deepEqual(badges.map(b => b.tone), ["neutral", "danger", "warn", "info"]);
        assert.equal(cardBadges(card({ risk: { level: "high", label: null } }))[1].text, "High risk");
    });

    it("does not tell a core plugin that a restart is needed to change it, since it cannot be changed", () => {
        assert.deepEqual(cardBadges(card({ core: true, restartToToggle: true })).map(b => b.text), ["Amiricord"]);
    });
});

describe("asking before turning a plugin on", () => {
    it("warns about experimental first, then legacy, and not about an ordinary plugin", () => {
        assert.equal(warningBeforeEnabling(card()), undefined);
        assert.equal(warningBeforeEnabling(card({ legacy: true })), "legacy");
        assert.equal(warningBeforeEnabling(card({ experimental: true })), "experimental");
        assert.equal(warningBeforeEnabling(card({ experimental: true, legacy: true })), "experimental");
    });

    it("names the plugin, and names the replacement of a legacy one when there is one", () => {
        const plain = warningText(card({ name: "Old" }), "legacy");
        assert.match(plain, /^Old is a legacy plugin/);
        assert.doesNotMatch(plain, /replaces it/);
        assert.match(warningText(card({ name: "Old", replacedBy: "NewOne" }), "legacy"), /NewOne replaces it/);
        assert.match(warningText(card({ name: "Wild" }), "experimental"), /^Wild is experimental/);
    });
});

describe("outcomeOf: the words for what the switch answered", () => {
    const c = card({ name: "Plug" });

    it("says the plugin is now on or off when it was applied", () => {
        assert.deepEqual(outcomeOf({ status: "applied" }, c, true), { text: "Plug is now on.", tone: "ok" });
        assert.deepEqual(outcomeOf({ status: "applied" }, c, false), { text: "Plug is now off.", tone: "ok" });
    });

    it("says it was saved when a restart is needed", () => {
        assert.deepEqual(outcomeOf({ status: "restart-needed" }, c, true), { text: "Saved. It changes after Discord restarts.", tone: "info" });
    });

    it("says nothing changed when it already was like that", () => {
        assert.equal(outcomeOf({ status: "unchanged" }, c, true).text, "Nothing changed: it was already on.");
        assert.equal(outcomeOf({ status: "unchanged" }, c, false).text, "Nothing changed: it was already off.");
    });

    it("gives the reason it refused, as a problem", () => {
        assert.deepEqual(outcomeOf({ status: "refused", reason: "core plugins cannot be turned off" }, c, false), { text: "Not changed: core plugins cannot be turned off.", tone: "bad" });
    });

    it("says the choice was saved when it failed to start, and that it stopped with errors when it failed to stop", () => {
        assert.deepEqual(outcomeOf({ status: "failed", error: "boom" }, c, true), { text: "Saved, but it did not start: boom", tone: "bad" });
        assert.deepEqual(outcomeOf({ status: "failed", error: "boom" }, c, false), { text: "Turned off, but it stopped with errors: boom", tone: "bad" });
    });
});

describe("the line a card shows under its description", () => {
    it("says nothing for a plugin that is simply on or off, a core plugin, and one that is on by default or because you turned it on", () => {
        assert.equal(cardStatus(card({ state: { running: true, reason: "default" } })), null);
        assert.equal(cardStatus(card({ state: { running: true, reason: "chosen" } })), null);
        assert.equal(cardStatus(card({ core: true, state: { running: true, reason: "core" } })), null);
        assert.equal(cardStatus(card({ state: { running: false, wanted: false, reason: undefined } })), null);
    });

    it("says a problem, a plugin in quarantine, and a restart that is waiting", () => {
        const skipped = { kind: "quarantined" as const, message: "In quarantine after three failed starts" };
        assert.equal(cardStatus(card({ state: { error: "boom", running: false } })), "Failed to start: boom");
        assert.equal(cardStatus(card({ state: { skipped, running: false } })), "In quarantine after three failed starts");
        assert.equal(cardStatus(card({ state: { restartNeeded: true, wanted: true, running: false } })), "Will turn on after a restart");
        assert.equal(cardStatus(card({ state: { restartNeeded: true, wanted: false, running: true } })), "Will turn off after a restart");
    });

    it("says when another plugin keeps it running, and when it is wanted but did not start", () => {
        assert.equal(cardStatus(card({ state: { running: true, reason: "dependency", neededBy: ["a"] } })), "Running because a needs it");
        assert.equal(cardStatus(card({ state: { running: false, wanted: true, reason: undefined } })), "On, but not started");
    });
});

describe("the footer of a card", () => {
    it("has where it comes from, and no marks or tags for an ordinary plugin", () => {
        assert.deepEqual(cardFooter(card({ origin: "vencord" })), { source: "Vencord", marks: [], tags: [], moreTags: [] });
    });

    it("has the marks that matter, in order, and never the origin or the tags among them", () => {
        const footer = cardFooter(card({ risk: { level: "high", label: "High risk" }, experimental: true, legacy: true, restartToToggle: true, tags: ["ui"] }));
        assert.deepEqual(footer.marks.map(mark => mark.text), ["High risk", "Experimental", "Legacy", "Restart to change"]);
        assert.deepEqual(footer.marks.map(mark => mark.tone), ["danger", "warn", "warn", "info"]);
    });

    it("shows two tags and counts the rest", () => {
        assert.deepEqual(cardFooter(card({ tags: ["ui", "chat"] })).moreTags, []);
        const many = cardFooter(card({ tags: ["ui", "chat", "voice", "media"] }));
        assert.deepEqual([many.tags, many.moreTags], [["ui", "chat"], ["voice", "media"]]);
    });
});
