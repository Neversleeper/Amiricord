/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Items in Discord's right-click menu. A plugin gives a function that looks at what was right-clicked (a picture, a link) and answers with items, or nothing;
// when Discord's menu opens, the engine adds those items to the end of it, shaped like Discord's own. The menu is Discord's React: nothing is patched, the items
// are plain page elements added after the menu appeared, so Discord does not know about them and they go away with the menu. When the page's own menu looks
// different from what is expected, the items still show (with our own look) at the end of the menu, or nothing is added: the menu itself is never changed.
// NOT verified against every kind of Discord menu; it was written for the picture and link menus.

/** What was right-clicked: the picture or video address and the link address found at or above the element, when there are any. */
export interface ContextClick {
    target: Element;
    src: string | undefined;
    href: string | undefined;
}

export interface ContextMenuItem {
    label: string;
    action(): void | Promise<void>;
}

/** Answers with the items to add for this click, or nothing. */
export type ContextMenuProvider = (click: ContextClick) => ContextMenuItem | ContextMenuItem[] | null | undefined;

export interface PluginContextMenus {
    /** Adds a provider. It stops when the plugin stops. The id only has to differ between this plugin's providers. */
    add(id: string, provider: ContextMenuProvider): void;
}

/** How long, after a right-click, the engine waits for Discord's menu to appear. */
export const MENU_WAIT_MS = 800;
const MENU_SELECTOR = "[role=\"menu\"]:not([data-amiricord-menu])";
const ITEM_CLASS = "amiricord-menu-item";
const LEVELS = 6;

export const MENU_CSS = `
.${ITEM_CLASS} { display: flex; align-items: center; box-sizing: border-box; min-height: 32px; margin: 0 4px; padding: 6px 8px; border-radius: 4px; cursor: pointer; color: var(--text-default, var(--text-normal, #dbdee1)); font-size: 14px; font-weight: 500; line-height: 20px; }
.${ITEM_CLASS}:hover { background-color: var(--background-modifier-hover, rgba(255, 255, 255, .08)); }
.amiricord-menu-group { padding-top: 4px; margin-top: 4px; border-top: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, .1)); }
`;

const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && typeof (value as { tagName?: unknown; }).tagName === "string";

const addressOfMedia = (element: Element): string | undefined => {
    const tag = element.tagName?.toLowerCase();
    if (tag !== "img" && tag !== "video") return undefined;
    const media = element as HTMLImageElement | HTMLVideoElement;
    return media.currentSrc || media.src || undefined;
};

const NEARBY_LEVELS = 2;
const OVERLAY_WORDS = /original|image|media|video|embed|zoom|wrapper|container/i;
const NOT_MEDIA = /emoji|avatar|placeholder/i;

/**
 * In Discord's chat the click often lands NOT on the picture but on something laid over it or around it (seen in build 652418: `a.originalLink` beside the
 * `img`, `div.imageContainer` around it). When the clicked thing has no words of its own, or is named like a picture holder, the picture that sits inside it
 * or inside its next two parents counts, as long as there is exactly one there (emojis, avatars and the stand-in picture shown while a real one loads do not count; build 652418 puts an `imagePlaceholder` next to every chat picture). With two or more it is not guessed.
 */
function nearbyMedia(target: Element): string | undefined {
    const text = (target.textContent ?? "").trim();
    if (text !== "" && !OVERLAY_WORDS.test(String(target.className ?? ""))) return undefined;
    let element: Element | null = target;
    for (let level = 0; element && level <= NEARBY_LEVELS; level++, element = element.parentElement) {
        const found = [...element.querySelectorAll("img, video")].filter(node => addressOfMedia(node) !== undefined && !NOT_MEDIA.test(String(node.className ?? "")));
        if (found.length === 1) return addressOfMedia(found[0]);
        if (found.length > 1) return undefined;
    }
    return undefined;
}

/** The picture or video address and the link address at or above `target` (a few levels up), and when there is none, the one picture clicked through an overlay. */
export function clickedThing(target: Element | null): { src: string | undefined; href: string | undefined; } {
    let src: string | undefined;
    let href: string | undefined;
    let element: Element | null = target;
    for (let level = 0; element && level < LEVELS; level++, element = element.parentElement) {
        if (!src) src = addressOfMedia(element);
        if (!href && element.tagName?.toLowerCase() === "a") {
            const address = (element as HTMLAnchorElement).href;
            if (address) href = address;
        }
    }
    if (!src && target) src = nearbyMedia(target);
    return { src, href };
}

/** The little of the page the hub needs, so tests can give it a fake. */
export interface MenuPage {
    document: Document;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    MutationObserver: new (callback: () => void) => { observe(target: Node, options: { childList: boolean; subtree: boolean; }): void; disconnect(): void; };
    KeyboardEvent: new (type: string, init: { key: string; bubbles: boolean; }) => Event;
}

interface Registered {
    plugin: string;
    id: string;
    provider: ContextMenuProvider;
}

/** One for the whole engine: listens for right-clicks, waits for Discord's menu and adds what the plugins answered. */
export class ContextMenuHub {
    private readonly providers: Registered[] = [];
    private click: ContextClick | undefined;
    private watcher: { disconnect(): void; } | undefined;
    private timer: unknown;
    private listening = false;
    private styled = false;

