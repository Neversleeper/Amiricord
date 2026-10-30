/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UrlHighlighter (author prism) as found in Equicord's copy of Vencord's plugins. The original patches the link component and has a colour picker in the settings; here the links already on the page are coloured by hand (found in the message text, and in embeds when asked) and the tab has a text box and a colour box per pattern. The pattern is matched against the whole address anywhere in it (the same as the original), with * for any text and ? for one character.

import { addPanelTab } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    boldUrls: { type: "boolean", default: false, description: "Make the highlighted links bold" },
    highlightEmbeds: { type: "boolean", default: false, description: "Also colour the links inside embeds" }
});

export interface PatternEntry { pattern: string; color: string; }

const KEY = "patterns";
const DEFAULT_COLOR = "#eb7396";
const ATTRIBUTE = "data-amiricord-hl";
const CSS = `
[${ATTRIBUTE}] { color: var(--amiricord-hl-color) !important; }
[${ATTRIBUTE}="bold"] { font-weight: 700; }
`;

/** A glob (* any text, ? one character) as an unanchored case-insensitive regular expression. */
export function globToRegex(glob: string): RegExp {
    return new RegExp(glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i");
}

/** The first entry whose pattern matches the address. */
export function matchingEntry(url: string, entries: PatternEntry[]): PatternEntry | undefined {
    for (const entry of entries) {
        const pattern = entry.pattern.trim();
        if (pattern !== "" && globToRegex(pattern).test(url)) return entry;
    }
    return undefined;
}

/** Only the entries that have a text pattern and a colour like #rrggbb. */
export function cleanPatterns(value: unknown): PatternEntry[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is PatternEntry => !!entry && typeof entry.pattern === "string" && /^#[0-9a-f]{6}$/i.test(entry.color));
}

let entries: PatternEntry[] = [];
const listeners = new Set<() => void>();

const plugin: PluginCode = {
    async start(ctx) {
        entries = cleanPatterns(await ctx.storage.get(KEY));
        ctx.addStyle(CSS, "url-highlighter");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const scan = () => {
            timer = undefined;
            const selector = settings.store.highlightEmbeds ? "[id^=\"message-content-\"] a[href], [class*=\"embed\"] a[href]" : "[id^=\"message-content-\"] a[href]";
            for (const link of document.querySelectorAll<HTMLAnchorElement>(selector)) {
                const href = link.getAttribute("href") ?? "";
                const match = matchingEntry(href, entries);
                if (!match) {
                    if (link.hasAttribute(ATTRIBUTE)) { link.removeAttribute(ATTRIBUTE); link.style.removeProperty("--amiricord-hl-color"); }
                    continue;
                }
                const mode = settings.store.boldUrls ? "bold" : "plain";
                if (link.getAttribute(ATTRIBUTE) !== mode) link.setAttribute(ATTRIBUTE, mode);
                if (link.style.getPropertyValue("--amiricord-hl-color") !== match.color) link.style.setProperty("--amiricord-hl-color", match.color);
            }
        };
        const schedule = () => { if (timer === undefined) timer = setTimeout(scan, 150); };
        const observer = new MutationObserver(schedule);
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        const refresh = () => { schedule(); };
        listeners.add(refresh);
        ctx.onDispose(() => {
            observer.disconnect();
            listeners.delete(refresh);
            if (timer) clearTimeout(timer);
            for (const link of document.querySelectorAll<HTMLElement>(`[${ATTRIBUTE}]`)) { link.removeAttribute(ATTRIBUTE); link.style.removeProperty("--amiricord-hl-color"); }
        });
        schedule();
        const save = () => {
            ctx.storage.set(KEY, entries as never).catch(error => { ctx.reportError("UrlHighlighter", error); });
            for (const listener of listeners) listener();
        };
        addPanelTab(ctx, {
            title: "URL Highlighter",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => kit.panel(kit.card([
                kit.title("URL patterns"),
                kit.note("Links that match a pattern are coloured. Use * for any text, for example *.example.com"),
                ...entries.map((entry, index) => kit.row(
                    kit.input({ value: entry.pattern, placeholder: "*.example.com", onChange: value => { entries[index] = { ...entry, pattern: value }; save(); } }),
                    kit.input({ value: entry.color, type: "color", onChange: value => { entries[index] = { ...entry, color: value }; save(); } }),
                    kit.button("Delete", () => { entries = entries.filter((_, other) => other !== index); save(); }, { variant: "danger" }))),
                kit.row(kit.button("Add a pattern", () => { entries = [...entries, { pattern: "", color: DEFAULT_COLOR }]; save(); }, { variant: "primary" }))
            ]))
        });
    },
    stop() {
        listeners.clear();
        entries = [];
    }
};

export default plugin;
