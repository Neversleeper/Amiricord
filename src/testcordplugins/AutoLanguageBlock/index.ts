/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AutoLanguageBlock (by Neversleeper, who posted it in TestCord as soriita) as found in TestCord.
// It looks at each message that arrives and, when it has enough words of the language you picked, blocks the person who wrote it. The words are the
// original's, unchanged (`keywords.ts`). Blocking is a real change to your account: it cannot be undone by the plugin (unblock the person in Discord).
// Differences from the original, NOT verified in a real Discord:
//  - a word is matched as a whole word (the original looked for the letters anywhere, so "den", "dan", "que" or "ten" matched inside any word); languages
//    written without spaces between words (Japanese, Chinese, Korean) still match the letters anywhere, as there is no other way;
//  - it never blocks a friend, a person you already blocked, or yourself (the original blocked friends too), and it asks Discord to block each person only once;
//  - it reads what Discord itself sends to your page (each new message), nothing more, and nothing leaves the computer;
//  - the number of matches is a whole number from 1 to 10 (the original took any number).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";
import { languageKeywords } from "./keywords";

/** Languages written without spaces between words: their words are looked for anywhere in the text. */
const UNSPACED = new Set(["ja", "zh", "ko"]);

/** The relationship types Discord uses. */
export const RELATIONSHIP = { none: 0, friend: 1, blocked: 2 } as const;

/** Whether the text has at least `minMatches` of the words of the language (each word counts once). */
export function detectLanguage(content: string, language: string, minMatches: number): boolean {
    const keywords = languageKeywords[language];
    if (!keywords || keywords.length === 0 || minMatches < 1) return false;
    const text = content.toLowerCase().replaceAll("’", "'").trim();
    const spaced = !UNSPACED.has(language);
    const padded = spaced ? ` ${text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean).join(" ")} ` : text;
    let matches = 0;
    for (const keyword of new Set(keywords)) {
        const wanted = keyword.toLowerCase().replaceAll("’", "'");
        if (spaced ? padded.includes(` ${wanted} `) : padded.includes(wanted)) {
            matches++;
            if (matches >= minMatches) return true;
        }
    }
    return false;
}

export interface Candidate {
    selfId: string | undefined;
    authorId: unknown;
    authorIsBot: boolean;
    content: unknown;
    /** What Discord says about the person: 0 none, 1 friend, 2 blocked, 3 or 4 a request, 5 implicit. */
    relationship: number | undefined;
}

export interface BlockRules { language: string; minMatches: number; blockBots: boolean; }

/** Whether this message makes the plugin block its author. */
export function shouldBlock(message: Candidate, rules: BlockRules): boolean {
    if (typeof message.authorId !== "string" || message.authorId === "" || message.authorId === message.selfId) return false;
    if (typeof message.content !== "string" || message.content.trim().length < 3) return false;
    if (message.authorIsBot && !rules.blockBots) return false;
    if (message.relationship === RELATIONSHIP.friend || message.relationship === RELATIONSHIP.blocked) return false;
    return detectLanguage(message.content, rules.language, rules.minMatches);
}

export const LANGUAGES = [
    { label: "Spanish", value: "es" }, { label: "English", value: "en" }, { label: "Turkish", value: "tr" }, { label: "Portuguese", value: "pt" }, { label: "French", value: "fr" },
    { label: "German", value: "de" }, { label: "Italian", value: "it" }, { label: "Russian", value: "ru" }, { label: "Japanese", value: "ja" }, { label: "Chinese", value: "zh" },
    { label: "Korean", value: "ko" }, { label: "Arabic", value: "ar" }, { label: "Hindi", value: "hi" }, { label: "Polish", value: "pl" }, { label: "Dutch", value: "nl" }
] as const;

const settings = definePluginSettings({
    isEnabled: { type: "boolean", default: true, description: "Enable or disable automatic blocking" },
    bannedLanguage: { type: "select", default: "tr", description: "Language to automatically block", options: LANGUAGES },
    minMatches: { type: "number", default: 2, min: 1, max: 10, integer: true, description: "Minimum keyword matches required to trigger a block (recommended: 2-3)" },
    blockBots: { type: "boolean", default: false, description: "Also block bots that write in the selected language (not recommended)" },
    logToConsole: { type: "boolean", default: false, description: "Write in the browser console what was detected (useful for debugging; it includes the message text)" }
});

interface RelationshipActions { addRelationship?(request: { userId: string; type: number; }): unknown; }

interface MessageEvent { message?: { content?: unknown; author?: { id?: unknown; bot?: unknown; username?: unknown; globalName?: unknown; global_name?: unknown; }; }; }

const asked = new Set<string>();
/** The function that looks at each new message; it exists only while the plugin runs. */
let handler: ((event: MessageEvent) => void) | undefined;

const plugin: PluginCode = {
    settings,

    flux: {
        MESSAGE_CREATE: (event: unknown) => { handler?.(event as MessageEvent); }
    },

    start(ctx) {
        const actions = ctx.finders.byProps<RelationshipActions>("addRelationship", "removeRelationship");
        const relationships = ctx.common.RelationshipStore;
        const users = ctx.common.UserStore;
        ctx.onDispose(() => { asked.clear(); });
        handler = event => {
            if (!settings.store.isEnabled) return;
            const message = event.message;
            const author = message?.author;
            if (!message || !author) return;
            const authorId = typeof author.id === "string" ? author.id : undefined;
            const store = relationships.get() as unknown as { getRelationshipType?(id: string): number; } | undefined;
            const rules: BlockRules = { language: settings.store.bannedLanguage, minMatches: settings.store.minMatches, blockBots: settings.store.blockBots };
            const decision = shouldBlock({
                selfId: users.get()?.getCurrentUser()?.id, authorId, authorIsBot: author.bot === true, content: message.content,
                relationship: authorId ? store?.getRelationshipType?.(authorId) : undefined
            }, rules);
            if (settings.store.logToConsole) console.log(`[AutoLanguageBlock] ${String(author.username)} wrote a message → ${decision ? "blocked" : "left alone"}`);
            if (!decision || !authorId || asked.has(authorId)) return;
            const add = actions.get()?.addRelationship;
            if (typeof add !== "function") { ctx.toasts.show("Could not block: Discord's block function was not found.", "failure"); return; }
            asked.add(authorId);
            const name = typeof author.globalName === "string" ? author.globalName : typeof author.global_name === "string" ? author.global_name : String(author.username ?? authorId);
            try {
                void Promise.resolve(add.call(actions.get(), { userId: authorId, type: RELATIONSHIP.blocked })).catch(() => { asked.delete(authorId); });
                ctx.toasts.show(`Blocked: ${name} (detected language: ${settings.store.bannedLanguage.toUpperCase()})`, "failure");
            } catch {
                asked.delete(authorId);
                ctx.toasts.show("An error occurred while trying to block the person.", "failure");
            }
        };
    },

    stop() {
        handler = undefined;
        asked.clear();
    }
};

export default plugin;
