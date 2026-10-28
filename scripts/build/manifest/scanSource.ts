/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reads TypeScript source with the TypeScript parser and reports which sensitive capabilities the code uses.
// It works on the syntax tree, so words inside comments or text never count as code.
// It is a static scan: it catches mistakes and omissions, not code written to hide what it does.

import ts from "typescript";

export type Capability =
    | "dynamic-code"
    | "spawn"
    | "listen"
    | "network-api"
    | "url-literal"
    | "account-write"
    | "send-message"
    | "token"
    | "fs"
    | "file-dialog"
    | "clipboard"
    | "open-external"
    | "devtools"
    | "telemetry"
    | "authorization-literal";

export interface Detection {
    capability: Capability;
    line: number;
    /** What was seen, for the message (a function name, a host, ...). */
    detail: string;
}

const CHILD_PROCESS_MODULES = new Set(["child_process", "node:child_process"]);
const NETWORK_MODULES = new Set(["http", "node:http", "https", "node:https", "http2", "node:http2", "net", "node:net", "tls", "node:tls", "dgram", "node:dgram"]);
const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises", "original-fs"]);
const REST_WRITE_METHODS = new Set(["post", "put", "patch", "del", "delete"]);
const DIALOG_NAMES = new Set([
    "showOpenDialog", "showOpenDialogSync", "showSaveDialog", "showSaveDialogSync",
    "showDirectoryPicker", "showOpenFilePicker", "showSaveFilePicker"
]);
const NETWORK_CONSTRUCTORS = new Set(["XMLHttpRequest", "WebSocket", "EventSource"]);
const NETWORK_REQUEST_OBJECTS = new Set(["net", "http", "https"]);
const URL_RE = /\bhttps?:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi;

function unwrapCallee(expr: ts.Expression): ts.Expression {
    let current = expr;
    for (;;) {
        if (ts.isParenthesizedExpression(current)) {
            current = current.expression;
        } else if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
            // (0, eval)(code) is an indirect eval
            current = current.right;
        } else {
            return current;
        }
    }
}

function scriptKind(fileName: string) {
    return fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Find the sensitive capabilities used by one source file. */
export function scanSource(text: string, fileName: string): Detection[] {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
    const found: Detection[] = [];

    const add = (node: ts.Node, capability: Capability, detail: string) => {
        found.push({ capability, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, detail });
    };

    const onModule = (node: ts.Node, name: string) => {
        if (CHILD_PROCESS_MODULES.has(name)) add(node, "spawn", name);
        if (FS_MODULES.has(name)) add(node, "fs", name);
        if (NETWORK_MODULES.has(name)) add(node, "network-api", `import of ${name}`);
    };

    const firstStringArg = (call: ts.CallExpression) => {
        const arg = call.arguments[0];
        return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
    };

    const onCall = (node: ts.CallExpression) => {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const name = firstStringArg(node);
            if (name) onModule(node, name);
            return;
        }

        const callee = unwrapCallee(node.expression);

        if (ts.isIdentifier(callee)) {
            const name = callee.text;
            if (name === "eval" || name === "Function") add(node, "dynamic-code", `${name}()`);
            else if (name === "fetch") add(node, "network-api", "fetch()");
            else if (name === "require") {
                const module = firstStringArg(node);
                if (module) onModule(node, module);
            } else if (name === "setTimeout" || name === "setInterval") {
                if (firstStringArg(node) !== null) add(node, "dynamic-code", `${name}() with a string`);
            } else if (name === "openExternal") add(node, "open-external", "openExternal()");
            else if (name === "openDevTools" || name === "canOpenDevTools") add(node, "devtools", `${name}()`);
            else if (name === "copyToClipboard") add(node, "clipboard", "copyToClipboard()");
            else if (name === "createServer") add(node, "listen", "createServer()");
            else if (DIALOG_NAMES.has(name)) add(node, "file-dialog", `${name}()`);
            return;
        }

        if (!ts.isPropertyAccessExpression(callee)) return;
        const name = callee.name.text;
        const object = callee.expression.getText(sf);

        if (name === "fetch") add(node, "network-api", `${object}.fetch()`);
        else if (name === "sendBeacon") add(node, "network-api", `${object}.sendBeacon()`);
        else if (name === "request" && NETWORK_REQUEST_OBJECTS.has(object)) add(node, "network-api", `${object}.request()`);
        else if (name === "createServer") add(node, "listen", `${object}.createServer()`);
        else if (name === "getToken") add(node, "token", `${object}.getToken()`);
        else if (name === "sendMessage" || name === "_sendMessage") add(node, "send-message", `${object}.${name}()`);
        else if (REST_WRITE_METHODS.has(name) && /RestAPI$/.test(object)) add(node, "account-write", `${object}.${name}()`);
        else if (DIALOG_NAMES.has(name)) add(node, "file-dialog", `${name}()`);
        else if (name === "openExternal") add(node, "open-external", `${object}.openExternal()`);
        else if (name === "openDevTools" || name === "canOpenDevTools") add(node, "devtools", `${object}.${name}()`);
        else if (name === "open" && object === "window") add(node, "open-external", "window.open()");
        else if (name === "copyToClipboard") add(node, "clipboard", `${object}.copyToClipboard()`);
    };

    const onLiteral = (node: ts.Node, text: string) => {
        for (const match of text.matchAll(URL_RE)) add(node, "url-literal", match[1].toLowerCase());
        if (text.includes("/science")) add(node, "telemetry", "a /science endpoint");
        if (text.toLowerCase() === "authorization") add(node, "authorization-literal", "\"Authorization\"");
    };

    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            onModule(node, node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node)) {
            onCall(node);
        } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
            const name = node.expression.text;
            if (name === "Function") add(node, "dynamic-code", "new Function()");
            else if (NETWORK_CONSTRUCTORS.has(name)) add(node, "network-api", `new ${name}()`);
        } else if (ts.isPropertyAccessExpression(node)) {
            if (node.name.text === "clipboard" && node.expression.getText(sf) === "navigator") add(node, "clipboard", "navigator.clipboard");
        } else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            onLiteral(node, node.text);
        }
        ts.forEachChild(node, visit);
    };

    visit(sf);
    return found;
}

