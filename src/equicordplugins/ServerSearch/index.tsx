/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ServerSearch (author camila314) as found in TestCord's copy of Equicord's plugins. NOT tried in a real Discord.
// Differences from the original: the button is added with `ctx.serverList` (Amiricord's own server list API, drawn above the servers), the dispatcher is found with the
// plugin's own finder, and the hover text is the browser's own `title` (the original used Discord's Tooltip component, which Amiricord does not offer yet).

import type { PluginCode } from "../../renderer/engine";

const CSS = `
#amiricord-searchbutton-container { width: 100%; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
#amiricord-searchbutton { display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: var(--background-primary, var(--background-base-low, #2b2d31)); height: 48px; width: 48px; border-radius: 100%; transition: border-radius 0.15s ease-out, background-color 0.15s ease-out; cursor: pointer; }
#amiricord-searchbutton-icon { color: var(--text-default, var(--text-normal, #dbdee1)); }
#amiricord-searchbutton:hover { border-radius: 34%; background-color: var(--green-360, #248046); }
#amiricord-searchbutton:hover #amiricord-searchbutton-icon { color: var(--white-500, #fff); }
`;

interface Dispatcher { dispatch(event: { type: string; [key: string]: unknown; }): void; }

let dispatcher: Dispatcher | undefined;
/** Changes at every stop, so a start that was still waiting for the dispatcher knows it must not go on. */
let generation = 0;

function SearchIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" id="amiricord-searchbutton-icon">
            <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.421.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
        </svg>
    );
}

function SearchButton() {
    return (
        <div id="amiricord-searchbutton-container">
            <div
                id="amiricord-searchbutton"
                title="Search"
                role="button"
                tabIndex={0}
                aria-label="Search servers"
                onClick={() => dispatcher?.dispatch({ type: "QUICKSWITCHER_SHOW", query: "", queryMode: null })}
            >
                <SearchIcon />
            </div>
        </div>
    );
}

const plugin: PluginCode = {
    async start(ctx) {
        const mine = ++generation;
        const found = await ctx.finders.byProps<Dispatcher>("dispatch", "subscribe").ready();
        if (mine !== generation) return;
        dispatcher = found;
        ctx.addStyle(CSS);
        ctx.serverList.add("above", SearchButton);
    },

    stop() {
        generation++;
        dispatcher = undefined;
    }
};

export default plugin;
