/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UnitConverter (author sadan) as found in Equicord's copy of Vencord's plugins. The original has a longer table written out in a file; this one covers temperature, length, weight, volume and speed in both directions with the same idea (find numbers followed by a unit and convert to the other system). The result shows as a notice, not under the message.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    myUnits: {
        type: "select", default: "imperial", description: "The units you use: things are converted to the other kind",
        options: [{ label: "Imperial", value: "imperial" }, { label: "Metric", value: "metric" }]
    }
});

type Rule = { regex: RegExp; convert(value: number, groups: string[]): string; };
const fixed = (n: number) => String(Number(n.toFixed(2)));

/** Imperial text -> metric. */
const IMPERIAL: Rule[] = [
    { regex: /(-?\d+(?:\.\d+)?) ?°?F(?!\w)/gi, convert: v => `${fixed((v - 32) * 5 / 9)}°C` },
    { regex: /(\d+)(?:'|\s?ft|\s?feet|\s?foot) ?(\d+(?:\.\d+)?)(?:"|''|\s?in(?:ch(?:es)?)?)/gi, convert: (_v, g) => `${fixed(Number(g[1]) * 0.3048 + Number(g[2]) * 0.0254)}m` },
    { regex: /(\d+(?:\.\d+)?) ?(?:ft|feet|foot)(?!\w)/gi, convert: v => `${fixed(v * 0.3048)}m` },
    { regex: /(\d+(?:\.\d+)?) ?(?:in|inch|inches)(?!\w)/gi, convert: v => `${fixed(v * 2.54)}cm` },
    { regex: /(\d+(?:\.\d+)?) ?(?:yd|yards?)(?!\w)/gi, convert: v => `${fixed(v * 0.9144)}m` },
    { regex: /(\d+(?:\.\d+)?) ?(?:mi|miles?)(?!\w)/gi, convert: v => `${fixed(v * 1.609344)}km` },
    { regex: /(\d+(?:\.\d+)?) ?(?:lbs?|pounds?)(?!\w)/gi, convert: v => `${fixed(v * 0.45359237)}kg` },
    { regex: /(\d+(?:\.\d+)?) ?(?:oz|ounces?)(?!\w)/gi, convert: v => `${fixed(v * 28.349523)}g` },
    { regex: /(\d+(?:\.\d+)?) ?(?:gal|gallons?)(?!\w)/gi, convert: v => `${fixed(v * 3.785411784)}L` },
    { regex: /(\d+(?:\.\d+)?) ?(?:fl ?oz)(?!\w)/gi, convert: v => `${fixed(v * 29.5735)}mL` },
    { regex: /(\d+(?:\.\d+)?) ?mph(?!\w)/gi, convert: v => `${fixed(v * 1.609344)}km/h` }
];

/** Metric text -> imperial. */
const METRIC: Rule[] = [
    { regex: /(-?\d+(?:\.\d+)?) ?°?C(?!\w)/gi, convert: v => `${fixed(v * 9 / 5 + 32)}°F` },
    { regex: /(\d+(?:\.\d+)?) ?(?:km|kilometers?|kilometres?)(?!\w)/gi, convert: v => `${fixed(v / 1.609344)}mi` },
    { regex: /(\d+(?:\.\d+)?) ?(?:cm|centimeters?|centimetres?)(?!\w)/gi, convert: v => `${fixed(v / 2.54)}in` },
    { regex: /(\d+(?:\.\d+)?) ?(?:m|meters?|metres?)(?!\w)/gi, convert: v => `${fixed(v / 0.3048)}ft` },
    { regex: /(\d+(?:\.\d+)?) ?(?:kg|kilograms?)(?!\w)/gi, convert: v => `${fixed(v / 0.45359237)}lb` },
    { regex: /(\d+(?:\.\d+)?) ?(?:g|grams?)(?!\w)/gi, convert: v => `${fixed(v / 28.349523)}oz` },
    { regex: /(\d+(?:\.\d+)?) ?(?:l|liters?|litres?)(?!\w)/gi, convert: v => `${fixed(v / 3.785411784)}gal` },
    { regex: /(\d+(?:\.\d+)?) ?(?:ml|milliliters?|millilitres?)(?!\w)/gi, convert: v => `${fixed(v / 29.5735)}fl oz` },
    { regex: /(\d+(?:\.\d+)?) ?km\/h(?!\w)/gi, convert: v => `${fixed(v / 1.609344)}mph` }
];

/** The conversions found in a text, as "5 ft -> 1.52m" lines (one per match). */
export function convertText(text: string, to: "metric" | "imperial"): string[] {
    const found: string[] = [];
    for (const rule of to === "metric" ? IMPERIAL : METRIC) {
        for (const match of text.matchAll(rule.regex)) found.push(`${match[0].trim()} → ${rule.convert(Number(match[1]), [...match])}`);
    }
    return found;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        ctx.messageButtons.add({
            id: "convert-units",
            label: "Convert Units",
            icon: { viewBox: "0 0 24 24", path: "M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 8.74A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" },
            onClick: ({ channelId, messageId }) => {
                const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { content?: string; } | undefined; } | undefined)?.getMessage(channelId, messageId);
                const found = convertText(message?.content ?? "", settings.store.myUnits === "metric" ? "imperial" : "metric");
                ctx.toasts.show(found.length > 0 ? found.slice(0, 4).join("  •  ") : "No units to convert in that message.", found.length > 0 ? "info" : "failure");
            }
        });
    }
};

export default plugin;