    constructor(
        private readonly page: MenuPage,
        private readonly addStyle: (css: string) => void,
        private readonly report: (plugin: string, source: string, error: unknown) => void
    ) {}

    add(plugin: string, id: string, provider: ContextMenuProvider): () => void {
        const entry: Registered = { plugin, id, provider };
        this.providers.push(entry);
        this.listen();
        return () => {
            const at = this.providers.indexOf(entry);
            if (at >= 0) this.providers.splice(at, 1);
            if (this.providers.length === 0) this.unlisten();
        };
    }

    private readonly onContextMenu = (event: Event) => {
        this.stopWaiting();
        const target = isElement(event.target) ? event.target : null;
        if (!target || this.providers.length === 0) return;
        this.click = { target, ...clickedThing(target) };
        const { document: doc } = this.page;
        const look = () => { this.look(); };
        const watcher = new this.page.MutationObserver(look);
        watcher.observe(doc.body, { childList: true, subtree: true });
        this.watcher = watcher;
        this.timer = this.page.setTimeout(() => { this.stopWaiting(); }, MENU_WAIT_MS);
        // The menu may already be there when Discord draws it in the same turn.
        look();
    };

    private listen() {
        if (this.listening) return;
        this.listening = true;
        this.page.document.addEventListener("contextmenu", this.onContextMenu, true);
    }

    private unlisten() {
        this.listening = false;
        this.page.document.removeEventListener("contextmenu", this.onContextMenu, true);
        this.stopWaiting();
    }

    private stopWaiting() {
        this.watcher?.disconnect();
        this.watcher = undefined;
        if (this.timer !== undefined) this.page.clearTimeout(this.timer);
        this.timer = undefined;
        this.click = undefined;
    }

    /** The menu on screen: one that is not hidden (zero size), and one that already holds items before one that does not. */
    private findMenu(): Element | null {
        const candidates = [...this.page.document.querySelectorAll(MENU_SELECTOR)].filter(candidate => {
            const box = (candidate as { getBoundingClientRect?: () => { width: number; height: number; }; }).getBoundingClientRect?.();
            return !box || box.width > 0 || box.height > 0;
        });
        return candidates.find(candidate => candidate.querySelector("[role=\"menuitem\"]") !== null) ?? candidates[0] ?? null;
    }

    private look() {
        const click = this.click;
        if (!click) return;
        const menu = this.findMenu();
        if (!menu) return;
        menu.setAttribute("data-amiricord-menu", "");
        this.stopWaiting();
        const items: ContextMenuItem[] = [];
        for (const entry of [...this.providers]) {
            try {
                const answer = entry.provider(click);
                if (Array.isArray(answer)) items.push(...answer);
                else if (answer) items.push(answer);
            } catch (error) {
                this.report(entry.plugin, `context menu ${entry.id}`, error);
            }
        }
        if (items.length === 0) return;
        try {
            this.draw(menu, items);
        } catch (error) {
            this.report("engine", "context menu", error);
        }
    }

    private draw(menu: Element, items: ContextMenuItem[]) {
        if (!this.styled) {
            this.styled = true;
            this.addStyle(MENU_CSS);
        }
        const { document: doc } = this.page;
        // The look is copied from an item that has words: in build 652418 the first `menuitem` of a message menu is a reaction button (an emoji, no words), and an item
        // copied from it came out 5 pixels tall, so it could not be seen.
        const menuItems = [...menu.querySelectorAll("[role=\"menuitem\"]")];
        const template = menuItems.find(candidate => (candidate.textContent ?? "").trim() !== "") ?? menuItems[0] ?? null;
        const group = doc.createElement("div");
        group.setAttribute("role", "group");
        group.className = "amiricord-menu-group";
        for (const item of items) group.append(this.makeItem(item));
        // After the last group of Discord's items, inside the same list.
        const parent = template?.closest("[role=\"group\"]")?.parentElement ?? menu;
        parent.append(group);
    }

    /**
     * Our own element with our own styles (`MENU_CSS`). Copying one of Discord's items was tried first: in build 652418 the copy had the right size, colour and
     * text by its computed styles and still showed an empty box, because of something inside Discord's item that could not be seen from here.
     */
    private makeItem(item: ContextMenuItem): Element {
        const { document: doc } = this.page;
        const element = doc.createElement("div");
        element.setAttribute("role", "menuitem");
        element.setAttribute("tabindex", "-1");
        element.className = ITEM_CLASS;
        element.textContent = item.label;
        element.addEventListener("click", () => {
            this.closeMenu();
            Promise.resolve().then(() => item.action()).catch((error: unknown) => { this.report("engine", `context menu item ${item.label}`, error); });
        });
        return element;
    }

    /** Discord closes its menu on Escape. */
    private closeMenu() {
        this.page.document.dispatchEvent(new this.page.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
}

/** The part a plugin gets: its providers are taken away when it stops. */
export function buildContextMenus(hub: ContextMenuHub, plugin: string, onDispose: (undo: () => void) => void): PluginContextMenus {
    return {
        add(id, provider) {
            onDispose(hub.add(plugin, id, provider));
        }
    };
}
