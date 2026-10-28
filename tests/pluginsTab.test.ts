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
import type { ToggleResult } from "../src/api/pluginSwitch";
import { CORE_LOCK_TEXT, PluginItem } from "../src/plugins/Settings/PluginItem";
import { DEFAULT_FILTER, type Outcome, type PluginsFilter } from "../src/plugins/Settings/pluginsModel";
import { makePluginsTab, RESTART_QUESTION } from "../src/plugins/Settings/PluginsTab";
import { NO_WINDOW_TEXT } from "../src/plugins/Settings/pluginWindowModel";

// --- The same tiny stand-in for React that tests/settingsTabs.test.ts uses. ---------------------------------------------------------------

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

function fakeReact(initial: unknown[] = [], calls: unknown[] = []) {
    const queue = [...initial];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, (value: unknown) => { calls.push(value); }]) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    return { react, calls };
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

afterEach(() => { setReactSource(undefined); });

// --- Fixtures -------------------------------------------------------------------------------------------------------------------------

type Overrides = Partial<Omit<PluginCard, "state" | "risk">> & { state?: Partial<PluginCard["state"]>; };

function card(over: Overrides = {}): PluginCard {
    const base: PluginCard = {
        id: "plug", name: "Plug", version: "1.0.0", description: "Does a thing.", origin: "amiricord", license: "GPL-3.0-or-later", authors: [{ name: "Mixi" }], credits: [],
        tags: [], dependencies: [], core: false, experimental: false, legacy: false, replacedBy: null, requiresRestart: "auto", restartToToggle: false, hasSettings: false, riskySettings: [],
        risk: { level: "low", label: null, reasons: [] }, hosts: [], telemetryHosts: [], compatibility: "ok",
        state: { chosen: undefined, wanted: true, running: true, lifecycle: "started", error: null, reason: "default", neededBy: [], skipped: undefined, restartNeeded: false }
    };
    return { ...base, ...over, state: { ...base.state, ...over.state } };
}

interface Setup { cards?: PluginCard[]; state?: Partial<{ filter: PluginsFilter; notes: Record<string, Outcome>; pending: Record<string, boolean>; question: { id: string; kind: "experimental" | "legacy"; } | null; askingRestart: boolean; }>; result?: ToggleResult | Error; openDetails?: (card: PluginCard) => boolean; }

/** Draws the tab once with the given state, and records what it asks the engine to do. */
function draw(setup: Setup = {}) {
    const toggles: Array<[string, boolean]> = [];
    const restarts: number[] = [];
    const details: string[] = [];
    const initial = [setup.state?.filter ?? DEFAULT_FILTER, setup.state?.notes ?? {}, setup.state?.pending ?? {}, setup.state?.question ?? null, setup.state?.askingRestart ?? false, 0];
    const { react, calls } = fakeReact(initial);
    // Also keep what each setter received on its own, in the order the tab declares its state: filter, notes, pending, question, asking, refresh.
    const bySetter: unknown[][] = initial.map(() => []);
    let slot = 0;
    react.useState = ((_start: unknown) => {
        const index = slot++;
        return [initial[index], (value: unknown) => { calls.push(value); bySetter[index].push(value); }];
    }) as ReactLike["useState"];
    setReactSource(() => react);
    const Tab = makePluginsTab({
        cards: () => setup.cards ?? [],
        toggle: (id, enabled) => {
            toggles.push([id, enabled]);
            return setup.result instanceof Error ? Promise.reject(setup.result) : Promise.resolve(setup.result ?? { status: "applied" });
        },
        restart: () => { restarts.push(1); },
        openDetails: opened => { details.push(opened.id); return setup.openDetails ? setup.openDetails(opened) : true; }
    });
    const tree = render(Tab());
    return { tree, toggles, restarts, details, calls, bySetter };
}

const cardEl = (tree: unknown, id: string) => findAll(tree, el => el.props["data-plugin"] === id)[0];
const switchOf = (tree: unknown, id: string) => findAll(cardEl(tree, id), el => el.props.role === "switch")[0];
const click = (el: El) => (el.props.onClick as () => void)();
const buttonByText = (tree: unknown, text: string) => findAll(tree, el => el.type === "button" && textOf(el) === text)[0];
const inputOf = (tree: unknown, label: string) => findAll(tree, el => el.props["aria-label"] === label)[0];
const tick = () => new Promise<void>(done => setImmediate(done));

