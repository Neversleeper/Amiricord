/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    Author,
    computeRisk,
    Credit,
    emptyPermissions,
    Manifest,
    NetworkPermission,
    Origin,
    ORIGIN_FOLDERS,
    ORIGINS,
    Permissions,
    RiskResult,
    Stage,
    STAGES,
    Tag,
    TAGS
} from "../../../src/shared/manifest";

export interface ValidationContext {
    /** Name of the plugin folder, which must equal the manifest `id`. */
    folderName: string;
    /** The origin that the folder holding the plugin belongs to (see ORIGIN_FOLDERS); `origin` must equal it. */
    expectedOrigin: Origin;
}

export type ValidationResult =
    | { ok: true; manifest: Manifest; risk: RiskResult; }
    | { ok: false; errors: string[]; };

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LICENSE_RE = /^[A-Za-z0-9.+\-() ]{2,80}$/;
const DISCORD_ID_RE = /^\d{17,20}$/;
const GITHUB_PROFILE_RE = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// bare hostname, or `*.` followed by a domain with at least two labels (so `*.com` is rejected)
const HOST_RE = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// relative path inside the plugin folder, no `..`, no drive letters, no backslashes
const ENTRY_RE = /^(?!.*\.\.)(?![\\/])[A-Za-z0-9_./-]+\.(?:ts|tsx)$/;
const NAME_LIST_RE = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/;

type Obj = Record<string, unknown>;

class Checker {
    errors: string[] = [];

    err(path: string, message: string) {
        this.errors.push(`${path}: ${message}`);
    }

    obj(path: string, v: unknown, allowed: readonly string[]): Obj | null {
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
            this.err(path, "must be an object");
            return null;
        }
        for (const key of Object.keys(v)) {
            if (!allowed.includes(key)) this.err(`${path}.${key}`, "unknown field");
        }
        return v as Obj;
    }

    str(path: string, v: unknown, re?: RegExp, what = "a non-empty string"): string | null {
        if (typeof v !== "string" || v.trim() === "") {
            this.err(path, `must be ${what}`);
            return null;
        }
        if (re && !re.test(v)) {
            this.err(path, `has an invalid format: ${JSON.stringify(v)}`);
            return null;
        }
        return v;
    }

    bool(path: string, v: unknown, fallback: boolean): boolean {
        if (v === undefined) return fallback;
        if (typeof v !== "boolean") {
            this.err(path, "must be true or false");
            return fallback;
        }
        return v;
    }

    list(path: string, v: unknown): unknown[] {
        if (v === undefined) return [];
        if (!Array.isArray(v)) {
            this.err(path, "must be a list");
            return [];
        }
        return v;
    }

    strList(path: string, v: unknown, re?: RegExp): string[] {
        const out: string[] = [];
        this.list(path, v).forEach((item, i) => {
            const s = this.str(`${path}[${i}]`, item, re);
            if (s !== null) out.push(s);
        });
        const dup = out.find((s, i) => out.indexOf(s) !== i);
        if (dup !== undefined) this.err(path, `contains a duplicate: ${JSON.stringify(dup)}`);
        return out;
    }

    oneOf<T extends string>(path: string, v: unknown, options: readonly T[], fallback: T): T {
        if (v === undefined) return fallback;
        if (typeof v !== "string" || !options.includes(v as T)) {
            this.err(path, `must be one of: ${options.join(", ")}`);
            return fallback;
        }
        return v as T;
    }
}

