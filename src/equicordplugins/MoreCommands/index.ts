/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MoreCommands (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. Only the commands that need nothing but your own computer are ported (the original has about thirty, many of which ask outside websites for pictures or jokes). The engine allows ten commands per plugin, so these are the ten that are most useful in chat. Each one sends its result as a message, as the original does.

import type { PluginCode } from "../../renderer/engine";

const MORSE: Record<string, string> = {
    a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.",
    s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..", "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....",
    "7": "--...", "8": "---..", "9": "----.", ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "/": "-..-.", "-": "-....-", "@": ".--.-."
};

/** Morse code for a text; letters are separated by a space, words by " / ". A character with no code is left out. */
export function toMorse(text: string): string {
    return text.toLowerCase().split(/\s+/).filter(Boolean).map(word => [...word].map(char => MORSE[char]).filter(Boolean).join(" ")).filter(Boolean).join(" / ");
}

/** Alternating capitals: "mock" becomes "mOcK". */
export function mockText(text: string): string {
    let upper = false;
    return [...text].map(char => /\p{L}/u.test(char) ? ((upper = !upper) ? char.toLowerCase() : char.toUpperCase()) : char).join("");
}

/** uwu-speak: r and l become w, and a face is added at the end. */
export function uwuify(text: string): string {
    return `${text.replace(/[rl]/g, "w").replace(/[RL]/g, "W").replace(/n([aeiou])/g, "ny$1").replace(/N([aeiou])/gi, "Ny$1")} uwu`;
}

export type Transformation = "upper" | "lower" | "reverse" | "mock" | "uwu" | "morse" | "same";

/** A text changed in one of the ways above; an unknown way leaves it as it is. */
export function transformText(text: string, kind: string): string {
    switch (kind.trim().toLowerCase()) {
        case "upper": case "uppercase": return text.toUpperCase();
        case "lower": case "lowercase": return text.toLowerCase();
        case "reverse": return [...text].reverse().join("");
        case "mock": return mockText(text);
        case "uwu": return uwuify(text);
        case "morse": return toMorse(text);
        default: return text;
    }
}

/** Whole numbers from `pick` (a number in [0, 1)). */
export function randomInt(min: number, max: number, pick: () => number = Math.random): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    return low + Math.floor(pick() * (high - low + 1));
}

/** The dice thrown: `count` throws of a die with `sides`. */
export function rollDice(sides: number, count: number, pick: () => number = Math.random): number[] {
    return Array.from({ length: Math.max(1, Math.min(20, count)) }, () => randomInt(1, Math.max(2, Math.min(1000, sides)), pick));
}

/** The words and characters of a text. */
export function countWords(text: string): { words: number; characters: number; } {
    return { words: text.trim() === "" ? 0 : text.trim().split(/\s+/).length, characters: [...text].length };
}

const plugin: PluginCode = {
    start(ctx) {
        const value = (args: ReadonlyArray<{ name: string; value: unknown; }>, name: string) => args.find(arg => arg.name === name)?.value;
        const text = (args: ReadonlyArray<{ name: string; value: unknown; }>, name: string) => String(value(args, name) ?? "");
        const add = (name: string, description: string, options: Parameters<typeof ctx.commands.add>[0]["options"], run: (args: ReadonlyArray<{ name: string; value: unknown; }>) => string | undefined) => {
            ctx.commands.add({ name, description, options, execute: args => { const content = run(args); return content === undefined ? undefined : { content }; } });
        };
        add("choose", "Pick one of several choices", [{ name: "choices", description: "The choices, separated by commas", required: true }], args => {
            const choices = text(args, "choices").split(",").map(choice => choice.trim()).filter(Boolean);
            if (choices.length === 0) { ctx.toasts.show("Write some choices separated by commas.", "failure"); return undefined; }
            return `I choose: ${choices[randomInt(0, choices.length - 1)]}`;
        });
        add("rolldice", "Roll one or more dice", [{ name: "sides", description: "Sides of the die (6 when empty)", type: "integer" }, { name: "count", description: "How many dice (1 when empty)", type: "integer" }], args => {
            const rolls = rollDice(Number(value(args, "sides") ?? 6), Number(value(args, "count") ?? 1));
            return `🎲 ${rolls.join(", ")}${rolls.length > 1 ? ` (total ${rolls.reduce((sum, roll) => sum + roll, 0)})` : ""}`;
        });
        add("flipcoin", "Flip a coin", [], () => `🪙 ${randomInt(0, 1) === 0 ? "Heads" : "Tails"}`);
        add("randomnumber", "A random whole number between two numbers", [{ name: "min", description: "The smallest (1 when empty)", type: "integer" }, { name: "max", description: "The largest (100 when empty)", type: "integer" }], args =>
            `🔢 ${randomInt(Number(value(args, "min") ?? 1), Number(value(args, "max") ?? 100))}`);
        add("transform", "Change a text: upper, lower, reverse, mock, uwu or morse", [{ name: "text", description: "The text", required: true }, { name: "how", description: "upper, lower, reverse, mock, uwu or morse", required: true }], args =>
            transformText(text(args, "text"), text(args, "how")));
        add("wordcount", "Count the words and characters of a text", [{ name: "text", description: "The text", required: true }], args => {
            const counts = countWords(text(args, "text"));
            return `${counts.words} words, ${counts.characters} characters`;
        });
        add("lenny", "Add ( ͡° ͜ʖ ͡°) to a message", [{ name: "text", description: "A message to put it after" }], args => `${text(args, "text")} ( ͡° ͜ʖ ͡°)`.trim());
        add("shrug", "Add ¯\\_(ツ)_/¯ to a message", [{ name: "text", description: "A message to put it after" }], args => `${text(args, "text")} ¯\\_(ツ)_/¯`.trim());
        add("tableflip", "Flip a table", [{ name: "text", description: "A message to put it after" }], args => `${text(args, "text")} (╯°□°）╯︵ ┻━┻`.trim());
        add("slap", "Slap someone with a large trout", [{ name: "victim", description: "Who to slap", type: "user", required: true }], args => `*slaps <@${text(args, "victim")}> around a bit with a large trout* 🐟`);
    }
};

export default plugin;