/** Applies the functional updates a setter received to a starting value, the way React would. */
function applied<T>(calls: unknown[], start: T): T {
    return calls.reduce<T>((value, call) => typeof call === "function" ? (call as (v: T) => T)(value) : call as T, start);
}

// --- Tests ---------------------------------------------------------------------------------------------------------------------------

describe("the Plugins tab: layout", () => {
    const cards = [card({ id: "b", name: "Beta" }), card({ id: "a", name: "Alpha", state: { wanted: false, running: false, reason: undefined } }), card({ id: "core", name: "Core", core: true, state: { reason: "core" } })];

    it("shows the management card, the two counts, the filters, and the plugins and the core plugins apart, by name", () => {
        const { tree } = draw({ cards });
        const text = textOf(tree);
        assert.match(text, /Plugin Management/);
        assert.match(text, /1 of 2 on/);
        assert.match(text, /Core plugins1/);
        const grids = findAll(tree, el => hasClass(el, "amiricord-plugins-grid"));
        assert.equal(grids.length, 2);
        assert.deepEqual(findAll(grids[0], el => el.props["data-plugin"] !== undefined).map(el => el.props["data-plugin"]), ["a", "b"]);
        assert.deepEqual(findAll(grids[1], el => el.props["data-plugin"] !== undefined).map(el => el.props["data-plugin"]), ["core"]);
        for (const label of ["Search for a plugin", "Filter by state", "Filter by origin", "Filter by risk", "Filter by tag", "Filter by author"]) assert.ok(inputOf(tree, label), label);
    });

    it("says there are no plugins yet instead of drawing an empty grid", () => {
        const { tree } = draw({ cards: [card({ id: "core", name: "Core", core: true })] });
        assert.match(textOf(tree), /None yet/);
        assert.match(textOf(tree), /No plugins are installed yet/);
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-plugins-grid")).length, 1, "only the core grid");
    });

    it("shows no 'Clear filters' button until a filter is set, and then it puts the default filter back", () => {
        assert.equal(buttonByText(draw({ cards }).tree, "Clear filters"), undefined);
        const { tree, calls } = draw({ cards, state: { filter: { ...DEFAULT_FILTER, state: "on" } } });
        click(buttonByText(tree, "Clear filters"));
        assert.deepEqual(calls, [DEFAULT_FILTER]);
    });

    it("blames the filters when they hide every plugin", () => {
        const { tree } = draw({ cards, state: { filter: { ...DEFAULT_FILTER, search: "zzz" } } });
        assert.match(textOf(tree), /No plugin matches/);
        assert.match(textOf(tree), /No core plugin matches/);
    });

    it("offers the origins, tags and authors that exist, and sends the filter the person picks", () => {
        const { tree, calls } = draw({ cards: [card({ id: "v", origin: "vencord", tags: ["ui"], authors: [{ name: "Zed" }] }), card({ id: "w", authors: [{ name: "Ana" }] })] });
        const author = inputOf(tree, "Filter by author");
        assert.deepEqual(findAll(author, el => el.type === "option").map(el => el.props.value), ["", "Ana", "Zed"]);
        const origin = inputOf(tree, "Filter by origin");
        assert.deepEqual(findAll(origin, el => el.type === "option").map(el => el.props.value), ["", "amiricord", "vencord"]);
        const tag = inputOf(tree, "Filter by tag");
        assert.deepEqual(findAll(tag, el => el.type === "option").map(el => el.props.value), ["", "ui"]);

        (inputOf(tree, "Search for a plugin").props.onChange as (e: unknown) => void)({ target: { value: "be" } });
        (origin.props.onChange as (e: unknown) => void)({ target: { value: "vencord" } });
        (inputOf(tree, "Filter by state").props.onChange as (e: unknown) => void)({ target: { value: "off" } });
        (inputOf(tree, "Filter by risk").props.onChange as (e: unknown) => void)({ target: { value: "high" } });
        (tag.props.onChange as (e: unknown) => void)({ target: { value: "ui" } });
        (author.props.onChange as (e: unknown) => void)({ target: { value: "Zed" } });
        assert.deepEqual(applied(calls, DEFAULT_FILTER), { search: "be", origin: "vencord", state: "off", risk: "high", tag: "ui", author: "Zed" });
    });
});