function checkPermissions(c: Checker, raw: unknown): Permissions {
    const result = emptyPermissions();
    const p = c.obj("permissions", raw, [
        "network", "native", "account", "messages", "token", "files", "system", "code", "telemetry"
    ]);
    if (!p) return result;

    c.list("permissions.network", p.network).forEach((item, i) => {
        const path = `permissions.network[${i}]`;
        const n = c.obj(path, item, ["host", "from", "why"]);
        if (!n) return;
        const host = c.str(`${path}.host`, n.host, HOST_RE, "a hostname like www.example.com or *.example.com (no scheme, path or port)");
        const from = c.oneOf<NetworkPermission["from"]>(`${path}.from`, n.from, ["main", "renderer"], "main");
        if (n.from === undefined) c.err(`${path}.from`, "is required (main or renderer)");
        const why = c.str(`${path}.why`, n.why);
        if (host && why) result.network.push({ host, from, why });
    });
    const hosts = result.network.map(n => `${n.from}:${n.host}`);
    const dupHost = hosts.find((h, i) => hosts.indexOf(h) !== i);
    if (dupHost) c.err("permissions.network", `declares ${dupHost} twice`);

    if (p.native !== undefined) {
        const n = c.obj("permissions.native", p.native, ["functions"]);
        if (n) result.native.functions = c.strList("permissions.native.functions", n.functions, NAME_LIST_RE);
    }
    if (p.account !== undefined) {
        const a = c.obj("permissions.account", p.account, ["write"]);
        if (a) result.account.write = c.strList("permissions.account.write", a.write, NAME_LIST_RE);
    }
    if (p.messages !== undefined) {
        const m = c.obj("permissions.messages", p.messages, ["read", "send"]);
        if (m) {
            result.messages.read = c.oneOf("permissions.messages.read", m.read, ["none", "visible", "all-channels"], "none");
            result.messages.send = c.bool("permissions.messages.send", m.send, false);
        }
    }
    result.token = c.bool("permissions.token", p.token, false);
    result.files = c.oneOf("permissions.files", p.files, ["none", "plugin-data", "user-chosen", "paths"], "none");
    if (p.system !== undefined) {
        const s = c.obj("permissions.system", p.system, ["spawn", "clipboard", "listen", "openExternal", "devtools"]);
        if (s) {
            result.system.spawn = c.bool("permissions.system.spawn", s.spawn, false);
            result.system.clipboard = c.bool("permissions.system.clipboard", s.clipboard, false);
            result.system.openExternal = c.bool("permissions.system.openExternal", s.openExternal, false);
            result.system.devtools = c.bool("permissions.system.devtools", s.devtools, false);
            c.list("permissions.system.listen", s.listen).forEach((port, i) => {
                if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
                    c.err(`permissions.system.listen[${i}]`, "must be a port number from 1 to 65535");
                } else {
                    result.system.listen.push(port as number);
                }
            });
        }
    }
    if (p.code !== undefined) {
        const code = c.obj("permissions.code", p.code, ["dynamic"]);
        if (code) result.code.dynamic = c.bool("permissions.code.dynamic", code.dynamic, false);
    }
    if (p.telemetry !== undefined) {
        const t = c.obj("permissions.telemetry", p.telemetry, ["send"]);
        if (t) result.telemetry.send = c.strList("permissions.telemetry.send", t.send);
    }
    return result;
}

const ROOT_FIELDS = [
    "schema", "id", "name", "version", "description", "origin", "license", "authors", "credits", "tags",
    "dependencies", "enabledByDefault", "experimental", "legacy", "replacedBy", "requiresRestart", "startAt", "deferrable", "core",
    "discord", "entry", "permissions", "secrets", "riskySettings"
] as const;

