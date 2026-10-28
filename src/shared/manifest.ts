/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin manifest types and the pure helpers shared by the build and the running engine.
// Design: docs/design-01-manifest-permissions.md

export const ORIGINS = ["amiricord", "vencord", "equicord", "testcord", "betterdiscord"] as const;
export type Origin = typeof ORIGINS[number];

/**
 * Folder under `src/` that holds the plugins of each origin, laid out like TestCord:
 * our own plugins in `plugins/`, adapted ones in a sibling folder named after their origin.
 */
export const ORIGIN_FOLDERS: Record<Origin, string> = {
    amiricord: "plugins",
    vencord: "vencordplugins",
    equicord: "equicordplugins",
    testcord: "testcordplugins",
    betterdiscord: "betterdiscordplugins"
};

/**
 * Names a plugin may list in `dependencies` besides other plugins: the APIs the engine itself provides.
 * Empty until the engine has any; each API is added here when it is written.
 */
export const ENGINE_APIS: readonly string[] = [];

/** When a plugin starts: before Discord's modules load, once its main modules are ready, or when the page has loaded. */
export const STAGES = ["init", "webpackReady", "domReady"] as const;
export type Stage = typeof STAGES[number];

/** Closed list of plugin tags. Extend it here when a new tag is really needed. */
export const TAGS = ["chat", "media", "privacy", "ui", "voice", "utility", "developer", "fix", "experimental"] as const;
export type Tag = typeof TAGS[number];

/** Text shown on the card of a high risk plugin. Kept in one place so it can be renamed. */
export const HIGH_RISK_LABEL = "High risk";

export type RiskLevel = "low" | "medium" | "high";

export interface NetworkPermission {
    /** Bare hostname such as `www.pinterest.com`, or `*.domain.tld` for subdomains. */
    host: string;
    /** Which side makes the request. */
    from: "main" | "renderer";
    why: string;
}

export interface Permissions {
    network: NetworkPermission[];
    native: { functions: string[]; };
    account: { write: string[]; };
    messages: { read: "none" | "visible" | "all-channels"; send: boolean; };
    token: boolean;
    files: "none" | "plugin-data" | "user-chosen" | "paths";
    system: { spawn: boolean; clipboard: boolean; listen: number[]; openExternal: boolean; /** Open Discord's developer tools (a native function can ask `host.openDevTools()`). */ devtools: boolean; };
    code: { dynamic: boolean; };
    telemetry: { send: string[]; };
}

export interface Author {
    name: string;
    discordId?: string;
    /** Link to the author's GitHub profile: `https://github.com/<user>`. */
    github?: string;
    role?: string;
}

export interface Credit {
    name: string;
    license?: string;
    url?: string;
}

export interface Manifest {
    schema: 1;
    id: string;
    name: string;
    version: string;
    description: string;
    origin: Origin;
    /** SPDX license identifier. */
    license: string;
    authors: Author[];
    credits: Credit[];
    tags: Tag[];
    dependencies: string[];
    enabledByDefault: boolean;
    experimental: boolean;
    legacy: boolean;
    replacedBy: string | null;
    requiresRestart: "auto" | boolean;
    /** Stage at which the plugin starts. */
    startAt: Stage;
    /** May start later, when the page is idle. Only for plugins that nothing needs early. */
    deferrable: boolean;
    core: boolean;
    discord: { minBuild: number | null; maxBuild: number | null; };
    entry: { renderer: string; main?: string; };
    permissions: Permissions;
    secrets: string[];
    riskySettings: string[];
}

/**
 * Whether turning a plugin on or off needs a restart of Discord. `true` and `false` are the plugin's own word;
 * `"auto"` means yes when it has patches (they are applied while Discord loads its modules) or main-process code (the main process makes its
 * table of plugins with native code once, at start), and no otherwise.
 */
export function needsRestartToToggle(requiresRestart: Manifest["requiresRestart"], hasPatches: boolean, hasNative = false): boolean {
    return requiresRestart === "auto" ? hasPatches || hasNative : requiresRestart;
}

export function emptyPermissions(): Permissions {
    return {
        network: [],
        native: { functions: [] },
        account: { write: [] },
        messages: { read: "none", send: false },
        token: false,
        files: "none",
        system: { spawn: false, clipboard: false, listen: [], openExternal: false, devtools: false },
        code: { dynamic: false },
        telemetry: { send: [] }
    };
}

export interface RiskResult {
    level: RiskLevel;
    /** Plain language reasons, one per permission that raised the level. Shown on the card. */
    reasons: string[];
}

/**
 * The risk level is computed from the declared permissions. A plugin never chooses it.
 * High: anything that acts as the user, touches the token or arbitrary files, runs programs,
 * listens on a port, runs dynamic code or sends telemetry.
 * Medium: declared network hosts, native code, clipboard, opening links, opening Discord's developer tools.
 * Low: nothing else.
 */
export function computeRisk(p: Permissions): RiskResult {
    const high: string[] = [];
    const medium: string[] = [];

    if (p.account.write.length) high.push(`Writes to your account: ${p.account.write.join(", ")}`);
    if (p.messages.send) high.push("Sends messages");
    if (p.messages.read === "all-channels") high.push("Reads messages from all channels");
    if (p.token) high.push("Uses your token");
    if (p.files === "user-chosen") high.push("Reads or writes files you choose");
    if (p.files === "paths") high.push("Reads or writes files at arbitrary paths");
    if (p.system.spawn) high.push("Starts programs");
    if (p.system.listen.length) high.push(`Listens on local port(s): ${p.system.listen.join(", ")}`);
    if (p.code.dynamic) high.push("Runs dynamic code");
    if (p.telemetry.send.length) high.push(`Sends telemetry to: ${p.telemetry.send.join(", ")}`);

    if (p.network.length) medium.push(`Connects to: ${[...new Set(p.network.map(n => n.host))].join(", ")}`);
    if (p.native.functions.length) medium.push("Has native code");
    if (p.system.clipboard) medium.push("Uses the clipboard");
    if (p.system.openExternal) medium.push("Opens links outside Discord");
    if (p.system.devtools) medium.push("Opens Discord's developer tools");

    if (high.length) return { level: "high", reasons: [...high, ...medium] };
    if (medium.length) return { level: "medium", reasons: medium };
    return { level: "low", reasons: [] };
}

/** Discord's own hosts. Requests to them go through Discord's client, so plugins need not declare them. */
export const FIRST_PARTY_HOSTS = ["discord.com", "discordapp.com", "discordapp.net", "discord.gg", "discord.media", "discord.dev"] as const;

export function isFirstPartyHost(host: string): boolean {
    const h = host.toLowerCase();
    return FIRST_PARTY_HOSTS.some(fp => h === fp || h.endsWith("." + fp));
}

/**
 * Whether a declared host pattern covers a host. `example.com` covers only itself;
 * `*.example.com` covers any subdomain of it, but not `example.com` itself.
 */
export function hostMatches(pattern: string, host: string): boolean {
    const p = pattern.toLowerCase();
    const h = host.toLowerCase();
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    return p === h;
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        // Every array inside Permissions is a set, so order must not matter.
        return value.map(sortKeys).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeys((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

/**
 * Stable text form of the permissions. Two manifests with the same permissions give the same text
 * whatever the order of keys or list items. Hash it to detect a change after a plugin update.
 */
export function canonicalPermissions(p: Permissions): string {
    // `devtools` came after the first hashes were made: it is written only when it is true, so a plugin that does not use it keeps the text (and the hash) it always had.
    const { devtools, ...system } = p.system;
    return JSON.stringify(sortKeys(devtools ? p : { ...p, system }));
}