describe("the Plugins tab: the switch", () => {
    it("locks the switch of a core plugin, says why, and does nothing when it is clicked", () => {
        const { tree, toggles, calls } = draw({ cards: [card({ id: "core", name: "Core", core: true })] });
        const sw = switchOf(tree, "core");
        assert.equal(sw.props["aria-disabled"], "true");
        assert.equal(sw.props["aria-checked"], "true");
        assert.equal(sw.props.title, CORE_LOCK_TEXT);
        click(sw);
        assert.deepEqual(toggles, []);
        assert.deepEqual(calls, []);
    });

    it("also refuses a core plugin in the tab itself, if a card ever reported a click for it", () => {
        // The card blocks the click already; this goes around the card and calls what the tab gave it, so the second layer is tested alone.
        const { react } = fakeReact([DEFAULT_FILTER, {}, {}, null, false, 0]);
        setReactSource(() => react);
        const toggles: Array<[string, boolean]> = [];
        const Tab = makePluginsTab({ cards: () => [card({ id: "core", name: "Core", core: true })], toggle: async (id, enabled) => { toggles.push([id, enabled]); return { status: "applied" }; }, restart: () => undefined, openDetails: () => true });
        const flat = (node: unknown): unknown[] => Array.isArray(node) ? node.flatMap(flat) : isEl(node) ? [node, ...node.children.flatMap(flat)] : [];
        const items = flat(Tab()).filter((el): el is El => isEl(el) && el.type === PluginItem);
        assert.equal(items.length, 1);
        (items[0].props.onSwitch as (c: PluginCard) => void)(items[0].props.card as PluginCard);
        assert.deepEqual(toggles, []);
    });

    it("turns a plugin off when it is on, and on when it is off", () => {
        const on = draw({ cards: [card({ id: "p" })] });
        assert.equal(switchOf(on.tree, "p").props["aria-checked"], "true");
        click(switchOf(on.tree, "p"));
        assert.deepEqual(on.toggles, [["p", false]]);

        const off = draw({ cards: [card({ id: "p", state: { wanted: false, running: false, reason: undefined } })] });
        assert.equal(switchOf(off.tree, "p").props["aria-checked"], "false");
        click(switchOf(off.tree, "p"));
        assert.deepEqual(off.toggles, [["p", true]]);
    });

    it("ignores a click while that plugin's switch is still on its way", () => {
        const { tree, toggles } = draw({ cards: [card({ id: "p" })], state: { pending: { p: true } } });
        assert.equal(switchOf(tree, "p").props["aria-disabled"], "true");
        click(switchOf(tree, "p"));
        assert.deepEqual(toggles, []);
    });

    it("replaces the old note with one that says it is working, and marks the switch as on its way, as soon as it is clicked", () => {
        const { tree, bySetter } = draw({ cards: [card({ id: "p", name: "Plug", state: { wanted: false, running: false, reason: undefined } })] });
        click(switchOf(tree, "p"));
        const [, notes, pending, question] = bySetter;
        assert.deepEqual(applied(notes, { p: { text: "old", tone: "ok" } as Outcome, other: { text: "keep", tone: "ok" } as Outcome }), {
            other: { text: "keep", tone: "ok" },
            p: { text: "Starting Plug... if it has to wait for something in Discord this can take up to a minute.", tone: "info" }
        });
        assert.deepEqual(applied(pending, {}), { p: true });
        assert.deepEqual(question, [null]);
    });

    it("says it is turning off, not starting, when a plugin that is on is clicked", () => {
        const { tree, bySetter } = draw({ cards: [card({ id: "p", name: "Plug", state: { running: true, wanted: true } })] });
        click(switchOf(tree, "p"));
        assert.deepEqual((applied(bySetter[1], {}) as Record<string, Outcome>).p, { text: "Turning Plug off...", tone: "info" });
    });

    it("shows the answer of the engine under the card when the switch ends, takes the 'on its way' mark away and reads the cards again", async () => {
        const { tree, bySetter } = draw({ cards: [card({ id: "p", name: "Plug" })], result: { status: "restart-needed" } });
        click(switchOf(tree, "p"));
        await tick();
        const [, notes, pending, , , refresh] = bySetter;
        assert.deepEqual(applied(notes, {} as Record<string, Outcome>).p, { text: "Saved. It changes after Discord restarts.", tone: "info" });
        assert.deepEqual(applied(pending, {}), {}, "set and then cleared");
        assert.equal(pending.length, 2);
        assert.equal(applied(refresh, 0), 1);
    });

    it("turns a failure of the call itself into a note, clears the mark, and never lets the error escape", async () => {
        const { tree, bySetter } = draw({ cards: [card({ id: "p", name: "Plug" })], result: new Error("bridge is down") });
        click(switchOf(tree, "p"));
        await tick();
        const [, notes, pending] = bySetter;
        assert.deepEqual(applied(notes, {} as Record<string, Outcome>).p, { text: "Not changed: bridge is down", tone: "bad" });
        assert.deepEqual(applied(pending, {}), {});
    });

    it("tells the person what the engine answered for turning a plugin on", async () => {
        const off = { wanted: false, running: false, reason: undefined } as const;
        const { tree, toggles, bySetter } = draw({ cards: [card({ id: "p", name: "Plug", state: off })], result: { status: "failed", error: "boom" } });
        click(switchOf(tree, "p"));
        await tick();
        assert.deepEqual(toggles, [["p", true]]);
        assert.deepEqual(applied(bySetter[1], {} as Record<string, Outcome>).p, { text: "Saved, but it did not start: boom", tone: "bad" });
    });
});

