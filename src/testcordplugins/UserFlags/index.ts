/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UserFlags (author x2b) as found in TestCord. Same four kinds, same private storage. The original shows the flag under that person's messages; the engine has no message-accessory hook yet, so here the flags are listed in the tab and shown as a notice when you flag someone. Everything stays in this computer's storage for the plugin.

import { userIdFromTarget } from "../../api/clickTargets";
import { addPanelTab, openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export const FLAG_KINDS = {
    danger: { label: "Danger", color: "#ff7473", emoji: "\u{1F6D1}" },
    warning: { label: "Warning", color: "#ffb02e", emoji: "⚠️" },
    info: { label: "Info", color: "#62a8ff", emoji: "ℹ️" },
    positive: { label: "Positive", color: "#62ff74", emoji: "✅" }
} as const;
export type FlagKind = keyof typeof FLAG_KINDS;
export interface Flag { type: FlagKind; text: string; }

const KEY = "flags";
let flags: Record<string, Flag> = {};
const listeners = new Set<() => void>();

/** The flags with one changed; null removes it. */
export function withFlag(all: Record<string, Flag>, id: string, flag: Flag | null): Record<string, Flag> {
    const next = { ...all };
    if (flag && flag.text.trim() !== "") next[id] = { type: flag.type, text: flag.text.trim() };
    else delete next[id];
    return next;
}

/** Only the entries that are a flag (a saved value may be damaged). */
export function cleanFlags(value: unknown): Record<string, Flag> {
    const out: Record<string, Flag> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;
    for (const [id, flag] of Object.entries(value)) {
        const candidate = flag as Partial<Flag> | null;
        if (candidate && typeof candidate.text === "string" && candidate.type !== undefined && candidate.type in FLAG_KINDS) out[id] = { type: candidate.type, text: candidate.text };
    }
    return out;
}

const plugin: PluginCode = {
    async start(ctx) {
        flags = cleanFlags(await ctx.storage.get(KEY));
        const users = ctx.common.UserStore;
        const nameOf = (id: string) => {
            const user = users.get()?.getUser(id) as { username?: string; globalName?: string; } | undefined;
            return user?.globalName ?? user?.username ?? id;
        };
        const save = async (id: string, flag: Flag | null) => {
            flags = withFlag(flags, id, flag);
            await ctx.storage.set(KEY, flags as never);
            for (const listener of listeners) listener();
        };
        const editor = (id: string) => openPanelWindow(ctx, `Flag ${nameOf(id)}`, (kit, react) => {
            const [kind, setKind] = react.useState(flags[id]?.type ?? "warning") as [string, (value: string) => void];
            const [text, setText] = react.useState(flags[id]?.text ?? "") as [string, (value: string) => void];
            return kit.panel(kit.card([
                kit.select({ value: kind, onChange: setKind, options: (Object.keys(FLAG_KINDS) as FlagKind[]).map(key => ({ label: `${FLAG_KINDS[key].emoji} ${FLAG_KINDS[key].label}`, value: key })) }),
                kit.input({ value: text, onChange: setText, placeholder: "A short text (empty removes the flag)", maxLength: 200 }),
                kit.row(kit.button("Save", () => {
                    save(id, { type: kind as FlagKind, text }).then(() => { ctx.toasts.show(text.trim() === "" ? "Flag removed." : `${FLAG_KINDS[kind as FlagKind].emoji} ${nameOf(id)}: ${text}`, "success"); }, error => { ctx.reportError("UserFlags", error); });
                }, { variant: "primary" }))
            ]));
        });
        ctx.menuItems.add("user-flags", click => {
            const id = userIdFromTarget(click.target);
            if (!id) return null;
            return { label: flags[id] ? "Edit User Flag" : "Flag User", action: () => { editor(id); } };
        });
        addPanelTab(ctx, {
            title: "User Flags",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const entries = Object.entries(flags);
                return kit.panel(entries.length === 0
                    ? kit.card([kit.title("User Flags"), kit.note("No flags yet. Right-click a person and choose Flag User.")])
                    : kit.card([kit.title(`User Flags (${entries.length})`), ...entries.map(([id, flag]) => kit.item(id, null, `${FLAG_KINDS[flag.type].emoji} ${nameOf(id)}`, flag.text, [
                        kit.button("Edit", () => { editor(id); }),
                        kit.button("Remove", () => { save(id, null).catch(() => undefined); }, { variant: "danger" })
                    ]))]));
            }
        });
    },
    stop() {
        listeners.clear();
        flags = {};
    }
};

export default plugin;
