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
import type { PluginSettingsAnswer, PluginSettingsComponent, SettingInfo } from "../src/api/pluginSettings";
import { GONE_TEXT, makePluginWindow, RESET_DONE_TEXT, type WindowParts } from "../src/plugins/Settings/PluginWindow";
import { NONE_TEXT, OFF_TEXT, RESET_QUESTION, RESTART_NOTE, RISKY_QUESTION } from "../src/plugins/Settings/pluginWindowModel";
import type { JsonValue } from "../src/shared/settings";

// --- The same tiny stand-in for React as in tests/pluginsTab.test.ts. ----------------------------------------------------------------------

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

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

/** Applies the functional updates a setter received to a starting value, the way React would. */
function applied<T>(calls: unknown[], start: T): T {
    return calls.reduce<T>((value, call) => typeof call === "function" ? (call as (v: T) => T)(value) : call as T, start);
}

afterEach(() => { setReactSource(undefined); });

// --- Fixtures ---------------------------------------------------------------------------------------------------------------------------

const part = (className: string) => ({ children }: { children?: unknown; }) => ({ type: "div", props: { className }, children: [children].flat() });
const parts: WindowParts = {
    ModalRoot: part("root"), ModalHeader: part("header"), ModalContent: part("content"), ModalFooter: part("footer"),
    ModalCloseButton: ({ onClick }) => ({ type: "button", props: { className: "close", onClick }, children: ["x"] })
};

const info = (over: Partial<SettingInfo> = {}): SettingInfo => ({ key: "size", type: "number", description: "A size", default: 5, value: 5, changed: false, restartNeeded: false, risky: false, min: 1, max: 10, integer: true, ...over });

const card = (over: Partial<PluginCard> = {}): PluginCard => ({
    id: "plug", name: "Plug", version: "1.2.0", description: "Does a thing.", origin: "amiricord", license: "GPL-3.0-or-later", authors: [{ name: "Mixi" }, { name: "szlcx404" }], credits: [],
    tags: ["ui"], dependencies: [], core: false, experimental: true, legacy: false, replacedBy: null, requiresRestart: "auto", restartToToggle: false, hasSettings: true, riskySettings: [],
    risk: { level: "low", label: null, reasons: [] }, hosts: [], telemetryHosts: [], compatibility: "ok",
    state: { chosen: undefined, wanted: true, running: true, lifecycle: "started", error: null, reason: "default", neededBy: [], skipped: undefined, restartNeeded: false },
    ...over
});

interface Draw {
    card?: PluginCard | null;
    answer?: PluginSettingsAnswer;
    /** What setSetting answers: a sentence for a refusal, null for success. */
    refuse?: string | null;
    resetAnswer?: string | null;
    /** The component the plugin draws below its settings, and the error boundary the window is given. */
    component?: PluginSettingsComponent;
    guard?: (props: { label: string; children?: unknown; }) => unknown;
    state?: Partial<{ drafts: Record<string, string>; errors: Record<string, string>; asking: { key: string; value: JsonValue; } | null; restartKeys: Record<string, boolean>; askingReset: boolean; resetNote: string | null; }>;
}

function draw(over: Draw = {}) {
    const sets: Array<[string, string, JsonValue]> = [];
    const resets: string[] = [];
    const closes: number[] = [];
    const initial = [over.state?.drafts ?? {}, over.state?.errors ?? {}, over.state?.asking ?? null, over.state?.restartKeys ?? {}, over.state?.askingReset ?? false, over.state?.resetNote ?? null, 0];
    const bySetter: unknown[][] = initial.map(() => []);
    let slot = 0;
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((_start: unknown) => { const index = slot++; return [initial[index], (value: unknown) => { bySetter[index].push(value); }]; }) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    setReactSource(() => react);
    const Window = makePluginWindow({
        card: () => (over.card === null ? undefined : over.card ?? card()),
        settingsOf: () => over.answer ?? { state: "ready", settings: [info()] },
        setSetting: (id, key, value) => { sets.push([id, key, value]); return over.refuse ?? null; },
        resetSettings: id => { resets.push(id); return over.resetAnswer ?? null; },
        componentOf: () => over.component,
        guard: over.guard,
        parts
    });
    const tree = render(Window({ id: "plug", onClose: () => { closes.push(1); } }));
    return { tree, sets, resets, closes, bySetter };
}

