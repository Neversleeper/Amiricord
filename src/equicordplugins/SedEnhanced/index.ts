/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SedEnhanced (authors dawn, Willow, kat) as found in Equicord's copy of Vencord's plugins. Same expression format (any of / | $ # @ ! as the separator, flags r g m i s u d y v) and the same non-regex mode. The original hooks Discord's own typed `s/a/b/`; here it is a slash command, because the engine cannot cancel a message that is being sent. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    regexByDefault: { type: "boolean", default: false, description: "Use regular expressions unless the r flag is given (the r flag then turns them off)" }
});

const SED = /^s(?<sep>[/|$#@!])(?<match>(?!\1)(?:(?![^\\]\1).)*.|)\1(?<replace>(?!\1)(?:(?![^\\]\1).)*.|)\1?(?<modes>[rgmisudyv]*)$/;

/** The text after applying `s/match/replace/modes`, or undefined when the expression is not valid. */
export function applySed(expression: string, text: string, regexByDefault = false): string | undefined {
    const groups = SED.exec(expression.trim())?.groups;
    if (!groups) return undefined;
    let { match: pattern, replace } = groups;
    const flags = groups.modes.split("");
    const isRegex = flags.includes("r") !== regexByDefault;
    let find: string | RegExp = pattern;
    if (isRegex) {
        try {
            find = new RegExp(pattern, flags.filter(flag => "gmisudyv".includes(flag)).join(""));
        } catch {
            return undefined;
        }
    } else {
        pattern = pattern.replace(/\\([*?+/])/g, "$1");
        replace = replace.replace(/\\([*?+/])/g, "$1");
        find = pattern;
    }
    return flags.includes("g") ? text.replaceAll(find, replace) : text.replace(find, replace);
}

interface Actions { editMessage(channel: string, id: string, edit: { content: string; }): unknown; deleteMessage(channel: string, id: string): unknown; }
interface Messages { getLastEditableMessage(channel: string): { id: string; content: string; attachments?: unknown[]; } | undefined; }

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const actions = ctx.finders.byProps<Actions>("editMessage", "deleteMessage", "sendMessage");
        const messages = ctx.common.MessageStore;
        const selected = ctx.common.SelectedChannelStore;
        ctx.commands.add({
            name: "sed",
            description: "Change your last message with s/old/new/flags",
            options: [{ name: "expression", description: "For example s/colour/color/g", required: true }],
            execute(args) {
                const expression = String(args.find(arg => arg.name === "expression")?.value ?? "");
                const channel = selected.get()?.getChannelId();
                const target = channel ? (messages.get() as unknown as Messages | undefined)?.getLastEditableMessage(channel) : undefined;
                if (!channel || !target) { ctx.toasts.show("There is no message of yours to change here.", "failure"); return; }
                const replaced = applySed(expression, target.content, settings.store.regexByDefault);
                if (replaced === undefined) { ctx.toasts.show("That is not a valid sed expression.", "failure"); return; }
                if (replaced === target.content) return;
                if (!replaced.trim() && !(target.attachments?.length)) actions.get()?.deleteMessage(channel, target.id);
                else actions.get()?.editMessage(channel, target.id, { content: replaced });
            }
        });
    }
};

export default plugin;
