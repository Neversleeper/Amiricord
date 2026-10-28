/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { checkPlugins } from "../scripts/build/manifest/checkPlugins";
import { compareDetections, compareNativeExports, unusedDeclarations } from "../scripts/build/manifest/scanPlugin";
import { Capability, nativeExports, scanSource, usesPatches, usesSettings } from "../scripts/build/manifest/scanSource";
import { emptyPermissions, hostMatches, isFirstPartyHost, Permissions } from "../src/shared/manifest";

const caps = (code: string, file = "index.ts") => scanSource(code, file).map(d => d.capability);
const has = (code: string, capability: Capability, file = "index.ts") => caps(code, file).includes(capability);

describe("scanSource: detections", () => {
    it("detects dynamic code in every common form", () => {
        for (const code of [
            "eval(x);",
            "(0, eval)(x);",
            "new Function('return 1');",
            "Function('return 1')();",
            "setTimeout('doIt()', 10);",
            "setInterval(\"doIt()\", 10);"
        ]) assert.ok(has(code, "dynamic-code"), code);
    });

    it("does not treat normal timers or look-alike names as dynamic code", () => {
        for (const code of ["setTimeout(() => {}, 10);", "evaluate(x);", "const eval2 = 1; eval2;", "obj.functionName();"]) {
            assert.ok(!has(code, "dynamic-code"), code);
        }
    });

    it("detects network APIs", () => {
        for (const code of [
            "fetch(url);",
            "window.fetch(url);",
            "new XMLHttpRequest();",
            "new WebSocket(url);",
            "navigator.sendBeacon(url);",
            "net.request({ url });",
            "https.request(options);"
        ]) assert.ok(has(code, "network-api"), code);
    });

    it("detects process starts and servers, from imports, require and dynamic import", () => {
        assert.ok(has("import { spawn } from \"child_process\";", "spawn"));
        assert.ok(has("import cp from \"node:child_process\";", "spawn"));
        assert.ok(has("const cp = require(\"child_process\");", "spawn"));
        assert.ok(has("await import(\"child_process\");", "spawn"));
        assert.ok(has("http.createServer(handler);", "listen"));
        assert.ok(has("createServer(handler);", "listen"));
    });

    it("detects account writes, messages, token and Authorization", () => {
        assert.ok(has("RestAPI.post({ url });", "account-write"));
        assert.ok(has("Vencord.Api.RestAPI.patch({ url });", "account-write"));
        assert.ok(!has("RestAPI.get({ url });", "account-write"));
        assert.ok(has("MessageActions.sendMessage(id, msg);", "send-message"));
        assert.ok(has("MessageActions._sendMessage(id, msg, extra);", "send-message"), "Discord's own function that the utility sendMessage calls");
        assert.ok(has("AuthenticationStore.getToken();", "token"));
        assert.ok(has("headers = { \"Authorization\": t };", "authorization-literal"));
    });

    it("detects files, dialogs, clipboard, links and telemetry", () => {
        assert.ok(has("import { readFileSync } from \"fs\";", "fs"));
        assert.ok(has("import fs from \"node:fs/promises\";", "fs"));
        assert.ok(has("dialog.showOpenDialog({});", "file-dialog"));
        assert.ok(has("await showSaveFilePicker();", "file-dialog"));
        assert.ok(has("navigator.clipboard.writeText(x);", "clipboard"));
        assert.ok(has("copyToClipboard(x);", "clipboard"));
        assert.ok(has("shell.openExternal(url);", "open-external"));
        assert.ok(has("window.open(url);", "open-external"));
        assert.ok(has("post(\"/api/v9/science\");", "telemetry"));
    });

    it("reads hosts from URL text, including template strings", () => {
        const hosts = scanSource("const a = \"https://API.Example.com/x\"; const b = `https://cdn.example.org/${id}`;", "a.ts")
            .filter(d => d.capability === "url-literal").map(d => d.detail);
        assert.deepEqual(hosts, ["api.example.com", "cdn.example.org"]);
    });

    it("ignores everything that is only in comments", () => {
        const code = [
            "// fetch('https://evil.example.com'); eval('x'); child_process",
            "/* RestAPI.post({}); AuthenticationStore.getToken(); */",
            "export const x = 1;"
        ].join("\n");
        assert.deepEqual(scanSource(code, "a.ts"), []);
    });

    it("reports the line number", () => {
        const [d] = scanSource("export const a = 1;\n\nfetch(x);\n", "a.ts");
        assert.equal(d.line, 3);
    });

    it("parses TSX files", () => {
        assert.ok(has("export const C = () => <a href=\"https://example.com\">x</a>;", "url-literal", "c.tsx"));
    });
});