const control = (tree: unknown, label: string) => findAll(tree, el => el.props["aria-label"] === label)[0];
const buttonByText = (tree: unknown, text: string) => findAll(tree, el => el.type === "button" && textOf(el) === text)[0];
const press = (el: El) => (el.props.onClick as () => void)();

// --- Tests ---------------------------------------------------------------------------------------------------------------------------------

describe("the window of a plugin: what it shows", () => {
    it("shows the name with its version, the description, the marks of the card and the authors", () => {
        const { tree } = draw();
        const text = textOf(tree);
        assert.match(text, /Plugv1\.2\.0/);
        assert.match(text, /Does a thing\./);
        assert.match(text, /Experimental/);
        const authors = findAll(tree, el => hasClass(el, "amiricord-pwin-author")).map(textOf);
        assert.deepEqual(authors, ["Mixi", "szlcx404"]);
    });

    it("says so when there is no description or no author", () => {
        const { tree } = draw({ card: card({ description: "", authors: [] }) });
        assert.match(textOf(tree), /This plugin has no description\./);
        assert.match(textOf(tree), /No authors listed\./);
    });

    it("says there are no settings for a plugin without them, and has no Reset button", () => {
        const { tree } = draw({ answer: { state: "none" } });
        assert.match(textOf(tree), new RegExp(NONE_TEXT.replace(".", "\\.")));
        assert.equal(buttonByText(tree, "Reset"), undefined);
        assert.ok(buttonByText(tree, "Close"));
    });

    it("says to turn the plugin on when it is off and its settings cannot be read", () => {
        const { tree } = draw({ answer: { state: "not-loaded" } });
        assert.match(textOf(tree), new RegExp(OFF_TEXT.replace(".", "\\.")));
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-pwin-row")).length, 0);
        assert.equal(buttonByText(tree, "Reset"), undefined);
    });

    it("says the plugin is gone when the card no longer exists", () => {
        const { tree } = draw({ card: null });
        assert.match(textOf(tree), new RegExp(GONE_TEXT.replace(".", "\\.")));
    });

    it("draws a row per setting with a readable title, its description, and a control of the right kind", () => {
        const answer: PluginSettingsAnswer = {
            state: "ready",
            settings: [
                info(),
                info({ key: "label", type: "string", description: "A label", default: "hi", value: "hi", maxLength: 8, min: undefined, max: undefined, integer: undefined }),
                info({ key: "loudMode", type: "boolean", description: "Be loud", default: false, value: true, min: undefined, max: undefined, integer: undefined }),
                info({ key: "mode", type: "select", description: "A mode", default: "a", value: "b", options: [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }], min: undefined, max: undefined, integer: undefined })
            ]
        };
        const { tree } = draw({ answer });
        const titles = findAll(tree, el => hasClass(el, "amiricord-pwin-row-title")).map(textOf);
        assert.deepEqual(titles, ["Size", "Label", "Loud Mode", "Mode"]);
        assert.equal(control(tree, "Size").type, "input");
        assert.equal(control(tree, "Label").type, "input");
        assert.equal(control(tree, "Loud Mode").props.role, "switch");
        assert.equal(control(tree, "Loud Mode").props["aria-checked"], "true");
        const select = control(tree, "Mode");
        assert.equal(select.type, "select");
        assert.equal(select.props.value, "b");
        assert.deepEqual(findAll(select, el => el.type === "option").map(textOf), ["Alpha", "Beta"]);
        assert.match(textOf(tree), /A mode/);
    });

    it("marks a setting that needs a restart and one the plugin lists as risky", () => {
        const { tree } = draw({ answer: { state: "ready", settings: [info({ restartNeeded: true }), info({ key: "other", risky: true })] } });
        const tags = findAll(tree, el => hasClass(el, "amiricord-tag")).map(textOf);
        assert.deepEqual(tags, ["Restart", "Risky"]);
    });

    it("shows a Reset button when there are settings", () => {
        assert.ok(buttonByText(draw().tree, "Reset"));
    });
});

