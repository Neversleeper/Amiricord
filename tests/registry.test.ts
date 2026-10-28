/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { checkPlugins } from "../scripts/build/manifest/checkPlugins";
import { buildRegistry, computeStartOrder, serializeRegistry } from "../scripts/build/manifest/registry";
import { nativeTableFromRegistry } from "../src/main/nativeTable";
import { Origin, ORIGIN_FOLDERS } from "../src/shared/manifest";

let src: string;

beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), "amiricord-registry-"));
});

afterEach(() => {
    rmSync(src, { recursive: true, force: true });
});

function add(origin: Origin, id: string, extra: Record<string, unknown> = {}, files: Record<string, string> = { "index.tsx": "export {};\n" }) {
    const dir = join(src, ORIGIN_FOLDERS[origin], id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({
        schema: 1, id, name: id, version: "1.0.0", description: `${id} plugin`, origin,
        license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }],
        credits: origin === "amiricord" ? [] : [{ name: "Original Author" }],
        entry: { renderer: "index.tsx" }, permissions: {}, ...extra
    }));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

describe("computeStartOrder", () => {
    it("puts dependencies before the plugins that need them", () => {
        const order = computeStartOrder([
            { id: "C", dependencies: ["B"] },
            { id: "B", dependencies: ["A"] },
            { id: "A", dependencies: [] }
        ]);
        assert.deepEqual(order, ["A", "B", "C"]);
    });

    it("is stable: independent plugins come out sorted by id", () => {
        const order = computeStartOrder([
            { id: "Z", dependencies: [] },
            { id: "M", dependencies: [] },
            { id: "A", dependencies: ["Z"] }
        ]);
        assert.deepEqual(order, ["M", "Z", "A"]);
    });

    it("ignores dependencies that are engine APIs, not plugins", () => {
        assert.deepEqual(computeStartOrder([{ id: "A", dependencies: ["CommandsAPI"] }]), ["A"]);
    });

    it("throws on a cycle", () => {
        assert.throws(() => computeStartOrder([
            { id: "A", dependencies: ["B"] },
            { id: "B", dependencies: ["A"] }
        ]), /cycle/);
    });
});

describe("buildRegistry", () => {
    it("lists every plugin sorted by id with path, hash and computed risk", () => {
        add("amiricord", "Zeta");
        add("equicord", "Alpha", {
            permissions: { account: { write: ["quest.progress"] } }
        });
        const registry = buildRegistry(checkPlugins(src));
        assert.equal(registry.schema, 1);
        assert.deepEqual(registry.plugins.map(p => p.id), ["Alpha", "Zeta"]);
        assert.equal(registry.plugins[0].path, "equicordplugins/Alpha");
        assert.equal(registry.plugins[0].risk.level, "high");
        assert.equal(registry.plugins[1].risk.level, "low");
        assert.match(registry.plugins[0].permissionsHash, /^[0-9a-f]{64}$/);
        assert.ok(!("schema" in registry.plugins[0]), "entries should not repeat the manifest schema field");
    });

    it("orders startup by dependencies", () => {
        add("amiricord", "Child", { dependencies: ["Base"] });
        add("amiricord", "Base");
        assert.deepEqual(buildRegistry(checkPlugins(src)).startOrder, ["Base", "Child"]);
    });

    it("is deterministic: the same sources give the same text", () => {
        add("amiricord", "One");
        add("vencord", "Two");
        const a = serializeRegistry(buildRegistry(checkPlugins(src)));
        const b = serializeRegistry(buildRegistry(checkPlugins(src)));
        assert.equal(a, b);
        assert.ok(a.endsWith("\n"));
        assert.doesNotMatch(a, /amiricord-registry-/, "the file must not contain machine specific paths");
    });

    it("changes the permissions hash exactly when the permissions change", () => {
        add("amiricord", "P", {});
        const before = buildRegistry(checkPlugins(src)).plugins[0].permissionsHash;
        const sameAgain = buildRegistry(checkPlugins(src)).plugins[0].permissionsHash;
        assert.equal(before, sameAgain);

        writeFileSync(join(src, "plugins", "P", "plugin.json"), JSON.stringify({
            schema: 1, id: "P", name: "P", version: "1.0.1", description: "changed", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], entry: { renderer: "index.tsx" },
            permissions: { system: { clipboard: true } }
        }));
        writeFileSync(join(src, "plugins", "P", "index.tsx"), "navigator.clipboard.writeText(\"x\");\n");
        const after = buildRegistry(checkPlugins(src)).plugins[0].permissionsHash;
        assert.notEqual(before, after);
    });

    it("keeps the same hash when only the version or description change", () => {
        add("amiricord", "P");
        const before = buildRegistry(checkPlugins(src)).plugins[0].permissionsHash;
        writeFileSync(join(src, "plugins", "P", "plugin.json"), JSON.stringify({
            schema: 1, id: "P", name: "P", version: "9.9.9", description: "other text", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], entry: { renderer: "index.tsx" }, permissions: {}
        }));
        assert.equal(buildRegistry(checkPlugins(src)).plugins[0].permissionsHash, before);
    });

    it("refuses to build while any plugin has errors", () => {
        add("amiricord", "Good");
        add("amiricord", "Bad", { version: "one" });
        assert.throws(() => buildRegistry(checkPlugins(src)), /cannot build the registry/);
    });

    it("builds an empty registry for an empty tree", () => {
        mkdirSync(join(src, "plugins"));
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(registry, { schema: 1, plugins: [], startOrder: [] });
    });
});