describe("nativeExports", () => {
    it("lists exported values and ignores types and unexported code", () => {
        const code = [
            "import x from \"y\";",
            "export function a() {}",
            "export async function b() {}",
            "export const c = () => 1, d = 2;",
            "export class E {}",
            "export type T = string;",
            "export interface I {}",
            "function hidden() {}",
            "const alsoHidden = 1;",
            "export { hidden as renamed };",
            "export type { T as T2 };"
        ].join("\n");
        assert.deepEqual(nativeExports(code, "native.ts"), ["E", "a", "b", "c", "d", "renamed"]);
    });

    it("lists a default export as `default`", () => {
        assert.deepEqual(nativeExports("export default function () {}", "native.ts"), ["default"]);
    });
});

describe("hostMatches and isFirstPartyHost", () => {
    it("matches exact hosts and wildcard subdomains only", () => {
        assert.ok(hostMatches("example.com", "example.com"));
        assert.ok(hostMatches("EXAMPLE.com", "example.COM"));
        assert.ok(!hostMatches("example.com", "api.example.com"));
        assert.ok(hostMatches("*.example.com", "api.example.com"));
        assert.ok(hostMatches("*.example.com", "a.b.example.com"));
        assert.ok(!hostMatches("*.example.com", "example.com"));
        assert.ok(!hostMatches("*.example.com", "badexample.com"));
    });

    it("recognizes Discord's own hosts", () => {
        assert.ok(isFirstPartyHost("discord.com"));
        assert.ok(isFirstPartyHost("cdn.discordapp.com"));
        assert.ok(!isFirstPartyHost("notdiscord.com"));
        assert.ok(!isFirstPartyHost("discord.com.evil.example"));
    });
});

