/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// CSS from plugins. `ctx.addStyle(css)` puts a <style> element in the page and hands back a way to change or remove it;
// whatever a plugin added is removed when the plugin stops or fails to start, and nothing can be added afterwards.
// The text is always set as text, never as markup. CSS that would make the page contact a web address is refused:
// reaching the network is something a plugin has to declare, and a style sheet must not be a side door.
// Design: docs/design-03-settings.md piece D.

export interface StyleElementLike {
    id: string;
    textContent: string | null;
    remove(): void;
}

/** The little the manager needs from the page, so tests can give it a fake. */
export interface StyleHost {
    create(): StyleElementLike;
    attach(element: StyleElementLike): void;
}

export interface StyleHandle {
    /** Replace the CSS of this style. */
    update(css: string): void;
    /** Take the style out of the page. Safe to call twice. */
    remove(): void;
}

export const STYLE_LIMITS = { maxBytes: 512 * 1024, maxPerPlugin: 50, maxNameLength: 64 } as const;

export const STYLE_ID_PREFIX = "amiricord-style-";

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/** Size of a text in UTF-8, counted by hand so this file needs nothing from the page when it loads. */
function utf8Length(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            // A pair of UTF-16 halves is one character of four bytes.
            bytes += 4;
            i++;
        } else bytes += 3;
    }
    return bytes;
}

/** Why this CSS may not be added, or undefined when it is fine. */
export function refuseCss(css: unknown): string | undefined {
    if (typeof css !== "string") return "the CSS must be text";
    if (utf8Length(css) > STYLE_LIMITS.maxBytes) return `the CSS is larger than ${STYLE_LIMITS.maxBytes / 1024} KB`;
    // Comments could hide or split what is looked for, so they are taken out first.
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, " ");
    if (/@import\b/i.test(plain)) return "@import is not allowed (it loads another file)";
    // A backslash escape can spell `url(` another way, so any escape inside a url-like word is refused too.
    if (/u\\|ur\\|\\[0-9a-f]{1,6}\s*r\s*l/i.test(plain)) return "escapes inside url() are not allowed";
    if (/url\(\s*(['"]?)\s*(https?:|wss?:|ftp:|\/\/)/i.test(plain)) return "url() to a web address is not allowed";
    if (/image-set\(\s*['"]\s*(https?:|wss?:|ftp:|\/\/)/i.test(plain)) return "image-set() to a web address is not allowed";
    return undefined;
}

interface Owned {
    element: StyleElementLike;
}

export class StyleManager {
    private readonly byPlugin = new Map<string, Map<string, Owned>>();
    private counter = 0;

    constructor(private readonly host: StyleHost) { }

    /** How many styles a plugin has in the page right now. */
    countOf(pluginId: string): number {
        return this.byPlugin.get(pluginId)?.size ?? 0;
    }

    private add(pluginId: string, css: string, name: string | undefined): StyleHandle {
        const reason = refuseCss(css);
        if (reason) throw new Error(`Style of ${pluginId} refused: ${reason}`);
        if (name !== undefined && (name.length > STYLE_LIMITS.maxNameLength || !NAME_PATTERN.test(name))) throw new Error(`Style name of ${pluginId} is not valid`);

        let styles = this.byPlugin.get(pluginId);
        if (!styles) this.byPlugin.set(pluginId, styles = new Map());
        const key = name ?? `auto-${++this.counter}`;

        const existing = styles.get(key);
        if (existing) {
            // The same name again is a change of that style, not a second one.
            existing.element.textContent = css;
            return this.handle(pluginId, key, existing);
        }
        if (styles.size >= STYLE_LIMITS.maxPerPlugin) throw new Error(`${pluginId} already has ${STYLE_LIMITS.maxPerPlugin} styles`);

        const element = this.host.create();
        element.id = `${STYLE_ID_PREFIX}${pluginId}-${key}`;
        element.textContent = css;
        this.host.attach(element);
        const owned: Owned = { element };
        styles.set(key, owned);
        return this.handle(pluginId, key, owned);
    }

    private handle(pluginId: string, key: string, owned: Owned): StyleHandle {
        return {
            update: css => {
                const reason = refuseCss(css);
                if (reason) throw new Error(`Style of ${pluginId} refused: ${reason}`);
                if (this.byPlugin.get(pluginId)?.get(key) === owned) owned.element.textContent = css;
            },
            remove: () => {
                const styles = this.byPlugin.get(pluginId);
                if (styles?.get(key) !== owned) return;
                styles.delete(key);
                if (styles.size === 0) this.byPlugin.delete(pluginId);
                owned.element.remove();
            }
        };
    }

    /** Take out every style a plugin added. Returns how many there were. */
    removeAll(pluginId: string): number {
        const styles = this.byPlugin.get(pluginId);
        if (!styles) return 0;
        this.byPlugin.delete(pluginId);
        let count = 0;
        for (const { element } of styles.values()) {
            count++;
            try {
                element.remove();
            } catch {
                // An element the page already dropped is fine.
            }
        }
        return count;
    }

    /**
     * The `addStyle` function for one run of one plugin. `onDispose` registers the cleanup with the lifecycle;
     * after it runs, adding is refused so a late callback cannot leave a style behind.
     */
    forRun(pluginId: string, onDispose: (undo: () => void) => void): (css: string, name?: string) => StyleHandle {
        let closed = false;
        let registered = false;
        return (css, name) => {
            if (closed) throw new Error(`${pluginId} has stopped, so it cannot add styles`);
            const handle = this.add(pluginId, css, name);
            if (!registered) {
                registered = true;
                onDispose(() => { closed = true; this.removeAll(pluginId); });
            }
            return handle;
        };
    }
}

/** The real thing: <style> elements in the page's <head>. */
export function pageStyleHost(document: { createElement(tag: string): unknown; head?: { appendChild(node: unknown): unknown; } | null; documentElement?: { appendChild(node: unknown): unknown; } | null; }): StyleHost {
    return {
        create: () => document.createElement("style") as StyleElementLike,
        attach: element => { (document.head ?? document.documentElement)?.appendChild(element); }
    };
}