/**
 * Whether the code mentions `patches` as a name: a property, a variable, an assignment target. Patches are applied only when
 * Discord loads its modules, so such a plugin cannot be turned on or off without a restart. Strings and comments do not count.
 * It leans towards "yes": a plugin that only has an unrelated variable called `patches` is told to restart, which is safe.
 */
export function usesPatches(text: string, fileName: string): boolean {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isIdentifier(node) && node.text === "patches") found = true;
        else if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && node.name.text === "patches") found = true;
        else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "patches") found = true;
        else ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * Whether the code calls `definePluginSettings(...)`, which is how a plugin declares settings the owner can change. It follows an import
 * under another name (`import { definePluginSettings as define }`) and a call through a namespace (`api.definePluginSettings(...)`).
 * A plugin that gives its own `settingsComponent` (a property of that name: `{ settingsComponent: X }`, a shorthand, a method, or `code.settingsComponent`)
 * has settings too. Only a call or a property counts: the name in a comment, a string or a type does not. It does not look inside the arguments,
 * so it says whether a plugin HAS settings, not which ones.
 */
export function usesSettings(text: string, fileName: string): boolean {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
    const NAME = "definePluginSettings";
    const COMPONENT = "settingsComponent";
    const names = new Set<string>([NAME]);
    for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            if ((element.propertyName ?? element.name).text === NAME) names.add(element.name.text);
        }
    }
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
            const key = node.name;
            if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === COMPONENT) found = true;
        } else if (ts.isPropertyAccessExpression(node) && node.name.text === COMPONENT) {
            found = true;
        }
        if (found) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isIdentifier(callee) && names.has(callee.text)) found = true;
            else if (ts.isPropertyAccessExpression(callee) && callee.name.text === NAME) found = true;
        }
        if (!found) ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

function hasExport(node: ts.Node) {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefault(node: ts.Node) {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * Names a native (main process) file exports. Every exported value becomes callable from the
 * renderer, so the list must match `permissions.native.functions` exactly. Types are ignored.
 */
export function nativeExports(text: string, fileName: string): string[] {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
    const names: string[] = [];

    for (const statement of sf.statements) {
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && hasExport(statement)) {
            names.push(hasDefault(statement) ? "default" : statement.name?.text ?? "default");
        } else if (ts.isVariableStatement(statement) && hasExport(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
            }
        } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (!element.isTypeOnly) names.push(element.name.text);
            }
        } else if (ts.isExportAssignment(statement)) {
            names.push("default");
        }
    }
    return [...new Set(names)].sort();
}
