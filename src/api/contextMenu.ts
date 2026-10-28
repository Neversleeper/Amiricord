/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Context menus for plugins: `ctx.contextMenu.open(event, items)` draws a menu at the pointer, `close()` takes it away, and `onElement(selector, build)` opens
// one on a right click on the elements that match. It is plain DOM made here (no Discord module, no permission), styled with Discord's colour variables so it
// follows the theme. It closes on a click outside, on Escape (which Discord does not get), on Tab, when the window changes size or something scrolls, after an item
// runs, when another menu opens, and when the plugin stops. Arrow keys, Home, End, Enter and Space work. Text is always set as text, never as HTML.
// This is NOT an entry inside Discord's own menu (that needs Discord's components, see the analysis). Design: docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md.

import type { DocumentLike, ElementLike, EventLike } from "./notifications";

export interface ContextMenuItem {
    id: string;
    label: string;
    action(): void;
    disabled?: boolean;
    /** Drawn in red, for something that removes or breaks. */
    danger?: boolean;
    /** Drawn with a check mark when true and as a choice that is not taken when false; left out when missing. */
    checked?: boolean;
}

export interface ContextMenuSeparator {
    separator: true;
}

/** A small heading and its items (and separators). One level only: a group inside a group is dropped. */
export interface ContextMenuGroup {
    group: string;
    items: Array<ContextMenuItem | ContextMenuSeparator>;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuGroup;

/** Where the pointer was: what a mouse event gives. */
export interface PointerLike {
    clientX: number;
    clientY: number;
    preventDefault?(): void;
}

export interface PluginContextMenu {
    /** Open a menu at the pointer. Any menu that was open goes first. Returns whether one opened (not when no entry is valid). */
    open(event: PointerLike, items: ContextMenuEntry[]): boolean;
    /** Close the menu this plugin opened, if it is still open. */
    close(): void;
    /**
     * Open a menu on a right click on an element that matches `selector`. `build(event, element)` gives the entries, or nothing (or only invalid entries) to leave
     * Discord's own menu alone. Returns a function that stops it. An error in `build` is reported and Discord's menu goes on as if it had not been there.
     */
    onElement(selector: string, build: (event: PointerLike, element: unknown) => ContextMenuEntry[] | null | undefined): () => void;
}

export const MAX_ENTRIES = 60;
export const LABEL_MAX = 80;
export const GROUP_MAX = 40;

// --- Cleaning what a plugin gives -----------------------------------------------------------------------------------------------------------

export interface CleanItem { kind: "item"; id: string; label: string; action(): void; disabled: boolean; danger: boolean; checked?: boolean; }
export interface CleanSeparator { kind: "separator"; }
export interface CleanGroup { kind: "group"; label: string; items: Array<CleanItem | CleanSeparator>; }
export type CleanEntry = CleanItem | CleanSeparator | CleanGroup;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function cleanItem(value: Record<string, unknown>): CleanItem | undefined {
    if (typeof value.id !== "string" || typeof value.label !== "string" || typeof value.action !== "function") return undefined;
    const label = cut(value.label.trim(), LABEL_MAX);
    if (label === "") return undefined;
    const item: CleanItem = { kind: "item", id: value.id, label, action: value.action as () => void, disabled: value.disabled === true, danger: value.danger === true };
    if (typeof value.checked === "boolean") item.checked = value.checked;
    return item;
}

/** A menu never starts or ends with a separator, and never has two in a row. */
function tidy<T extends { kind: string; }>(entries: T[]): T[] {
    const out: T[] = [];
    for (const entry of entries) {
        if (entry.kind === "separator" && (out.length === 0 || out[out.length - 1].kind === "separator")) continue;
        out.push(entry);
    }
    while (out.length > 0 && out[out.length - 1].kind === "separator") out.pop();
    return out;
}

/** The entries a plugin gave, without what is not valid (an item with no text or no function, a group with nothing in it...), at most `MAX_ENTRIES` items. Never throws. */
export function cleanEntries(entries: unknown): CleanEntry[] {
    if (!Array.isArray(entries)) return [];
    let count = 0;
    const out: CleanEntry[] = [];
    for (const raw of entries) {
        if (count >= MAX_ENTRIES) break;
        if (!isObject(raw)) continue;
        if (raw.separator === true) {
            out.push({ kind: "separator" });
        } else if (typeof raw.group === "string" && Array.isArray(raw.items)) {
            const inner: Array<CleanItem | CleanSeparator> = [];
            for (const sub of raw.items) {
                if (count >= MAX_ENTRIES) break;
                if (!isObject(sub)) continue;
                if (sub.separator === true) { inner.push({ kind: "separator" }); continue; }
                const item = cleanItem(sub);
                if (item) { inner.push(item); count++; }
            }
            const items = tidy(inner);
            const label = cut(raw.group.trim(), GROUP_MAX);
            if (items.some(entry => entry.kind === "item")) out.push({ kind: "group", label, items });
        } else {
            const item = cleanItem(raw);
            if (item) { out.push(item); count++; }
        }
    }
    return tidy(out);
}

// --- The page ---------------------------------------------------------------------------------------------------------------------------

export interface MenuEventLike extends EventLike {
    target?: unknown;
    clientX?: number;
    clientY?: number;
}

export interface MenuElementLike extends ElementLike {
    style: { left: string; top: string; };
    offsetWidth?: number;
    offsetHeight?: number;
    contains?(other: unknown): boolean;
    focus?(): void;
}

export interface ContextMenuDocument extends Omit<DocumentLike, "createElement"> {
    createElement(tag: string): MenuElementLike;
    addEventListener(type: string, listener: (event: MenuEventLike) => void, capture?: boolean): void;
    removeEventListener(type: string, listener: (event: MenuEventLike) => void, capture?: boolean): void;
    documentElement?: { clientWidth: number; clientHeight: number; } | null;
}

export interface ContextMenuLayerDeps {
    document?: ContextMenuDocument;
    /** Put the menu's CSS into the page (called once, the first time a menu opens). */
    addStyle(css: string): void;
}

export const CONTEXT_MENU_CSS = `
.amiricord-context-menu { position: fixed; z-index: 1004; box-sizing: border-box; min-width: 188px; max-width: 320px; max-height: calc(100vh - 16px); overflow-y: auto; padding: 6px 8px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); border-radius: 4px; font-size: 14px; color: var(--text-default, #dbdee1); background: var(--background-floating, var(--background-base-lowest, #111214)); box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.4)); outline: none; }
.amiricord-context-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; box-sizing: border-box; padding: 6px 8px; border-radius: 2px; line-height: 18px; cursor: pointer; user-select: none; }
.amiricord-context-item[data-active="true"] { color: var(--menu-item-default-hover-text, #fff); background: var(--menu-item-default-hover-background, var(--brand-500, #5865f2)); }
.amiricord-context-item-danger { color: var(--status-danger, #f23f42); }
.amiricord-context-item-danger[data-active="true"] { color: #fff; background: var(--status-danger, #da373c); }
.amiricord-context-item[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.amiricord-context-item[aria-disabled="true"][data-active="true"] { color: inherit; background: transparent; }
.amiricord-context-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amiricord-context-check { flex: 0 0 auto; width: 16px; text-align: center; }
.amiricord-context-separator { height: 1px; margin: 4px 0; background: var(--background-modifier-accent, rgba(255, 255, 255, 0.08)); }
.amiricord-context-group-title { padding: 6px 8px 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-muted, #949ba4); }
`;

const VIEWPORT_MARGIN = 8;

interface Open {
    owner: string;
    root: MenuElementLike;
    close(): void;
}

export function createContextMenuLayer(deps: ContextMenuLayerDeps) {
    let current: Open | undefined;
    let styled = false;

    const closeCurrent = () => {
        const open = current;
        current = undefined;
        open?.close();
    };

    const openMenu = (owner: string, reportError: (source: string, error: unknown) => void, pointer: PointerLike, given: unknown): boolean => {
        const page = deps.document;
        if (!page?.body) return false;
        const entries = cleanEntries(given);
        if (!entries.some(entry => entry.kind !== "separator")) return false;
        closeCurrent();
        if (!styled) {
            styled = true;
            deps.addStyle(CONTEXT_MENU_CSS);
        }

        const root = page.createElement("div");
        root.className = "amiricord-context-menu";
        root.setAttribute("role", "menu");
        root.tabIndex = -1;

        const rows: Array<{ el: MenuElementLike; item: CleanItem; }> = [];
        let active = -1;
        const setActive = (index: number) => {
            if (rows[active]) rows[active].el.setAttribute("data-active", "false");
            active = index;
            if (rows[active]) {
                rows[active].el.setAttribute("data-active", "true");
                rows[active].el.focus?.();
            }
        };
        const next = (from: number, step: 1 | -1): number => {
            for (let i = from + step; i >= 0 && i < rows.length; i += step) if (!rows[i].item.disabled) return i;
            return from;
        };

        const run = (item: CleanItem) => {
            if (item.disabled) return;
            closeCurrent();
            try {
                item.action();
            } catch (error) {
                reportError("context menu action", error);
            }
        };

        const drawItem = (item: CleanItem, into: MenuElementLike) => {
            const row = page.createElement("div");
            row.className = `amiricord-context-item${item.danger ? " amiricord-context-item-danger" : ""}`;
            row.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
            row.setAttribute("data-id", item.id);
            row.setAttribute("data-active", "false");
            row.tabIndex = -1;
            if (item.disabled) row.setAttribute("aria-disabled", "true");
            if (item.checked !== undefined) row.setAttribute("aria-checked", item.checked ? "true" : "false");
            const label = page.createElement("span");
            label.className = "amiricord-context-label";
            label.textContent = item.label;
            row.append(label);
            if (item.checked === true) {
                const mark = page.createElement("span");
                mark.className = "amiricord-context-check";
                mark.textContent = "✓";
                row.append(mark);
            }
            const index = rows.length;
            rows.push({ el: row, item });
            row.addEventListener("mouseenter", () => { if (!item.disabled) setActive(index); });
            row.addEventListener("click", () => { run(item); });
            into.append(row);
        };
        const drawSeparator = (into: MenuElementLike) => {
            const line = page.createElement("div");
            line.className = "amiricord-context-separator";
            line.setAttribute("role", "separator");
            into.append(line);
        };

        for (const entry of entries) {
            if (entry.kind === "item") {
                drawItem(entry, root);
            } else if (entry.kind === "separator") {
                drawSeparator(root);
            } else {
                const group = page.createElement("div");
                group.setAttribute("role", "group");
                group.setAttribute("aria-label", entry.label);
                if (entry.label !== "") {
                    const title = page.createElement("div");
                    title.className = "amiricord-context-group-title";
                    title.textContent = entry.label;
                    group.append(title);
                }
                for (const inner of entry.items) {
                    if (inner.kind === "item") drawItem(inner, group);
                    else drawSeparator(group);
                }
                root.append(group);
            }
        }

        // Closing: a press outside, Escape (Discord does not get it), Tab, a new window size, or something scrolling.
        const onDown = (event: MenuEventLike) => {
            if (root.contains?.(event.target)) return;
            closeCurrent();
        };
        const onKey = (event: MenuEventLike) => {
            const key = event.key;
            if (key === "Escape") {
                event.preventDefault?.();
                event.stopPropagation?.();
                closeCurrent();
            } else if (key === "Tab") {
                closeCurrent();
            } else if (key === "ArrowDown" || key === "ArrowUp") {
                event.preventDefault?.();
                setActive(active < 0 ? (key === "ArrowDown" ? next(-1, 1) : next(rows.length, -1)) : next(active, key === "ArrowDown" ? 1 : -1));
            } else if (key === "Home" || key === "End") {
                event.preventDefault?.();
                setActive(key === "Home" ? next(-1, 1) : next(rows.length, -1));
            } else if ((key === "Enter" || key === " ") && rows[active]) {
                event.preventDefault?.();
                run(rows[active].item);
            }
        };
        const onChange = () => { closeCurrent(); };
        page.addEventListener("mousedown", onDown, true);
        page.addEventListener("keydown", onKey, true);
        page.addEventListener("scroll", onChange, true);
        page.addEventListener("resize", onChange, true);

        page.body.append(root);
        // Placed at the pointer and kept inside the window.
        const view = page.documentElement;
        const x = Number.isFinite(pointer.clientX) ? pointer.clientX : 0;
        const y = Number.isFinite(pointer.clientY) ? pointer.clientY : 0;
        const width = root.offsetWidth ?? 0;
        const height = root.offsetHeight ?? 0;
        const left = view ? Math.max(VIEWPORT_MARGIN, Math.min(x, view.clientWidth - width - VIEWPORT_MARGIN)) : x;
        const top = view ? Math.max(VIEWPORT_MARGIN, Math.min(y, view.clientHeight - height - VIEWPORT_MARGIN)) : y;
        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
        root.focus?.();

        current = {
            owner,
            root,
            close() {
                page.removeEventListener("mousedown", onDown, true);
                page.removeEventListener("keydown", onKey, true);
                page.removeEventListener("scroll", onChange, true);
                page.removeEventListener("resize", onChange, true);
                root.remove();
            }
        };
        return true;
    };

    return {
        forPlugin(id: string, onDispose: (undo: () => void) => void, reportError: (source: string, error: unknown) => void): PluginContextMenu {
            const stops = new Set<() => void>();
            let registered = false;
            const register = () => {
                if (registered) return;
                registered = true;
                // Switching the plugin off takes its menu and its listeners away.
                onDispose(() => {
                    for (const stop of [...stops]) stop();
                    if (current?.owner === id) closeCurrent();
                });
            };

            return {
                open(event, items) {
                    register();
                    return openMenu(id, reportError, isObject(event) ? event as unknown as PointerLike : { clientX: 0, clientY: 0 }, items);
                },

                close() {
                    if (current?.owner === id) closeCurrent();
                },

                onElement(selector, build) {
                    const page = deps.document;
                    if (!page || typeof selector !== "string" || selector.trim() === "" || typeof build !== "function") return () => undefined;
                    register();
                    let broken = false;
                    const listener = (event: MenuEventLike) => {
                        if (broken) return;
                        const target = event.target as { closest?(selector: string): unknown; } | null | undefined;
                        let element: unknown;
                        try {
                            element = typeof target?.closest === "function" ? target.closest(selector) : null;
                        } catch (error) {
                            // A selector that is not valid: said once, and this registration stops asking.
                            broken = true;
                            reportError("context menu selector", error);
                            return;
                        }
                        if (!element) return;
                        let entries: unknown;
                        try {
                            entries = build(event as unknown as PointerLike, element);
                        } catch (error) {
                            reportError("context menu build", error);
                            return;
                        }
                        if (!cleanEntries(entries).some(entry => entry.kind !== "separator")) return;
                        // Before Discord's own handlers: its menu must not open as well.
                        event.preventDefault?.();
                        event.stopPropagation?.();
                        openMenu(id, reportError, event as unknown as PointerLike, entries);
                    };
                    page.addEventListener("contextmenu", listener, true);
                    const stop = () => {
                        stops.delete(stop);
                        page.removeEventListener("contextmenu", listener, true);
                    };
                    stops.add(stop);
                    return stop;
                }
            };
        }
    };
}
