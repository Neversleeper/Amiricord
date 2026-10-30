/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AnonymiseFileNames (author fawn) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which adds a button to every upload to switch it, and a /spoiler command): here the rule is the same for every upload and a setting turns it off or on. The patch is on Discord's upload function, so it only applies if that code still looks like the original's; it is optional and does nothing when it does not. The option to add SPOILER_ to the name is kept. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    anonymise: { type: "boolean", default: true, description: "Anonymise the names of uploaded files" },
    spoilerMessages: { type: "boolean", default: false, description: "Put SPOILER_ in front of the name, so the file is hidden until clicked" },
    method: {
        type: "select",
        default: "random",
        description: "How the new name is made",
        options: [
            { label: "Random characters", value: "random" },
            { label: "Always the same name", value: "consistent" },
            { label: "Timestamp", value: "timestamp" },
            { label: "Date", value: "date" }
        ]
    },
    randomLength: { type: "number", default: 7, min: 3, max: 32, integer: true, description: "Length of the random name" },
    consistent: { type: "string", default: "image", description: "The name used for \"Always the same name\"" },
    dateFormat: { type: "string", default: "YYYY-MM-DD_HH-mm-ss-SSS", description: "Format of the date name (YYYY, MM, DD, HH, mm, ss and SSS are understood)" }
});

export interface NameRules { method: string; randomLength: number; consistent: string; dateFormat: string; spoiler: boolean; }

/** The extension of a file name, with the dot ("" when there is none); ".tar.gz" counts as one. */
export function extensionOf(name: string): string {
    const tar = /\.tar\.\w+$/.exec(name);
    const index = tar?.index ?? name.lastIndexOf(".");
    return index > 0 ? name.slice(index) : "";
}

/** The date written by a format such as YYYY-MM-DD_HH-mm-ss-SSS. */
export function formatDate(format: string, date: Date): string {
    const two = (value: number) => value.toString().padStart(2, "0");
    return format.replace(/YYYY/g, String(date.getFullYear())).replace(/MM/g, two(date.getMonth() + 1)).replace(/DD/g, two(date.getDate())).replace(/HH/g, two(date.getHours()))
        .replace(/mm/g, two(date.getMinutes())).replace(/ss/g, two(date.getSeconds())).replace(/SSS/g, date.getMilliseconds().toString().padStart(3, "0"));
}

/** The new name of a file: another name with the same extension. `pick` gives numbers in [0, 1). */
export function anonymisedName(original: string, rules: NameRules, now: Date, pick: () => number = Math.random): string {
    const extension = extensionOf(original);
    const chars = "0123456789bdfhjkmnpqrstvwxz";
    let base: string;
    switch (rules.method) {
        case "consistent": base = rules.consistent || "image"; break;
        case "timestamp": base = String(now.getTime()); break;
        case "date": base = formatDate(rules.dateFormat, now) || String(now.getTime()); break;
        default: base = Array.from({ length: Math.max(1, rules.randomLength) }, () => chars[Math.floor(pick() * chars.length)]).join("");
    }
    return `${rules.spoiler ? "SPOILER_" : ""}${base}${extension}`;
}

const plugin: PluginCode & { anonymise(upload: { filename?: string; }): void; } = {
    settings,
    patches: [
        {
            find: "async uploadFiles(",
            lazy: true,
            required: false,
            replacements: [{ match: /async uploadFiles\((\i)\){/, replace: "$&$1.forEach($self.anonymise);" }]
        }
    ],
    anonymise(upload) {
        if (!settings.store.anonymise || typeof upload?.filename !== "string") return;
        upload.filename = anonymisedName(upload.filename, {
            method: settings.store.method, randomLength: settings.store.randomLength, consistent: settings.store.consistent, dateFormat: settings.store.dateFormat, spoiler: settings.store.spoilerMessages
        }, new Date());
    }
};

export default plugin;