describe("the Plugins tab: asking before turning on", () => {
    const off = { wanted: false, running: false, reason: undefined } as const;

    it("asks first for an experimental or a legacy plugin, and does not turn it on yet", () => {
        for (const kind of ["experimental", "legacy"] as const) {
            const { tree, toggles, calls } = draw({ cards: [card({ id: "p", [kind]: true, state: off })] });
            click(switchOf(tree, "p"));
            assert.deepEqual(toggles, [], kind);
            assert.deepEqual(calls, [{ id: "p", kind }], kind);
        }
    });

    it("does not ask to turn such a plugin off", () => {
        const { tree, toggles } = draw({ cards: [card({ id: "p", experimental: true })] });
        click(switchOf(tree, "p"));
        assert.deepEqual(toggles, [["p", false]]);
    });

    it("shows the question under that card only, and 'Turn on anyway' turns it on", () => {
        const cards = [card({ id: "p", name: "Wild", experimental: true, state: off }), card({ id: "q", name: "Calm" })];
        const { tree, toggles } = draw({ cards, state: { question: { id: "p", kind: "experimental" } } });
        assert.match(textOf(cardEl(tree, "p")), /Wild is experimental/);
        assert.doesNotMatch(textOf(cardEl(tree, "q")), /experimental/);
        click(buttonByText(cardEl(tree, "p"), "Turn on anyway") as El);
        assert.deepEqual(toggles, [["p", true]]);
    });

    it("drops the question on Cancel without turning anything on", () => {
        const { tree, toggles, calls } = draw({ cards: [card({ id: "p", experimental: true, state: off })], state: { question: { id: "p", kind: "experimental" } } });
        click(buttonByText(tree, "Cancel"));
        assert.deepEqual(toggles, []);
        assert.deepEqual(calls, [null]);
    });
});

