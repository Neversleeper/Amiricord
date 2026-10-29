/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.DOM: small helpers for a plugin's styles and elements. Everything a plugin adds through it is remembered per plugin, so stopping the plugin removes it.

export interface BdDom {
    readonly screenWidth: number;
    readonly screenHeight: number;
    addStyle(caller: string, id: string, css: string): void;
    removeStyle(caller: string, id: string): void;
    createElement(tag: string, options?: Record<string, unknown>, ...children: Array<string | Node>): HTMLElement;
    parseHTML(html: string, fragment?: boolean): Node | NodeList;
    onAdded(caller: string, selector: string, callback: (element: Element) => void): () => void;
    onRemoved(caller: string, node: Node, callback: () => void): () => void;
    animate(caller: string, update: (progress: number) => void, duration: number, options?: { timing?: (t: number) => number; }): () => void;
    escapeHTML(text: string): string;
    /** Take away everything one plugin added. */
    cleanup(caller: string): void;
}

export interface DomPage {
    document: Document;
    innerWidth: number;
    innerHeight: number;
    MutationObserver: typeof MutationObserver;
    requestAnimationFrame(callback: (time: number) => void): number;
    cancelAnimationFrame(id: number): void;
    performance: { now(): number; };
}

/** BetterDiscord turns any id into one that is safe in a selector. */
export const safeId = (id: string): string => String(id).replace(/^[^a-z]+|[^\w-]+/gi, "-");

export function createBdDom(page: DomPage): BdDom {
    const styles = new Map<string, Set<string>>();
    const watchers = new Map<string, Set<() => void>>();

    const track = (caller: string, stop: () => void): (() => void) => {
        const set = watchers.get(caller) ?? new Set<() => void>();
        watchers.set(caller, set);
        const wrapped = () => { set.delete(wrapped); stop(); };
        set.add(wrapped);
        return wrapped;
    };
    const styleElement = (id: string): HTMLElement | null => page.document.getElementById(`bd-${safeId(id)}`);

    return {
        get screenWidth() { return Math.max(page.document.documentElement.clientWidth, page.innerWidth || 0); },
        get screenHeight() { return Math.max(page.document.documentElement.clientHeight, page.innerHeight || 0); },

        addStyle(caller, id, css) {
            const domId = `bd-${safeId(id)}`;
            let element = styleElement(id);
            if (!element) {
                element = page.document.createElement("style");
                element.id = domId;
                page.document.head.appendChild(element);
            }
            element.textContent = String(css);
            const ids = styles.get(caller) ?? new Set<string>();
            ids.add(id);
            styles.set(caller, ids);
        },
        removeStyle(caller, id) {
            styleElement(id)?.remove();
            styles.get(caller)?.delete(id);
        },

        createElement(tag, options = {}, ...children) {
            const element = page.document.createElement(tag);
            for (const [name, value] of Object.entries(options)) {
                if (value === undefined || value === null || value === false) continue;
                if (name === "className") element.className = String(value);
                else if (name === "style" && typeof value === "object") Object.assign(element.style, value);
                else if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
                else element.setAttribute(name, value === true ? "" : String(value));
            }
            if (children.length > 0) element.append(...children);
            return element;
        },
        parseHTML(html, fragment = false) {
            const template = page.document.createElement("template");
            template.innerHTML = String(html).trim();
            if (fragment) return template.content.cloneNode(true);
            return template.content.childNodes.length === 1 ? template.content.firstChild! : template.content.childNodes;
        },

        onAdded(caller, selector, callback) {
            const existing = page.document.body.querySelector(selector);
            if (existing) {
                callback(existing);
                return () => undefined;
            }
            const observer = new page.MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        const element = node as Element;
                        const match = element.matches(selector) ? element : element.querySelector(selector);
                        if (!match) continue;
                        observer.disconnect();
                        callback(match);
                        return;
                    }
                }
            });
            observer.observe(page.document.body, { subtree: true, childList: true });
            return track(caller, () => { observer.disconnect(); });
        },
        onRemoved(caller, node, callback) {
            const observer = new page.MutationObserver(mutations => {
                for (const mutation of mutations) {
                    const gone = Array.from(mutation.removedNodes);
                    if (gone.includes(node as ChildNode) || gone.some(n => n.contains(node))) {
                        observer.disconnect();
                        callback();
                        return;
                    }
                }
            });
            observer.observe(page.document.body, { subtree: true, childList: true });
            return track(caller, () => { observer.disconnect(); });
        },

        animate(caller, update, duration, options = {}) {
            const timing = options.timing ?? ((t: number) => t);
            const start = page.performance.now();
            let frame = 0;
            const tick = (time: number) => {
                const t = Math.min(1, Math.max(0, (time - start) / duration));
                update(timing(t));
                if (t < 1) frame = page.requestAnimationFrame(tick);
            };
            frame = page.requestAnimationFrame(tick);
            return track(caller, () => { page.cancelAnimationFrame(frame); });
        },

        escapeHTML: text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),

        cleanup(caller) {
            for (const id of [...(styles.get(caller) ?? [])]) styleElement(id)?.remove();
            styles.delete(caller);
            for (const stop of [...(watchers.get(caller) ?? [])]) stop();
            watchers.delete(caller);
        }
    };
}
