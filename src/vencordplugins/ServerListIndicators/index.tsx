/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin ServerListIndicators (authors Rini and Panniku) as found in TestCord's copy of Vencord's plugins. Same look and settings.
// Differences: it is drawn through Amiricord's own server list API (`ctx.serverList`), the hook that redraws on store changes is written with React's own hooks, Discord's
// tooltip is the browser's own `title`, and the style uses the original's ids. NOT checked on a live page: the store names, and how the circle looks (it uses Discord's
// `--guildbar-avatar-size` variable, which may not exist in this build; a fallback of 48px is given).

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const SERVER = 1;
const FRIEND = 2;

const settings = definePluginSettings({
    mode: {
        type: "select",
        default: FRIEND,
        description: "Mode",
        restartNeeded: true,
        options: [
            { label: "Only online friend count", value: FRIEND },
            { label: "Only server count", value: SERVER },
            { label: "Both server and online friend counts", value: SERVER | FRIEND }
        ]
    },
    useCompact: { type: "boolean", default: false, restartNeeded: true, description: "Makes the indicator appear with only text" }
} as const);

const CSS = `
#ac-indicators-container, #ac-indicators-compact-container { width: 100%; display: flex; align-items: center; justify-content: center; }
#ac-indicators-indicator-items {
    display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 24%;
    height: var(--guildbar-avatar-size, 48px); width: var(--guildbar-avatar-size, 48px); background-color: var(--background-mod-subtle, rgba(128, 128, 128, 0.2));
    transition: border-radius 0.15s ease-out, background-color 0.15s ease-out;
}
.custom-theme-background #ac-indicators-indicator-items { background-color: var(--background-mod-strong, rgba(128, 128, 128, 0.3)); }
#ac-indicators-indicator-items:hover { background-color: var(--brand-500, #5865f2); }
#ac-indicators-compact-indicator-items { display: flex; flex-direction: column; align-items: center; justify-content: center; }
#ac-friendcount, #ac-guildcount { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 600; width: 100%; color: var(--text-default, currentColor); }
#ac-friendcount-icon, #ac-guildcount-icon { width: 14px; height: 14px; }
`;

const FRIEND_PATH = "M13 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z";
const FRIEND_PATH_2 = "M3 5v-.75C3 3.56 3.56 3 4.25 3s1.24.56 1.33 1.25C6.12 8.65 9.46 12 13 12h1a8 8 0 0 1 8 8 2 2 0 0 1-2 2 .21.21 0 0 1-.2-.15 7.65 7.65 0 0 0-1.32-2.3c-.15-.2-.42-.06-.39.17l.25 2c.02.15-.1.28-.25.28H9a2 2 0 0 1-2-2v-2.22c0-1.57-.67-3.05-1.53-4.37A15.85 15.85 0 0 1 3 5Z";
const GUILD_PATH = "M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44c-.21.4-.4.8-.58 1.21-1.69-.25-3.4-.25-5.1 0-.18-.41-.37-.82-.59-1.2-1.6.27-3.14.75-4.6 1.43A19.04 19.04 0 0 0 .96 17.7a18.43 18.43 0 0 0 5.63 2.87c.46-.62.86-1.28 1.2-1.98-.65-.25-1.29-.55-1.9-.92.17-.12.32-.24.47-.37 3.58 1.7 7.7 1.7 11.28 0l.46.37c-.6.36-1.25.67-1.9.92.35.7.75 1.35 1.2 1.98 2.03-.63 3.94-1.6 5.64-2.87.47-4.87-.78-9.09-3.3-12.83ZM8.3 15.12c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.89 2.27-2 2.27Zm7.4 0c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.88 2.27-2 2.27Z";

let relationships: Lazy;
let presences: Lazy;
let guilds: Lazy;
let joinRequests: Lazy;

function useStores(stores: any[], read: () => number): number {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    const value = read();
    react.useEffect(() => {
        const listener = () => redraw(n => n + 1);
        const live = stores.filter(store => typeof store?.addChangeListener === "function");
        live.forEach(store => store.addChangeListener(listener));
        return () => live.forEach(store => store.removeChangeListener(listener));
    }, stores);
    return value;
}

function onlineFriends(): number {
    try {
        let count = 0;
        for (const id of relationships?.get()?.getFriendIDs?.() ?? []) {
            if ((presences?.get()?.getStatus?.(id) ?? "offline") !== "offline") count++;
        }
        return count;
    } catch {
        return 0;
    }
}

function serverCount(): number {
    try {
        const all = guilds?.get()?.getGuilds?.() ?? {};
        const pending: string[] = joinRequests?.get()?.computeGuildIds?.() ?? [];
        return (guilds?.get()?.getGuildCount?.() ?? 0) + pending.filter(id => all[id] === undefined || all[id] === null).length;
    } catch {
        return 0;
    }
}

function Counter({ kind, count }: { kind: "friend" | "guild"; count: number; }) {
    const compact = settings.store.useCompact;
    const id = kind === "friend" ? "ac-friendcount" : "ac-guildcount";
    return (
        <div id={id}>
            {!compact && (
                <svg id={`${id}-icon`} aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                    {kind === "friend"
                        ? <><path fill="currentColor" d={FRIEND_PATH} /><path fill="currentColor" d={FRIEND_PATH_2} /></>
                        : <path fill="currentColor" d={GUILD_PATH} />}
                </svg>
            )}
            <span id={`${id}-text`}>{count}</span>
            {compact && <span id={`${id}-text-compact`}>{kind === "friend" ? "Friends" : "Servers"}</span>}
        </div>
    );
}

function Indicators() {
    const mode = Number(settings.store.mode);
    const friends = useStores([relationships?.get(), presences?.get()], onlineFriends);
    const servers = useStores([guilds?.get(), joinRequests?.get()], serverCount);
    const text = mode === (SERVER | FRIEND) ? `${friends} Friends, ${servers} Servers` : mode === FRIEND ? `${friends} Friends` : `${servers} Servers`;
    const prefix = settings.store.useCompact ? "ac-indicators-compact-" : "ac-indicators-";
    return (
        <div id={`${prefix}container`}>
            <div id={`${prefix}indicator-items`} title={text}>
                {(mode & FRIEND) !== 0 && <Counter kind="friend" count={friends} />}
                {(mode & SERVER) !== 0 && <Counter kind="guild" count={servers} />}
            </div>
        </div>
    );
}

const plugin: PluginCode = {
    settings,

    start(ctx) {
        relationships = ctx.common.RelationshipStore;
        presences = ctx.common.PresenceStore;
        guilds = ctx.common.GuildStore;
        joinRequests = ctx.finders.byStore("UserGuildJoinRequestStore");
        ctx.addStyle(CSS);
        ctx.serverList.add("above", Indicators);
    },

    stop() {
        relationships = presences = guilds = joinRequests = undefined;
    }
};

export default plugin;
