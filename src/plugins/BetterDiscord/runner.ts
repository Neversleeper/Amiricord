/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- a BetterDiscord plugin can export anything */

// Runs the text of one BetterDiscord plugin file and gives back the plugin it exports. This is the only place in the layer that runs a string as code (`new Function`),
// which is why the plugin that owns it declares `permissions.code.dynamic`. Only the files bundled into the build are ever run here; nothing is read from the disk or
// the network at run time.

import type { BdMeta } from "./meta";

/** The Node modules a BetterDiscord plugin may ask for. `events` works; the others are refused with a clear message instead of answering with something that does nothing. */
class EventEmitter {
    private readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
    on(name: string, handler: (...args: any[]) => void): this { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); return this; }
    addListener(name: string, handler: (...args: any[]) => void): this { return this.on(name, handler); }
    off(name: string, handler: (...args: any[]) => void): this { this.handlers.set(name, (this.handlers.get(name) ?? []).filter(h => h !== handler)); return this; }
    removeListener(name: string, handler: (...args: any[]) => void): this { return this.off(name, handler); }
    once(name: string, handler: (...args: any[]) => void): this {
        const wrapper = (...args: any[]) => { this.off(name, wrapper); handler(...args); };
        return this.on(name, wrapper);
    }
    emit(name: string, ...args: any[]): boolean {
        const list = this.handlers.get(name) ?? [];
        for (const handler of [...list]) handler(...args);
        return list.length > 0;
    }
}

export function requireFor(pluginName: string): (id: string) => unknown {
    return id => {
        if (id === "events") return { EventEmitter, default: EventEmitter };
        throw new Error(`${pluginName} asked for the Node module "${id}", which Discord's page does not have; this plugin needs BetterDiscord's own app and cannot run here`);
    };
}

export interface RunInput {
    source: string;
    fileName: string;
    meta: BdMeta;
    /** The `BdApi` made for this plugin. */
    bdApi: unknown;
    /** What the plugin sees as `window` / `global`. */
    page: unknown;
}

/** Runs the file and returns what it exported, as a plugin object. Throws with a message that names the plugin when the file cannot be run or exports nothing usable. */
export function runPluginSource(input: RunInput): any {
    const { source, fileName, meta, bdApi, page } = input;
    const module = { exports: {} as any };
    const text = `${source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source}\n//# sourceURL=betterdiscord://plugins/${fileName}`;
    let run: (...args: unknown[]) => void;
    try {
        // eslint-disable-next-line no-new-func -- running the text of a bundled BetterDiscord plugin is what this file is for
        run = new Function("module", "exports", "require", "BdApi", "global", "process", "__filename", "__dirname", text) as (...args: unknown[]) => void;
    } catch (error) {
        throw new Error(`${meta.name}: the file has a syntax error (${error instanceof Error ? error.message : String(error)})`);
    }
    run.call(page, module, module.exports, requireFor(meta.name), bdApi, page, { env: {}, platform: "browser" }, fileName, "");

    let exported = module.exports;
    if (exported && typeof exported === "object" && "default" in exported && Object.keys(exported).length === 1) exported = exported.default;
    if (typeof exported === "function") {
        let made: any;
        try {
            made = new exported(meta);
        } catch (error) {
            // An arrow function or a plain function that returns the plugin cannot be built with `new`.
            if (!(error instanceof TypeError) || !/not a constructor/.test(error.message)) throw error;
            made = exported(meta);
        }
        exported = made;
    }
    if (!exported || (typeof exported !== "object" && typeof exported !== "function")) throw new Error(`${meta.name}: the file does not export a plugin (module.exports is empty)`);
    const hasStart = typeof exported.start === "function" || typeof exported.onStart === "function" || typeof exported.load === "function";
    if (!hasStart) throw new Error(`${meta.name}: the exported plugin has no start() function`);
    return exported;
}
