/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ViewRaw (authors Ven, Nickyux, Vishnya) as found in TestCord's copy of Vencord's plugins. Same idea and the same cleaning (private fields such as the e-mail and phone number of a person are taken out, and the edit history is left out of a message). The data is read from Discord's own message and user stores. The original's "copy raw" button on the message bar and its role and channel versions are not ported. Nothing is sent anywhere.

import { messageFromTarget, userIdFromTarget } from "../../api/clickTargets";
import { openPanelWindow } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    sortKeys: { type: "boolean", default: true, description: "Sort the keys of the data alphabetically" },
    stripSensitiveData: { type: "boolean", default: true, description: "Leave out private fields (e-mail, phone number) of people" }
});

const PRIVATE_FIELDS = ["email", "phone", "storeCountry", "personalConnectionId"];

/** Sorts the keys of every object, deeply. */
export function sortKeys<T>(value: T): T {
    if (Array.isArray(value)) return value.map(sortKeys) as T;
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sortKeys(inner)])) as T;
    }
    return value;
}

/** A plain copy of the data as JSON text, without the private fields of people (when asked) and the edit history of messages. */
export function rawText(data: unknown, options: { sort: boolean; strip: boolean; }): string {
    const copy = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    const strip = (person: unknown) => {
        if (options.strip && person && typeof person === "object") for (const field of PRIVATE_FIELDS) delete (person as Record<string, unknown>)[field];
    };
    strip(copy);
    strip(copy.author);
    for (const field of ["editHistory", "deleted", "firstEditTimestamp"]) delete copy[field];
    return JSON.stringify(options.sort ? sortKeys(copy) : copy, null, 4);
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const users = ctx.common.UserStore;
        const show = (title: string, data: unknown, content?: string) => {
            let text: string;
            try {
                text = rawText(data, { sort: settings.store.sortKeys, strip: settings.store.stripSensitiveData });
            } catch (error) {
                ctx.reportError("ViewRaw", error);
                ctx.toasts.show("That data could not be read.", "failure");
                return;
            }
            const copy = (value: string, done: string) => { navigator.clipboard.writeText(value).then(() => { ctx.toasts.show(done, "success"); }, () => { ctx.toasts.show("Could not copy.", "failure"); }); };
            openPanelWindow(ctx, title, kit => kit.panel(kit.card([
                kit.h("pre", { style: { maxHeight: "50vh", overflow: "auto", margin: 0, padding: "8px", userSelect: "text", fontSize: "12px", background: "var(--background-secondary, #2b2d31)", borderRadius: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, text),
                kit.row(kit.button("Copy data", () => { copy(text, "Data copied!"); }, { variant: "primary" }), content ? kit.button("Copy raw content", () => { copy(content, "Content copied!"); }) : null)
            ])));
        };
        ctx.menuItems.add("view-raw", click => {
            const found: Array<{ label: string; action(): void; }> = [];
            const ref = messageFromTarget(click.target);
            if (ref) {
                const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { content?: string; } | undefined; } | undefined)?.getMessage(ref.channelId, ref.messageId);
                if (message) found.push({ label: "View Raw Message", action: () => { show("Raw Message Data", message, message.content); } });
            }
            const userId = userIdFromTarget(click.target);
            const user = userId ? users.get()?.getUser(userId) : undefined;
            if (user) found.push({ label: "View Raw User", action: () => { show("Raw User Data", user); } });
            return found.length > 0 ? found : null;
        });
    }
};

export default plugin;