describe("compareDetections", () => {
    const run = (code: string, change: (p: Permissions) => void = () => { }, side: "main" | "renderer" = "renderer") => {
        const p = emptyPermissions();
        change(p);
        return compareDetections("x.ts", side, scanSource(code, "x.ts"), p);
    };
    const errors = (f: ReturnType<typeof run>) => f.filter(x => x.severity === "error").map(x => x.rule);

    it("passes code that does nothing sensitive", () => {
        assert.deepEqual(run("export const x = 1;"), []);
    });

    it("rejects each undeclared capability with its own rule", () => {
        const cases: Array<[string, string]> = [
            ["eval(x);", "S-DYNAMIC"],
            ["import cp from \"child_process\";", "S-SPAWN"],
            ["http.createServer(h);", "S-LISTEN"],
            ["fetch(u);", "S-NETWORK"],
            ["RestAPI.post({});", "S-ACCOUNT"],
            ["MessageActions.sendMessage(a, b);", "S-SEND"],
            ["MessageActions._sendMessage(a, b, c);", "S-SEND"],
            ["Store.getToken();", "S-TOKEN"],
            ["import fs from \"fs\";", "S-FILES"],
            ["dialog.showOpenDialog({});", "S-DIALOG"],
            ["navigator.clipboard.writeText(x);", "S-CLIPBOARD"],
            ["window.open(u);", "S-OPEN"],
            ["post(\"/api/v9/science\");", "S-TELEMETRY"]
        ];
        for (const [code, rule] of cases) assert.deepEqual(errors(run(code)), [rule], code);
    });

    it("accepts the same code once the permission is declared", () => {
        assert.deepEqual(run("eval(x);", p => { p.code.dynamic = true; }), []);
        assert.deepEqual(run("RestAPI.post({});", p => { p.account.write = ["quest.progress"]; }), []);
        assert.deepEqual(run("Store.getToken();", p => { p.token = true; }), []);
        assert.deepEqual(run("dialog.showOpenDialog({});", p => { p.files = "user-chosen"; }), []);
    });

    it("lets sending messages count as an account write", () => {
        assert.deepEqual(errors(run("RestAPI.post({});", p => { p.messages.send = true; })), []);
    });

    it("requires a host for the side that uses the network", () => {
        const rendererHost = (p: Permissions) => { p.network.push({ host: "example.com", from: "renderer", why: "x" }); };
        assert.deepEqual(errors(run("fetch(u);", rendererHost, "renderer")), []);
        assert.deepEqual(errors(run("fetch(u);", rendererHost, "main")), ["S-NETWORK"]);
    });

    it("lets native code reach the network only through the host helper", () => {
        const mainHost = (p: Permissions) => { p.network.push({ host: "example.com", from: "main", why: "x" }); };
        assert.deepEqual(errors(run("export async function go(host) { return host.fetch(u); }", mainHost, "main")), []);
        for (const code of ["fetch(u);", "globalThis.fetch(u);", "https.request(o);", "import https from \"node:https\";", "import net from \"net\";", "new WebSocket(u);"]) {
            assert.deepEqual(errors(run(code, mainHost, "main")), ["S-NATIVE-HOST"], code);
        }
        assert.deepEqual(errors(run("class C { async go() { return this.deps.host.fetch(u); } }", mainHost, "main")), [], "a helper object that keeps the host is fine");
        assert.deepEqual(errors(run("class C { async go() { return this.deps.ghost.fetch(u); } }", mainHost, "main")), ["S-NATIVE-HOST"], "only the host helper counts");
        // The page side is not held to the helper.
        const rendererHost = (p: Permissions) => { p.network.push({ host: "example.com", from: "renderer", why: "x" }); };
        assert.deepEqual(errors(run("fetch(u);", rendererHost, "renderer")), []);
    });

    it("warns, without failing, about URL hosts that are not declared", () => {
        const f = run("const u = \"https://other.example.com/x\";");
        assert.equal(f.length, 1);
        assert.equal(f[0].severity, "warning");
        assert.equal(f[0].rule, "S-URL");
        assert.deepEqual(run("const u = \"https://cdn.discordapp.com/x\";"), []);
        assert.deepEqual(run("const u = \"https://api.example.com/x\";", p => { p.network.push({ host: "*.example.com", from: "main", why: "x" }); }), []);
    });
});

describe("unusedDeclarations and compareNativeExports", () => {
    it("warns about permissions the code never uses", () => {
        const p = emptyPermissions();
        p.token = true;
        p.system.clipboard = true;
        const rules = unusedDeclarations([], p);
        assert.equal(rules.length, 2);
        assert.ok(rules.every(f => f.severity === "warning" && f.rule === "S-UNUSED"));
    });

    it("requires native exports to match permissions.native.functions exactly", () => {
        const p = emptyPermissions();
        p.native.functions = ["search", "download"];
        assert.deepEqual(compareNativeExports("native.ts", "export function search() {}\nexport function download() {}", p), []);
        const extra = compareNativeExports("native.ts", "export function search() {}\nexport function download() {}\nexport function secret() {}", p);
        assert.equal(extra.length, 1);
        assert.match(extra[0].message, /exports secret/);
        const missing = compareNativeExports("native.ts", "export function search() {}", p);
        assert.equal(missing.length, 1);
        assert.match(missing[0].message, /lists download/);
    });
});