describe("the window of a plugin: changing a setting", () => {
    it("writes a yes/no setting at once, with the opposite value", () => {
        const { tree, sets } = draw({ answer: { state: "ready", settings: [info({ key: "loud", type: "boolean", default: false, value: false })] } });
        press(control(tree, "Loud"));
        assert.deepEqual(sets, [["plug", "loud", true]]);
    });

    it("turns a yes/no setting that is on back off, and one that is off on", () => {
        const on = draw({ answer: { state: "ready", settings: [info({ key: "loud", type: "boolean", default: false, value: true })] } });
        press(control(on.tree, "Loud"));
        assert.deepEqual(on.sets, [["plug", "loud", false]]);
        const off = draw({ answer: { state: "ready", settings: [info({ key: "loud", type: "boolean", default: true, value: false })] } });
        press(control(off.tree, "Loud"));
        assert.deepEqual(off.sets, [["plug", "loud", true]]);
    });

    it("writes a choice from a drop-down with the real value of the option, not its text", () => {
        const answer: PluginSettingsAnswer = { state: "ready", settings: [info({ key: "level", type: "select", default: 1, value: 1, options: [{ label: "Low", value: 1 }, { label: "High", value: 2 }] })] };
        const { tree, sets } = draw({ answer });
        (control(tree, "Level").props.onChange as (e: unknown) => void)({ target: { value: "2" } });
        assert.deepEqual(sets, [["plug", "level", 2]]);
        (control(tree, "Level").props.onChange as (e: unknown) => void)({ target: { value: "nonsense" } });
        assert.equal(sets.length, 1, "a value that is not one of the options is ignored");
    });

    it("keeps a number being typed in a draft, and writes nothing until the person leaves the box", () => {
        const { tree, sets, bySetter } = draw();
        (control(tree, "Size").props.onChange as (e: unknown) => void)({ target: { value: "8" } });
        assert.deepEqual(applied(bySetter[0], {}), { size: "8" });
        assert.deepEqual(sets, []);
    });

    it("writes a typed number on leaving the box or on Enter, as a number", () => {
        const left = draw({ state: { drafts: { size: "8" } } });
        (control(left.tree, "Size").props.onBlur as () => void)();
        assert.deepEqual(left.sets, [["plug", "size", 8]]);
        const entered = draw({ state: { drafts: { size: "9" } } });
        (control(entered.tree, "Size").props.onKeyDown as (e: unknown) => void)({ key: "Enter" });
        assert.deepEqual(entered.sets, [["plug", "size", 9]]);
        const other = draw({ state: { drafts: { size: "9" } } });
        (control(other.tree, "Size").props.onKeyDown as (e: unknown) => void)({ key: "a" });
        assert.deepEqual(other.sets, [], "only Enter writes");
    });

    it("does not send a number that is wrong, and shows why", () => {
        for (const [text, message] of [["99", "It must be at most 10."], ["abc", "That is not a number."], ["", "Type a number."], ["2.5", "It must be a whole number."], ["0", "It must be at least 1."]] as const) {
            const { tree, sets, bySetter } = draw({ state: { drafts: { size: text } } });
            (control(tree, "Size").props.onBlur as () => void)();
            assert.deepEqual(sets, [], text);
            assert.deepEqual(applied(bySetter[1], {}), { size: message }, text);
        }
    });

    it("sends nothing when the box was not touched, or holds the value already in use", () => {
        const untouched = draw();
        (control(untouched.tree, "Size").props.onBlur as () => void)();
        assert.deepEqual(untouched.sets, []);
        const same = draw({ state: { drafts: { size: "5" } } });
        (control(same.tree, "Size").props.onBlur as () => void)();
        assert.deepEqual(same.sets, []);
        assert.deepEqual(applied(same.bySetter[0], { size: "5" }), {}, "the draft is dropped");
    });

    it("writes a text, and refuses one that is too long", () => {
        const answer: PluginSettingsAnswer = { state: "ready", settings: [info({ key: "label", type: "string", default: "hi", value: "hi", maxLength: 4 })] };
        const ok = draw({ answer, state: { drafts: { label: "abcd" } } });
        (control(ok.tree, "Label").props.onBlur as () => void)();
        assert.deepEqual(ok.sets, [["plug", "label", "abcd"]]);
        const long = draw({ answer, state: { drafts: { label: "abcde" } } });
        (control(long.tree, "Label").props.onBlur as () => void)();
        assert.deepEqual(long.sets, []);
        assert.deepEqual(applied(long.bySetter[1], {}), { label: "It must be at most 4 characters." });
    });

    it("shows the sentence the engine gave when it refused, and clears it when it accepted", () => {
        const refused = draw({ refuse: "plug.size must be at most 10", state: { drafts: { size: "8" } } });
        (control(refused.tree, "Size").props.onBlur as () => void)();
        assert.deepEqual(applied(refused.bySetter[1], {}), { size: "plug.size must be at most 10" });
        const accepted = draw({ state: { drafts: { size: "8" } } });
        (control(accepted.tree, "Size").props.onBlur as () => void)();
        assert.deepEqual(applied(accepted.bySetter[1], { size: "old" }), {}, "the old sentence goes away");
        const shown = draw({ state: { errors: { size: "Not saved" } } });
        const [alert] = findAll(shown.tree, el => el.props.role === "alert");
        assert.equal(textOf(alert), "Not saved");
    });

    it("says to restart after a setting that needs it was written, and not for the others", () => {
        const answer: PluginSettingsAnswer = { state: "ready", settings: [info({ key: "loud", type: "boolean", default: false, value: false, restartNeeded: true })] };
        const { tree, bySetter } = draw({ answer });
        press(control(tree, "Loud"));
        assert.deepEqual(applied(bySetter[3], {}), { loud: true });
        const shown = draw({ answer, state: { restartKeys: { loud: true } } });
        assert.match(textOf(shown.tree), new RegExp(RESTART_NOTE.replace(".", "\\.")));
        const plain = draw({ answer: { state: "ready", settings: [info({ key: "loud", type: "boolean", default: false, value: false })] } });
        press(control(plain.tree, "Loud"));
        assert.deepEqual(applied(plain.bySetter[3], {}), {}, "no restart mark");
    });
});

