/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import type { LoggedNotification } from "../src/api/notificationLog";
import { clockOf, EMPTY_TEXT, makeNotificationLogWindow, MEMORY_NOTE } from "../src/plugins/Settings/NotificationLogWindow";
import { CARDS_TEXT, LOG_TEXT, makeNotificationOptionsWindow, type NotificationOptions, OPTIONS_INTRO, SIZE_TEXT } from "../src/plugins/Settings/NotificationOptionsWindow";
import type { WindowParts } from "../src/plugins/Settings/PluginWindow";

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
const press = (el: El) => (el.props.onClick as () => void)();
const buttonByText = (tree: unknown, text: string) => findAll(tree, el => el.type === "button" && textOf(el) === text)[0];

afterEach(() => { setReactSource(undefined); });

const part = (className: string) => ({ children }: { children?: unknown; }) => ({ type: "div", props: { className }, children: [children].flat() });
const parts: WindowParts = {
    ModalRoot: part("root"), ModalHeader: part("header"), ModalContent: part("content"), ModalFooter: part("footer"),
    ModalCloseButton: ({ onClick }) => ({ type: "button", props: { className: "close", onClick }, children: ["x"] })
};

function fakeReact(initial: unknown[] = []) {
    const bySetter: unknown[][] = initial.map(() => []);
    const subscribed: Array<{ subscribe: unknown; snapshot: unknown; }> = [];
    let slot = 0;
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((_start: unknown) => { const index = slot++; return [initial[index], (value: unknown) => { bySetter[index]?.push(value); }]; }) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: ((subscribe: unknown, getSnapshot: () => unknown) => { subscribed.push({ subscribe, snapshot: getSnapshot() }); return getSnapshot(); }) as ReactLike["useSyncExternalStore"],
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    setReactSource(() => react);
    return { bySetter, subscribed };
}

const entry = (id: number, over: Partial<LoggedNotification> = {}): LoggedNotification => ({ id, at: new Date(2026, 9, 29, 8, 5, 9).getTime(), plugin: "Plug", title: `title ${id}`, body: `body ${id}`, ...over });

function drawLog(entries: LoggedNotification[]) {
    const fake = fakeReact();
    const clears: number[] = [];
    const closes: number[] = [];
    const listener = () => undefined;
    const Window = makeNotificationLogWindow({
        list: () => entries, clear: () => { clears.push(1); }, subscribe: () => listener, version: () => 7, parts
    });
    const tree = render(Window({ onClose: () => { closes.push(1); } }));
    return { tree, clears, closes, fake };
}

describe("the clock of the log", () => {
    it("writes hours, minutes and seconds of the local clock with two digits each", () => {
        assert.equal(clockOf(new Date(2026, 9, 29, 8, 5, 9).getTime()), "08:05:09");
        assert.equal(clockOf(new Date(2026, 0, 1, 23, 59, 0).getTime()), "23:59:00");
        assert.equal(clockOf(new Date(2026, 5, 15, 0, 0, 0).getTime()), "00:00:00");
    });
});

describe("the Notification Log window", () => {
    it("says that nothing has been shown yet, and that the list is only in memory", () => {
        const { tree } = drawLog([]);
        assert.ok(textOf(tree).includes(EMPTY_TEXT));
        assert.ok(textOf(tree).includes(MEMORY_NOTE));
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-nlog-item")).length, 0);
    });

    it("lists the entries in the order it is given (newest first), each with its time, plugin, title and text", () => {
        const { tree } = drawLog([entry(2, { plugin: "Second" }), entry(1, { plugin: "First" })]);
        const items = findAll(tree, el => hasClass(el, "amiricord-nlog-item"));
        assert.equal(items.length, 2);
        assert.equal(textOf(findAll(items[0], el => hasClass(el, "amiricord-nlog-plugin"))[0]), "Second");
        assert.equal(textOf(findAll(items[0], el => hasClass(el, "amiricord-nlog-time"))[0]), "08:05:09");
        assert.equal(textOf(findAll(items[0], el => hasClass(el, "amiricord-nlog-title"))[0]), "title 2");
        assert.equal(textOf(findAll(items[0], el => hasClass(el, "amiricord-nlog-body"))[0]), "body 2");
        assert.equal(textOf(findAll(items[1], el => hasClass(el, "amiricord-nlog-plugin"))[0]), "First");
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-nlog-item")).map(item => item.type).every(type => type === "li"), true);
    });

    it("draws no empty line for a notification that had no title or no body, and shows text as text", () => {
        const { tree } = drawLog([entry(1, { title: "", body: "only a body" }), entry(2, { title: "only a title", body: "" }), entry(3, { title: "<b>bold</b>", body: "<script>x</script>" })]);
        const [first, second, third] = findAll(tree, el => hasClass(el, "amiricord-nlog-item"));
        assert.equal(findAll(first, el => hasClass(el, "amiricord-nlog-title")).length, 0);
        assert.equal(findAll(second, el => hasClass(el, "amiricord-nlog-body")).length, 0);
        assert.equal(textOf(findAll(third, el => hasClass(el, "amiricord-nlog-title"))[0]), "<b>bold</b>");
        assert.equal(findAll(tree, el => el.type === "script" || el.type === "b").length, 0);
    });

    it("listens to the log through the engine's own subscription, so a notification that arrives while the window is open appears", () => {
        const { fake } = drawLog([entry(1)]);
        assert.equal(fake.subscribed.length, 1);
        assert.equal(typeof fake.subscribed[0].subscribe, "function");
    });

    it("clears the list with its button, and the button does nothing when there is nothing to clear", () => {
        const full = drawLog([entry(1)]);
        assert.equal(buttonByText(full.tree, "Clear the list").props["aria-disabled"], "false");
        press(buttonByText(full.tree, "Clear the list"));
        assert.equal(full.clears.length, 1);
        const empty = drawLog([]);
        assert.equal(buttonByText(empty.tree, "Clear the list").props["aria-disabled"], "true");
        press(buttonByText(empty.tree, "Clear the list"));
        assert.equal(empty.clears.length, 0);
    });

    it("closes with the Close button and with the cross", () => {
        const { tree, closes } = drawLog([]);
        press(buttonByText(tree, "Close"));
        press(findAll(tree, el => hasClass(el, "close"))[0]);
        assert.equal(closes.length, 2);
    });
});

