/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShipCalc (author Sharp) as found in TestCord. `/ship` rates the love between two names; the same pair always gets the
// same score. Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

/** A score from 0 to 100 that depends only on the two names (in any order, any case). */
export function score(a: string, b: string): number {
    const s = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join("💕");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 101;
}

export function heartFor(percent: number): string {
    if (percent > 80) return "💞";
    if (percent > 50) return "💖";
    if (percent > 25) return "💗";
    return "💔";
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "ship",
            description: "Calculate a love percentage between two people",
            options: [
                { name: "a", description: "Person one", type: "string", required: true },
                { name: "b", description: "Person two", type: "string", required: true }
            ],
            execute(args) {
                const value = (name: string) => String(args.find(arg => arg.name === name)?.value ?? "");
                const a = value("a");
                const b = value("b");
                const percent = score(a, b);
                return { content: `${heartFor(percent)} **${a}** + **${b}** = **${percent}%**` };
            }
        });
    }
};

export default plugin;