/** Validate a parsed `plugin.json`. Collects every problem instead of stopping at the first. */
export function validateManifest(raw: unknown, ctx: ValidationContext): ValidationResult {
    const c = new Checker();
    const root = c.obj("manifest", raw, ROOT_FIELDS);
    if (!root) return { ok: false, errors: c.errors };

    if (root.schema !== 1) c.err("schema", "must be 1");

    const id = c.str("id", root.id, ID_RE, "an identifier of letters, digits, _ or - starting with a letter") ?? "";
    if (id && id !== ctx.folderName) c.err("id", `must equal the plugin folder name (${JSON.stringify(ctx.folderName)}), got ${JSON.stringify(id)}`);

    const name = c.str("name", root.name) ?? "";
    const version = c.str("version", root.version, VERSION_RE, "a version like 1.2.3") ?? "";
    const description = c.str("description", root.description) ?? "";
    const license = c.str("license", root.license, LICENSE_RE, "an SPDX license identifier like GPL-3.0-or-later") ?? "";

    const origin = c.oneOf<Origin>("origin", root.origin, ORIGINS, "amiricord");
    if (root.origin === undefined) c.err("origin", `is required (${ORIGINS.join(", ")})`);
    else if (origin !== ctx.expectedOrigin) {
        c.err("origin", `must be ${JSON.stringify(ctx.expectedOrigin)} because the plugin is in the ${ORIGIN_FOLDERS[ctx.expectedOrigin]} folder, got ${JSON.stringify(root.origin)}`);
    }

    const authors: Author[] = [];
    const rawAuthors = c.list("authors", root.authors);
    if (rawAuthors.length === 0) c.err("authors", "needs at least one author");
    rawAuthors.forEach((item, i) => {
        const path = `authors[${i}]`;
        const a = c.obj(path, item, ["name", "discordId", "github", "role"]);
        if (!a) return;
        const authorName = c.str(`${path}.name`, a.name);
        const author: Author = { name: authorName ?? "" };
        if (a.discordId !== undefined) {
            const idValue = c.str(`${path}.discordId`, a.discordId, DISCORD_ID_RE, "a Discord user ID (17 to 20 digits)");
            if (idValue) author.discordId = idValue;
        }
        if (a.github !== undefined) {
            const link = c.str(`${path}.github`, a.github, GITHUB_PROFILE_RE, "a GitHub profile link like https://github.com/user");
            if (link) author.github = link;
        }
        if (a.role !== undefined) {
            const role = c.str(`${path}.role`, a.role);
            if (role) author.role = role;
        }
        if (authorName) authors.push(author);
    });

    const credits: Credit[] = [];
    c.list("credits", root.credits).forEach((item, i) => {
        const path = `credits[${i}]`;
        const cr = c.obj(path, item, ["name", "license", "url"]);
        if (!cr) return;
        const creditName = c.str(`${path}.name`, cr.name);
        const credit: Credit = { name: creditName ?? "" };
        if (cr.license !== undefined) {
            const l = c.str(`${path}.license`, cr.license, LICENSE_RE, "an SPDX license identifier");
            if (l) credit.license = l;
        }
        if (cr.url !== undefined) {
            const u = c.str(`${path}.url`, cr.url, /^https:\/\/[^\s]+$/, "an https URL");
            if (u) credit.url = u;
        }
        if (creditName) credits.push(credit);
    });
    if (origin !== "amiricord" && credits.length === 0) {
        c.err("credits", `is required when origin is ${JSON.stringify(origin)}: list the original author(s) and license`);
    }

    const tags: Tag[] = [];
    c.list("tags", root.tags).forEach((item, i) => {
        if (typeof item !== "string" || !TAGS.includes(item as Tag)) c.err(`tags[${i}]`, `must be one of: ${TAGS.join(", ")}`);
        else tags.push(item as Tag);
    });

    const dependencies = c.strList("dependencies", root.dependencies, ID_RE);
    if (id && dependencies.includes(id)) c.err("dependencies", "a plugin cannot depend on itself");

    const enabledByDefault = c.bool("enabledByDefault", root.enabledByDefault, false);
    const experimental = c.bool("experimental", root.experimental, false);
    const legacy = c.bool("legacy", root.legacy, false);
    let replacedBy: string | null = null;
    if (root.replacedBy !== undefined && root.replacedBy !== null) {
        replacedBy = c.str("replacedBy", root.replacedBy, ID_RE, "the id of the replacing plugin");
        if (replacedBy !== null && !legacy) c.err("replacedBy", "only makes sense when legacy is true");
    }
    if (legacy && enabledByDefault) c.err("enabledByDefault", "a legacy plugin cannot be enabled by default");

    let requiresRestart: "auto" | boolean = "auto";
    if (root.requiresRestart !== undefined) {
        if (root.requiresRestart === "auto" || typeof root.requiresRestart === "boolean") requiresRestart = root.requiresRestart;
        else c.err("requiresRestart", "must be \"auto\", true or false");
    }

    const startAt = c.oneOf<Stage>("startAt", root.startAt, STAGES, "webpackReady");
    const deferrable = c.bool("deferrable", root.deferrable, false);

    const core = c.bool("core", root.core, false);
    if (core && origin !== "amiricord") c.err("core", "only plugins with origin \"amiricord\" can be core");
    if (deferrable && startAt === "init") c.err("deferrable", "a plugin that starts at \"init\" cannot be deferred");
    if (deferrable && core) c.err("deferrable", "a core plugin cannot be deferred");

    const discord = { minBuild: null as number | null, maxBuild: null as number | null };
    if (root.discord !== undefined) {
        const d = c.obj("discord", root.discord, ["minBuild", "maxBuild"]);
        if (d) {
            for (const key of ["minBuild", "maxBuild"] as const) {
                const v = d[key];
                if (v === undefined || v === null) continue;
                if (!Number.isInteger(v) || (v as number) < 1) c.err(`discord.${key}`, "must be a positive integer or null");
                else discord[key] = v as number;
            }
            if (discord.minBuild !== null && discord.maxBuild !== null && discord.minBuild > discord.maxBuild) {
                c.err("discord", "minBuild cannot be greater than maxBuild");
            }
        }
    }

    const entry: Manifest["entry"] = { renderer: "" };
    const e = c.obj("entry", root.entry, ["renderer", "main"]);
    if (e) {
        entry.renderer = c.str("entry.renderer", e.renderer, ENTRY_RE, "a relative .ts or .tsx path inside the plugin folder") ?? "";
        if (e.main !== undefined) {
            const main = c.str("entry.main", e.main, ENTRY_RE, "a relative .ts or .tsx path inside the plugin folder");
            if (main) entry.main = main;
        }
    }

    const permissions = checkPermissions(c, root.permissions === undefined ? {} : root.permissions);
    if (root.permissions === undefined) c.err("permissions", "is required (use an empty object {} for a plugin that needs nothing)");

    const hasNative = permissions.native.functions.length > 0;
    if (hasNative && !entry.main) c.err("entry.main", "is required because permissions.native lists functions");
    if (!hasNative && entry.main) c.err("permissions.native.functions", "must list the native functions because entry.main is set");

    const secrets = c.strList("secrets", root.secrets, NAME_LIST_RE);
    const riskySettings = c.strList("riskySettings", root.riskySettings, NAME_LIST_RE);

    if (c.errors.length) return { ok: false, errors: c.errors };

    const manifest: Manifest = {
        schema: 1, id, name, version, description, origin, license, authors, credits, tags, dependencies,
        enabledByDefault, experimental, legacy, replacedBy, requiresRestart, startAt, deferrable, core, discord, entry,
        permissions, secrets, riskySettings
    };
    return { ok: true, manifest, risk: computeRisk(permissions) };
}
