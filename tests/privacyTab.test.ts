/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import type { PluginCard } from "../src/api/pluginCards";
import { makePrivacyTab, onOff, pauseLeftText, PrivacyTabDeps, REFRESH_MS, testText, verdictOf } from "../src/plugins/Settings/PrivacyTab";
import type { EngineStatus } from "../src/renderer/engine";
import type { BlockLog } from "../src/shared/blocks";
import type { PrivacyAnswer, ProviderTestAnswer } from "../src/shared/privacy";
import type { PrivacyChange, PrivacyChangeResult } from "../src/shared/privacyChange";
import { emptyNetworkCounts } from "../src/shared/shields";

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

/** A stand-in for React: useState answers from a queue and records every call of the setters, useEffect keeps the effect to run by hand. */
function fakeReact(initial: unknown[] = []) {
    const queue = [...initial];
    const setterCalls: unknown[] = [];
    const setterSlots: number[] = [];
    let slots = 0;
    const effects: Array<() => void | (() => void)> = [];
    const effectDeps: Array<readonly unknown[] | undefined> = [];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => { const slot = slots++; return [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, (value: unknown) => { setterCalls.push(value); setterSlots.push(slot); }]; }) as ReactLike["useState"],
        useEffect: (effect, deps) => { effects.push(effect); effectDeps.push(deps); },
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    return { react, setterCalls, setterSlots, effects, effectDeps };
}

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

function render(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(render);
    if (!isEl(node)) return node;
    if (typeof node.type === "function") {
        const children = node.children.length <= 1 ? node.children[0] : node.children;
        return render((node.type as (props: unknown) => unknown)({ ...node.props, ...(children === undefined ? {} : { children }) }));
    }
    return { ...node, children: node.children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined).map(render) };
}

function findAll(node: unknown, test: (el: El) => boolean, found: El[] = []): El[] {
    if (!isEl(node)) return found;
    if (test(node)) found.push(node);
    for (const child of node.children) findAll(child, test, found);
    return found;
}

function textOf(node: unknown): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!isEl(node)) return "";
    return node.children.map(textOf).join("");
}

const hasClass = (el: El, name: string) => typeof el.props.className === "string" && el.props.className.split(" ").includes(name);

/** The text of every row: "name|value". */
const rows = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-row")).map(row => `${textOf(row.children[0])}|${textOf(row.children[1])}`);

/** The text of every counter tile: "label|number". */
const tiles = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-tile")).map(tile => `${textOf(tile.children[1])}|${textOf(tile.children[0])}`);

const click = (el: El | undefined) => { (el!.props.onClick as () => void)(); };
const tick = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => { setReactSource(undefined); });

const status = (change: Partial<EngineStatus> = {}): EngineStatus => ({
    version: "0.1.0", discordBuild: 1, safeMode: false, safeModeReason: null, enteredSafeMode: false, quarantine: [], devMode: false, problems: [],
    selfTests: [{ name: "super-properties", status: "pass", detail: "", ms: 1 }, { name: "first-gateway-message", status: "pass", detail: "", ms: 1 }],
    stopped: { analytics: 4, metrics: 0, "crash-reports": 0 },
    stoppedAt: { analytics: null, metrics: null, "crash-reports": null },
    network: { ...emptyNetworkCounts(), "usage-reports": 1 },
    dns: "Off",
    ...change
} as EngineStatus);

const card = (change: Partial<PluginCard> & { name: string; }): PluginCard => ({
    id: change.name, core: false, hosts: [], state: { running: true }, ...change
} as unknown as PluginCard);

const answer = (change: Partial<PrivacyAnswer> = {}): PrivacyAnswer => ({
    counts: { ...emptyNetworkCounts(), metrics: 7, "token-stripped": 2 },
    dns: { line: "Configured: Quad9, automatic, answered in 38 ms", mode: "automatic", provider: "quad9", saved: { mode: "automatic", provider: "quad9" }, pending: false },
    telemetry: { usage: true, crash: true },
    logVersion: 3,
    rules: [{ id: "r1", host: "m.stripe.com", subdomains: true, reason: "payment fingerprint" }, { id: "r2", host: "x.test", subdomains: false, reason: "" }],
    ruleCount: 2,
    pause: null,
    providers: [
        { id: "quad9", name: "Quad9", host: "dns.quad9.net", filters: "malware", note: "Quad9 note." },
        { id: "mullvad-base", name: "Mullvad (base)", host: "base.dns.mullvad.net", filters: "none", note: "Mullvad note." }
    ],
    ...change
});

/** The answer with one more thing changed inside `dns`. */
const withDns = (dns: Partial<PrivacyAnswer["dns"]>) => answer({ dns: { ...answer().dns, ...dns } });

/** `state` fills the useState calls in the order the tab makes them: answer, tests, notes, open, relaunching. */
function setup(state: unknown[], deps: Partial<PrivacyTabDeps> = {}, result: PrivacyChangeResult | null | Error = { status: "applied", message: "Saved." }) {
    const fake = fakeReact(state);
    setReactSource(() => fake.react);
    const reads: number[] = [];
    const tests: string[] = [];
    const changes: PrivacyChange[] = [];
    const restarts: number[] = [];
    const blockReads: number[] = [];
    let blockList: BlockLog | null = { version: 3, groups: [] };
    const tab = makePrivacyTab({
        status: () => status(),
        cards: () => [],
        read: async () => { reads.push(1); return answer(); },
        test: async id => { tests.push(id); return { ok: true, reason: "", ms: 12 }; },
        change: async change => { changes.push(change); if (result instanceof Error) throw result; return result; },
        restart: () => { restarts.push(1); },
        blocks: async () => { blockReads.push(1); return blockList; },
        now: () => 1_000_000,
        telemetry: () => ({ usage: true, crash: true }),
        ...deps
    });
    return { ...fake, tab, reads, tests, changes, restarts, blockReads, setBlocks: (list: BlockLog | null) => { blockList = list; }, tree: () => render({ type: tab, props: {}, children: [] }) };
}

/** The switch element inside the line whose text starts with `title`. */
const switchOf = (tree: unknown, title: string) => {
    const line = findAll(tree, el => hasClass(el, "amiricord-pswitch")).find(el => textOf(el).startsWith(title));
    return { line: line!, el: findAll(line, el => el.props.role === "switch")[0]! };
};

describe("the verdict at the top", () => {
    const pass = [{ status: "pass" as const }];
    it("is good when the self-test did not fail and both telemetry switches are on", () => {
        assert.deepEqual(verdictOf(pass, { usage: true, crash: true }).level, "good");
        assert.equal(verdictOf(pass, { usage: true, crash: true }).title, "Active");
        assert.equal(verdictOf([], { usage: true, crash: true }).level, "good");
        assert.equal(verdictOf([{ status: "not-seen" }], { usage: true, crash: true }).level, "good");
    });

    it("says a check is needed when a self-test failed, even with the switches on", () => {
        const verdict = verdictOf([{ status: "pass" }, { status: "fail" }], { usage: true, crash: true });
        assert.deepEqual([verdict.level, verdict.title], ["bad", "Check needed"]);
    });

    it("says partial when either switch is off, and a failure outranks it", () => {
        assert.equal(verdictOf(pass, { usage: false, crash: true }).title, "Partial");
        assert.equal(verdictOf(pass, { usage: true, crash: false }).title, "Partial");
        assert.equal(verdictOf(pass, { usage: false, crash: false }).level, "warn");
        assert.equal(verdictOf([{ status: "fail" }], { usage: false, crash: false }).title, "Check needed");
    });

    it("never claims everything is private", () => {
        for (const verdict of [verdictOf(pass, { usage: true, crash: true }), verdictOf(pass, { usage: false, crash: true }), verdictOf([{ status: "fail" }], { usage: true, crash: true })]) {
            assert.doesNotMatch(verdict.title + verdict.detail, /\ball (traffic|requests|your)|completely|fully|anonymous/i);
        }
    });
});

describe("the words", () => {
    it("on and off", () => {
        assert.deepEqual([onOff(true), onOff(false)], ["On", "Off"]);
    });

    it("tells the result of a test and only what is true", () => {
        assert.equal(testText("running"), "Testing...");
        assert.equal(testText(null), "The test could not run");
        assert.equal(testText({ ok: true, reason: "", ms: 38 }), "Answered in 38 ms");
        assert.equal(testText({ ok: true, reason: "", ms: null }), "Answered in 0 ms");
        assert.equal(testText({ ok: false, reason: "the provider did not answer within 3 seconds", ms: null }), "Did not pass: the provider did not answer within 3 seconds");
    });
});

