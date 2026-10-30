/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceCount (author sirphantom89) as found in TestCord. The original patched the code that draws a channel in the list; here a small number is put at the end of the row of each voice and stage channel, counted from Discord's voice state store, and redrawn when someone joins or leaves. Same two settings (show the limit; hide the number on empty channels). New: a channel that is full shows its number in red.
// The rows (`a[data-list-item-id="channels___<id>"]`, with a `linkTop_` row inside) were read in her running Discord (build 655747); the number itself was NOT seen with people in a channel.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showUserLimit: { type: "boolean", default: true, description: "Show the user limit too, on channels that have one (3/10)" },
    hideEmpty: { type: "boolean", default: true, description: "Hide the number on empty channels" }
});

/** The text of the badge, or null when none is shown. */
export function countLabel(count: number, limit: number, showLimit: boolean, hideEmpty: boolean): string | null {
    if (count === 0 && hideEmpty) return null;
    return showLimit && limit > 0 ? `${count}/${limit}` : String(count);
}

export const isFull = (count: number, limit: number): boolean => limit > 0 && count >= limit;

/** Discord's channel types for a voice channel and a stage channel. */
export const VOICE_TYPES: readonly number[] = [2, 13];

interface VoiceStates { getVoiceStatesForChannel(channelId: string): Record<string, unknown> | undefined; }
interface Channels { getChannel(id: string): { type?: number; userLimit?: number; user_limit?: number; } | undefined; }

const ROW = "a[data-list-item-id^=\"channels___\"]";
const MARK = "data-amiricord-voicecount";
const CSS = `
[${MARK}] { margin-left: auto; padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--channels-default, var(--text-muted, #949ba4)); flex: none; }
[${MARK}="full"] { color: var(--status-danger, #f23f43); }
`;
const REDRAW_DELAY_MS = 120;

let stop: (() => void) | undefined;

const plugin: PluginCode & { redraw?(): void; } = {
    settings,
    start(ctx) {
        ctx.addStyle(CSS, "voice-count");
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const states = ctx.common.VoiceStateStore;
        const channels = ctx.common.ChannelStore;
        const draw = () => {
            const store = states.get() as unknown as VoiceStates | undefined;
            const channelStore = channels.get() as unknown as Channels | undefined;
            if (!store || !channelStore) return;
            for (const row of page.querySelectorAll<HTMLElement>(ROW)) {
                const id = row.getAttribute("data-list-item-id")?.slice("channels___".length);
                const channel = id ? channelStore.getChannel(id) : undefined;
                const top = row.querySelector<HTMLElement>("[class*=\"linkTop_\"]");
                const badge = top?.querySelector<HTMLElement>(`[${MARK}]`);
                if (!id || !channel || !top || !VOICE_TYPES.includes(channel.type ?? -1)) { badge?.remove(); continue; }
                const count = Object.keys(store.getVoiceStatesForChannel(id) ?? {}).length;
                const limit = channel.userLimit ?? channel.user_limit ?? 0;
                const text = countLabel(count, limit, settings.store.showUserLimit, settings.store.hideEmpty);
                if (text === null) { badge?.remove(); continue; }
                const element = badge ?? top.appendChild(page.createElement("span"));
                element.setAttribute(MARK, isFull(count, limit) ? "full" : "yes");
                if (element.textContent !== text) element.textContent = text;
            }
        };
        let timer: number | undefined;
        const queue = () => {
            if (timer !== undefined) return;
            timer = view.setTimeout(() => { timer = undefined; draw(); }, REDRAW_DELAY_MS);
        };
        plugin.redraw = queue;
        // The channel list is drawn again when you scroll or change server, so the badges are put back when the page changes.
        const observer = new view.MutationObserver(records => {
            // Our own badges changing must not start another round.
            const ours = (node: Node) => node instanceof view.Element && node.hasAttribute(MARK);
            const inside = (record: MutationRecord) => record.target instanceof view.Element && record.target.closest(`[${MARK}]`) !== null;
            if (records.some(record => !inside(record) && ![...record.addedNodes, ...record.removedNodes].every(ours))) queue();
        });
        observer.observe(page.body, { childList: true, subtree: true });
        queue();
        stop = () => {
            observer.disconnect();
            if (timer !== undefined) view.clearTimeout(timer);
            plugin.redraw = undefined;
            for (const badge of page.querySelectorAll(`[${MARK}]`)) badge.remove();
        };
    },
    flux: {
        VOICE_STATE_UPDATES() { plugin.redraw?.(); },
        CHANNEL_UPDATES() { plugin.redraw?.(); }
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
