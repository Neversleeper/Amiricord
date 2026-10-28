/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's own sounds: `ctx.sounds.list()` gives their names and `ctx.sounds.play(name, volume)` plays one. Discord keeps its sound files behind a Webpack
// "context" module that maps `"./<name>.mp3"` to the module of each file, and each file module only exports the address of the file. The layer asks the
// engine for that context module (found by the text of its source, never by a module id, which changes with every Discord build), checks that it behaves
// like such a context, and plays a name only if it is one of its keys. A plugin cannot play any other address. When Discord's sounds cannot be reached the
// answers are an empty list and `false`, and the plugin keeps its own tones. No permission is needed: nothing leaves the machine and nothing is read.
// Honest limit: the browser may refuse to start a sound before the user has interacted with the page; `play` says only that it was asked to start.
// What a plugin started is stopped when the plugin stops. Design: docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md (section 3).

import type { ModuleView } from "../webpack/finders";

export interface PluginSounds {
    /** The names Discord has sounds for (like `discodo`, `message1`), sorted. Empty when Discord's sounds cannot be reached. */
    list(): string[];
    /** Start the sound `name` at `volume` (0 to 1, default 1; anything else is clamped). False when the name is not one of `list()` or the sound could not be started. */
    play(name: string, volume?: number): boolean;
    /** Stop every sound this plugin started and that is still playing. */
    stopAll(): void;
}

/** What the layer needs from a Webpack context module: the keys and the module of one key. A real `require.context` result fits. */
export interface SoundContext {
    (key: string): unknown;
    keys(): string[];
}

/** The part of an `Audio` object the layer uses. */
export interface AudioLike {
    volume: number;
    play(): unknown;
    pause(): void;
    addEventListener?(type: string, listener: () => void): void;
}

export interface SoundLayerDeps {
    /** Finds Discord's sound context, or undefined. Called again after a miss, never more often than `retryMs`. */
    locate(): SoundContext | undefined;
    /** Makes an audio object for a file address, or undefined when the page cannot play sounds. */
    createAudio(url: string): AudioLike | undefined;
    now(): number;
    /** How long to wait after a miss before looking again. Default 5 000 ms. */
    retryMs?: number;
}

export const MAX_SOUNDS_PER_PLUGIN = 8;
export const NAME_MAX = 80;
const DEFAULT_RETRY_MS = 5000;

const KEY = /^\.\/([A-Za-z0-9_-]{1,80})\.mp3$/;
const FILE_ADDRESS = /^(?:\/(?!\/)|https:\/\/)[^\s"'<>\\]{1,500}\.mp3$/;

export function volumeOf(value: unknown): number {
    if (typeof value !== "number" || Number.isNaN(value)) return 1;
    return Math.min(1, Math.max(0, value));
}

export function createSoundLayer(deps: SoundLayerDeps) {
    const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
    let context: SoundContext | undefined;
    let lastMiss: number | undefined;

    const reach = (): SoundContext | undefined => {
        if (context) return context;
        const now = deps.now();
        if (lastMiss !== undefined && now - lastMiss < retryMs) return undefined;
        let found: SoundContext | undefined;
        try {
            found = deps.locate();
        } catch {
            found = undefined;
        }
        if (typeof found === "function" && typeof found.keys === "function") context = found;
        else lastMiss = now;
        return context;
    };

    /** The names of the context, or undefined when it does not behave like a context of sounds. */
    const names = (found: SoundContext): string[] | undefined => {
        try {
            const keys = found.keys();
            if (!Array.isArray(keys)) return undefined;
            return keys.flatMap(key => (typeof key === "string" ? [KEY.exec(key)?.[1]] : [])).filter((name): name is string => name !== undefined).sort();
        } catch {
            return undefined;
        }
    };

    return {
        forPlugin(id: string, onDispose: (undo: () => void) => void, reportError: (source: string, error: unknown) => void): PluginSounds {
            const playing = new Set<AudioLike>();
            let registered = false;

            const stopAll = () => {
                for (const audio of [...playing]) {
                    try {
                        audio.pause();
                    } catch {
                        // A sound that cannot be stopped is not worth more.
                    }
                    playing.delete(audio);
                }
            };

            return {
                list() {
                    const found = reach();
                    return found ? names(found) ?? [] : [];
                },
                play(name, volume) {
                    try {
                        if (typeof name !== "string" || name.length === 0 || name.length > NAME_MAX) return false;
                        const found = reach();
                        const known = found ? names(found) : undefined;
                        if (!found || !known?.includes(name)) return false;
                        const module = found(`./${name}.mp3`);
                        if (typeof module !== "string" || !FILE_ADDRESS.test(module)) return false;
                        const audio = deps.createAudio(module);
                        if (!audio) return false;
                        // The oldest sound of this plugin stops when it asks for more than it may have.
                        while (playing.size >= MAX_SOUNDS_PER_PLUGIN) {
                            const oldest = playing.values().next().value as AudioLike;
                            try {
                                oldest.pause();
                            } catch {
                                // Dropped anyway.
                            }
                            playing.delete(oldest);
                        }
                        audio.volume = volumeOf(volume);
                        playing.add(audio);
                        audio.addEventListener?.("ended", () => { playing.delete(audio); });
                        if (!registered) {
                            registered = true;
                            onDispose(stopAll);
                        }
                        const started = audio.play();
                        // The browser may refuse to start a sound; that is not an error of the plugin.
                        if (started && typeof (started as Promise<unknown>).catch === "function") (started as Promise<unknown>).catch(() => { playing.delete(audio); });
                        return true;
                    } catch (error) {
                        reportError(`sounds.play(${id})`, error);
                        return false;
                    }
                },
                stopAll
            };
        }
    };
}

/** The text that only Discord's sound context has in its source: the key of one of its best known sounds. */
export const SOUND_CONTEXT_MARKER = "\"./discodo.mp3\"";

/** Looks through the source of Discord's modules for the sound context and runs only the module(s) that carry the marker. */
export function locateSoundContext(view: Pick<ModuleView, "ids" | "sourceOf" | "exportsOf">): SoundContext | undefined {
    for (const id of view.ids()) {
        let source: string | undefined;
        try {
            source = view.sourceOf(id);
        } catch {
            continue;
        }
        if (source === undefined || !source.includes(SOUND_CONTEXT_MARKER)) continue;
        let exports: unknown;
        try {
            exports = view.exportsOf(id, true);
        } catch {
            continue;
        }
        if (typeof exports === "function" && typeof (exports as { keys?: unknown; }).keys === "function") return exports as SoundContext;
    }
    return undefined;
}
