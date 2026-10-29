/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin SilentTyping (authors Ven, Rini, ImBanana and Etorix) as found in TestCord's copy of Equicord/Vencord's plugins. It hides that you
// are typing: Discord's own "start typing" is replaced by one that does nothing in the places you hid. The three patches are the original's. Differences:
//  - the little button in the chat bar is added by a fourth patch (Vencord's chat button API anchor, `"sticker")`, which matches once on build 653945) and is drawn with
//    plain React elements (a keyboard icon, crossed out when typing is hidden); a left or right click toggles globally, in the channel or in the server, as chosen in the
//    settings (the original's "open menu" choice is not there). The chat box right click menu has a "Silent Typing" checkbox (`textarea-context`, NOT checked);
//  - the command's "toggle" choice (global, channel or guild) is a text option (the commands API has no fixed choices), and the answer is a short message at the bottom of the page;
//  - the two "hide other people's typing" patches read their setting without a hook, so they follow it the next time the chat bar or the member list is drawn.
// NOT checked on a live page: the button and its position, and the other anchors on build 653945 (see below). The "start typing" one is in code Discord loads later (the text is not in the main file) and the
// member list one did not match; both are optional and lazy, so if they do not match, typing is simply not hidden (and the plugin card says so).

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const ACTIONS = [
    { label: "Toggle globally", value: "global" },
    { label: "Toggle in this channel", value: "channel" },
    { label: "Toggle in this server", value: "guild" }
];

const settings = definePluginSettings({
    showIcon: { type: "boolean", default: true, description: "Show the button in the chat bar." },
    leftClickAction: { type: "select", default: "global", description: "What a left click on the chat bar button does.", options: ACTIONS },
    rightClickAction: { type: "select", default: "channel", description: "What a right click on the chat bar button does.", options: ACTIONS },
    enabledGlobally: { type: "boolean", default: true, description: "Toggle functionality of your own typing indicator globally." },
    hideChatBoxTypingIndicators: { type: "boolean", default: false, description: "Hide other users' typing indicators from above the chat bar." },
    hideMembersListTypingIndicators: { type: "boolean", default: false, description: "Hide other users' typing indicators from the members list." },
    defaultHidden: {
        type: "boolean",
        default: true,
        description: "If enabled, your typing is hidden from others in any DMs/channels/servers not listed in \"Disabled Locations\" below. If disabled, your typing is shown in any not listed in \"Enabled Locations\" below."
    },
    alwaysEnableInActiveVoiceChat: { type: "boolean", default: false, description: "Always allow your typing indicator to show when typing in a voice channel you are connected to." },
    temporaryEnableThresholdServers: {
        type: "number", default: 0, min: 0, max: 3600, integer: true,
        description: "Temporarily allow your typing indicator to show for this many seconds after sending a message in a server channel. 0 turns it off."
    },
    temporaryEnableThresholdDirectMessages: {
        type: "number", default: 0, min: 0, max: 3600, integer: true,
        description: "Temporarily allow your typing indicator to show for this many seconds after sending a message in a DM or group DM. 0 turns it off."
    },
    enabledLocations: { type: "string", default: "", description: "Enable functionality for these IDs. A comma separated list of DM IDs, channel IDs and server IDs. Only used if \"Default Hidden\" is off." },
    disabledLocations: { type: "string", default: "", description: "Disable functionality for these IDs. A comma separated list of DM IDs, channel IDs and server IDs. Only used if \"Default Hidden\" is on." }
} as const);

let context: EnginePluginContext | undefined;
let channels: Lazy;
let selectedChannel: Lazy;
let messages: Lazy;
let dispatcher: Lazy;

const TITLE = "Silent Typing";

function effectiveList(): string[] {
    const text = settings.store.defaultHidden ? settings.store.disabledLocations : settings.store.enabledLocations;
    return text.split(",").map(part => part.trim()).filter(Boolean);
}

function toggleGlobal(): void {
    settings.store.enabledGlobally = !settings.store.enabledGlobally;
}

function toggleLocation(locationId: string): void {
    const list = effectiveList();
    const at = list.indexOf(locationId);
    if (at >= 0) list.splice(at, 1);
    else list.push(locationId);
    if (settings.store.defaultHidden) settings.store.disabledLocations = list.join(", ");
    else settings.store.enabledLocations = list.join(", ");
}

