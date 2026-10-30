/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// UiApi, a core plugin: the patches behind `ctx.serverList` (src/api/serverList.ts), `ctx.commands` (src/api/commands.ts) and `ctx.messagePopover`
// (src/api/messagePopover.ts). It does nothing until a plugin adds something. Every patch is optional: a Discord that moved the text only means that
// what plugins added does not show, and the health report says "no module matched" instead of Discord breaking. The texts were read from Discord's web
// build 652418 (the same files the desktop app runs), where each server list and commands pattern below matches exactly once; the message bar is
// described in `messagePopover.ts`. Written from scratch after reading how Vencord's three APIs work; no code was copied.
// Nothing here was tried in a real Discord.

import { commandHub } from "../../api/commands";
import { currentReact } from "../../api/jsxRuntime";
import { messageEventHub, type OutgoingChannel } from "../../api/messageEvents";
import { serverList, type ServerListPosition } from "../../api/serverList";
import { userArea } from "../../api/userArea";
import type { PluginCode } from "../../renderer/engine";

type Maker = (component: unknown, key: string, plugin: string) => unknown;

/** The class that catches a failing element so one broken plugin does not take the whole server list with it; it draws nothing after a failure. */
let boundary: { react: unknown; type: unknown; } | undefined;

function boundaryType(): unknown {
    const react = currentReact();
    if (boundary?.react === react) return boundary.type;
    const Base = react.Component as (new (props: unknown) => { props: { children?: unknown; }; state: { failed: boolean; }; }) | undefined;
    let type: unknown;
    if (typeof Base === "function") {
        class Boundary extends Base {
            state = { failed: false };
            static getDerivedStateFromError() { return { failed: true }; }
            render() { return (this as unknown as { state: { failed: boolean; }; }).state.failed ? null : this.props.children; }
        }
        type = Boundary;
    }
    boundary = { react, type };
    return type;
}

const make: Maker = (component, key) => {
    const react = currentReact();
    const inner = react.createElement(component);
    const type = boundaryType();
    return type ? react.createElement(type, { key }, inner) : react.createElement(react.Fragment, { key }, inner);
};

/** One component per place, made for the React Discord runs. It listens to the hub, so what a plugin adds later appears without Discord drawing the list again. */
let slots: { react: unknown; byPosition: Map<ServerListPosition, unknown>; } | undefined;

function slotFor(position: ServerListPosition): unknown {
    const react = currentReact();
    if (slots?.react !== react) slots = { react, byPosition: new Map() };
    let slot = slots.byPosition.get(position);
    if (!slot) {
        slot = function AmiricordServerListSlot() {
            react.useSyncExternalStore(serverList.subscribe, serverList.version);
            return react.createElement(react.Fragment, null, ...serverList.render(position, make));
        };
        slots.byPosition.set(position, slot);
    }
    return slot;
}

/** The one component that draws every plugin button of the bar, made for the React Discord runs. */
let userAreaComponent: { react: unknown; type: unknown; } | undefined;

function userAreaSlot(): unknown {
    const react = currentReact();
    if (userAreaComponent?.react === react) return userAreaComponent.type;
    const type = function AmiricordUserAreaSlot(props: { nameplate?: unknown; }) {
        react.useSyncExternalStore(userArea.subscribe, userArea.version);
        return react.createElement(react.Fragment, null, ...userArea.render((component, key) => {
            const inner = react.createElement(component, { nameplate: props.nameplate, iconForeground: undefined });
            const boundary = boundaryType();
            return boundary ? react.createElement(boundary, { key }, inner) : react.createElement(react.Fragment, { key }, inner);
        }));
    };
    userAreaComponent = { react, type };
    return type;
}

