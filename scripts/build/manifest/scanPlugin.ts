/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Compares what a plugin's source code does with what its plugin.json declares.
// Code that does something undeclared is an error and stops the build. Declared but unused is a warning.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { hostMatches, isFirstPartyHost, Manifest, Permissions } from "../../../src/shared/manifest";
import { Detection, nativeExports, scanSource, usesPatches, usesSettings } from "./scanSource";

export type Side = "main" | "renderer";

export interface Finding {
    /** Path relative to the plugin folder, with forward slashes. */
    file: string;
    line: number;
    rule: string;
    severity: "error" | "warning";
    message: string;
}

/** A file runs in the main process when it is the declared main entry or is named `native.*`. */
export function sideOf(file: string, manifest: Manifest): Side {
    const name = file.split("/").pop() ?? file;
    return file === manifest.entry.main || /^native\./.test(name) ? "main" : "renderer";
}

function finding(file: string, d: { line: number; }, rule: string, severity: Finding["severity"], message: string): Finding {
    return { file, line: d.line, rule, severity, message };
}

/** Findings for one file: things the code does that the permissions do not allow. */
export function compareDetections(file: string, side: Side, detections: Detection[], p: Permissions): Finding[] {
    const out: Finding[] = [];
    const hasHostFor = p.network.some(n => n.from === side);
    const declaredHosts = p.network.map(n => n.host);

    for (const d of detections) {
        switch (d.capability) {
            case "dynamic-code":
                if (!p.code.dynamic) out.push(finding(file, d, "S-DYNAMIC", "error", `${d.detail} runs dynamic code, but permissions.code.dynamic is false`));
                break;
            case "spawn":
                if (!p.system.spawn) out.push(finding(file, d, "S-SPAWN", "error", `${d.detail} can start programs, but permissions.system.spawn is false`));
                break;
            case "listen":
                if (p.system.listen.length === 0) out.push(finding(file, d, "S-LISTEN", "error", `${d.detail} can open a port, but permissions.system.listen is empty`));
                break;
            case "network-api":
                if (!hasHostFor) out.push(finding(file, d, "S-NETWORK", "error", `${d.detail} uses the network from the ${side} side, but permissions.network lists no host with from "${side}"`));
                else if (side === "main" && !/(^|\.)host\.fetch\(\)$/.test(d.detail)) out.push(finding(file, d, "S-NATIVE-HOST", "error", `${d.detail} reaches the network without the host helper: native code must use host.fetch(), which refuses hosts the plugin did not declare`));
                break;
            case "url-literal":
                if (!isFirstPartyHost(d.detail) && !declaredHosts.some(h => hostMatches(h, d.detail))) {
                    out.push(finding(file, d, "S-URL", "warning", `the URL host ${d.detail} is not in permissions.network (declare it if the plugin connects to it)`));
                }
                break;
            case "account-write":
                if (p.account.write.length === 0 && !p.messages.send) out.push(finding(file, d, "S-ACCOUNT", "error", `${d.detail} changes things on your account, but permissions.account.write is empty`));
                break;
            case "send-message":
                if (!p.messages.send) out.push(finding(file, d, "S-SEND", "error", `${d.detail} sends messages, but permissions.messages.send is false`));
                break;
            case "token":
                if (!p.token) out.push(finding(file, d, "S-TOKEN", "error", `${d.detail} reads your token, but permissions.token is false`));
                break;
            case "fs":
                if (p.files === "none") out.push(finding(file, d, "S-FILES", "error", `imports ${d.detail}, but permissions.files is "none"`));
                break;
            case "file-dialog":
                if (p.files !== "user-chosen" && p.files !== "paths") out.push(finding(file, d, "S-DIALOG", "error", `${d.detail} lets the user pick files, but permissions.files is "${p.files}"`));
                break;
            case "clipboard":
                if (!p.system.clipboard) out.push(finding(file, d, "S-CLIPBOARD", "error", `${d.detail} uses the clipboard, but permissions.system.clipboard is false`));
                break;
            case "open-external":
                if (!p.system.openExternal) out.push(finding(file, d, "S-OPEN", "error", `${d.detail} opens links outside Discord, but permissions.system.openExternal is false`));
                break;
            case "devtools":
                if (side === "main" && !p.system.devtools) out.push(finding(file, d, "S-DEVTOOLS", "error", `${d.detail} opens Discord's developer tools, but permissions.system.devtools is false`));
                break;
            case "telemetry":
                if (p.telemetry.send.length === 0) out.push(finding(file, d, "S-TELEMETRY", "error", `mentions ${d.detail}, but permissions.telemetry.send is empty`));
                break;
            case "authorization-literal":
                if (!p.token) out.push(finding(file, d, "S-AUTH", "warning", "mentions an Authorization header; if it carries the user's token, set permissions.token"));
                break;
        }
    }
    return out;
}