describe("the Plugins tab: restart", () => {
    const waiting = [card({ id: "a", name: "Alpha", state: { restartNeeded: true } }), card({ id: "b", name: "Beta" })];

    it("keeps the usual card, and no restart button, when nothing waits", () => {
        const { tree } = draw({ cards: [card()] });
        assert.equal(buttonByText(tree, "Restart Discord"), undefined);
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-plugins-restart")).length, 0);
    });

    it("turns the top card into 'Restart required', naming the plugins that wait", () => {
        const { tree } = draw({ cards: waiting });
        const [top] = findAll(tree, el => hasClass(el, "amiricord-plugins-restart"));
        assert.match(textOf(top), /Restart required/);
        assert.match(textOf(top), /changes to Alpha\./);
        assert.doesNotMatch(textOf(top), /Beta/);
    });

    it("asks before restarting, and restarts only after 'Restart now'", () => {
        const first = draw({ cards: waiting });
        click(buttonByText(first.tree, "Restart Discord"));
        assert.deepEqual(first.calls, [true]);
        assert.deepEqual(first.restarts, []);

        const asking = draw({ cards: waiting, state: { askingRestart: true } });
        assert.match(textOf(asking.tree), new RegExp(RESTART_QUESTION));
        assert.equal(buttonByText(asking.tree, "Restart Discord"), undefined);
        click(buttonByText(asking.tree, "Restart now"));
        assert.deepEqual(asking.restarts, [1]);
    });

    it("goes back from the question on Cancel without restarting", () => {
        const { tree, restarts, calls } = draw({ cards: waiting, state: { askingRestart: true } });
        click(buttonByText(tree, "Cancel"));
        assert.deepEqual(calls, [false]);
        assert.deepEqual(restarts, []);
    });

    it("does not show the restart question when nothing waits any more, even if it was open", () => {
        const { tree } = draw({ cards: [card()], state: { askingRestart: true } });
        assert.equal(buttonByText(tree, "Restart now"), undefined);
    });
});

describe("the Plugins tab: the gear and the \"i\" of a card", () => {
    const detailsOf = (tree: unknown, id: string) => findAll(cardEl(tree, id), el => el.type === "button" && hasClass(el, "amiricord-plugin-details"))[0];

    it("puts a gear on a plugin with settings and an \"i\" on one without, both next to the switch", () => {
        const { tree } = draw({ cards: [card({ id: "with", name: "With", hasSettings: true }), card({ id: "without", name: "Without", hasSettings: false })] });
        assert.equal(detailsOf(tree, "with").props["aria-label"], "With: open its settings");
        assert.equal(detailsOf(tree, "with").props.title, "Settings");
        assert.equal(detailsOf(tree, "without").props["aria-label"], "Without: open its details");
        assert.equal(detailsOf(tree, "without").props.title, "Details");
        const [controls] = findAll(cardEl(tree, "with"), el => hasClass(el, "amiricord-plugin-controls"));
        assert.deepEqual(controls.children.map(child => (child as El).props.role ?? "details"), ["details", "switch"]);
    });

    it("draws a gear (a disc with a hole cut out of it) for settings and a plain disc with an \"i\" for details", () => {
        const { tree } = draw({ cards: [card({ id: "with", name: "With", hasSettings: true }), card({ id: "without", name: "Without", hasSettings: false })] });
        assert.equal(findAll(detailsOf(tree, "with"), el => el.type === "mask").length, 1, "the gear is cut through a mask");
        assert.equal(findAll(detailsOf(tree, "without"), el => el.type === "mask").length, 0, "the \"i\" is a single shape");
    });

    it("gives a core plugin the button too, because its window is read only information and its switch stays locked", () => {
        const { tree } = draw({ cards: [card({ id: "core", name: "Core", core: true, hasSettings: true, state: { reason: "core" } })] });
        assert.ok(detailsOf(tree, "core"));
    });

    it("opens the window of the plugin that was pressed, and says nothing when it opened", () => {
        const { tree, details, bySetter } = draw({ cards: [card({ id: "a", name: "A", hasSettings: true }), card({ id: "b", name: "B" })] });
        click(detailsOf(tree, "b"));
        assert.deepEqual(details, ["b"]);
        assert.deepEqual(bySetter[1], [], "no note");
    });

    it("tells the person when the window could not be opened, whether it says so or throws", () => {
        const refused = draw({ cards: [card({ id: "a", name: "A" })], openDetails: () => false });
        click(detailsOf(refused.tree, "a"));
        assert.deepEqual(applied(refused.bySetter[1], {}), { a: { text: NO_WINDOW_TEXT, tone: "bad" } });
        const thrown = draw({ cards: [card({ id: "a", name: "A" })], openDetails: () => { throw new Error("boom"); } });
        click(detailsOf(thrown.tree, "a"));
        assert.deepEqual(applied(thrown.bySetter[1], {}), { a: { text: NO_WINDOW_TEXT, tone: "bad" } });
    });
});

