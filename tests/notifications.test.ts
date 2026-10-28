/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BODY_MAX, createNotificationLayer, DEFAULT_TIMEOUT_MS, type ElementLike, type EventLike, MAX_CARDS_PER_PLUGIN, MAX_TIMEOUT_MS, NOTIFICATION_CSS,
    type NotificationOptions, safeIcon, timeoutOf, TITLE_MAX
} from "../src/api/notifications";

// --- A small stand-in for the page --------------------------------------------------------------------------------------------------------

class FakeElement implements ElementLike {
    className = "";
    textContent: string | null = null;
    tabIndex = -1;
    src?: string;
    attrs: Record<string, string> = {};
    children: FakeElement[] = [];
    parent?: FakeElement;
    listeners = new Map<string, Array<(event: EventLike) => void>>();

    constructor(readonly tag: string) { }

    setAttribute(name: string, value: string) { this.attrs[name] = value; }

    append(...children: ElementLike[]) {
        for (const child of children as FakeElement[]) {
            child.parent = this;
            this.children.push(child);
        }
    }

    remove() {
        if (!this.parent) return;
        const at = this.parent.children.indexOf(this);
        if (at >= 0) this.parent.children.splice(at, 1);
        this.parent = undefined;
    }

    addEventListener(type: string, listener: (event: EventLike) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    fire(type: string, event: EventLike = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    all(test: (el: FakeElement) => boolean, found: FakeElement[] = []): FakeElement[] {
        if (test(this)) found.push(this);
        for (const child of this.children) child.all(test, found);
        return found;
    }

    has(className: string) { return this.className.split(" ").includes(className); }
}

function setup(options: { page?: boolean; body?: boolean; } = {}) {
    const body = new FakeElement("body");
    const styles: string[] = [];
    const timers: Array<{ work: () => void; ms: number; cleared: boolean; }> = [];
    const layer = createNotificationLayer({
        document: options.page === false ? undefined : { createElement: tag => new FakeElement(tag), body: options.body === false ? null : body },
        setTimeout: (work, ms) => { timers.push({ work, ms, cleared: false }); return timers.length - 1; },
        clearTimeout: id => { timers[id as number].cleared = true; },
        addStyle: css => { styles.push(css); }
    });
    const disposers: Array<() => void> = [];
    const errors: Array<[string, unknown]> = [];
    const forPlugin = (id: string) => layer.forPlugin(id, undo => { disposers.push(undo); }, (source, error) => { errors.push([source, error]); });
    const cards = (id?: string) => body.all(el => el.has("amiricord-notification") && (id === undefined || el.attrs["data-plugin"] === id));
    const titles = (id?: string) => cards(id).map(card => card.all(el => el.has("amiricord-notification-title"))[0]?.textContent);
    return { body, styles, timers, disposers, errors, forPlugin, cards, titles };
}

const card = (title: string, extra: Partial<NotificationOptions> = {}): NotificationOptions => ({ title, ...extra });

// --- Tests ---------------------------------------------------------------------------------------------------------------------------------

describe("the corner and the style", () => {
    it("makes one corner in the page the first time a card is shown, and adds the style once for everything", () => {
        const t = setup();
        assert.equal(t.body.children.length, 0, "nothing is made before a card is shown");
        const a = t.forPlugin("A");
        const b = t.forPlugin("B");
        a.show(card("one"));
        b.show(card("two"));
        a.show(card("three"));
        const corners = t.body.children.filter(el => el.has("amiricord-notifications"));
        assert.equal(corners.length, 1);
        assert.deepEqual([corners[0].attrs.role, corners[0].attrs["aria-label"], corners[0].attrs["aria-live"]], ["region", "Notifications", "polite"]);
        assert.deepEqual(t.styles, [NOTIFICATION_CSS]);
        assert.equal(t.cards().length, 3);
    });

    it("never lets the corner catch clicks meant for Discord: only the cards do", () => {
        assert.match(NOTIFICATION_CSS, /\.amiricord-notifications \{[^}]*pointer-events: none/);
        assert.match(NOTIFICATION_CSS, /\.amiricord-notification \{[^}]*pointer-events: auto/);
    });
});

describe("a card", () => {
    it("shows the title and the body as text, marks which plugin showed it, and has a close button", () => {
        const t = setup();
        t.forPlugin("Plug").show({ title: "Hello", body: "World" });
        const [shown] = t.cards("Plug");
        assert.equal(shown.attrs["data-plugin"], "Plug");
        assert.equal(shown.all(el => el.has("amiricord-notification-title"))[0].textContent, "Hello");
        assert.equal(shown.all(el => el.has("amiricord-notification-body"))[0].textContent, "World");
        const [cross] = shown.all(el => el.has("amiricord-notification-close"));
        assert.deepEqual([cross.tag, cross.attrs["aria-label"], cross.attrs.type], ["button", "Close", "button"]);
    });

    it("keeps markup as text, never as HTML", () => {
        const t = setup();
        t.forPlugin("P").show({ title: "<img src=x onerror=alert(1)>", body: "<b>bold</b>" });
        const [shown] = t.cards();
        assert.equal(shown.all(el => el.has("amiricord-notification-title"))[0].textContent, "<img src=x onerror=alert(1)>");
        assert.equal(shown.all(el => el.tag === "img").length, 0, "no element was made from the text");
    });

    it("cuts a long title and a long body with an ellipsis, and trims spaces", () => {
        const t = setup();
        t.forPlugin("P").show({ title: `  ${"t".repeat(TITLE_MAX + 50)}  `, body: "b".repeat(BODY_MAX + 50) });
        const [shown] = t.cards();
        const title = shown.all(el => el.has("amiricord-notification-title"))[0].textContent!;
        const body = shown.all(el => el.has("amiricord-notification-body"))[0].textContent!;
        assert.equal(title.length, TITLE_MAX);
        assert.ok(title.endsWith("\u2026"));
        assert.equal(body.length, BODY_MAX);
        assert.equal(t.titles()[0]!.startsWith(" "), false);
    });

    it("shows a card with only a body, or only a title, and nothing for neither", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.show({ title: "", body: "just a body" });
        p.show({ title: "just a title" });
        assert.equal(t.cards().length, 2);
        assert.equal(t.cards()[0].all(el => el.has("amiricord-notification-title")).length, 0);
        assert.equal(t.cards()[1].all(el => el.has("amiricord-notification-body")).length, 0);
        for (const nothing of [{ title: "" }, { title: "   " }, { title: 5 as never }, {} as never, null as never, undefined as never, "text" as never]) {
            p.show(nothing);
        }
        assert.equal(t.cards().length, 2, "none of those made a card");
    });

    it("gives a handle that does nothing for a card that was not shown", () => {
        const t = setup();
        const handle = t.forPlugin("P").show({ title: "" });
        assert.doesNotThrow(() => { handle.close(); handle.close(); });
        assert.equal(t.disposers.length, 0, "and registers nothing to undo");
    });
});

describe("the icon", () => {
    it("accepts an https address and a small image given in the address", () => {
        assert.equal(safeIcon("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
        assert.equal(safeIcon("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
        assert.equal(safeIcon("data:image/jpeg;base64,AAAA"), "data:image/jpeg;base64,AAAA");
        assert.equal(safeIcon("data:image/webp;base64,AA+/=="), "data:image/webp;base64,AA+/==");
    });

    it("drops anything else: scripts, files, plain http, blobs, other data types, text with spaces, a huge address, and non-text", () => {
        for (const bad of ["javascript:alert(1)", "file:///C:/a.png", "http://example.com/a.png", "blob:https://x/1", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA",
            "https://exa mple.com/a.png", "https://", `https://x/${"a".repeat(200_001)}`, 5, null, undefined, {}]) {
            assert.equal(safeIcon(bad), undefined, String(bad).slice(0, 30));
        }
    });

    it("puts an accepted icon in the card as an image with no description, and none for a dropped one", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.show({ title: "with", icon: "https://cdn.example.com/a.png" });
        p.show({ title: "without", icon: "javascript:alert(1)" });
        const [withIcon, withoutIcon] = t.cards();
        const [image] = withIcon.all(el => el.tag === "img");
        assert.deepEqual([image.src, image.attrs.alt, image.has("amiricord-notification-icon")], ["https://cdn.example.com/a.png", "", true]);
        assert.equal(withoutIcon.all(el => el.tag === "img").length, 0);
    });
});

describe("how long a card stays", () => {
    it("leaves a card for six seconds by default, takes it away when the time is up, and clears nothing it did not set", () => {
        const t = setup();
        t.forPlugin("P").show(card("a"));
        assert.deepEqual(t.timers.map(timer => timer.ms), [DEFAULT_TIMEOUT_MS]);
        t.timers[0].work();
        assert.equal(t.cards().length, 0);
    });

    it("follows timeoutMs, keeps a card with 0 until it is closed, and never goes over the largest time", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.show(card("short", { timeoutMs: 1500 }));
        p.show(card("forever", { timeoutMs: 0 }));
        p.show(card("huge", { timeoutMs: 10 * MAX_TIMEOUT_MS }));
        assert.deepEqual(t.timers.map(timer => timer.ms), [1500, MAX_TIMEOUT_MS]);
        assert.equal(t.cards().length, 3);
    });

    it("uses the default for a time that is negative, not a number, or not text", () => {
        assert.equal(timeoutOf(-1), DEFAULT_TIMEOUT_MS);
        assert.equal(timeoutOf(Number.NaN), DEFAULT_TIMEOUT_MS);
        assert.equal(timeoutOf(Infinity), DEFAULT_TIMEOUT_MS);
        assert.equal(timeoutOf("5000"), DEFAULT_TIMEOUT_MS);
        assert.equal(timeoutOf(undefined), DEFAULT_TIMEOUT_MS);
        assert.equal(timeoutOf(2500.9), 2500);
        assert.equal(timeoutOf(0), 0);
        assert.equal(timeoutOf(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
    });

    it("stops the clock of a card that is closed before its time", () => {
        const t = setup();
        const handle = t.forPlugin("P").show(card("a"));
        handle.close();
        assert.equal(t.timers[0].cleared, true);
        assert.equal(t.cards().length, 0);
    });
});

describe("pressing a card", () => {
    it("runs onClick and then closes the card", () => {
        const t = setup();
        const log: string[] = [];
        t.forPlugin("P").show(card("a", { onClick: () => { log.push(`click, cards: ${t.cards().length}`); } }));
        t.cards()[0].fire("click");
        assert.deepEqual(log, ["click, cards: 1"], "onClick runs while the card is still there");
        assert.equal(t.cards().length, 0);
    });

    it("keeps the card when dismissOnClick is false, and still runs onClick", () => {
        const t = setup();
        let clicks = 0;
        t.forPlugin("P").show(card("a", { onClick: () => { clicks++; }, dismissOnClick: false }));
        t.cards()[0].fire("click");
        assert.equal(clicks, 1);
        assert.equal(t.cards().length, 1);
    });

    it("closes a card with no onClick when pressed, by default, and is a plain status when it can do nothing", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.show(card("closes"));
        p.show(card("still", { dismissOnClick: false }));
        const [closes, still] = t.cards();
        assert.deepEqual([closes.attrs.role, closes.tabIndex], ["button", 0]);
        assert.deepEqual([still.attrs.role, still.tabIndex], ["status", -1]);
        assert.equal(still.listeners.size, 0, "it does not react to presses");
        closes.fire("click");
        assert.equal(t.cards().length, 1);
    });

    it("reports an onClick that throws, and closes the card all the same", () => {
        const t = setup();
        const failure = new Error("boom");
        t.forPlugin("P").show(card("a", { onClick: () => { throw failure; } }));
        t.cards()[0].fire("click");
        assert.deepEqual(t.errors, [["notification click", failure]]);
        assert.equal(t.cards().length, 0);
    });

    it("can be pressed with Enter or Space, which do not scroll the page, and not with other keys", () => {
        const t = setup();
        let clicks = 0;
        const p = t.forPlugin("P");
        p.show(card("enter", { onClick: () => { clicks++; }, dismissOnClick: false }));
        const [first] = t.cards();
        let prevented = 0;
        first.fire("keydown", { key: "Enter", preventDefault: () => { prevented++; } });
        first.fire("keydown", { key: " ", preventDefault: () => { prevented++; } });
        first.fire("keydown", { key: "a", preventDefault: () => { prevented++; } });
        first.fire("keydown", { key: "Tab" });
        assert.equal(clicks, 2);
        assert.equal(prevented, 2);
    });

    it("closes with the cross without running onClick, and without the press reaching the card", () => {
        const t = setup();
        let clicks = 0;
        t.forPlugin("P").show(card("a", { onClick: () => { clicks++; } }));
        const [shown] = t.cards();
        let stopped = 0;
        shown.all(el => el.has("amiricord-notification-close"))[0].fire("click", { stopPropagation: () => { stopped++; } });
        assert.equal(clicks, 0);
        assert.equal(stopped, 1);
        assert.equal(t.cards().length, 0);
    });

    it("ignores an onClick that is not a function", () => {
        const t = setup();
        t.forPlugin("P").show(card("a", { onClick: "no" as never }));
        assert.doesNotThrow(() => t.cards()[0].fire("click"));
    });
});

describe("the handle, the limit and the cleanup", () => {
    it("closes only its own card, and closing twice does nothing more", () => {
        const t = setup();
        const p = t.forPlugin("P");
        const one = p.show(card("one"));
        p.show(card("two"));
        one.close();
        one.close();
        assert.deepEqual(t.titles(), ["two"]);
    });

    it("keeps the last five cards of a plugin and takes the oldest away, without touching another plugin", () => {
        const t = setup();
        const other = t.forPlugin("Other");
        other.show(card("theirs"));
        const p = t.forPlugin("P");
        for (let i = 1; i <= MAX_CARDS_PER_PLUGIN + 2; i++) p.show(card(`n${i}`));
        assert.deepEqual(t.titles("P"), ["n3", "n4", "n5", "n6", "n7"]);
        assert.deepEqual(t.titles("Other"), ["theirs"]);
        assert.equal(t.timers.filter(timer => timer.cleared).length, 2, "the clocks of the two that went were stopped");
    });

    it("closeAll takes away this plugin's cards only", () => {
        const t = setup();
        const a = t.forPlugin("A");
        const b = t.forPlugin("B");
        a.show(card("a1"));
        a.show(card("a2"));
        b.show(card("b1"));
        a.closeAll();
        assert.deepEqual(t.titles(), ["b1"]);
    });

    it("registers one undo with the plugin the first time it shows a card, which takes every card away", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.show(card("one"));
        p.show(card("two"));
        assert.equal(t.disposers.length, 1);
        t.disposers[0]();
        assert.equal(t.cards().length, 0);
    });
});

describe("without a page", () => {
    it("shows nothing and breaks nothing when there is no document, or no body yet", () => {
        for (const options of [{ page: false }, { body: false }]) {
            const t = setup(options);
            const handle = t.forPlugin("P").show(card("a"));
            assert.doesNotThrow(() => { handle.close(); t.forPlugin("P").closeAll(); });
            assert.deepEqual(t.styles, [], "and no style was added");
            assert.equal(t.disposers.length, 0);
        }
    });

    it("tries again when the body appears later", () => {
        let bodyReady = false;
        const body = new FakeElement("body");
        const layer = createNotificationLayer({
            document: { createElement: tag => new FakeElement(tag), get body() { return bodyReady ? body : null; } },
            setTimeout: () => 0, clearTimeout: () => undefined, addStyle: () => undefined
        });
        const p = layer.forPlugin("P", () => undefined, () => undefined);
        p.show({ title: "early" });
        assert.equal(body.children.length, 0);
        bodyReady = true;
        p.show({ title: "late" });
        assert.equal(body.all(el => el.has("amiricord-notification")).length, 1);
    });
});
