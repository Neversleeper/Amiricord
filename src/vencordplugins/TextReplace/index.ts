/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TextReplace (authors AutumnVN, TheKodeToad, Etorix, Ape) as found in TestCord's copy of Vencord's plugins. Same two kinds of rules (simple, and regular expressions written as /pattern/flags) and the same "only if the message contains" condition, applied to messages you send. The original can also change how other people's messages look to you (a patch into Discord's message drawing); that part is not ported. Rules are kept in this plugin's own storage.

import { addPanelTab } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface Rule { find: string; replace: string; onlyIfIncludes: string; }

const KEY = "rules";
let rules: { simple: Rule[]; regex: Rule[]; } = { simple: [], regex: [] };
const listeners = new Set<() => void>();

/** A pattern written as /pattern/flags (or just a pattern, flags g) as a regular expression. */
export function stringToRegex(text: string): RegExp {
    const match = /^(\/)?(.+?)(?:\/([gimsuyv]*))?$/.exec(text);
    if (!match) return new RegExp(text);
    return new RegExp(match[2], match[3] === undefined ? "g" : [...new Set(match[3])].join(""));
}

/** The message with every rule applied. A rule that cannot be read is skipped. */
export function applyRules(content: string, all: { simple: Rule[]; regex: Rule[]; }): string {
    let text = content;
    for (const rule of all.simple) {
        if (rule.find === "" || (rule.onlyIfIncludes && !text.includes(rule.onlyIfIncludes))) continue;
        text = text.replaceAll(rule.find, rule.replace);
    }
    for (const rule of all.regex) {
        if (rule.find === "" || (rule.onlyIfIncludes && !text.includes(rule.onlyIfIncludes))) continue;
        try {
            text = text.replace(stringToRegex(rule.find), rule.replace);
        } catch { /* skip a rule that is not a valid expression */ }
    }
    return text;
}

function clean(value: unknown): { simple: Rule[]; regex: Rule[]; } {
    const pick = (list: unknown): Rule[] => Array.isArray(list)
        ? list.filter((rule): rule is Rule => !!rule && typeof rule.find === "string" && typeof rule.replace === "string").map(rule => ({ find: rule.find, replace: rule.replace, onlyIfIncludes: typeof rule.onlyIfIncludes === "string" ? rule.onlyIfIncludes : "" }))
        : [];
    const object = value && typeof value === "object" ? value as { simple?: unknown; regex?: unknown; } : {};
    return { simple: pick(object.simple), regex: pick(object.regex) };
}

const plugin: PluginCode = {
    async start(ctx) {
        rules = clean(await ctx.storage.get(KEY));
        const save = () => {
            ctx.storage.set(KEY, rules as never).catch(error => { ctx.reportError("TextReplace", error); });
            for (const listener of listeners) listener();
        };
        ctx.messageEvents.onBeforeSend(content => applyRules(content, rules));
        addPanelTab(ctx, {
            title: "Text Replace",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: (kit, react) => {
                const [sample, setSample] = react.useState("") as [string, (value: string) => void];
                const section = (kind: "simple" | "regex", title: string, note: string) => kit.card([
                    kit.title(title), kit.note(note),
                    ...rules[kind].map((rule, index) => kit.row(
                        kit.input({ value: rule.find, placeholder: kind === "regex" ? "/pattern/flags" : "Find", onChange: value => { rules[kind][index] = { ...rule, find: value }; save(); } }),
                        kit.input({ value: rule.replace, placeholder: "Replace with", onChange: value => { rules[kind][index] = { ...rule, replace: value }; save(); } }),
                        kit.input({ value: rule.onlyIfIncludes, placeholder: "Only if it contains (optional)", onChange: value => { rules[kind][index] = { ...rule, onlyIfIncludes: value }; save(); } }),
                        kit.button("Delete", () => { rules[kind] = rules[kind].filter((_, other) => other !== index); save(); }, { variant: "danger" }))),
                    kit.row(kit.button("Add a rule", () => { rules[kind] = [...rules[kind], { find: "", replace: "", onlyIfIncludes: "" }]; save(); }, { variant: "primary" }))
                ]);
                return kit.panel(
                    kit.card([kit.title("Try your rules"), kit.input({ value: sample, onChange: setSample, placeholder: "Type a message" }), kit.note(sample === "" ? "" : `Result: ${applyRules(sample, rules)}`)]),
                    section("simple", "Simple replacements", "Find and replace. For example, find brb and replace it with be right back."),
                    section("regex", "Regular expressions", "For advanced use. Write the pattern as /pattern/flags; $1 and so on work in the replacement.")
                );
            }
        });
    },
    stop() {
        listeners.clear();
        rules = { simple: [], regex: [] };
    }
};

export default plugin;
