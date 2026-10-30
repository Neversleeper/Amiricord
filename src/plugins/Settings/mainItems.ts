/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the main tab of the Amiricord section lists: the quick actions (buttons) and the client settings (switches). They are data, so
// a feature that gets built later only changes its own entry from "coming soon" to working, and the page itself does not change.
// The set follows what TestCord shows on its main tab (the owner's reference); entries whose feature does not exist yet are marked
// `soon` and do nothing, and the page says so on each of them. Order of the tiles: three per row, like TestCord's.

import { FolderIcon, HealthIcon, LogIcon, PaintbrushIcon, RefreshIcon, SourceIcon } from "./icon";

export interface QuickActionItem {
    id: string;
    title: string;
    Icon: () => unknown;
    /** What the tile does. Missing while the feature does not exist. */
    run?: () => void;
    /** Ask before running: the first click shows `text`, and a second button named `button` runs it. */
    confirm?: { text: string; button: string; };
    /** The feature is not built yet: the tile is drawn dimmed and does nothing. */
    soon?: boolean;
}

export interface SettingItem {
    id: string;
    title: string;
    description: string;
    /** Changing it needs a restart of Discord (the page says so next to the title). */
    restart?: boolean;
    /** A caution shown under the description. */
    warning?: string;
    /** The feature is not built yet: the switch is drawn off and does nothing. */
    soon?: boolean;
    /** A switch that works: how to read it, change it and hear about changes made elsewhere (the editor window). Given by `defaultSettings`, never together with `soon`. */
    live?: LiveSwitch;
}

/** What makes a switch of the main tab work. */
export interface LiveSwitch {
    get(): boolean;
    set(on: boolean): void;
    /** Be told when it changes from somewhere else. Returns the way to stop listening. */
    subscribe(listener: () => void): () => void;
}

/** A drop-down of the settings: a title, a text and the labels of its choices. */
export interface ChoiceItem {
    id: string;
    title: string;
    description: string;
    /** The first one is the default and is shown as chosen. */
    choices: string[];
    restart?: boolean;
    soon?: boolean;
    /** A drop-down that works: which choice is picked, how to pick another, and how to hear about a change made elsewhere. Given by `defaultChoices`, never together with `soon`. */
    live?: LiveChoice;
}

/** What makes a drop-down of the main tab work: the position of the picked choice (0 is the first). */
export interface LiveChoice {
    get(): number;
    set(index: number): void;
    subscribe(listener: () => void): () => void;
}

/** A titled group of buttons under the settings (the notifications). */
export interface ButtonGroupItem {
    id: string;
    title: string;
    description: string;
    buttons: Array<{ id: string; title: string; run?: () => void; soon?: boolean; }>;
}

export interface QuickActionActions {
    openDataFolder(): void;
    openNotificationLog(): void;
    openNotificationOptions(): void;
    openCssEditor(): void;
    openHealthReport(): void;
    openSourceCode(): void;
    restart(): void;
}

/** The six tiles, in the order they are drawn. Five of them work and are wired to what the engine offers; "Edit Custom CSS" and "Notification Log" open their own windows. */
export function defaultQuickActions(actions: QuickActionActions): QuickActionItem[] {
    return [
        { id: "notification-log", title: "Notification Log", Icon: LogIcon, run: actions.openNotificationLog },
        { id: "quick-css", title: "Edit Custom CSS", Icon: PaintbrushIcon, run: actions.openCssEditor },
        {
            id: "relaunch", title: "Relaunch Discord", Icon: RefreshIcon, run: actions.restart,
            confirm: { text: "Relaunching closes any call and loses messages you have not sent.", button: "Relaunch now" }
        },
        { id: "data-folder", title: "Open Settings Folder", Icon: FolderIcon, run: actions.openDataFolder },
        { id: "health-report", title: "Health Report", Icon: HealthIcon, run: actions.openHealthReport },
        { id: "source-code", title: "View Source Code", Icon: SourceIcon, run: actions.openSourceCode }
    ];
}

/**
 * The switches of "Client Settings". A switch whose feature is built is given its `LiveSwitch` by id and stops being `soon`; the others wait, and each one is its own step of the plan.
 */
export function defaultSettings(live: Readonly<Record<string, LiveSwitch | undefined>> = {}): SettingItem[] {
    return withLive([
        { id: "amiricord-icon", title: "Show the Amiricord logo", description: "Swaps the Discord logo button for the Amiricord logo.", soon: true },
        { id: "custom-css", title: "Custom CSS", description: "Turn your own style sheet on or off.", soon: true },
        {
            id: "native-title-bar", title: "Windows title bar", restart: true, soon: true,
            description: "Uses the standard Windows title bar instead of Discord's own. It can work better with tools that manage windows."
        },
        {
            id: "transparent", title: "Transparent window", restart: true, soon: true,
            description: "Makes the window see-through. It only has an effect with a theme designed for transparency.",
            warning: "While this is on, the window cannot be resized and Windows cannot snap it to the screen edges."
        },
        {
            id: "no-min-size", title: "Remove minimum window size", restart: true, soon: true,
            description: "Lets you shrink the window below the size Discord normally allows."
        },
        {
            id: "ctrl-q", title: "Ctrl+Q to quit", restart: true, soon: true,
            description: "Adds Ctrl+Q as a second way to close Discord, besides Alt+F4."
        }
    ], live);
}

function withLive(items: SettingItem[], live: Readonly<Record<string, LiveSwitch | undefined>>): SettingItem[] {
    return items.map(item => {
        const found = live[item.id];
        if (!found) return item;
        const { soon: _soon, ...rest } = item;
        return { ...rest, live: found };
    });
}

/** The drop-downs that follow the switches. A drop-down whose feature is built is given its `LiveChoice` by id and stops being `soon`. */
export function defaultChoices(live: Readonly<Record<string, LiveChoice | undefined>> = {}): ChoiceItem[] {
    return withLiveChoices([{
        id: "background-material", title: "Window background effect", restart: true, soon: true,
        description: "Gives the window one of the Windows background looks. It needs a theme that supports transparency, and Discord must restart after you change it.",
        choices: [
            "None",
            "Mica (tints the window with your wallpaper and system theme)",
            "Tabbed (Mica with a stronger tint)",
            "Acrylic (blurs whatever is behind the window)"
        ]
    }], live);
}

function withLiveChoices(items: ChoiceItem[], live: Readonly<Record<string, LiveChoice | undefined>>): ChoiceItem[] {
    return items.map(item => {
        const found = live[item.id];
        if (!found) return item;
        const { soon: _soon, ...rest } = item;
        return { ...rest, live: found };
    });
}

/** The groups of buttons at the end of the settings. */
export function defaultButtonGroups(actions: Pick<QuickActionActions, "openNotificationLog" | "openNotificationOptions">): ButtonGroupItem[] {
    return [{
        id: "notifications", title: "Notifications",
        description: "Controls for the notifications Amiricord itself shows. Discord's own message notifications are not affected.",
        buttons: [
            { id: "notification-settings", title: "Notification options", run: actions.openNotificationOptions },
            { id: "notification-log", title: "Open the log", run: actions.openNotificationLog }
        ]
    }];
}
