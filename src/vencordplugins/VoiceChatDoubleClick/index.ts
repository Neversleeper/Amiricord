/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceChatDoubleClick (authors Ven, D3SOX and sadan) as found in TestCord's copy of Vencord's plugins.
// The three patches are the original's. On build 653945: the channel mention one matches once; the "active now" one finds its anchor twice and the first match is used;
// the voice channel list one (".handleClickChat") is in code Discord loads later, so it is lazy and NOT known to match.
// Difference: the original opened the channel with Discord's `ChannelRouter`; here the "active now" click goes through the engine's channel jump (Discord's own
// `transitionToChannel` is not among the names this build exports, so it is looked for by name at the time of the click and does nothing if it is not there).

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const timers: Record<string, { timeout?: ReturnType<typeof setTimeout>; i: number; } | undefined> = {};

let context: EnginePluginContext | undefined;

interface Router { transitionToChannel(id: string): void; }

const plugin: PluginCode & {
    goToChannel(props: { id?: string; } | undefined): void;
    shouldRunOnClick(event: { detail: number; }, props: { channelId?: string; }): boolean;
    schedule(callback: () => void, instance: { props?: { channel?: { id?: string; }; }; }): void;
} = {
    patches: [
        {
            // Stage and voice channels (they share a concatenated module). `onClick` here is a custom prop that Discord handles itself, so `onDoubleClick` would not work;
            // a timer counts the clicks instead.
            find: ".handleClickChat",
            lazy: true,
            required: false,
            replacements: [{ match: /onClick:\(\)=>\{this.handleClick\(\)/g, replace: "onClick:()=>{$self.schedule(()=>{this.handleClick()},this)" }]
        },
        {
            // Channel mentions.
            find: 'className:"channelMention",children:[null!=',
            lazy: true,
            required: false,
            replacements: [{
                match: /onClick:(\i)(?=,.{0,30}className:"channelMention".+?(\i)\.inContent)/,
                replace: "onClick:(vcDoubleClickEvt)=>$self.shouldRunOnClick(vcDoubleClickEvt,$2)&&$1()"
            }]
        },
        {
            // Voice channels in the active now section: one click on the name goes there, a double click joins.
            find: ',["embedded_background"]',
            lazy: true,
            required: false,
            replacements: [{
                match: /(?=children)(?<=selectVoiceChannel\((\i)\.id\).{0,100})/,
                replace: "onClick:$self.goToChannel.bind(null,$1),"
            }]
        }
    ],

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
        for (const id of Object.keys(timers)) {
            clearTimeout(timers[id]?.timeout);
            delete timers[id];
        }
    },

    goToChannel(props) {
        const id = props?.id;
        if (!id || !context) return;
        try {
            context.finders.byProps<Router>("transitionToChannel").get()?.transitionToChannel(id);
        } catch (error) {
            context.reportError("VoiceChatDoubleClick", error);
        }
    },

    shouldRunOnClick(event, { channelId }) {
        const channels = context?.common.ChannelStore.get();
        const channel = channelId ? channels?.getChannel(channelId) as { type?: number; } | undefined : undefined;
        if (!channel || ![2, 13].includes(channel.type ?? -1)) return true;
        return event.detail >= 2;
    },

    schedule(callback, instance) {
        const id = instance.props?.channel?.id;
        if (!id) return;
        if (context?.common.SelectedChannelStore.get()?.getVoiceChannelId() === id) {
            callback();
            return;
        }
        const data = (timers[id] ??= { i: 0 });
        clearTimeout(data.timeout);
        if (++data.i >= 2) {
            callback();
            delete timers[id];
        } else {
            data.timeout = setTimeout(() => { delete timers[id]; }, 500);
        }
    }
};

export default plugin;
