/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the window of a plugin (opened by the gear or the "i" of its card) says and checks, without React and without Discord. The engine checks
// every value again against the plugin's own declaration (`ctx.plugins.setSetting`); the checks here only give the person a clear sentence before
// anything is sent, so a half-typed number never reaches the plugin. Design: docs/analysis-48-plugin-settings-gear.md.

import type { PluginSettingsAnswer, SettingInfo } from "../../api/pluginSettings";

export const NONE_TEXT = "There are no settings for this plugin.";
export const OFF_TEXT = "Turn this plugin on to see and change its settings.";
export const RESTART_TAG = "Restart";
export const RESTART_NOTE = "Restart Discord to apply this.";
export const RISKY_TAG = "Risky";
export const RISKY_QUESTION = "The plugin lists this setting as risky to change. Change it anyway?";
export const RESET_QUESTION = "Put every setting of this plugin back to its default? The plugin stays on or off as it is.";
export const NO_WINDOW_TEXT = "The window could not be opened.";

/** The sentence under the title of the Settings section when there is nothing to edit, or null when there are settings (even an empty list is "none"). */
export function emptyText(answer: PluginSettingsAnswer): string | null {
    if (answer.state === "not-loaded") return OFF_TEXT;
    if (answer.state === "none" || answer.settings.length === 0) return NONE_TEXT;
    return null;
}

export type NumberCheck = { ok: true; value: number; } | { ok: false; error: string; };

/** A number typed in a box. Empty, not a number, not whole when it must be, or out of its limits all give a sentence. */
export function checkNumber(text: string, info: Pick<SettingInfo, "min" | "max" | "integer">): NumberCheck {
    const trimmed = text.trim();
    if (trimmed === "") return { ok: false, error: "Type a number." };
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return { ok: false, error: "That is not a number." };
    if (info.integer === true && !Number.isInteger(value)) return { ok: false, error: "It must be a whole number." };
    if (info.min !== undefined && value < info.min) return { ok: false, error: `It must be at least ${info.min}.` };
    if (info.max !== undefined && value > info.max) return { ok: false, error: `It must be at most ${info.max}.` };
    return { ok: true, value };
}

/** A sentence when a text is longer than the setting allows, or null. */
export function checkText(text: string, info: Pick<SettingInfo, "maxLength">): string | null {
    return info.maxLength !== undefined && text.length > info.maxLength ? `It must be at most ${info.maxLength} characters.` : null;
}

/** The text a box shows for a setting: what the person is typing, or the value in use. */
export function boxText(info: Pick<SettingInfo, "value">, draft: string | undefined): string {
    return draft ?? String(info.value);
}

/** The label of the option that is chosen in a drop-down, for a value that may no longer be among the options. */
export function optionLabel(info: Pick<SettingInfo, "options" | "value">): string {
    return info.options?.find(option => option.value === info.value)?.label ?? String(info.value);
}

/** A readable title for a setting, made from its name: `randomizeSearch` becomes "Randomize Search", `show_all` becomes "Show all". */
export function settingTitle(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .trim();
    return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