describe("the window of a plugin: risky settings and Reset ask first", () => {
    const risky: PluginSettingsAnswer = { state: "ready", settings: [info({ key: "loud", type: "boolean", default: false, value: false, risky: true })] };

    it("writes nothing when a risky setting is changed; it asks first", () => {
        const { tree, sets, bySetter } = draw({ answer: risky });
        press(control(tree, "Loud"));
        assert.deepEqual(sets, []);
        assert.deepEqual(bySetter[2], [{ key: "loud", value: true }]);
    });

    it("shows the question under the setting, and writes the asked value only on Change anyway", () => {
        const { tree, sets } = draw({ answer: risky, state: { asking: { key: "loud", value: true } } });
        assert.match(textOf(tree), new RegExp(RISKY_QUESTION.slice(0, 20)));
        press(buttonByText(tree, "Change anyway"));
        assert.deepEqual(sets, [["plug", "loud", true]]);
    });

    it("drops the question and the typed text on Cancel, and writes nothing", () => {
        const { tree, sets, bySetter } = draw({ answer: risky, state: { asking: { key: "loud", value: true }, drafts: { loud: "x" } } });
        press(buttonByText(tree, "Cancel"));
        assert.deepEqual(sets, []);
        assert.deepEqual(bySetter[2], [null]);
        assert.deepEqual(applied(bySetter[0], { loud: "x" }), {});
    });

    it("asks before a Reset, and does nothing until it is confirmed", () => {
        const { tree, resets, bySetter } = draw();
        press(buttonByText(tree, "Reset"));
        assert.deepEqual(resets, []);
        assert.deepEqual(bySetter[4], [true]);
    });

    it("resets only after the question, and says it is done", () => {
        const { tree, resets, bySetter } = draw({ state: { askingReset: true } });
        assert.match(textOf(tree), new RegExp(RESET_QUESTION.slice(0, 25)));
        press(buttonByText(tree, "Reset"));
        assert.deepEqual(resets, ["plug"]);
        assert.deepEqual(bySetter[5], [RESET_DONE_TEXT]);
        assert.deepEqual(bySetter[4], [false]);
    });

    it("says what went wrong when the reset was refused, and Cancel does not reset", () => {
        const refused = draw({ state: { askingReset: true }, resetAnswer: "no way" });
        press(buttonByText(refused.tree, "Reset"));
        assert.deepEqual(refused.bySetter[5], ["no way"]);
        const cancelled = draw({ state: { askingReset: true } });
        press(buttonByText(cancelled.tree, "Cancel"));
        assert.deepEqual(cancelled.resets, []);
        assert.deepEqual(cancelled.bySetter[4], [false]);
    });

    it("closes from the Close button and from the cross", () => {
        const { tree, closes } = draw();
        press(buttonByText(tree, "Close"));
        press(findAll(tree, el => hasClass(el, "close"))[0]);
        assert.equal(closes.length, 2);
    });
});

