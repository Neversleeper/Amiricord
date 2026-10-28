/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The secrets of plugins (a session cookie, a key): kept in the main process, encrypted with the operating system's own secure storage, and never given back
// to the page. The page can write a secret, clear it and ask whether it exists; only the plugin's own native code can read it (`host.secret`). No Electron in this
// file: the encryption and the file come in as small objects, so everything here is tested with fakes. Design: docs/analysis-31-pinterest-tool-settings-and-storage.md.

import { LIMITS } from "../shared/settings";

/** The part of Electron's `safeStorage` this needs. */
export interface SecretBackend {
    available(): boolean;
    /** Text in, an opaque text out (base64). May throw. */
    encrypt(text: string): string;
    /** Opaque text in, the secret out, or null when it cannot be read (another user, a damaged value). */
    decrypt(cipher: string): string | null;
}

export interface SecretFile {
    /** The saved text, or null when there is none. */
    read(): string | null;
    /** Save the text. Returns the error message, or null when it worked. */
    write(text: string): string | null;
}

export const SECRET_LIMITS = { maxValueChars: 8192, maxPerPlugin: 50, maxFileChars: 256 * 1024 } as const;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (name: unknown): name is string => typeof name === "string" && LIMITS.settingKey.test(name) && !FORBIDDEN.has(name);
const isPluginId = (id: unknown): id is string => typeof id === "string" && LIMITS.pluginId.test(id) && !FORBIDDEN.has(id);

type Saved = Record<string, Record<string, string>>;

export class SecretStore {
    private saved: Saved | undefined;
    /** What was wrong in the file when it was read, for the engine's list of problems. */
    readonly problems: string[] = [];

    constructor(private readonly deps: { backend: SecretBackend; file: SecretFile; }) { }

    private load(): Saved {
        if (this.saved) return this.saved;
        const saved: Saved = Object.create(null);
        this.saved = saved;
        let text: string | null = null;
        try {
            text = this.deps.file.read();
        } catch {
            this.problems.push("the secrets file could not be read, so no secret is available");
            return saved;
        }
        if (text === null) return saved;
        try {
            const data: unknown = JSON.parse(text);
            if (!isRecord(data) || data.schema !== 1 || !isRecord(data.plugins)) throw new Error("shape");
            for (const [id, entry] of Object.entries(data.plugins)) {
                if (!isPluginId(id) || !isRecord(entry)) continue;
                const names: Record<string, string> = Object.create(null);
                for (const [name, cipher] of Object.entries(entry)) {
                    if (isName(name) && typeof cipher === "string") names[name] = cipher;
                }
                saved[id] = names;
            }
        } catch {
            this.problems.push("the secrets file is damaged, so no secret is available");
        }
        return saved;
    }

    private persist(saved: Saved): string | null {
        const plugins: Record<string, Record<string, string>> = {};
        for (const id of Object.keys(saved).sort()) {
            const names = Object.keys(saved[id]).sort();
            if (!names.length) continue;
            plugins[id] = {};
            for (const name of names) plugins[id][name] = saved[id][name];
        }
        const text = JSON.stringify({ schema: 1, plugins }, null, 1) + "\n";
        if (text.length > SECRET_LIMITS.maxFileChars) return "the secrets would be too large";
        return this.deps.file.write(text);
    }

    has(plugin: string, name: string): boolean {
        return Boolean(this.load()[plugin]?.[name]);
    }

    /** The secret, or null when there is none or it cannot be decrypted. Only the main process asks this; the page never does. */
    get(plugin: string, name: string): string | null {
        const cipher = this.load()[plugin]?.[name];
        if (!cipher) return null;
        try {
            return this.deps.backend.decrypt(cipher);
        } catch {
            return null;
        }
    }