describe("pnpm build:registry (command line)", () => {
    const script = join(process.cwd(), "scripts", "build", "generateRegistry.ts");
    const run = (args: string[]) => {
        try {
            const stdout = execFileSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", stdio: "pipe" });
            return { code: 0, stdout, stderr: "" };
        } catch (err) {
            const e = err as { status: number; stdout: string; stderr: string; };
            return { code: e.status, stdout: e.stdout, stderr: e.stderr };
        }
    };

    it("writes the registry file when everything is valid", () => {
        add("amiricord", "Good");
        const out = join(src, "out", "registry.json");
        const r = run([src, out]);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        const written = JSON.parse(readFileSync(out, "utf8"));
        assert.deepEqual(written.plugins.map((p: { id: string; }) => p.id), ["Good"]);
    });

    it("writes nothing and exits with 1 when a plugin has errors", () => {
        add("amiricord", "Bad", { version: "one" });
        const out = join(src, "out", "registry.json");
        const r = run([src, out]);
        assert.equal(r.code, 1);
        assert.equal(existsSync(out), false);
        assert.match(r.stderr, /not written/);
    });
});

describe("buildRegistry: patches", () => {
    it("carries whether each plugin has patches into the registry", () => {
        add("amiricord", "Patched", {}, { "index.tsx": "export default { patches: [] };\n" });
        add("amiricord", "Plain");
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(Object.fromEntries(registry.plugins.map(p => [p.id, p.hasPatches])), { Patched: true, Plain: false });
    });
});

describe("buildRegistry: settings", () => {
    it("carries whether each plugin declares settings into the registry", () => {
        add("amiricord", "WithSettings", {}, { "index.tsx": "export const s = definePluginSettings({}); export default { settings: s };\n" });
        add("amiricord", "Plain");
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(Object.fromEntries(registry.plugins.map(p => [p.id, p.hasSettings])), { Plain: false, WithSettings: true });
    });

    it("finds settings declared in another file of the plugin, but not in its main-process file", () => {
        add("amiricord", "Split", {}, { "index.tsx": "import { settings } from './settings'; export default { settings };\n", "settings.ts": "export const settings = definePluginSettings({});\n" });
        add("amiricord", "MainOnly", { entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["run"] } } },
            { "index.tsx": "export default {};\n", "native.ts": "const s = definePluginSettings({}); export function run() { return s; }\n" });
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(Object.fromEntries(registry.plugins.map(p => [p.id, p.hasSettings])), { MainOnly: false, Split: true });
    });
});

describe("buildRegistry: main-process code", () => {
    it("marks the plugins that have a main-process entry, which the main process loads only at start", () => {
        add("amiricord", "Native", { entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["run"] } } },
            { "index.tsx": "export default {};\n", "native.ts": "export function run() { return 1; }\n" });
        add("amiricord", "Plain");
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(Object.fromEntries(registry.plugins.map(p => [p.id, p.hasNative])), { Native: true, Plain: false });
    });
});

describe("buildRegistry: a plugin with its own settings component", () => {
    it("is marked as having settings even without declared ones", () => {
        add("amiricord", "Own", {}, { "index.tsx": "export default { settingsComponent: () => null };\n" });
        add("amiricord", "Plain");
        const registry = buildRegistry(checkPlugins(src));
        assert.deepEqual(Object.fromEntries(registry.plugins.map(p => [p.id, p.hasSettings])), { Own: true, Plain: false });
    });
});

describe("the developer tools permission from plugin.json to the main process", () => {
    it("reaches the table of native plugins only for the plugin that declared it", () => {
        const native = (system: Record<string, unknown>) => ({ entry: { renderer: "index.tsx", main: "native.ts" }, permissions: { native: { functions: ["go"] }, system } });
        const files = { "index.tsx": "export default {};\n", "native.ts": "export async function go(host) { return host.openDevTools(); }\n" };
        add("amiricord", "Dev", { ...native({ devtools: true }), enabledByDefault: true }, files);
        add("amiricord", "Other", { ...native({ clipboard: true }), enabledByDefault: true }, { "index.tsx": "export default {};\n", "native.ts": "export async function go() { return 1; }\n" });
        const registry = buildRegistry(checkPlugins(src));
        const table = nativeTableFromRegistry({ registryText: serializeRegistry(registry), safeMode: false, quarantine: [], choices: {}, modules: { Dev: () => ({}), Other: () => ({}) } });
        assert.equal(table.plugins.Dev.devtools, true);
        assert.equal("devtools" in table.plugins.Other, false);
        assert.deepEqual(table.problems, []);
    });
});