/** 1 when it is the voice channel you are in, 2 when you wrote there a moment ago, 0 otherwise. */
export function implicitlyAllowed(channelId: string): number {
    const channel = channels?.get()?.getChannel?.(channelId);
    if (!channel) return 0;
    if (settings.store.alwaysEnableInActiveVoiceChat && selectedChannel?.get()?.getVoiceChannelId?.() === channel.id) return 1;
    const seconds = channel.guild_id ? settings.store.temporaryEnableThresholdServers : settings.store.temporaryEnableThresholdDirectMessages;
    if (seconds === 0) return 0;
    const sent = messages?.get()?.getLastEditableMessage?.(channel.id)?.timestamp?.getTime?.();
    return sent && Date.now() < sent + seconds * 1000 ? 2 : 0;
}

export function explicitlyDisallowed(channelId: string): boolean {
    if (!settings.store.enabledGlobally) return false;
    const guildId = channels?.get()?.getChannel?.(channelId)?.guild_id;
    const list = effectiveList();
    const listed = list.includes(channelId) || (guildId !== undefined && list.includes(guildId));
    return settings.store.defaultHidden ? !listed : listed;
}

function say(text: string): void {
    context?.toasts.show(`${TITLE}: ${text}`, "info");
}

/** Toggles "global", "channel" or "guild" for the channel that is open; returns false when there is nothing to toggle. */
function toggleWhere(where: string): boolean {
    const channelId = selectedChannel?.get()?.getChannelId?.();
    if (where === "global") {
        toggleGlobal();
        return true;
    }
    if (!channelId) return false;
    if (where === "channel") {
        toggleLocation(channelId);
        return true;
    }
    const guildId = channels?.get()?.getChannel?.(channelId)?.guild_id;
    if (where !== "guild" || !guildId) return false;
    toggleLocation(guildId);
    return true;
}

function ChatBarButton(): unknown {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (value: number) => void];
    const on = settings.store.enabledGlobally;
    const act = (where: string) => {
        if (toggleWhere(where)) redraw(Date.now());
        else say("there is no channel open to toggle.");
    };
    return react.createElement("button", {
        type: "button",
        "aria-label": "Silent typing",
        title: on ? "Silent typing is on (click to change)" : "Silent typing is off (click to change)",
        onClick: () => act(settings.store.leftClickAction),
        onContextMenu: (event: { preventDefault(): void; }) => { event.preventDefault(); act(settings.store.rightClickAction); },
        style: { background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "var(--interactive-icon-default, #b5bac1)", display: "flex", alignItems: "center" }
    }, react.createElement("svg", { width: 24, height: 24, viewBox: "0 0 24 24" },
        react.createElement("path", { fill: "currentColor", d: "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm2 3v2h2V9H5Zm4 0v2h2V9H9Zm4 0v2h2V9h-2Zm4 0v2h2V9h-2ZM7 13v2h10v-2H7Z" }),
        on ? react.createElement("path", { stroke: "var(--status-danger, #f23f43)", strokeWidth: 2.4, strokeLinecap: "round", d: "M3 21 21 3" }) : null));
}