describe("the Plugins tab: the layout of a card", () => {
    const footerOf = (tree: unknown, id: string) => findAll(cardEl(tree, id), el => hasClass(el, "amiricord-plugin-footer"))[0];

    it("has the name, the description and a footer, and no version or authors line (the window shows them)", () => {
        const { tree } = draw({ cards: [card({ id: "a", name: "Alpha", version: "9.9.9", authors: [{ name: "Someone" }] })] });
        const text = textOf(cardEl(tree, "a"));
        assert.match(text, /Alpha/);
        assert.match(text, /Does a thing\./);
        assert.doesNotMatch(text, /9\.9\.9/);
        assert.doesNotMatch(text, /Someone/);
        assert.equal(findAll(cardEl(tree, "a"), el => hasClass(el, "amiricord-plugin-name")).map(textOf)[0], "Alpha");
    });

    it("says where the plugin comes from on the left of the footer, and its marks and first two tags on the right with a +N", () => {
        const { tree } = draw({ cards: [card({ id: "a", origin: "vencord", experimental: true, tags: ["ui", "chat", "voice", "media"] })] });
        const footer = footerOf(tree, "a");
        assert.equal(textOf(findAll(footer, el => hasClass(el, "amiricord-plugin-source"))[0]), "Vencord");
        assert.deepEqual(findAll(footer, el => hasClass(el, "amiricord-plugin-badge")).map(textOf), ["Experimental"]);
        const tags = findAll(footer, el => hasClass(el, "amiricord-plugin-tag"));
        assert.deepEqual(tags.map(textOf), ["ui", "chat", "+2"]);
        assert.equal(tags[2].props.title, "voice, media", "the hover text lists the tags that did not fit");
    });

    it("draws no extra line for an ordinary plugin that is on or off, and one for a problem, a note or a question", () => {
        const plain = draw({ cards: [card({ id: "on" }), card({ id: "off", state: { running: false, wanted: false, reason: undefined } })] });
        assert.equal(findAll(plain.tree, el => hasClass(el, "amiricord-plugin-extra")).length, 0);
        const failing = draw({ cards: [card({ id: "bad", state: { error: "boom", running: false } })] });
        const [extra] = findAll(failing.tree, el => hasClass(el, "amiricord-plugin-extra"));
        assert.match(textOf(extra), /Failed to start: boom/);
        assert.equal(findAll(extra, el => hasClass(el, "amiricord-plugin-status-problem")).length, 1);
        const noted = draw({ cards: [card({ id: "n" })], state: { notes: { n: { text: "Saved.", tone: "ok" } } } });
        assert.match(textOf(findAll(noted.tree, el => hasClass(el, "amiricord-plugin-extra"))[0]), /Saved\./);
        assert.equal(findAll(noted.tree, el => hasClass(el, "amiricord-plugin-status")).length, 0, "no empty status line next to a note");
        const asked = draw({ cards: [card({ id: "q", experimental: true })], state: { question: { id: "q", kind: "experimental" } } });
        assert.match(textOf(findAll(asked.tree, el => hasClass(el, "amiricord-plugin-extra"))[0]), /experimental/);
    });

    it("counts nothing when every tag fits: no +N, and no marks for an ordinary plugin", () => {
        const { tree } = draw({ cards: [card({ id: "a", tags: ["ui", "chat"] })] });
        const footer = footerOf(tree, "a");
        assert.deepEqual(findAll(footer, el => hasClass(el, "amiricord-plugin-tag")).map(textOf), ["ui", "chat"]);
        assert.equal(findAll(footer, el => hasClass(el, "amiricord-plugin-badge")).length, 0);
    });

    it("puts the footer last, after the description and any extra line", () => {
        const { tree } = draw({ cards: [card({ id: "bad", state: { error: "boom", running: false } })] });
        const classes = (cardEl(tree, "bad").children as El[]).map(child => String(child.props.className ?? child.type));
        assert.deepEqual(classes.map(name => name.split(" ")[0]), ["amiricord-plugin-head", "amiricord-plugin-desc", "amiricord-plugin-extra", "amiricord-plugin-footer"]);
    });
});
