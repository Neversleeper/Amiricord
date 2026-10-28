/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A very small page for tests: elements with attributes, children, a few selectors, listeners and events. Only what the menu and message code use.

type Listener = (event: FakeEvent) => void;

export interface FakeEvent { type: string; target: unknown; key?: string; bubbles?: boolean; }

/** Selectors this page understands: `tag`, `*`, `.class`, `#id`, `[attr]`, `[attr="value"]`, `[attr*=value]`, `:not([attr])`, joined together, and lists with commas. */
function matches(element: FakeElement, selector: string): boolean {
    return selector.split(",").some(part => {
        let rest = part.trim();
        if (rest === "*") return true;
        let ok = true;
        const take = (pattern: RegExp, check: (match: RegExpExecArray) => boolean) => {
            let found: RegExpExecArray | null;
            while ((found = pattern.exec(rest)) !== null) {
                if (!check(found)) ok = false;
                rest = rest.replace(found[0], "");
                pattern.lastIndex = 0;
            }
        };
        take(/:not\(\[([\w-]+)\]\)/, m => !element.hasAttribute(m[1]));
        take(/\[([\w-]+)\*="?([^"\]]*)"?\]/, m => (element.getAttribute(m[1]) ?? "").includes(m[2]));
        take(/\[([\w-]+)="([^"]*)"\]/, m => element.getAttribute(m[1]) === m[2]);
        take(/\[([\w-]+)\]/, m => element.hasAttribute(m[1]));
        take(/\.([\w-]+)/, m => element.className.split(/\s+/).includes(m[1]));
        take(/#([\w-]+)/, m => element.id === m[1]);
        const tag = rest.trim();
        return ok && (tag === "" || element.tagName.toLowerCase() === tag.toLowerCase());
    });
}

/** An element and its parents, up to the top (or only the element itself when `bubbles` is false). */
function* climb(start: FakeElement, bubbles = true): Generator<FakeElement> {
    for (let node: FakeElement | null = start; node; node = bubbles ? node.parentElement : null) yield node;
}

export class FakeElement {
    parentElement: FakeElement | null = null;
    children: FakeElement[] = [];
    private text = "";
    private readonly attributes = new Map<string, string>();
    private readonly listeners = new Map<string, Listener[]>();
    src = "";
    title = "";
    type = "";
    style: Record<string, string> = {};
    download = "";
    accept = "";
    files: Array<{ text(): Promise<string>; }> | undefined;
    onchange: (() => void) | undefined;
    clicks = 0;
    currentSrc = "";
    href = "";

    constructor(readonly tagName: string, attributes: Record<string, string> = {}, text = "") {
        for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
        this.text = text;
    }

    get id() { return this.attributes.get("id") ?? ""; }
    set id(value: string) { this.attributes.set("id", value); }

    click() { this.clicks++; }

    get className() { return this.attributes.get("class") ?? ""; }
    set className(value: string) { this.attributes.set("class", value); }

    get textContent(): string { return this.children.length ? this.children.map(child => child.textContent).join("") : this.text; }
    set textContent(value: string) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.text = value; }

    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    getAttributeNames() { return [...this.attributes.keys()]; }

    append(...nodes: FakeElement[]) {
        for (const node of nodes) {
            node.remove();
            node.parentElement = this;
            this.children.push(node);
        }
    }

    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
    }

    private descendants(): FakeElement[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector: string) { return this.descendants().filter(node => matches(node, selector)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }

    contains(other: unknown): boolean { return other === this || this.descendants().includes(other as FakeElement); }

    closest(selector: string): FakeElement | null {
        for (const node of climb(this)) if (matches(node, selector)) return node;
        return null;
    }

    cloneNode(): FakeElement {
        const copy = new FakeElement(this.tagName, Object.fromEntries(this.attributes), this.children.length ? "" : this.text);
        for (const child of this.children) copy.append(child.cloneNode());
        return copy;
    }

    addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    removeEventListener(type: string, listener: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)); }

    /** Sends an event to this element's listeners, then up through its parents when it bubbles. */
    dispatchEvent(event: FakeEvent) {
        for (const node of climb(this, event.bubbles !== false)) {
            for (const listener of node.listeners.get(event.type) ?? []) listener(event);
        }
        return true;
    }
}

export class FakeDocument extends FakeElement {
    readonly body = new FakeElement("body");
    readonly events: FakeEvent[] = [];

    constructor() {
        super("document");
        this.append(this.body);
    }

    hidden = false;

    createElement(tag: string) { return new FakeElement(tag); }

    getElementById(id: string) { return this.querySelector(`#${id}`); }

    override dispatchEvent(event: FakeEvent) {
        this.events.push(event);
        return super.dispatchEvent(event);
    }
}

/** A page whose timers and observers the test drives by hand. */
export function fakePage() {
    const document = new FakeDocument();
    const timers = new Map<number, { run: () => void; ms: number; }>();
    let nextTimer = 1;
    const observers: Array<{ callback: () => void; observed: boolean; disconnected: boolean; }> = [];
    class Observer {
        state = { callback: () => undefined as void, observed: false, disconnected: false };
        constructor(callback: () => void) { this.state.callback = callback; observers.push(this.state); }
        observe() { this.state.observed = true; }
        disconnect() { this.state.disconnected = true; }
    }
    class Keyboard {
        type: string; key: string; bubbles: boolean; target: unknown = undefined;
        constructor(type: string, init: { key: string; bubbles: boolean; }) { this.type = type; this.key = init.key; this.bubbles = init.bubbles; }
    }
    const intervals = new Map<number, { run: () => void; ms: number; }>();
    const frames: Array<() => void> = [];
    const page = {
        document,
        requestAnimationFrame: (run: () => void) => { frames.push(run); return frames.length; },
        setInterval: (run: () => void, ms: number) => { const id = nextTimer++; intervals.set(id, { run, ms }); return id; },
        clearInterval: (id: unknown) => { intervals.delete(id as number); },
        setTimeout: (run: () => void, ms: number) => { const id = nextTimer++; timers.set(id, { run, ms }); return id; },
        clearTimeout: (id: unknown) => { timers.delete(id as number); },
        MutationObserver: Observer,
        KeyboardEvent: Keyboard
    };
    return {
        page,
        document,
        timers,
        intervals,
        frames,
        runFrames() { for (const run of frames.splice(0)) run(); },
        observers,
        /** Tell every live observer that the page changed. */
        mutate() { for (const observer of observers) if (observer.observed && !observer.disconnected) observer.callback(); },
        runTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.run(); } }
    };
}