    /** Save a secret, encrypted. Returns why it was refused, or null when it was saved. Never stores plain text. */
    set(plugin: string, name: string, value: string): string | null {
        if (!isPluginId(plugin) || !isName(name)) return "that is not a valid secret name";
        if (typeof value !== "string" || value.length === 0 || value.length > SECRET_LIMITS.maxValueChars) return `a secret must be text of 1 to ${SECRET_LIMITS.maxValueChars} characters`;
        if (!this.deps.backend.available()) return "this computer's secure storage is not available, so the secret was not saved";
        const saved = this.load();
        const names = saved[plugin] ?? Object.create(null) as Record<string, string>;
        if (!(name in names) && Object.keys(names).length >= SECRET_LIMITS.maxPerPlugin) return "this plugin has too many secrets";
        let cipher: string;
        try {
            cipher = this.deps.backend.encrypt(value);
        } catch {
            return "the secret could not be encrypted, so it was not saved";
        }
        const before = saved[plugin];
        saved[plugin] = { ...names, [name]: cipher };
        const error = this.persist(saved);
        if (error) {
            if (before) saved[plugin] = before;
            else delete saved[plugin];
        }
        return error;
    }

    /** Forget a secret. Returns the error, or null (also when there was none). */
    clear(plugin: string, name: string): string | null {
        const saved = this.load();
        const names = saved[plugin];
        if (!names || !(name in names)) return null;
        const { [name]: _gone, ...rest } = names;
        saved[plugin] = rest;
        const error = this.persist(saved);
        if (error) saved[plugin] = names;
        return error;
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// What the page may ask

export type SecretAnswer = { ok: true; value?: boolean; } | { ok: false; error: string; };

export interface SecretCall { action: "set" | "clear" | "has"; plugin: string; name: string; value?: string; }

/** Check a call from the page and rebuild it with only the known fields. Anything else gives null. */
export function parseSecretCall(message: unknown): SecretCall | null {
    if (!isRecord(message) || !isPluginId(message.plugin) || !isName(message.name)) return null;
    if (message.action === "has" || message.action === "clear") return { action: message.action, plugin: message.plugin, name: message.name };
    if (message.action === "set" && typeof message.value === "string") return { action: "set", plugin: message.plugin, name: message.name, value: message.value };
    return null;
}

/** The secret names each plugin declared in its manifest, read from the registry the build wrote. A registry that cannot be read declares nothing. */
export function declaredSecrets(registryText: string): Record<string, string[]> {
    const out: Record<string, string[]> = Object.create(null);
    try {
        const data: unknown = JSON.parse(registryText);
        if (!isRecord(data) || !Array.isArray(data.plugins)) return out;
        for (const plugin of data.plugins) {
            if (!isRecord(plugin) || !isPluginId(plugin.id) || !Array.isArray(plugin.secrets)) continue;
            out[plugin.id] = plugin.secrets.filter(isName);
        }
    } catch {
        // Nothing is declared.
    }
    return out;
}

/** The handler behind the page's secret channel: Discord's own pages only, known plugins only, declared names only. Never gives a secret back. */
export function answerSecretCall(
    store: SecretStore,
    declared: () => Readonly<Record<string, readonly string[]>>,
    trusted: (url: unknown) => boolean,
    senderUrl: unknown,
    message: unknown
): SecretAnswer {
    if (!trusted(senderUrl)) return { ok: false, error: "The caller is not Discord's page." };
    const call = parseSecretCall(message);
    if (!call) return { ok: false, error: "The secret call is malformed." };
    const names = Object.prototype.hasOwnProperty.call(declared(), call.plugin) ? declared()[call.plugin] : undefined;
    if (!names?.includes(call.name)) return { ok: false, error: `${call.plugin}: ${call.name} is not a secret this plugin declared.` };
    if (call.action === "has") return { ok: true, value: store.has(call.plugin, call.name) };
    const error = call.action === "set" ? store.set(call.plugin, call.name, call.value as string) : store.clear(call.plugin, call.name);
    return error ? { ok: false, error: `${call.plugin}: ${error}` } : { ok: true };
}