describe("the window of a plugin: the component a plugin draws itself", () => {
    const Panel: PluginSettingsComponent = ({ onClose }) => ({ type: "div", props: { className: "custom-panel", onClick: onClose }, children: ["Mine"] });
    const sections = (tree: unknown) => findAll(tree, el => hasClass(el, "amiricord-pwin-section"));

    it("is drawn at the end of the Settings section, below the declared settings", () => {
        const { tree } = draw({ component: Panel, answer: { state: "ready", settings: [info(), info({ key: "other" })] } });
        const settings = sections(tree)[1];
        const classes = (settings.children as El[]).map(child => String(child.props.className ?? "").split(" ")[0]);
        assert.deepEqual(classes, ["amiricord-pwin-heading", "amiricord-pwin-row", "amiricord-pwin-row", "amiricord-pwin-custom"]);
        assert.equal(findAll(tree, el => hasClass(el, "custom-panel")).length, 1);
    });

    it("is given onClose, which closes the window", () => {
        const { tree, closes } = draw({ component: Panel });
        press(findAll(tree, el => hasClass(el, "custom-panel"))[0]);
        assert.equal(closes.length, 1);
    });

    it("is drawn inside the error boundary the window was given, labelled with the plugin", () => {
        const guard = (props: { label: string; children?: unknown; }) => ({ type: "div", props: { className: "guard", "data-label": props.label }, children: [props.children] });
        const { tree, closes } = draw({ component: Panel, guard });
        const [guarded] = findAll(tree, el => hasClass(el, "guard"));
        assert.equal(guarded.props["data-label"], "The settings of Plug");
        assert.equal(findAll(guarded, el => hasClass(el, "custom-panel")).length, 1);
        press(findAll(guarded, el => hasClass(el, "custom-panel"))[0]);
        assert.equal(closes.length, 1, "it is given onClose inside the boundary too");
    });

    it("is drawn without a boundary when the window was given none", () => {
        const { tree } = draw({ component: Panel });
        assert.equal(findAll(tree, el => hasClass(el, "custom-panel")).length, 1);
    });

    it("means the plugin has settings even if it declares none: no 'there are no settings' sentence", () => {
        const withIt = draw({ component: Panel, answer: { state: "none" } });
        assert.doesNotMatch(textOf(withIt.tree), new RegExp(NONE_TEXT.replace(".", "\\.")));
        assert.equal(findAll(withIt.tree, el => hasClass(el, "amiricord-pwin-empty")).length, 0);
        const without = draw({ answer: { state: "none" } });
        assert.match(textOf(without.tree), new RegExp(NONE_TEXT.replace(".", "\\.")));
    });

    it("is not drawn when the plugin gave none", () => {
        const { tree } = draw();
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-pwin-custom")).length, 0);
    });

    it("leaves Reset out when there are no declared settings to reset", () => {
        assert.equal(buttonByText(draw({ component: Panel, answer: { state: "none" } }).tree, "Reset"), undefined);
    });
});