function drawOptions(start: NotificationOptions = { cards: true, log: true, size: 100 }) {
    const fake = fakeReact([start.cards, start.log, start.size]);
    const changes: Array<Partial<NotificationOptions>> = [];
    const closes: number[] = [];
    const Window = makeNotificationOptionsWindow({ read: () => start, set: change => { changes.push(change); }, parts });
    const tree = render(Window({ onClose: () => { closes.push(1); } }));
    return { tree, changes, closes, fake };
}

const switchOf = (tree: unknown, label: string) => findAll(tree, el => el.props.role === "switch" && el.props["aria-label"] === label)[0];

describe("the notification options window", () => {
    it("explains that Discord's own notifications are not affected, and has two switches and a size", () => {
        const { tree } = drawOptions();
        assert.ok(textOf(tree).includes(OPTIONS_INTRO));
        assert.match(OPTIONS_INTRO, /Discord's own message notifications are not affected/);
        assert.equal(findAll(tree, el => el.props.role === "switch").length, 2);
        const select = findAll(tree, el => el.type === "select")[0];
        assert.equal(select.props["aria-label"], SIZE_TEXT);
        assert.deepEqual(findAll(select, el => el.type === "option").map(textOf), ["25", "50", "100", "200"]);
    });

    it("shows the saved choices", () => {
        const on = drawOptions({ cards: true, log: false, size: 50 });
        assert.equal(switchOf(on.tree, CARDS_TEXT).props["aria-checked"], "true");
        assert.equal(switchOf(on.tree, LOG_TEXT).props["aria-checked"], "false");
        assert.equal(findAll(on.tree, el => el.type === "select")[0].props.value, "50");
    });

    it("keeps a change at once when a switch is pressed, by click or by Enter and space, and has no Save button", () => {
        const { tree, changes, fake } = drawOptions({ cards: true, log: true, size: 100 });
        press(switchOf(tree, CARDS_TEXT));
        let prevented = 0;
        const key = (event: { key: string; }) => (switchOf(tree, LOG_TEXT).props.onKeyDown as (event: unknown) => void)({ ...event, preventDefault: () => { prevented++; } });
        key({ key: " " });
        key({ key: "Enter" });
        key({ key: "x" });
        assert.deepEqual(changes, [{ cards: false }, { log: false }, { log: false }]);
        assert.equal(prevented, 2);
        assert.deepEqual(fake.bySetter[0], [false]);
        assert.equal(buttonByText(tree, "Save"), undefined);
        assert.ok(buttonByText(tree, "Close"));
    });

    it("keeps a new size when one of the choices is picked, and ignores anything else", () => {
        const { tree, changes, fake } = drawOptions();
        const change = (value: string) => (findAll(tree, el => el.type === "select")[0].props.onChange as (event: { target: { value: string; }; }) => void)({ target: { value } });
        change("25");
        change("30");
        change("abc");
        change("");
        assert.deepEqual(changes, [{ size: 25 }]);
        assert.deepEqual(fake.bySetter[2], [25]);
    });

    it("closes with the Close button and with the cross", () => {
        const { tree, closes } = drawOptions();
        press(buttonByText(tree, "Close"));
        press(findAll(tree, el => hasClass(el, "close"))[0]);
        assert.equal(closes.length, 2);
    });
});