const plugin: PluginCode & {
    renderServerList(position: ServerListPosition): unknown[];
    renderUserArea(props: unknown): unknown[];
    withCommands(base: unknown): unknown;
    transformOutgoing(content: string, channel: OutgoingChannel): string;
} = {
    patches: [
        {
            // Discord's Home button. It returns one element; it now returns that element and the "above" ones after it.
            find: "tutorialId:\"friends-list\"",
            lazy: true,
            required: false,
            replacements: [{
                match: /return(\(0,\i\.jsx\)\("div",\{className:\i\.\i,"data-guilds-bar-home":!0,children:.{0,400}?tutorialId:"friends-list".+?\}\)\}\))(?=\}function)/,
                replace: "return[$1].concat($self.renderServerList(\"above\"))"
            }]
        },
        {
            // The scroll area of the list: the Home separator, then the servers. "in" goes between them and "below" after the servers.
            // The text must be in the module that draws the list (a first version looked for `.setGuildsTree(`, which is in another module of the same file).
            // Seen in build 653945: the Questify plugin wraps the element that comes after the separator (its patch turns `(0,r.jsx)(i3,{guildDiscoveryButton:` into
            // `(0,r.jsx)(Wrapper,{__amiricordOriginal:i3,guildDiscoveryButton:`), so the first pattern must not expect the plain form after the separator.
            find: "guildDiscoveryButton:",
            all: true,
            lazy: true,
            required: false,
            replacements: [
                {
                    match: /(scrollToTop:\i,lurkingGuildIds:\i\}\),\(0,\i\.jsx\)\(\i,\{\}\),)(?=\(0,\i\.jsx\)\(.{1,160}?guildDiscoveryButton:)/,
                    replace: "$1...$self.renderServerList(\"in\"),"
                },
                {
                    match: /(guildDiscoveryButton:\i,disableAppDownload:\i,isOverlay:\i,renderTreeNode:\i,lurkingGuildIds:\i\}\))(?=\]\}\))/,
                    replace: "$1,...$self.renderServerList(\"below\")"
                }
            ]
        },
        {
            // The bar at the bottom left (microphone, headphones, settings): the buttons added by plugins come first. The text was read from Discord build 653945, where the
            // function that draws the bar returns a row whose first child is the microphone button (it takes `accountContainerRef`).
            find: "accountContainerRef:",
            lazy: true,
            required: false,
            replacements: [{
                match: /children:\[(?=\(0,\i\.jsx\)\(\i,\{accountContainerRef:\i,selfMute)/,
                replace: "children:[...$self.renderUserArea(arguments[0]),"
            }]
        },
        {
            // The message box: the typed text is turned into the message to send by `let E=X.parse(channel,text)`; the plugins may change the text first.
            // Read from Discord build 655747 (module 688606, one match).
            find: ".handleSendMessage,onResize:",
            lazy: true,
            required: false,
            replacements: [{
                match: /let (\i)=(\i\.\i)\.parse\((\i),(\i)\);\1\.tts=/,
                replace: "let $1=$2.parse($3,$self.transformOutgoing($4,$3));$1.tts="
            }]
        },
        {
            // The function that gives the built-in commands (the list of shrug, tableflip, tts...): the added commands come with it.
            find: "getBuiltInCommands",
            lazy: true,
            required: false,
            replacements: [{
                match: /(function \i\(\i,\i,\i\)\{let \i=)(\i\?\i:\i)(,\i=\i\.getConfig\(\{location:"getBuiltInCommands"\}\)\.enabled)/,
                replace: "$1$self.withCommands($2)$3"
            }]
        }
    ],

    /** Called by the patched Discord code: the elements of one place of the server list. Never throws. */
    renderServerList(position) {
        try {
            const react = currentReact();
            return [react.createElement(slotFor(position), { key: `amiricord-slot-${position}` })];
        } catch {
            return [];
        }
    },

    /** Called by the patched Discord code with the props of the bar: the buttons of the plugins, drawn by one component that listens to the hub. Never throws. */
    renderUserArea(props) {
        try {
            const react = currentReact();
            const given = props as { nameplate?: unknown; iconForeground?: string; } | undefined;
            return [react.createElement(userAreaSlot(), { key: "amiricord-user-area", nameplate: given?.nameplate })];
        } catch {
            return [];
        }
    },

    /** Called by the patched Discord code with the text about to be sent and its channel: the text after the plugins changed it. Never throws. */
    transformOutgoing(content, channel) {
        try {
            return messageEventHub.transform(content, channel);
        } catch {
            return content;
        }
    },

    /** Called by the patched Discord code with its list of built-in commands: the same list with the plugins' commands added. Never throws. */
    withCommands(base) {
        try {
            return commandHub.withCommands(base);
        } catch {
            return base;
        }
    }
};

export default plugin;
