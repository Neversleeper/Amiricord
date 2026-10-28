/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Plugins page may know about each plugin: a card per plugin with its description, who made it, what it may
// do (the permissions turned into plain facts) and where it stands right now. Plain data, nothing live: no functions,
// no code, and never the names of secret settings or any value. Pure: the engine feeds it the registry, the decision
// of which plugins run, the user's choices and the state of the lifecycle.
// Design: docs/design-03-settings.md piece E.

import type { EnabledSet, EnableReason, SkippedPlugin } from "../shared/enabledSet";
import { Author, computeRisk, Credit, emptyPermissions, HIGH_RISK_LABEL, needsRestartToToggle, NetworkPermission, Origin, Permissions, RiskLevel, Tag } from "../shared/manifest";
import type { PluginState } from "./lifecycle";

/** The part of a registry entry the cards need. Real registry entries have all of it. */
export interface PluginDescription {
    id: string;
    name: string;
    version: string;
    description: string;
    origin: Origin;
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
    /** Whether the plugin has patches (the build finds out). Decides what `requiresRestart: "auto"` means. */
    hasPatches: boolean;
    /** Whether the plugin declares settings (the build finds out). The card shows a gear for it; the settings themselves are not here. */
    hasSettings: boolean;
    /** Whether the plugin has main-process code (`entry.main`). The main process loads it only when Discord starts, so switching such a plugin needs a restart. */
    hasNative: boolean;
    core: boolean;
    discord: { minBuild: number | null; maxBuild: number | null; };
    permissions: Permissions;
    riskySettings: string[];
}

/**
 * What `buildPluginCards` accepts: a full description, or just an id. The real registry always has everything (the build
 * checks it); the gaps are filled with neutral values only so the engine can be tested with small stand-ins.
 */
export type PluginSource = Pick<PluginDescription, "id"> & Partial<PluginDescription>;

function describePlugin(p: PluginSource): PluginDescription {
    return {
        name: p.id, version: "0.0.0", description: "", origin: "amiricord", license: "GPL-3.0-or-later", authors: [], credits: [], tags: [], dependencies: [],
        enabledByDefault: true, experimental: false, legacy: false, replacedBy: null, requiresRestart: "auto", hasPatches: false, hasSettings: false, hasNative: false, core: false,
        discord: { minBuild: null, maxBuild: null }, permissions: emptyPermissions(), riskySettings: [],
        ...p
    };
}

export type Compatibility = "ok" | "discord-too-old" | "discord-too-new" | "unknown";

export interface PluginCard {
    id: string;
    name: string;
    version: string;
    description: string;
    origin: Origin;
    license: string;
    authors: Author[];
    /** Original authors of adapted code. Empty for plugins written here. */
    credits: Credit[];
    tags: Tag[];
    dependencies: string[];
    core: boolean;
    experimental: boolean;
    legacy: boolean;
    replacedBy: string | null;
    requiresRestart: "auto" | boolean;
    /** Whether turning it on or off needs a restart: it has patches, or says so itself. Otherwise it can be changed on the spot. */
    restartToToggle: boolean;
    /** Whether the plugin has settings the owner can change. */
    hasSettings: boolean;
    /** Names of settings that are risky to change (never their values). */
    riskySettings: string[];
    risk: { level: RiskLevel; /** Set for the highest level, so the page shows the same words everywhere. */ label: string | null; reasons: string[]; };
    /** Hosts the plugin says it connects to, and why. */
    hosts: NetworkPermission[];
    /** Hosts the plugin sends usage data to. Empty for most. */
    telemetryHosts: string[];
    compatibility: Compatibility;
    state: {
        /** The user's own choice: true, false, or undefined when following the default. */
        chosen: boolean | undefined;
        /** What the plugin will do after the next restart, from the choice and the default. */
        wanted: boolean;
        /** Whether it was started this session. */
        running: boolean;
        /** The lifecycle state, or undefined for a plugin that was not enabled this session. */
        lifecycle: PluginState | undefined;
        error: string | null;
        /** Why it runs this session (core, chosen, default, dependency), when it does. */
        reason: EnableReason | undefined;
        /** Running plugins that need this one. */
        neededBy: string[];
        /** Why it could not run although it was wanted. */
        skipped: SkippedPlugin | undefined;
        /** True when a restart is what would change whether it runs. A plugin that can be switched on the spot never asks for one. */
        restartNeeded: boolean;
    };
}

export interface CardInput {
    plugins: readonly PluginSource[];
    enabledSet: Pick<EnabledSet, "enabled" | "why" | "skipped">;
    /** The user's choice for a plugin, as it is now (it may have changed since the start). */
    choiceOf(id: string): boolean | undefined;
    /** Discord's build number, or null when it is not known. */
    build: number | null;
    stateOf(id: string): PluginState | undefined;
    errorOf(id: string): string | null;
}

export function compatibilityOf(discord: PluginDescription["discord"], build: number | null): Compatibility {
    if (build === null) return "unknown";
    if (typeof discord.minBuild === "number" && build < discord.minBuild) return "discord-too-old";
    if (typeof discord.maxBuild === "number" && build > discord.maxBuild) return "discord-too-new";
    return "ok";
}

const sorted = <T>(list: readonly T[], key: (item: T) => string) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function buildPluginCards(input: CardInput): PluginCard[] {
    const ranAtStart = new Set(input.enabledSet.enabled);
    return sorted(input.plugins.map(describePlugin), p => p.id).map((p): PluginCard => {
        const risk = computeRisk(p.permissions);
        const chosen = input.choiceOf(p.id);
        const wanted = p.core || (chosen ?? p.enabledByDefault);
        const why = input.enabledSet.why[p.id];
        const skipped = input.enabledSet.skipped[p.id];
        const running = input.stateOf(p.id) === "started";
        return {
            id: p.id,
            name: p.name,
            version: p.version,
            description: p.description,
            origin: p.origin,
            license: p.license,
            authors: p.authors.map(a => ({ ...a })),
            credits: p.credits.map(c => ({ ...c })),
            tags: [...p.tags],
            dependencies: [...p.dependencies],
            core: p.core,
            experimental: p.experimental,
            legacy: p.legacy,
            replacedBy: p.replacedBy,
            requiresRestart: p.requiresRestart,
            restartToToggle: needsRestartToToggle(p.requiresRestart, p.hasPatches, p.hasNative),
            hasSettings: p.hasSettings,
            riskySettings: [...p.riskySettings],
            risk: { level: risk.level, label: risk.level === "high" ? HIGH_RISK_LABEL : null, reasons: [...risk.reasons] },
            hosts: p.permissions.network.map(n => ({ ...n })),
            telemetryHosts: [...p.permissions.telemetry.send],
            compatibility: compatibilityOf(p.discord, input.build),
            state: {
                chosen,
                wanted,
                running,
                lifecycle: input.stateOf(p.id),
                error: input.errorOf(p.id),
                reason: why?.reason,
                neededBy: why ? [...why.neededBy] : [],
                skipped: skipped ? { ...skipped } : undefined,
                // A plugin that runs only because another needs it, or that cannot run at all, does not change with the choice.
                restartNeeded: needsRestartToToggle(p.requiresRestart, p.hasPatches, p.hasNative) && !skipped && why?.reason !== "dependency" && wanted !== ranAtStart.has(p.id)
            }
        };
    });
}