describe("the Privacy & Security tab, what it shows", () => {
    it("shows the summary, the status table and the counters from the engine status and the snapshot", () => {
        const t = setup([answer(), {}]);
        const tree = t.tree();
        const all = rows(tree);
        assert.ok(all.includes("Privacy check|properties passed, first message passed"), all.join("\n"));
        assert.ok(all.includes("Engine|Chromium\u2019s own resolver"), all.join("\n"));
        assert.ok(all.includes("Encrypted DNS|Configured: Quad9, automatic, answered in 38 ms"));
        assert.ok(all.includes("Endpoint|dns.quad9.net"));
        assert.ok(all.includes("Mode|Automatic (falls back to the system's DNS)"));
        const counters = tiles(tree);
        assert.ok(counters.includes("Usage events|4"), "what NoTrack stopped comes from the engine status");
        assert.ok(counters.includes("Metrics reports|7"), "network counters come from the snapshot, not the older status");
        assert.ok(counters.includes("Token removed|2"));
    });

    it("uses the engine status and this page's own switches until the snapshot has come, and offers no control that needs it", () => {
        const t = setup([undefined, {}]);
        const tree = t.tree();
        const all = rows(tree);
        assert.ok(tiles(tree).includes("Usage reports|1"));
        assert.deepEqual(all.filter(row => row.startsWith("Encrypted DNS|")), ["Encrypted DNS|Off"]);
        assert.ok(all.includes("Rules|Not known yet"));
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-dropdown")).length, 0);
        assert.equal(findAll(tree, el => el.type === "button" && ["Test now", "Refresh"].includes(textOf(el))).length, 0);
        assert.equal(switchOf(tree, "Encrypted DNS").el.props.onClick, undefined, "the DNS switch cannot be used before the snapshot says what is saved");
        assert.equal(switchOf(tree, "Block crash reports").el.props["aria-checked"], "true");
    });

    it("says so when the main process did not answer", () => {
        assert.ok(rows(setup([null, {}]).tree()).includes("Rules|The main process did not answer"));
    });

    it("shows the verdict as a badge with a dot, in the colour of the verdict", () => {
        const badge = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-badge"))[0]!;
        const good = badge(setup([answer(), {}]).tree());
        assert.equal(textOf(good), "Active");
        assert.ok(hasClass(good, "amiricord-badge-good"));
        assert.equal(findAll(good, el => hasClass(el, "amiricord-badge-dot")).length, 1);
        const warn = badge(setup([answer({ telemetry: { usage: false, crash: true } }), {}]).tree());
        assert.equal(textOf(warn), "Partial");
        assert.ok(hasClass(warn, "amiricord-badge-warn"));
        const bad = badge(setup([answer(), {}], { status: () => status({ selfTests: [{ name: "super-properties", status: "fail", detail: "", ms: 1 }] }) }).tree());
        assert.equal(textOf(bad), "Check needed");
        assert.ok(hasClass(bad, "amiricord-badge-bad"));
    });

    it("marks the counters as live and a switched-off Secure Connect as still", () => {
        const badges = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-badge")).map(el => `${textOf(el)}:${["good", "warn", "bad", "off", "live"].find(level => hasClass(el, "amiricord-badge-" + level))}`);
        const on = badges(setup([answer(), {}]).tree());
        assert.ok(on.includes("Live, this session:live"));
        const off = badges(setup([withDns({ mode: "off" }), {}]).tree());
        assert.ok(off.includes("Off:off"));
        assert.ok(off.includes("Live, this session:live"));
    });

    it("keeps the two counter groups apart and never adds them", () => {
        const tree = setup([answer(), {}]).tree();
        const headings = findAll(tree, el => hasClass(el, "amiricord-subheading")).map(textOf);
        assert.deepEqual(headings, ["DNS provider", "Stopped inside Discord", "Cancelled on the network", "Covered"]);
        const counters = tiles(tree);
        assert.equal(counters.length, 9);
        assert.ok(!counters.some(line => /total|all/i.test(line)));
    });

    it("shows what is covered in the colour of what is switched on", () => {
        const chips = (telemetry: { usage: boolean; crash: boolean; }, ruleCount = 0) => findAll(setup([answer({ telemetry, ruleCount, rules: [] }), {}]).tree(), el => hasClass(el, "amiricord-pchip"))
            .map(chip => `${textOf(chip)}:${hasClass(chip, "amiricord-pchip-on") ? "on" : "off"}`);
        assert.deepEqual(chips({ usage: true, crash: true }), ["Usage reports:on", "Metrics:on", "Crash reports:on", "Telemetry host:on", "Token guard:on", "Your host rules:off"]);
        assert.deepEqual(chips({ usage: false, crash: true }, 3), ["Usage reports:off", "Metrics:off", "Crash reports:on", "Telemetry host:off", "Token guard:on", "Your host rules:on"]);
        assert.deepEqual(chips({ usage: true, crash: false }), ["Usage reports:on", "Metrics:on", "Crash reports:off", "Telemetry host:on", "Token guard:on", "Your host rules:off"]);
    });

    it("shows every counter under its own name, with its own number and its own colour", () => {
        const tree = setup([answer({ counts: { "usage-reports": 11, metrics: 12, "crash-reports": 13, "telemetry-host": 14, "host-rules": 15, "token-stripped": 16 } }), {}], {
            status: () => status({ stopped: { analytics: 1, metrics: 2, "crash-reports": 3 } })
        }).tree();
        assert.deepEqual(tiles(tree), [
            "Usage events|1", "Metrics|2", "Crash report hooks|3",
            "Usage reports|11", "Metrics reports|12", "Crash reports|13", "Telemetry pings|14", "Blocked by your rules|15", "Token removed|16"
        ]);
        for (const tile of findAll(tree, el => hasClass(el, "amiricord-tile"))) assert.match(String((tile.props.style as { borderTopColor?: string; }).borderTopColor), /^#[0-9a-f]{6}$/);
    });

    it("says in the counters card that the token guard is always on", () => {
        const card = findAll(setup([answer(), {}]).tree(), el => hasClass(el, "amiricord-pcard")).find(el => textOf(findAll(el, h => hasClass(h, "amiricord-pcard-title"))[0]) === "Protection counters")!;
        assert.match(textOf(card), /The token guard is always on/);
    });

    it("has the cards in order", () => {
        const tree = setup([answer(), {}]).tree();
        const cards = findAll(tree, el => hasClass(el, "amiricord-pcard"));
        assert.deepEqual(cards.map(card => textOf(findAll(card, el => hasClass(el, "amiricord-pcard-title"))[0])), ["Privacy Protection", "Secure Connect", "Who the client talks to", "Protection counters", "Blocked sites", "Recent blocks"]);
    });

    it("lists Discord and the running plugins that declared hosts, and no others", () => {
        const cards = [
            card({ name: "Lyrics", hosts: [{ host: "lrclib.net", from: "main", why: "x" }, { host: "api.test", from: "renderer", why: "y" }] }),
            card({ name: "Asleep", hosts: [{ host: "off.test", from: "main", why: "x" }], state: { running: false } as PluginCard["state"] }),
            card({ name: "Quiet" }),
            card({ name: "CorePlugin", core: true, hosts: [{ host: "core.test", from: "main", why: "x" }] })
        ];
        const all = rows(setup([answer(), {}], { cards: () => cards }).tree());
        assert.ok(all.includes("Discord|discord.com and its own hosts"));
        assert.ok(all.includes("Lyrics|lrclib.netapi.test"), "one pill per site");
        const pills = findAll(findAll(setup([answer(), {}], { cards: () => cards }).tree(), el => hasClass(el, "amiricord-row")).find(row => textOf(row.children[0]) === "Lyrics"), el => hasClass(el, "amiricord-pchip")).map(textOf);
        assert.deepEqual(pills, ["lrclib.net", "api.test"]);
        assert.ok(!all.some(row => /Asleep|Quiet|CorePlugin|off\.test|core\.test/.test(row)));
        assert.ok(!all.some(row => row.startsWith("Plugins|")));
    });

    it("says no plugin connects elsewhere when none does", () => {
        assert.ok(rows(setup([answer(), {}]).tree()).includes("Plugins|None connect elsewhere"));
    });

    it("lists the owner's rules with a plain name and the reason, and says when none was written", () => {
        const all = rows(setup([answer(), {}]).tree());
        assert.ok(all.includes("m.stripe.com and below|payment fingerprintRemove"));
        assert.ok(all.includes("x.test|No reason writtenRemove"));
        assert.ok(rows(setup([answer({ rules: [], ruleCount: 0 }), {}]).tree()).includes("Rules|None"));
    });

    it("says how many rules are not shown", () => {
        assert.ok(rows(setup([answer({ ruleCount: 5000 }), {}]).tree()).includes("More|4998 more rules are not shown"));
        assert.ok(!rows(setup([answer(), {}]).tree()).some(row => row.startsWith("More|")));
    });

    it("promises nothing it does not do: no button that is not wired, and what comes later is named", () => {
        const tree = setup([answer(), {}]).tree();
        const labels = findAll(tree, el => el.type === "button").map(textOf);
        assert.ok(!labels.some(label => /delete/i.test(label)), labels.join(", "));
        const everything = textOf(tree);
        assert.match(everything, /Coming soon/);
        assert.doesNotMatch(everything, /all your traffic|fully protected/i);
    });
});

describe("the switches", () => {
    it("show the real state of each one, and the Strict switch cannot be used while encrypted DNS is off", () => {
        const tree = setup([answer({ telemetry: { usage: true, crash: false }, dns: { ...answer().dns, saved: { mode: "automatic", provider: "quad9" } } }), {}]).tree();
        assert.equal(switchOf(tree, "Block usage reports and metrics").el.props["aria-checked"], "true");
        assert.equal(switchOf(tree, "Block crash reports").el.props["aria-checked"], "false");
        assert.equal(switchOf(tree, "Encrypted DNS").el.props["aria-checked"], "true");
        assert.equal(switchOf(tree, "Strict mode").el.props["aria-checked"], "false");
        for (const title of ["Block usage reports and metrics", "Block crash reports", "Encrypted DNS", "Strict mode"]) {
            const live = switchOf(tree, title).el;
            assert.deepEqual([typeof live.props.onClick, live.props["aria-disabled"], live.props.tabIndex], ["function", "false", 0], title);
            assert.ok(hasClass(live, "amiricord-switch-live"));
        }
        const off = switchOf(setup([withDns({ saved: { mode: "off", provider: "quad9" } }), {}]).tree(), "Strict mode").el;
        assert.deepEqual([off.props.onClick, off.props["aria-disabled"], off.props.tabIndex, off.props["aria-checked"]], [undefined, "true", -1, "false"]);
        assert.deepEqual(findAll(tree, el => el.type === "input").map(el => el.props.type), ["text", "text", "search"], "the fields are the two of the blocked sites form and the search of the recent blocks");
        assert.equal(findAll(tree, el => /account token/.test(textOf(el)) && hasClass(el, "amiricord-pswitch")).length, 0, "the token guard has no switch: it is always on");
    });

    it("show the DNS switch off when nothing is saved, and on when something is", () => {
        assert.equal(switchOf(setup([withDns({ saved: { mode: "off", provider: "" } }), {}]).tree(), "Encrypted DNS").el.props["aria-checked"], "false");
        assert.equal(switchOf(setup([withDns({ saved: { mode: "strict", provider: "quad9" } }), {}]).tree(), "Encrypted DNS").el.props["aria-checked"], "true");
    });

    it("ask the main process for the opposite change when clicked, never apply it themselves", () => {
        const flip = (title: string, telemetry: { usage: boolean; crash: boolean; }, dns?: Partial<PrivacyAnswer["dns"]>) => {
            const t = setup([answer({ telemetry, dns: { ...answer().dns, ...dns } }), {}]);
            click(switchOf(t.tree(), title).el);
            return t.changes;
        };
        assert.deepEqual(flip("Block usage reports and metrics", { usage: true, crash: true }), [{ type: "telemetry", key: "disableAnalytics", value: false }]);
        assert.deepEqual(flip("Block usage reports and metrics", { usage: false, crash: true }), [{ type: "telemetry", key: "disableAnalytics", value: true }]);
        assert.deepEqual(flip("Block crash reports", { usage: true, crash: true }), [{ type: "telemetry", key: "disableCrashReports", value: false }]);
        assert.deepEqual(flip("Block crash reports", { usage: true, crash: false }), [{ type: "telemetry", key: "disableCrashReports", value: true }]);
        assert.deepEqual(flip("Encrypted DNS", { usage: true, crash: true }, { saved: { mode: "strict", provider: "quad9" } }), [{ type: "dns", mode: "off", provider: "quad9" }]);
        assert.deepEqual(flip("Encrypted DNS", { usage: true, crash: true }, { saved: { mode: "off", provider: "quad9" } }), [{ type: "dns", mode: "automatic", provider: "quad9" }]);
    });

    it("answer to the Enter and Space keys, and to no other, and do nothing when they cannot be used", () => {
        const t = setup([answer(), {}]);
        const live = switchOf(t.tree(), "Block crash reports").el;
        const press = (key: string) => { let prevented = false; (live.props.onKeyDown as (event: unknown) => void)({ key, preventDefault: () => { prevented = true; } }); return prevented; };
        assert.equal(press("a"), false);
        assert.equal(press("Tab"), false);
        assert.deepEqual(t.changes, []);
        assert.equal(press("Enter"), true);
        assert.equal(press(" "), true);
        assert.equal(t.changes.length, 2);
        const idle = setup([withDns({ saved: { mode: "off", provider: "quad9" } }), {}]);
        const strict = switchOf(idle.tree(), "Strict mode").el;
        (strict.props.onKeyDown as (event: unknown) => void)({ key: "Enter" });
        assert.deepEqual(idle.changes, [], "the Strict switch does nothing while encrypted DNS is off");
    });

    it("say 'Waiting', then the sentence the main process answered, and read the snapshot again", async () => {
        const t = setup([answer(), {}], {}, { status: "cancelled", message: "Nothing was changed." });
        click(switchOf(t.tree(), "Block crash reports").el);
        const first = t.setterCalls[0] as (previous: Record<string, string>) => Record<string, string>;
        assert.deepEqual(first({ other: "x" }), { other: "x", disableCrashReports: "Waiting for the answer..." });
        await tick();
        const second = t.setterCalls[1] as (previous: Record<string, string>) => Record<string, string>;
        assert.deepEqual(second({ other: "x" }), { other: "x", disableCrashReports: "Nothing was changed." });
        assert.equal(t.reads.length, 1, "the snapshot is asked again");
        await tick();
        assert.ok(t.setterCalls.some(call => call !== null && typeof call === "object" && !(typeof call === "function") && "telemetry" in (call as object)));
    });

    it("say the main process did not answer when it gives null or fails", async () => {
        for (const result of [null, new Error("down")]) {
            const t = setup([answer(), {}], {}, result);
            click(switchOf(t.tree(), "Block usage reports and metrics").el);
            await tick();
            const last = t.setterCalls.find(call => typeof call === "function" && (call as (p: Record<string, string>) => Record<string, string>)({}).disableAnalytics === "The main process did not answer.");
            assert.ok(last, String(result));
        }
    });

    it("show the sentence under the switch it belongs to", () => {
        const tree = setup([answer(), {}, { disableAnalytics: "Saved. Done.", dnsSwitch: "DNS sentence." }]).tree();
        assert.match(textOf(switchOf(tree, "Block usage reports and metrics").line), /Saved\. Done\./);
        assert.match(textOf(switchOf(tree, "Encrypted DNS").line), /DNS sentence\./);
        assert.doesNotMatch(textOf(switchOf(tree, "Block crash reports").line), /Saved|DNS sentence/);
    });

    it("carry the Restart tag only while what was saved is not what this page runs", () => {
        const tag = (title: string, telemetry: { usage: boolean; crash: boolean; }, own: { usage: boolean; crash: boolean; }, pending = false) =>
            /Restart/.test(textOf(switchOf(setup([withDns({ pending }), {}].map((value, index) => (index === 0 ? { ...(value as PrivacyAnswer), telemetry } : value)), { telemetry: () => own }).tree(), title).line));
        assert.equal(tag("Block usage reports and metrics", { usage: true, crash: true }, { usage: true, crash: true }), false);
        assert.equal(tag("Block usage reports and metrics", { usage: false, crash: true }, { usage: true, crash: true }), true);
        assert.equal(tag("Block crash reports", { usage: false, crash: true }, { usage: true, crash: true }), false);
        assert.equal(tag("Block crash reports", { usage: true, crash: false }, { usage: true, crash: true }), true);
        assert.equal(tag("Block usage reports and metrics", { usage: true, crash: false }, { usage: true, crash: true }), false);
        assert.equal(tag("Encrypted DNS", { usage: true, crash: true }, { usage: true, crash: true }, true), true);
        assert.equal(tag("Encrypted DNS", { usage: true, crash: true }, { usage: true, crash: true }, false), false);
        assert.equal(tag("Strict mode", { usage: true, crash: true }, { usage: true, crash: true }, true), true);
        assert.equal(tag("Strict mode", { usage: true, crash: true }, { usage: true, crash: true }, false), false);
    });
});

describe("the relaunch notice", () => {
    const notice = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-restart"))[0];

    it("is not there when nothing is pending", () => {
        assert.equal(notice(setup([answer(), {}]).tree()), undefined);
    });

    it("is there when the DNS choice or a switch is pending, and asks before it relaunches", () => {
        for (const pending of [withDns({ pending: true }), answer({ telemetry: { usage: false, crash: true } }), answer({ telemetry: { usage: true, crash: false } })]) {
            const closed = notice(setup([pending, {}]).tree())!;
            assert.match(textOf(closed), /finishes when Discord starts again/);
            const buttons = findAll(closed, el => el.type === "button");
            assert.deepEqual(buttons.map(textOf), ["Relaunch Discord"]);
            const t = setup([pending, {}]);
            click(findAll(notice(t.tree()), el => el.type === "button")[0]);
            assert.deepEqual(t.setterCalls, [true]);
            assert.deepEqual(t.restarts, [], "the first click only opens the question");
        }
    });

    it("relaunches only after the second click, and can be cancelled", () => {
        const t = setup([withDns({ pending: true }), {}, {}, false, true]);
        const open = notice(t.tree())!;
        assert.match(textOf(open), /closes any call and loses messages you have not sent/);
        const buttons = findAll(open, el => el.type === "button");
        assert.deepEqual(buttons.map(textOf), ["Relaunch now", "Cancel"]);
        click(buttons[1]);
        assert.deepEqual([t.setterCalls, t.restarts], [[false], []]);
        click(buttons[0]);
        assert.deepEqual(t.restarts, [1]);
    });
});

describe("Secure Connect", () => {
    const selectOf = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-select"))[0]!;

    it("shows the chosen provider on the drop-down, the default when nothing is saved, and a plain word for an own address or an unknown one", () => {
        assert.equal(textOf(selectOf(setup([answer(), {}]).tree())), "Quad9");
        assert.equal(textOf(selectOf(setup([withDns({ saved: { mode: "off", provider: "" } }), {}]).tree())), "Mullvad (base) · default");
        assert.equal(textOf(selectOf(setup([withDns({ saved: { mode: "automatic", provider: "custom" } }), {}]).tree())), "Your own address");
        assert.equal(textOf(selectOf(setup([withDns({ saved: { mode: "automatic", provider: "gone" } }), {}]).tree())), "Choose a provider");
    });

    it("opens the list on a click and shows every provider with the chosen one marked", () => {
        const closed = setup([answer(), {}]);
        const tree = closed.tree();
        assert.equal(findAll(tree, el => el.props.role === "listbox").length, 0);
        assert.equal(selectOf(tree).props["aria-expanded"], "false");
        click(selectOf(tree));
        assert.deepEqual(closed.setterCalls, [true]);

        const open = setup([answer(), {}, {}, true]).tree();
        assert.equal(selectOf(open).props["aria-expanded"], "true");
        const options = findAll(open, el => el.props.role === "option");
        assert.deepEqual(options.map(textOf), ["Quad9Blocks malware sites", "Mullvad (base)"]);
        assert.deepEqual(options.map(option => option.props["aria-selected"]), ["true", "false"]);
        assert.ok(hasClass(options[0]!, "amiricord-option-on"));
        assert.ok(!hasClass(options[1]!, "amiricord-option-on"));
    });

    it("closes the list when clicked again", () => {
        const t = setup([answer(), {}, {}, true]);
        click(selectOf(t.tree()));
        assert.deepEqual(t.setterCalls, [false]);
    });

    it("asks for the provider that was picked, keeping the saved mode, and closes the list", () => {
        const t = setup([answer(), {}, {}, true]);
        click(findAll(t.tree(), el => el.props.role === "option")[1]);
        assert.deepEqual(t.changes, [{ type: "dns", mode: "automatic", provider: "mullvad-base" }]);
        assert.ok(t.setterCalls.includes(false), "the list closes");
        const off = setup([withDns({ saved: { mode: "off", provider: "" } }), {}, {}, true]);
        click(findAll(off.tree(), el => el.props.role === "option")[0]);
        assert.deepEqual(off.changes, [{ type: "dns", mode: "off", provider: "quad9" }]);
    });

    it("marks the default provider as chosen when nothing is saved", () => {
        const options = findAll(setup([withDns({ saved: { mode: "off", provider: "" } }), {}, {}, true]).tree(), el => el.props.role === "option");
        assert.deepEqual(options.map(option => option.props["aria-selected"]), ["false", "true"]);
        assert.ok(hasClass(options[1]!, "amiricord-option-on"));
    });

    it("shows the note of the chosen provider, and none when there is none", () => {
        assert.deepEqual(findAll(setup([answer(), {}]).tree(), el => hasClass(el, "amiricord-provider-note")).map(textOf), ["Quad9 note."]);
        assert.deepEqual(findAll(setup([withDns({ saved: { mode: "off", provider: "" } }), {}]).tree(), el => hasClass(el, "amiricord-provider-note")).map(textOf), ["Mullvad note."]);
        assert.deepEqual(findAll(setup([withDns({ saved: { mode: "automatic", provider: "gone" } }), {}]).tree(), el => hasClass(el, "amiricord-provider-note")), []);
    });

    it("has a Strict switch that asks for Strict or back to Automatic with the chosen provider", () => {
        const toStrict = setup([withDns({ saved: { mode: "automatic", provider: "mullvad-base" } }), {}]);
        click(switchOf(toStrict.tree(), "Strict mode").el);
        assert.deepEqual(toStrict.changes, [{ type: "dns", mode: "strict", provider: "mullvad-base" }]);
        const back = setup([withDns({ saved: { mode: "strict", provider: "mullvad-base" } }), {}]);
        const strict = switchOf(back.tree(), "Strict mode").el;
        assert.equal(strict.props["aria-checked"], "true");
        click(strict);
        assert.deepEqual(back.changes, [{ type: "dns", mode: "automatic", provider: "mullvad-base" }]);
    });

    it("asks for Strict with the default provider when the file holds a mode but no provider", () => {
        const t = setup([withDns({ saved: { mode: "automatic", provider: "" } }), {}]);
        click(switchOf(t.tree(), "Strict mode").el);
        assert.deepEqual(t.changes, [{ type: "dns", mode: "strict", provider: "mullvad-base" }]);
    });

    it("turns encrypted DNS on in Automatic with the saved provider, or with the default when none was saved, and off keeping the provider", () => {
        const on = (provider: string) => { const t = setup([withDns({ saved: { mode: "off", provider } }), {}]); click(switchOf(t.tree(), "Encrypted DNS").el); return t.changes; };
        assert.deepEqual(on(""), [{ type: "dns", mode: "automatic", provider: "mullvad-base" }]);
        assert.deepEqual(on("quad9"), [{ type: "dns", mode: "automatic", provider: "quad9" }]);
        const off = setup([withDns({ saved: { mode: "automatic", provider: "" } }), {}]);
        click(switchOf(off.tree(), "Encrypted DNS").el);
        assert.deepEqual(off.changes, [{ type: "dns", mode: "off", provider: "" }]);
    });

    it("explains the saved mode in words", () => {
        const words = (mode: "off" | "automatic" | "strict") => rows(setup([withDns({ saved: { mode, provider: "quad9" } }), {}]).tree()).find(row => row.startsWith("Mode|"));
        assert.equal(words("off"), "Mode|Off");
        assert.equal(words("automatic"), "Mode|Automatic (falls back to the system's DNS)");
        assert.equal(words("strict"), "Mode|Strict (never falls back)");
    });

    it("shows the sentence of the last DNS change under the controls", () => {
        const withNote = findAll(setup([answer(), {}, { dns: "Saved. Encrypted DNS takes effect the next time Discord starts." }]).tree(), el => hasClass(el, "amiricord-note")).map(textOf);
        assert.deepEqual(withNote, ["Saved. Encrypted DNS takes effect the next time Discord starts."]);
        assert.deepEqual(findAll(setup([answer(), {}]).tree(), el => hasClass(el, "amiricord-note")), []);
    });

    it("tells the endpoint of the chosen provider, or of the default when nothing is saved, and none for an unknown one", () => {
        const endpoint = (saved: PrivacyAnswer["dns"]["saved"]) => rows(setup([withDns({ saved }), {}]).tree()).find(row => row.startsWith("Endpoint|"));
        assert.equal(endpoint({ mode: "strict", provider: "mullvad-base" }), "Endpoint|base.dns.mullvad.net");
        assert.equal(endpoint({ mode: "off", provider: "quad9" }), "Endpoint|dns.quad9.net");
        assert.equal(endpoint({ mode: "off", provider: "" }), "Endpoint|base.dns.mullvad.net");
        assert.equal(endpoint({ mode: "automatic", provider: "gone" }), "Endpoint|None chosen");
    });

    it("shows its state in its own badge: active only while a mode is in force", () => {
        const badge = (state: unknown[]) => {
            const card = findAll(setup(state).tree(), el => hasClass(el, "amiricord-pcard")).find(el => textOf(findAll(el, h => hasClass(h, "amiricord-pcard-title"))[0]) === "Secure Connect")!;
            const el = findAll(card, x => hasClass(x, "amiricord-badge"))[0]!;
            return `${textOf(el)}:${["good", "off"].find(level => hasClass(el, "amiricord-badge-" + level))}`;
        };
        assert.equal(badge([answer(), {}]), "Active:good");
        assert.equal(badge([withDns({ mode: "off", line: "Off" }), {}]), "Off:off");
        assert.equal(badge([undefined, {}]), "Off:off");
    });
});

describe("Test now", () => {
    const testButton = (tree: unknown) => findAll(tree, el => el.type === "button" && textOf(el) === "Test now")[0]!;
    const resultLine = (tree: unknown) => textOf(findAll(tree, el => hasClass(el, "amiricord-provider-result"))[0]);

    it("tests the chosen provider, shows 'Testing...' at once and then the result", async () => {
        const t = setup([withDns({ saved: { mode: "off", provider: "mullvad-base" } }), {}]);
        click(testButton(t.tree()));
        assert.deepEqual(t.tests, ["mullvad-base"]);
        await tick();
        const [first, second] = t.setterCalls as Array<(previous: Record<string, unknown>) => Record<string, unknown>>;
        assert.deepEqual(first!({ other: 1 }), { other: 1, "mullvad-base": "running" });
        assert.deepEqual(second!({ other: 1 }), { other: 1, "mullvad-base": { ok: true, reason: "", ms: 12 } });
    });

    it("cannot be used for an unknown provider, and says why; with nothing saved it tests the default", () => {
        const none = setup([withDns({ saved: { mode: "automatic", provider: "gone" } }), {}]);
        const tree = none.tree();
        assert.equal(testButton(tree).props.disabled, true);
        assert.equal(resultLine(tree), "Choose a provider to test it.");
        click(testButton(tree));
        assert.deepEqual(none.tests, []);
        const fresh = setup([withDns({ saved: { mode: "off", provider: "" } }), {}]);
        const button = testButton(fresh.tree());
        assert.equal(button.props.disabled, false);
        click(button);
        assert.deepEqual(fresh.tests, ["mullvad-base"]);
    });

    it("says what it does before it is used, shows the result after, and is disabled while it runs", () => {
        assert.equal(resultLine(setup([answer(), {}]).tree()), "Test now asks the provider a question; it changes nothing.");
        const ok = setup([answer(), { quad9: { ok: true, reason: "", ms: 31 } as ProviderTestAnswer }]).tree();
        assert.equal(resultLine(ok), "Answered in 31 ms");
        assert.equal(testButton(ok).props.disabled, false);
        const failed = setup([answer(), { quad9: { ok: false, reason: "no answer", ms: null } as ProviderTestAnswer }]).tree();
        assert.equal(resultLine(failed), "Did not pass: no answer");
        const running = setup([answer(), { quad9: "running" }]).tree();
        assert.equal(resultLine(running), "Testing...");
        assert.equal(testButton(running).props.disabled, true);
        const other = setup([answer(), { "mullvad-base": "running" }]).tree();
        assert.equal(testButton(other).props.disabled, false, "a test of another provider does not block this one");
        assert.equal(resultLine(other), "Test now asks the provider a question; it changes nothing.");
    });

    it("follows the default provider when nothing is saved: its test is the one shown and the one that blocks the button", () => {
        const saved = { mode: "off" as const, provider: "" };
        const running = setup([withDns({ saved }), { "mullvad-base": "running" }]).tree();
        assert.equal(testButton(running).props.disabled, true);
        assert.equal(resultLine(running), "Testing...");
        const done = setup([withDns({ saved }), { "mullvad-base": { ok: true, reason: "", ms: 20 } }]).tree();
        assert.equal(resultLine(done), "Answered in 20 ms");
        const other = setup([withDns({ saved }), { quad9: "running" }]).tree();
        assert.equal(testButton(other).props.disabled, false);
    });

    it("has a Refresh button that reads the snapshot again", () => {
        const t = setup([answer(), {}]);
        const refresh = findAll(t.tree(), el => el.type === "button" && textOf(el) === "Refresh")[0];
        click(refresh);
        assert.equal(t.reads.length, 1);
    });

    it("keeps working when a test fails to run at all", async () => {
        const t = setup([answer(), {}], { test: async () => { throw new Error("bridge down"); } });
        click(testButton(t.tree()));
        await tick();
        const last = t.setterCalls.at(-1) as (previous: Record<string, unknown>) => Record<string, unknown>;
        assert.deepEqual(last({}), { quad9: null });
    });
});

describe("the refresh of the Privacy & Security tab", () => {
    it("asks for the snapshot when it opens and again every two seconds, and stops when it is closed", async () => {
        const t = setup([undefined, {}]);
        t.tree();
        assert.equal(t.effects.length, 1);
        const timers: Array<{ ms: number | undefined; run: () => void; cleared: boolean; }> = [];
        const realSet = globalThis.setInterval;
        const realClear = globalThis.clearInterval;
        globalThis.setInterval = ((run: () => void, ms?: number) => { timers.push({ ms, run, cleared: false }); return timers.length - 1; }) as unknown as typeof setInterval;
        globalThis.clearInterval = ((id: number) => { timers[id]!.cleared = true; }) as unknown as typeof clearInterval;
        try {
            const cleanup = t.effects[0]!() as () => void;
            assert.equal(REFRESH_MS, 2000);
            assert.equal(timers[0]!.ms, 2000);
            assert.deepEqual(t.effectDeps, [[]], "the effect runs once, when the tab opens");
            assert.equal(t.reads.length, 1, "asks at once");
            timers[0]!.run();
            assert.equal(t.reads.length, 2);
            await tick();
            assert.equal(t.setterCalls.length, 3, "two answers and one list of blocks (asked once, the number did not change)");
            cleanup();
            assert.equal(timers[0]!.cleared, true);
            const before = t.setterCalls.length;
            timers[0]!.run();
            await tick();
            assert.equal(t.setterCalls.length, before, "an answer that arrives after the tab closed is ignored");
        } finally {
            globalThis.setInterval = realSet;
            globalThis.clearInterval = realClear;
        }
    });

    it("treats a failing read as 'no answer' and ignores it once closed", async () => {
        const t = setup([undefined, {}], { read: async () => { throw new Error("down"); } });
        t.tree();
        const realSet = globalThis.setInterval;
        const realClear = globalThis.clearInterval;
        globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
        globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval;
        try {
            const cleanup = t.effects[0]!() as () => void;
            await tick();
            assert.deepEqual(t.setterCalls, [null]);
            cleanup();
        } finally {
            globalThis.setInterval = realSet;
            globalThis.clearInterval = realClear;
        }
    });

    it("uses the pause the caller gave", () => {
        const t = setup([undefined, {}], { refreshMs: 500 });
        t.tree();
        const seen: Array<number | undefined> = [];
        const realSet = globalThis.setInterval;
        const realClear = globalThis.clearInterval;
        globalThis.setInterval = ((_run: () => void, ms?: number) => { seen.push(ms); return 0; }) as unknown as typeof setInterval;
        globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval;
        try {
            (t.effects[0]!() as () => void)();
        } finally {
            globalThis.setInterval = realSet;
            globalThis.clearInterval = realClear;
        }
        assert.deepEqual(seen, [500]);
    });

    it("ignores a failure that arrives after the tab was closed", async () => {
        let fail: (error: Error) => void = () => undefined;
        const t = setup([undefined, {}], { read: () => new Promise((_resolve, reject) => { fail = reject; }) });
        t.tree();
        const realSet = globalThis.setInterval;
        const realClear = globalThis.clearInterval;
        globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
        globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval;
        try {
            const cleanup = t.effects[0]!() as () => void;
            cleanup();
            fail(new Error("late"));
            await tick();
            assert.deepEqual(t.setterCalls, []);
        } finally {
            globalThis.setInterval = realSet;
            globalThis.clearInterval = realClear;
        }
    });
});

describe("the Recent blocks card", () => {
    const groupOf = (change: Partial<BlockLog["groups"][number]> = {}): BlockLog["groups"][number] => ({ kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 1, agoMs: 7000, ...change });
    const list = (groups: BlockLog["groups"], version = 3): BlockLog => ({ version, groups });
    const quiet = () => status({ stopped: { analytics: 0, metrics: 0, "crash-reports": 0 } });
    const blockCard = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-pcard")).find(el => textOf(findAll(el, h => hasClass(h, "amiricord-pcard-title"))[0]) === "Recent blocks")!;
    const lines = (tree: unknown) => findAll(blockCard(tree), el => hasClass(el, "amiricord-block")).map(el => textOf(el));
    const empty = (tree: unknown) => findAll(blockCard(tree), el => hasClass(el, "amiricord-blocks-empty")).map(textOf);

    it("shows each group with its title, count, place, tags, badge and age", () => {
        const tree = setup([answer(), {}, {}, false, false, list([groupOf({ count: 3 }), groupOf({ kind: "token-stripped", host: "stranger.test", path: "/", method: "GET", agoMs: 65_000 })])], { status: quiet }).tree();
        assert.deepEqual(lines(tree), [
            "Usage report blocked×3POST discord.com/api/*/scienceUSAGENETWORKBLOCKED7s ago",
            "Token removed from a requestGET stranger.testTOKENNETWORKSTRIPPED1m ago"
        ]);
    });

    it("shows no count for a single block, and the badge in its own colour class", () => {
        const tree = setup([answer(), {}, {}, false, false, list([groupOf(), groupOf({ kind: "token-stripped", host: "b.test" })])], { status: quiet }).tree();
        assert.equal(findAll(blockCard(tree), el => hasClass(el, "amiricord-block-count")).length, 0);
        assert.deepEqual(findAll(blockCard(tree), el => hasClass(el, "amiricord-block-badge")).map(el => hasClass(el, "amiricord-block-badge-blocked") ? "blocked" : hasClass(el, "amiricord-block-badge-stripped") ? "stripped" : "?"), ["blocked", "stripped"]);
    });

    it("shows what NoTrack stopped inside Discord as its own lines, using this page's clock", () => {
        const tree = setup([answer(), {}, {}, false, false, list([])], { status: () => status({ stopped: { analytics: 212, metrics: 0, "crash-reports": 1 }, stoppedAt: { analytics: 990_000, metrics: null, "crash-reports": 400_000 } }) }).tree();
        assert.deepEqual(lines(tree), [
            "Usage events stopped inside Discord×212USAGEINSIDE DISCORDBLOCKED10s ago",
            "Crash report hooks stopped inside DiscordCRASHINSIDE DISCORDBLOCKED10m ago"
        ]);
    });

    it("says what is true when there is nothing to show", () => {
        assert.deepEqual(empty(setup([answer(), {}, {}, false, false, list([])], { status: quiet }).tree()), ["Nothing has been blocked in this session yet."]);
        assert.deepEqual(empty(setup([answer(), {}, {}, false, false, null], { status: quiet }).tree()), ["The main process did not answer."]);
        assert.deepEqual(empty(setup([answer(), {}], { status: quiet }).tree()), ["Nothing has been blocked in this session yet."], "before the list has come");
        assert.deepEqual(empty(setup([answer(), {}, {}, false, false, list([groupOf()]), "zzz"], { status: quiet }).tree()), ["No block matches the search."]);
        assert.deepEqual(lines(setup([answer(), {}, {}, false, false, list([groupOf()])], { status: quiet }).tree()).length, 1);
    });

    it("searches as the person types, from the first page, and shows only what matches", () => {
        const groups = [groupOf({ host: "discord.com" }), groupOf({ kind: "host-rules", host: "m.stripe.com", path: "/" })];
        const t = setup([answer(), {}, {}, false, false, list(groups), "stripe"], { status: quiet });
        const tree = t.tree();
        assert.deepEqual(lines(tree).length, 1);
        assert.match(lines(tree)[0]!, /Blocked by your rules/);
        const input = findAll(blockCard(tree), el => el.type === "input")[0]!;
        assert.deepEqual([input.props.type, input.props.value, input.props.placeholder], ["search", "stripe", "Search blocks..."]);
        (input.props.onChange as (event: unknown) => void)({ target: { value: "abc" } });
        assert.deepEqual(t.setterCalls, ["abc", 0]);
    });

    it("has eight lines to a page, and a pager that stops at both ends", () => {
        const groups = Array.from({ length: 20 }, (_, i) => groupOf({ host: `h${i}.test`, agoMs: i * 1000 }));
        const first = setup([answer(), {}, {}, false, false, list(groups), "", 0], { status: quiet });
        const tree = first.tree();
        assert.equal(lines(tree).length, 8);
        const pager = (card: unknown) => findAll(blockCard(card), el => hasClass(el, "amiricord-pager"))[0]!;
        assert.equal(textOf(findAll(pager(tree), el => hasClass(el, "amiricord-pager-text"))[0]), "Page 1 of 3");
        const [prev, next] = findAll(pager(tree), el => el.type === "button");
        assert.deepEqual([prev!.props.disabled, next!.props.disabled], [true, false]);
        click(next);
        assert.deepEqual(first.setterCalls, [1]);

        const last = setup([answer(), {}, {}, false, false, list(groups), "", 2], { status: quiet });
        const lastTree = last.tree();
        assert.equal(lines(lastTree).length, 4);
        assert.equal(textOf(findAll(pager(lastTree), el => hasClass(el, "amiricord-pager-text"))[0]), "Page 3 of 3");
        const [prev3, next3] = findAll(pager(lastTree), el => el.type === "button");
        assert.deepEqual([prev3!.props.disabled, next3!.props.disabled], [false, true]);
        click(prev3);
        assert.deepEqual(last.setterCalls, [1]);
    });

    it("brings a page that is too far back into range when the list shrinks", () => {
        const tree = setup([answer(), {}, {}, false, false, list([groupOf()]), "", 5], { status: quiet }).tree();
        assert.equal(lines(tree).length, 1);
        assert.equal(textOf(findAll(blockCard(tree), el => hasClass(el, "amiricord-pager-text"))[0]), "Page 1 of 1");
    });

    it("asks for each file through the confirmed channel and shows the sentence it was answered with", async () => {
        const t = setup([answer(), {}, {}, false, false, list([])], { status: quiet }, { status: "applied", message: "Saved recent-blocks-x.json in the exports folder. Only host." });
        const buttons = findAll(blockCard(t.tree()), el => el.type === "button" && /^Export/.test(textOf(el)));
        assert.deepEqual(buttons.map(textOf), ["Export JSON", "Export CSV"]);
        click(buttons[0]);
        click(buttons[1]);
        assert.deepEqual(t.changes, [{ type: "export-blocks", format: "json" }, { type: "export-blocks", format: "csv" }]);
        await tick();
        const sentences = t.setterCalls.filter(call => typeof call === "function" && (call as (p: Record<string, string>) => Record<string, string>)({}).export?.startsWith("Saved"));
        assert.equal(sentences.length, 2, "both files get their sentence under the export buttons");
        const shown = findAll(blockCard(setup([answer(), {}, { export: "Saved recent-blocks-x.json." }, false, false, list([])], { status: quiet }).tree()), el => hasClass(el, "amiricord-note")).map(textOf);
        assert.deepEqual(shown, ["Saved recent-blocks-x.json."]);
    });

    it("says what it never shows, and that the rest comes later", () => {
        const text = textOf(blockCard(setup([answer(), {}], { status: quiet }).tree()));
        assert.match(text, /Never a query, an id or a token/);
        assert.match(text, /cleared when Discord closes/);
        assert.match(text, /Pausing protection for ten minutes and resetting to the defaults come later/);
    });
});

describe("when the tab asks for the list of blocks", () => {
    const withTimers = async (work: (run: (n: number) => void) => Promise<void>) => {
        const timers: Array<() => void> = [];
        const realSet = globalThis.setInterval;
        const realClear = globalThis.clearInterval;
        globalThis.setInterval = ((run: () => void) => { timers.push(run); return timers.length - 1; }) as unknown as typeof setInterval;
        globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval;
        try {
            await work(n => { timers[n]!(); });
        } finally {
            globalThis.setInterval = realSet;
            globalThis.clearInterval = realClear;
        }
    };

    it("asks at once, and again only when the number in the snapshot changed", async () => {
        let version = 3;
        const t = setup([undefined, {}], { read: async () => answer({ logVersion: version }) });
        t.tree();
        await withTimers(async run => {
            t.effects[0]!();
            await tick();
            assert.equal(t.blockReads.length, 1);
            run(0);
            await tick();
            assert.equal(t.blockReads.length, 1, "the same number: no new ask");
            version = 4;
            run(0);
            await tick();
            assert.equal(t.blockReads.length, 2, "a new number: ask again");
            run(0);
            await tick();
            assert.equal(t.blockReads.length, 2);
        });
    });

    it("does not ask twice for the same number while the first answer is still on its way", async () => {
        const t = setup([undefined, {}]);
        t.tree();
        await withTimers(async run => {
            t.effects[0]!();
            run(0);
            await tick();
            assert.equal(t.blockReads.length, 1);
        });
    });

    it("tries again when the list did not come, and then does not ask again for the same number", async () => {
        let fail = true;
        const reads: number[] = [];
        const t = setup([undefined, {}], { blocks: async () => { reads.push(1); if (fail) throw new Error("down"); return { version: 3, groups: [] }; } });
        t.tree();
        await withTimers(async run => {
            t.effects[0]!();
            await tick();
            assert.equal(reads.length, 1);
            assert.ok(t.setterCalls.includes(null), "the list is marked as not answered");
            fail = false;
            run(0);
            await tick();
            assert.equal(reads.length, 2, "asked again although the number did not change");
            run(0);
            await tick();
            assert.equal(reads.length, 2, "and then not again");
        });
        const none = setup([undefined, {}], { blocks: async () => null });
        none.tree();
        await withTimers(async run => {
            none.effects[0]!();
            await tick();
            run(0);
            await tick();
            assert.equal(none.setterCalls.filter(call => call === null).length, 2, "a null answer is asked for again");
        });
    });

    it("ignores a failure of the list that arrives after the tab closed", async () => {
        let fail: (error: Error) => void = () => undefined;
        const late = setup([undefined, {}], { blocks: () => new Promise<BlockLog>((_resolve, reject) => { fail = reject; }) });
        late.tree();
        await withTimers(async () => {
            const cleanup = late.effects[0]!() as () => void;
            await tick();
            cleanup();
            const before = late.setterCalls.length;
            fail(new Error("late"));
            await tick();
            assert.equal(late.setterCalls.length, before);
        });
    });

    it("does not ask when the snapshot did not come, and ignores a list that arrives after the tab closed", async () => {
        const t = setup([undefined, {}], { read: async () => null });
        t.tree();
        await withTimers(async () => {
            t.effects[0]!();
            await tick();
            assert.equal(t.blockReads.length, 0);
        });
        let release: (list: BlockLog) => void = () => undefined;
        const late = setup([undefined, {}], { blocks: () => new Promise<BlockLog>(resolve => { release = resolve; }) });
        late.tree();
        await withTimers(async () => {
            const cleanup = late.effects[0]!() as () => void;
            await tick();
            cleanup();
            const before = late.setterCalls.length;
            release({ version: 3, groups: [] });
            await tick();
            assert.equal(late.setterCalls.length, before);
        });
    });
});

describe("the Blocked sites card", () => {
    /** The state queue up to the three fields of the form: answer, tests, notes, open, relaunching, blocks, query, page, site, why, below. */
    const withForm = (host: string, reason: string, below: boolean, notes: Record<string, string> = {}, snapshot: PrivacyAnswer | null | "unknown" = answer()) =>
        [snapshot === "unknown" ? undefined : snapshot, {}, notes, false, false, { version: 3, groups: [] }, "", 0, host, reason, below];
    const blocked = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-pcard")).find(el => textOf(findAll(el, h => hasClass(h, "amiricord-pcard-title"))[0]) === "Blocked sites")!;
    const buttons = (tree: unknown) => findAll(blocked(tree), el => el.type === "button");
    const fields = (tree: unknown) => findAll(blocked(tree), el => el.type === "input");

    it("has a site field, a why field, the below switch (on at first) and the Block site button, only once the snapshot is known", () => {
        const tree = setup(withForm("", "", true)).tree();
        assert.deepEqual(fields(tree).map(el => [el.props["aria-label"], el.props.placeholder, el.props.type]), [
            ["Site to block", "Site, for example ads.example.com", "text"], ["Why (optional)", "Why (optional)", "text"]
        ]);
        const below = findAll(blocked(tree), el => el.props.role === "switch")[0]!;
        assert.deepEqual([below.props["aria-checked"], below.props["aria-disabled"]], ["true", "false"]);
        assert.match(textOf(blocked(tree)), /Also block everything under it/);
        assert.ok(buttons(tree).map(textOf).includes("Block site"));
        const before = setup(withForm("", "", true, {}, "unknown")).tree();
        assert.deepEqual([fields(before).length, buttons(before).map(textOf).includes("Block site")], [0, false]);
        const none = setup(withForm("", "", true, {}, null)).tree();
        assert.equal(fields(none).length, 0);
    });

    it("keeps what is typed in the page's own state, and shows it", () => {
        const t = setup(withForm("ads.test", "tracks me", false));
        const tree = t.tree();
        assert.deepEqual(fields(tree).map(el => el.props.value), ["ads.test", "tracks me"]);
        assert.equal(findAll(blocked(tree), el => el.props.role === "switch")[0]!.props["aria-checked"], "false");
        const [site, why] = fields(tree);
        (site!.props.onChange as (event: unknown) => void)({ target: { value: "new.test" } });
        (why!.props.onChange as (event: unknown) => void)({ target: { value: "because" } });
        click(findAll(blocked(tree), el => el.props.role === "switch")[0]);
        assert.deepEqual(t.setterCalls, ["new.test", "because", true]);
        assert.deepEqual(t.setterSlots, [8, 9, 10], "the site, the reason and the switch each go to their own place");
        const flip = setup(withForm("", "", true));
        click(findAll(blocked(flip.tree()), el => el.props.role === "switch")[0]);
        assert.deepEqual(flip.setterCalls, [false]);
    });

    it("keeps the Block site button off until something is typed, spaces do not count", () => {
        const button = (host: string) => buttons(setup(withForm(host, "", true)).tree()).find(el => textOf(el) === "Block site")!;
        assert.equal(button("").props.disabled, true);
        assert.equal(button("   ").props.disabled, true);
        assert.equal(button("a.test").props.disabled, false);
    });

    it("asks to block the typed site with the switch and the reason as they are, and clears the form when the main process accepted it", async () => {
        const t = setup(withForm("ads.test", "tracks me", false), {}, { status: "applied", message: "Blocked. It takes effect at once." });
        click(buttons(t.tree()).find(el => textOf(el) === "Block site"));
        assert.deepEqual(t.changes, [{ type: "rule-add", host: "ads.test", subdomains: false, reason: "tracks me" }]);
        await tick();
        assert.ok(t.setterCalls.includes(""), "the fields are emptied");
        assert.equal(t.setterCalls.filter(call => call === "").length, 2, "both of them");
        const sentence = t.setterCalls.find(call => typeof call === "function" && (call as (p: Record<string, string>) => Record<string, string>)({}).rules === "Blocked. It takes effect at once.");
        assert.ok(sentence);
    });

    it("keeps what was typed when the main process refused, so it can be corrected", async () => {
        const t = setup(withForm("discord.com", "x", true), {}, { status: "refused", message: "Discord's own sites cannot be blocked from here: they would stop Discord." });
        click(buttons(t.tree()).find(el => textOf(el) === "Block site"));
        await tick();
        assert.ok(!t.setterCalls.includes(""), "nothing is emptied");
        const cancelled = setup(withForm("a.test", "x", true), {}, { status: "cancelled", message: "Nothing was changed." });
        click(buttons(cancelled.tree()).find(el => textOf(el) === "Block site"));
        await tick();
        assert.ok(!cancelled.setterCalls.includes(""));
        const silent = setup(withForm("a.test", "x", true), {}, null);
        click(buttons(silent.tree()).find(el => textOf(el) === "Block site"));
        await tick();
        assert.ok(!silent.setterCalls.includes(""));
    });

    it("has a Remove button on each rule that asks for that rule by its id, and the main process does the asking", () => {
        const t = setup(withForm("", "", true));
        const remove = buttons(t.tree()).filter(el => textOf(el) === "Remove");
        assert.equal(remove.length, 2);
        click(remove[1]);
        click(remove[0]);
        assert.deepEqual(t.changes, [{ type: "rule-remove", id: "r2" }, { type: "rule-remove", id: "r1" }]);
        const first = t.setterCalls[0] as (previous: Record<string, string>) => Record<string, string>;
        assert.deepEqual(first({}), { rules: "Waiting for the answer..." }, "the sentence goes under the card of the sites");
        assert.deepEqual(t.setterCalls.filter(call => call === ""), [], "taking a site off does not touch the form");
    });

    it("has no Remove button when there are no rules, or no snapshot", () => {
        for (const snapshot of [answer({ rules: [], ruleCount: 0 }), null, "unknown" as const]) assert.equal(buttons(setup(withForm("", "", true, {}, snapshot)).tree()).filter(el => textOf(el) === "Remove").length, 0);
    });

    it("shows the sentence of the last change under the form", () => {
        const notes = findAll(blocked(setup(withForm("", "", true, { rules: "Removed. It takes effect at once." })).tree()), el => hasClass(el, "amiricord-note")).map(textOf);
        assert.deepEqual(notes, ["Removed. It takes effect at once."]);
        assert.deepEqual(findAll(blocked(setup(withForm("", "", true)).tree()), el => hasClass(el, "amiricord-note")), []);
    });

    it("says what it never does: Discord's own sites are refused, a new block is at once, taking one off asks", () => {
        const text = textOf(blocked(setup(withForm("", "", true)).tree()));
        assert.match(text, /A new block takes effect at once; taking one off asks you first/);
        assert.match(text, /Discord.s own sites cannot be blocked from here/);
        assert.doesNotMatch(text, /coming in the next piece/);
    });
});

describe("the compact look of Blocked sites and Who the client talks to", () => {
    const cardOf = (tree: unknown, title: string) => findAll(tree, el => hasClass(el, "amiricord-pcard")).find(el => textOf(findAll(el, h => hasClass(h, "amiricord-pcard-title"))[0]) === title)!;

    it("puts the two fields and the button in one form, and the below switch last, as a compact line without a long explanation", () => {
        const form = findAll(cardOf(setup([answer(), {}]).tree(), "Blocked sites"), el => hasClass(el, "amiricord-rule-form"))[0]!;
        assert.deepEqual(form.children.filter(isEl).map(el => (el.type === "input" ? "input" : el.type === "button" ? "button" : hasClass(el, "amiricord-pswitch") ? "switch" : "other")), ["input", "input", "button", "switch"]);
        const line = findAll(form, el => hasClass(el, "amiricord-pswitch"))[0]!;
        assert.ok(hasClass(line, "amiricord-pswitch-compact"));
        assert.equal(findAll(line, el => hasClass(el, "amiricord-switch-desc")).length, 0, "no explanation line");
        assert.equal(textOf(line), "Also block everything under it");
    });

    it("keeps the switches of the top card with their explanation, and not compact", () => {
        const tree = setup([answer(), {}]).tree();
        const top = findAll(cardOf(tree, "Privacy Protection"), el => hasClass(el, "amiricord-pswitch"));
        assert.equal(top.length, 3);
        assert.ok(top.every(line => !hasClass(line, "amiricord-pswitch-compact") && findAll(line, el => hasClass(el, "amiricord-switch-desc")).length === 1));
    });

    it("says in one short sentence what Who the client talks to is, and that it is declared and not counted", () => {
        const text = findAll(cardOf(setup([answer(), {}]).tree(), "Who the client talks to"), el => hasClass(el, "amiricord-pcard-text")).map(textOf);
        assert.deepEqual(text, ["Discord, and the sites your running plugins said they connect to (declared, not counted)."]);
    });
});

describe("the pause on the tab", () => {
    const pass = [{ status: "pass" as const }];

    it("shows Paused, in warn, while a pause runs, and says what keeps working", () => {
        const verdict = verdictOf(pass, { usage: true, crash: true }, true);
        assert.deepEqual([verdict.level, verdict.title], ["warn", "Paused"]);
        assert.ok(verdict.detail.includes("token guard") && verdict.detail.includes("Crash reports"));
        assert.equal(verdictOf(pass, { usage: true, crash: true }, false).title, "Active");
    });

    it("lets a failed privacy check outrank the pause", () => {
        assert.equal(verdictOf([{ status: "fail" }], { usage: true, crash: true }, true).title, "Check needed");
    });

    it("counts the minutes up, never showing less than one", () => {
        assert.equal(pauseLeftText(600_000), "about 10 min left");
        assert.equal(pauseLeftText(540_001), "about 10 min left");
        assert.equal(pauseLeftText(61_000), "about 2 min left");
        assert.equal(pauseLeftText(60_000), "about 1 min left");
        assert.equal(pauseLeftText(1), "about 1 min left");
        assert.equal(pauseLeftText(0), "about 1 min left");
    });

    const PAUSE_BUTTONS = ["Pause protection for 10 minutes", "Resume now", "Reset to defaults"];
    const labels = (tree: unknown) => findAll(tree, el => el.type === "button").map(textOf).filter(label => PAUSE_BUTTONS.includes(label));

    it("offers to pause and to reset while it is not paused, and no banner", () => {
        const tree = setup([answer(), {}]).tree();
        assert.deepEqual(labels(tree), ["Pause protection for 10 minutes", "Reset to defaults"]);
        assert.ok(!textOf(tree).includes("Paused,"));
    });

    it("shows the banner with the time left and Resume now instead of Pause while paused", () => {
        const tree = setup([answer({ pause: { remainingMs: 150_000 } }), {}]).tree();
        assert.ok(textOf(tree).includes("Paused, about 3 min left."));
        assert.deepEqual(labels(tree), ["Resume now", "Reset to defaults"]);
        const badge = findAll(tree, el => hasClass(el, "amiricord-badge"))[0]!;
        assert.ok(hasClass(badge, "amiricord-badge-warn") && textOf(badge) === "Paused");
    });

    it("shows no pause buttons before the main process has answered", () => {
        assert.deepEqual(labels(setup([undefined, {}]).tree()), []);
    });

    it("asks the main process for each change and applies nothing itself", () => {
        const t = setup([answer(), {}]);
        const tree = t.tree();
        click(findAll(tree, el => el.type === "button" && textOf(el) === "Pause protection for 10 minutes")[0]);
        click(findAll(tree, el => el.type === "button" && textOf(el) === "Reset to defaults")[0]);
        const paused = setup([answer({ pause: { remainingMs: 1000 } }), {}]);
        click(findAll(paused.tree(), el => el.type === "button" && textOf(el) === "Resume now")[0]);
        assert.deepEqual(t.changes, [{ type: "pause" }, { type: "reset-defaults" }]);
        assert.deepEqual(paused.changes, [{ type: "resume" }]);
    });
});