describe("check:plugins with the scanner", () => {
    let root: string;
    beforeEach(() => { root = mkdtempSync(join(tmpdir(), "amiricord-scan-")); });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    function add(id: string, permissions: Record<string, unknown>, files: Record<string, string>, entry: Record<string, string> = { renderer: "index.tsx" }) {
        const dir = join(root, "plugins", id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plugin.json"), JSON.stringify({
            schema: 1, id, name: id, version: "1.0.0", description: "d", origin: "amiricord",
            license: "GPL-3.0-or-later", authors: [{ name: "szlcx404" }], entry, permissions
        }));
        for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    }

    it("fails a plugin whose code does more than it declared", () => {
        add("Sneaky", {}, { "index.tsx": "fetch(\"https://example.com\");\nAuthStore.getToken();\n" });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        const errs = r.plugins[0].errors.join("\n");
        assert.match(errs, /index\.tsx:1 S-NETWORK/);
        assert.match(errs, /index\.tsx:2 S-TOKEN/);
    });

    it("passes the same plugin once it declares what it does, and treats native.ts as the main side", () => {
        add("Honest", {
            network: [{ host: "example.com", from: "main", why: "search" }],
            native: { functions: ["search"] }
        }, {
            "index.tsx": "export const x = 1;\n",
            "native.ts": "export async function search(host: { fetch(u: string): unknown; }) { return host.fetch(\"https://example.com\"); }\n"
        }, { renderer: "index.tsx", main: "native.ts" });
        const r = checkPlugins(root);
        assert.equal(r.ok, true, JSON.stringify(r.plugins, null, 2));
    });

    it("fails a native file that fetches without the host helper, even when the host is declared", () => {
        add("Bypass", {
            network: [{ host: "example.com", from: "main", why: "search" }],
            native: { functions: ["search"] }
        }, {
            "index.tsx": "export const x = 1;\n",
            "native.ts": "export async function search() { return fetch(\"https://example.com\"); }\n"
        }, { renderer: "index.tsx", main: "native.ts" });
        const r = checkPlugins(root);
        assert.equal(r.ok, false);
        assert.match(r.plugins[0].errors.join("\n"), /native\.ts:1 S-NATIVE-HOST/);
    });

    it("can skip the scan", () => {
        add("Sneaky", {}, { "index.tsx": "eval(\"1\");\n" });
        assert.equal(checkPlugins(root, { scan: false }).ok, true);
        assert.equal(checkPlugins(root).ok, false);
    });
});

describe("usesPatches", () => {
    it("is true when the code names patches in any of the usual ways", () => {
        for (const code of [
            "export default { patches: [{ find: 'x', replacement: [] }] };",
            "const patches = []; export default { patches };",
            "plugin.patches = [];",
            "plugin['patches'] = [];",
            "export default { \"patches\": [] };",
            "definePlugin({ patches: [...a, ...b] });"
        ]) assert.equal(usesPatches(code, "index.tsx"), true, code);
    });

    it("is false for code without patches, and for the word in comments and strings", () => {
        for (const code of [
            "export default { start() {} };",
            "// patches would go here\nexport default {};",
            "/* patches: [] */ export default {};",
            "export default { description: 'no patches here', start() { log('patches'); } };",
            "const patch = 1; const patchesApplied = 2; export default {};"
        ]) assert.equal(usesPatches(code, "index.tsx"), false, code);
    });

    it("reads JSX files", () => {
        assert.equal(usesPatches("export const x = <div>patches</div>;", "a.tsx"), false);
        assert.equal(usesPatches("export default { patches: [] }; export const x = <div/>;", "a.tsx"), true);
    });
});

