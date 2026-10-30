/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceChannelSearch (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. The channels come from Discord's own channel store (only servers you are in); joining uses Discord's own join function (found by name, the same one FollowVoiceUser uses) and going uses the engine's ctx.navigate. Channels you cannot see or join are listed too, and Discord answers with its usual message when you press Join. Not tried in a real Discord.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface VoiceChannel { id: string; name: string; guildId: string; guildName: string; }

/** The channels whose name or server name has the typed words, in order of server and name. */
export function searchVoiceChannels(all: VoiceChannel[], query: string): VoiceChannel[] {
    const needle = query.trim().toLowerCase();
    const found = needle === "" ? all : all.filter(channel => channel.name.toLowerCase().includes(needle) || channel.guildName.toLowerCase().includes(needle));
    return [...found].sort((a, b) => a.guildName.localeCompare(b.guildName) || a.name.localeCompare(b.name));
}

interface GuildChannels { getChannels(guildId: string): { VOCAL?: Array<{ channel: { id: string; name: string; }; }>; } | undefined; }

const plugin: PluginCode = {
    start(ctx) {
        const guilds = ctx.common.GuildStore;
        const channelStore = ctx.finders.byStore<GuildChannels>("GuildChannelStore");
        const voice = ctx.finders.byProps<{ selectVoiceChannel(channelId: string | null): void; }>("selectVoiceChannel");
        const collect = (): VoiceChannel[] => {
            const all: VoiceChannel[] = [];
            const known = (guilds.get() as unknown as { getGuilds(): Record<string, { id: string; name?: string; }>; } | undefined)?.getGuilds() ?? {};
            for (const guild of Object.values(known)) {
                for (const entry of channelStore.get()?.getChannels(guild.id)?.VOCAL ?? []) all.push({ id: entry.channel.id, name: entry.channel.name, guildId: guild.id, guildName: guild.name ?? "A server" });
            }
            return all;
        };
        const open = () => {
            const all = collect();
            const done = openPanelWindow(ctx, "Voice channels", (kit, react) => {
                const [query, setQuery] = react.useState("") as [string, (value: string) => void];
                const shown = searchVoiceChannels(all, query).slice(0, 40);
                return kit.panel(
                    kit.card([kit.title(`${shown.length} of ${all.length} voice channels`), kit.input({ value: query, onChange: setQuery, placeholder: "Search by channel or server name" })]),
                    kit.card(shown.map(channel => kit.item(channel.id, null, channel.name, channel.guildName, [
                        kit.button("Join", () => { voice.get()?.selectVoiceChannel(channel.id); }, { variant: "primary" }),
                        kit.button("Go", () => { ctx.navigate(`/channels/${channel.guildId}/${channel.id}`); })
                    ])))
                );
            });
            if (!done) ctx.toasts.show("The window could not be opened.", "failure");
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === "v") { event.preventDefault(); open(); }
        };
        document.addEventListener("keydown", onKey);
        ctx.onDispose(() => { document.removeEventListener("keydown", onKey); });
        ctx.commands.add({ name: "voicesearch", description: "Search and join a voice channel in any of your servers", execute() { open(); } });
    }
};

export default plugin;