/** Warnings for permissions the whole plugin declares but its code never seems to use. */
export function unusedDeclarations(all: Detection[], p: Permissions): Finding[] {
    const seen = new Set(all.map(d => d.capability));
    const out: Finding[] = [];
    const warn = (rule: string, message: string) => out.push({ file: "plugin.json", line: 1, rule, severity: "warning", message });

    if (p.token && !seen.has("token")) warn("S-UNUSED", "permissions.token is true but the code never reads the token");
    if (p.code.dynamic && !seen.has("dynamic-code")) warn("S-UNUSED", "permissions.code.dynamic is true but no dynamic code was found");
    if (p.system.spawn && !seen.has("spawn")) warn("S-UNUSED", "permissions.system.spawn is true but no program start was found");
    if (p.system.listen.length && !seen.has("listen")) warn("S-UNUSED", "permissions.system.listen has ports but no server was found");
    if (p.system.clipboard && !seen.has("clipboard")) warn("S-UNUSED", "permissions.system.clipboard is true but no clipboard use was found");
    if (p.system.devtools && !seen.has("devtools")) warn("S-UNUSED", "permissions.system.devtools is true but no call that opens the developer tools was found");
    if (p.system.openExternal && !seen.has("open-external")) warn("S-UNUSED", "permissions.system.openExternal is true but no link opening was found");
    if (p.messages.send && !seen.has("send-message") && !seen.has("account-write")) warn("S-UNUSED", "permissions.messages.send is true but no message sending was found");
    if (p.telemetry.send.length && !seen.has("telemetry")) warn("S-UNUSED", "permissions.telemetry.send is set but no such endpoint was found");
    if (p.network.length && !seen.has("network-api") && !seen.has("url-literal")) warn("S-UNUSED", "permissions.network lists hosts but no network use was found");
    return out;
}

/** Findings for the native entry: its exports are exactly the functions callable from the renderer. */
export function compareNativeExports(file: string, text: string, p: Permissions): Finding[] {
    const exported = nativeExports(text, file);
    const declared = [...p.native.functions].sort();
    const undeclared = exported.filter(n => !declared.includes(n));
    const missing = declared.filter(n => !exported.includes(n));
    const out: Finding[] = [];
    if (undeclared.length) out.push({ file, line: 1, rule: "S-NATIVE", severity: "error", message: `exports ${undeclared.join(", ")} but permissions.native.functions does not list ${undeclared.length > 1 ? "them" : "it"}` });
    if (missing.length) out.push({ file, line: 1, rule: "S-NATIVE", severity: "error", message: `permissions.native.functions lists ${missing.join(", ")} but the file does not export ${missing.length > 1 ? "them" : "it"}` });
    return out;
}

function sourceFiles(dir: string, base = dir, files: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(path, base, files);
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(relative(base, path).split("\\").join("/"));
    }
    return files.sort();
}

/** Whether any page-side source file of the plugin has patches (files that run in the main process cannot patch Discord's modules). */
export function pluginUsesPatches(dir: string, manifest: Manifest): boolean {
    return sourceFiles(dir).some(file => sideOf(file, manifest) === "renderer" && usesPatches(readFileSync(join(dir, file), "utf8"), file));
}

/** Whether any page-side source file of the plugin declares settings. The build only finds out that it has some, it never runs the plugin to read them. */
export function pluginUsesSettings(dir: string, manifest: Manifest): boolean {
    return sourceFiles(dir).some(file => sideOf(file, manifest) === "renderer" && usesSettings(readFileSync(join(dir, file), "utf8"), file));
}

/** Scan every source file of a plugin folder against its manifest. */
export function scanPlugin(dir: string, manifest: Manifest): Finding[] {
    const p = manifest.permissions;
    const findings: Finding[] = [];
    const all: Detection[] = [];

    for (const file of sourceFiles(dir)) {
        const text = readFileSync(join(dir, file), "utf8");
        const detections = scanSource(text, file);
        all.push(...detections);
        findings.push(...compareDetections(file, sideOf(file, manifest), detections, p));
    }

    const main = manifest.entry.main;
    if (main && existsSync(join(dir, main))) {
        findings.push(...compareNativeExports(main, readFileSync(join(dir, main), "utf8"), p));
    }

    findings.push(...unusedDeclarations(all, p));
    return findings;
}