describe("usesSettings", () => {
    it("is true when the code calls definePluginSettings, also under another name or through a namespace", () => {
        for (const code of [
            "const settings = definePluginSettings({ a: { type: 'boolean', default: true, description: 'x' } });",
            "import { definePluginSettings } from '../../api/pluginSettings'; export const s = definePluginSettings({});",
            "import { definePluginSettings as define } from '../../api/pluginSettings'; export const s = define({});",
            "import * as api from '../../api/pluginSettings'; export const s = api.definePluginSettings({});",
            "export default { settings: definePluginSettings({}) };"
        ]) assert.equal(usesSettings(code, "index.ts"), true, code);
    });

    it("is false for code without it, and for the name in comments, strings, types and plain references", () => {
        for (const code of [
            "export default { start() {} };",
            "// definePluginSettings would go here\nexport default {};",
            "/* definePluginSettings({}) */ export default {};",
            "export default { description: 'uses definePluginSettings', start() { log('definePluginSettings()'); } };",
            "import { definePluginSettings } from '../../api/pluginSettings'; export const unused = 1;",
            "export const name = definePluginSettings;",
            "type T = ReturnType<typeof definePluginSettings>;",
            "const define = (x: unknown) => x; export const s = define({});"
        ]) assert.equal(usesSettings(code, "index.ts"), false, code);
    });

    it("reads JSX files and stops at the first call", () => {
        assert.equal(usesSettings("export const s = definePluginSettings({}); export const x = <div/>;", "a.tsx"), true);
        assert.equal(usesSettings("export const x = <div>definePluginSettings({})</div>;", "a.tsx"), false);
    });
});

describe("usesSettings: a plugin that draws its own settings", () => {
    it("is true for a settingsComponent property, a shorthand, a method, a quoted name and a property written to", () => {
        for (const code of [
            "export default { settingsComponent: Panel };",
            "const settingsComponent = () => null; export default { settingsComponent };",
            "export default { settingsComponent() { return null; } };",
            "export default { \"settingsComponent\": Panel };",
            "const code = {}; code.settingsComponent = Panel; export default code;"
        ]) assert.equal(usesSettings(code, "index.tsx"), true, code);
    });

    it("is false for the name in a comment, a string, a type or a variable that is not given to the plugin", () => {
        for (const code of [
            "// settingsComponent would go here\nexport default {};",
            "export default { description: 'has a settingsComponent' };",
            "type T = { other: number }; export default {};",
            "const settingsComponent = 1; export default {};"
        ]) assert.equal(usesSettings(code, "index.tsx"), false, code);
    });
});

describe("the developer tools in the code of a plugin", () => {
    const seen = (code: string) => scanSource(code, "x.ts").filter(d => d.capability === "devtools").map(d => d.detail);
    const perms = (change: (p: Permissions) => void = () => undefined) => { const p = emptyPermissions(); change(p); return p; };
    const errorsOf = (code: string, p: Permissions) => compareDetections("x.ts", "main", scanSource(code, "x.ts"), p).filter(f => f.severity === "error").map(f => f.rule);

    it("sees a call to openDevTools and canOpenDevTools, through the host or on its own, and nothing else", () => {
        assert.deepEqual(seen("host.openDevTools();"), ["host.openDevTools()"]);
        assert.deepEqual(seen("host.canOpenDevTools();"), ["host.canOpenDevTools()"]);
        assert.deepEqual(seen("openDevTools();"), ["openDevTools()"]);
        assert.deepEqual(seen("win.webContents.openDevTools();"), ["win.webContents.openDevTools()"]);
        for (const quiet of ["const name = \"openDevTools\";", "// host.openDevTools();", "const f = host.openDevTools;", "type T = { openDevTools(): void };", "const openDevTools = 1;"]) {
            assert.deepEqual(seen(quiet), [], quiet);
        }
    });

    it("refuses a call without the permission, and accepts it with the permission", () => {
        assert.deepEqual(errorsOf("export async function go(host) { return host.openDevTools(); }", perms()), ["S-DEVTOOLS"]);
        assert.deepEqual(errorsOf("export async function go(host) { return host.canOpenDevTools(); }", perms()), ["S-DEVTOOLS"]);
        assert.deepEqual(errorsOf("export async function go(host) { return host.openDevTools(); }", perms(p => { p.system.devtools = true; })), []);
    });

    it("warns about a permission that nothing uses, and not when it is used", () => {
        const withPermission = perms(p => { p.system.devtools = true; });
        const warn = (code: string) => unusedDeclarations(scanSource(code, "x.ts"), withPermission).map(f => f.rule + ":" + f.severity);
        assert.deepEqual(warn("export const x = 1;"), ["S-UNUSED:warning"]);
        assert.deepEqual(warn("host.openDevTools();"), []);
        assert.deepEqual(unusedDeclarations([], perms()), []);
    });
});