const plugin: PluginCode & {
    startTyping(channelId: string): void;
    addChatBarButton(buttons: unknown[], props: any): void;
    shouldHideChatBarTypingIndicators(): boolean;
    shouldHideMembersListTypingIndicators(): boolean;
} = {
    settings,

    patches: [
        {
            // The chat bar's button list (Vencord's chat button API patch; it matches once on build 653945).
            find: '"sticker")',
            lazy: true,
            required: false,
            replacements: [{ match: /0===(\i)\.length(?=.{0,25}?\(0,\i\.jsxs?\)\(.{0,75}?children:\1)/, replace: "($self.addChatBarButton($1,arguments[0]),$&)" }]
        },
        {
            find: '.dispatch({type:"TYPING_START_LOCAL"',
            lazy: true,
            required: false,
            replacements: [{ match: /startTyping\(\i\){.+?},stop/, replace: "startTyping:$self.startTyping,stop" }]
        },
        {
            find: "activityInviteEducationActivity:",
            lazy: true,
            required: false,
            group: true,
            replacements: [
                { match: /(let{activityInviteEducationActivity)/, replace: "const silentTypingShouldHideChatBarTypingIndicators=$self.shouldHideChatBarTypingIndicators();$1" },
                { match: /("stop-animation".{0,150}?ref:\i,children:)/, replace: "$1silentTypingShouldHideChatBarTypingIndicators?[]:" }
            ]
        },
        {
            find: ",{avatarCutoutX",
            lazy: true,
            required: false,
            replacements: [{
                match: /isTyping:(\i)=!1(,typingIndicatorRef:\i,isSpeaking:)/,
                replace: "silentTypingIsTyping:$1=$self.shouldHideMembersListTypingIndicators()?false:(arguments[0].isTyping??false)$2"
            }]
        }
    ],

    start(ctx) {
        context = ctx;
        channels = ctx.common.ChannelStore;
        selectedChannel = ctx.common.SelectedChannelStore;
        messages = ctx.common.MessageStore;
        dispatcher = ctx.common.FluxDispatcher;
        const added = ctx.commands.add({
            name: "silent-typing",
            description: "Hide your typing indicator from chat.",
            input: "builtin",
            options: [
                { name: "toggle", description: "Toggle functionality: global, channel or guild.", type: "string" },
                { name: "chat-bar-indicators", description: "Hide other users' typing indicators from above the chat bar.", type: "boolean" },
                { name: "members-list-indicators", description: "Hide other users' typing indicators from the members list.", type: "boolean" },
                { name: "default-hidden", description: "Whether to hide typing in DMs/channels/servers by default or not.", type: "boolean" }
            ],
            execute: args => {
                let updated = false;
                const value = (name: string) => args.find(arg => arg.name === name)?.value;
                const where = value("toggle");
                if (typeof where === "string") {
                    const channelId = selectedChannel?.get()?.getChannelId?.();
                    if (where === "global") {
                        toggleGlobal();
                        updated = true;
                    } else if (where === "channel" && channelId) {
                        toggleLocation(channelId);
                        updated = true;
                    } else if (where === "guild") {
                        const guildId = channelId ? channels?.get()?.getChannel?.(channelId)?.guild_id : undefined;
                        if (guildId) {
                            toggleLocation(guildId);
                            updated = true;
                        }
                    }
                }
                if (typeof value("chat-bar-indicators") === "boolean") { settings.store.hideChatBoxTypingIndicators = value("chat-bar-indicators") as boolean; updated = true; }
                if (typeof value("members-list-indicators") === "boolean") { settings.store.hideMembersListTypingIndicators = value("members-list-indicators") as boolean; updated = true; }
                if (typeof value("default-hidden") === "boolean") { settings.store.defaultHidden = value("default-hidden") as boolean; updated = true; }
                say(updated ? "settings updated." : "no changes made.");
            }
        });
        if (!added) throw new Error("the command /silent-typing could not be added (the name is taken or the commands API refused it)");

        // The entry of the chat box's right click menu.
        ctx.contextMenu.addNative("textarea-context", children => {
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!parts || !react) return;
            children.push(react.createElement(parts.MenuGroup as never, { id: "silent-typing", key: "silent-typing" },
                react.createElement(parts.MenuCheckboxItem as never, {
                    id: "silent-typing-toggle", label: "Silent Typing", checked: settings.store.enabledGlobally, action: () => { toggleGlobal(); }
                })));
        });
    },

    stop() {
        context = channels = selectedChannel = messages = dispatcher = undefined;
    },

    startTyping(channelId) {
        if (explicitlyDisallowed(channelId) && !implicitlyAllowed(channelId)) return;
        dispatcher?.get()?.dispatch({ type: "TYPING_START_LOCAL", channelId });
    },

    addChatBarButton(buttons, props) {
        try {
            if (!settings.store.showIcon || props?.disabled || props?.type?.analyticsName !== "normal") return;
            const react = currentReact() as any;
            buttons.push(react.createElement(ChatBarButton, { key: "silent-typing" }));
        } catch (error) {
            context?.reportError("SilentTyping", error);
        }
    },

    shouldHideChatBarTypingIndicators: () => settings.store.hideChatBoxTypingIndicators,
    shouldHideMembersListTypingIndicators: () => settings.store.hideMembersListTypingIndicators
};

export default plugin;
