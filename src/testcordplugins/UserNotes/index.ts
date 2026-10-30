/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UserNotes (author x2b) as found in TestCord. Same idea and same limit-free storage; the notes live in this computer's storage for the plugin. The original also shows the note box inside the profile and can copy your existing Discord notes; neither is ported (the engine has no profile hook, and reading your Discord notes needs your login token). The right-click item is "Open User Notes" on a person's name or picture.

import { userIdFromTarget } from "../../api/clickTargets";
import { addPanelTab, openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

const KEY = "notes";
let notes: Record<string, string> = {};
const listeners = new Set<() => void>();

/** The notes whose text or owner matches the words typed. `nameOf` gives the name shown for an id. */
export function searchNotes(all: Record<string, string>, query: string, nameOf: (id: string) => string): Array<[string, string]> {
    const needle = query.trim().toLowerCase();
    const entries = Object.entries(all);
    return needle === "" ? entries : entries.filter(([id, text]) => text.toLowerCase().includes(needle) || nameOf(id).toLowerCase().includes(needle) || id.includes(needle));
}

/** The notes with one changed; an empty text removes it. */
export function withNote(all: Record<string, string>, id: string, text: string): Record<string, string> {
    const next = { ...all };
    if (text.trim() === "") delete next[id];
    else next[id] = text;
    return next;
}

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        notes = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as unknown as Record<string, string> : {};
        const users = ctx.common.UserStore;
        const nameOf = (id: string) => {
            const user = users.get()?.getUser(id) as { username?: string; globalName?: string; } | undefined;
            return user?.globalName ?? user?.username ?? id;
        };
        const save = async (id: string, text: string) => {
            notes = withNote(notes, id, text);
            await ctx.storage.set(KEY, notes as never);
            for (const listener of listeners) listener();
        };
        const editor = (id: string) => openPanelWindow(ctx, `Notes about ${nameOf(id)}`, (kit, react) => {
            const [draft, setDraft] = react.useState(notes[id] ?? "") as [string, (value: string) => void];
            return kit.panel(kit.card([
                kit.area({ value: draft, onChange: setDraft, placeholder: "Write a note", rows: 8 }),
                kit.row(kit.button("Save", () => { save(id, draft).then(() => { ctx.toasts.show("Note saved.", "success"); }, error => { ctx.reportError("UserNotes", error); }); }, { variant: "primary" }))
            ]));
        });
        ctx.menuItems.add("user-notes", click => {
            const id = userIdFromTarget(click.target);
            return id ? { label: "Open User Notes", action: () => { editor(id); } } : null;
        });
        addPanelTab(ctx, {
            title: "User Notes",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: (kit, react) => {
                const [query, setQuery] = react.useState("") as [string, (value: string) => void];
                const shown = searchNotes(notes, query, nameOf);
                return kit.panel(
                    kit.card([kit.title(`Notes (${shown.length}/${Object.keys(notes).length})`), kit.input({ value: query, onChange: setQuery, placeholder: "Search by name, id or text" })]),
                    Object.keys(notes).length === 0
                        ? kit.card([kit.note("No notes yet. Right-click a person and choose Open User Notes.")])
                        : kit.card(shown.map(([id, text]) => kit.item(id, null, nameOf(id), text.slice(0, 120), [
                            kit.button("Edit", () => { editor(id); }),
                            kit.button("Delete", () => { save(id, "").catch(() => undefined); }, { variant: "danger" })
                        ])))
                );
            }
        });
    },
    stop() {
        listeners.clear();
        notes = {};
    }
};

export default plugin;
