/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Development probe: reads the structure of Discord's settings window once, to find where a settings tab can be added.
// It writes only structure: node keys and types, names of React components, and the source text of a few functions.
// It never reads props, state, text on screen, chats or account data. Every string is redacted before it is written.
// Only started in dev mode (see the dev flag file). Design: docs/design-03-settings.md section 9.

import { redact } from "../../shared/health";
import type { Finder } from "../../webpack/finders";

type Dictionary = Record<string, unknown>;

export interface ProbeLimits {
    maxDepth: number;
    maxNodes: number;
    maxSourceChars: number;
    maxFiberSteps: number;
    maxDumpChars: number;
}

export const DEFAULT_LIMITS: ProbeLimits = { maxDepth: 8, maxNodes: 2000, maxSourceChars: 4096, maxFiberSteps: 40, maxDumpChars: 900_000 };

const isSet = (value: unknown) => value !== undefined && value !== null;

const isObject = (value: unknown): value is Dictionary => (typeof value === "object" && value !== null) || typeof value === "function";

/** Read a property; a getter that throws gives undefined. */
function read(target: unknown, key: string): unknown {
    if (!isObject(target)) return undefined;
    try {
        return target[key];
    } catch {
        return undefined;
    }
}

function ownKeys(target: unknown): string[] {
    if (!isObject(target)) return [];
    try {
        return Object.keys(target).sort();
    } catch {
        return [];
    }
}

/** Names of the functions on an object's prototype chain below Object.prototype. */
export function methodNames(target: unknown): string[] {
    const names = new Set<string>();
    try {
        for (let proto = isObject(target) ? Object.getPrototypeOf(target) : null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
            for (const name of Object.getOwnPropertyNames(proto)) {
                if (name === "constructor") continue;
                const descriptor = Object.getOwnPropertyDescriptor(proto, name);
                if (typeof descriptor?.value === "function") names.add(name);
            }
        }
    } catch {
        // A hostile proxy simply gives a shorter list.
    }
    return [...names].sort();
}

/** The text of a function, cut at `max`, redacted. Anything that is not a function gives null. */
export function functionSource(value: unknown, max: number): string | null {
    if (typeof value !== "function") return null;
    try {
        const text = Function.prototype.toString.call(value);
        return redact(text.length > max ? text.slice(0, max) + "…" : text);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The tree

export interface NodeInfo {
    key: string | null;
    type: string;
    depth: number;
    children: number;
    parentKey: string | null;
    hasUseTitle: boolean;
    hasUseSubnavLabel: boolean;
    hasRender: boolean;
}

export interface TreeDump {
    rootFound: boolean;
    nodeCount: number;
    truncated: boolean;
    nodes: NodeInfo[];
}

const textOrNull = (value: unknown) => (typeof value === "string" ? redact(value) : null);

/** Names of the node types, from the enum object (`{ 0: "ROOT", ROOT: 0, ... }`). */
export function typeNameOf(enumObject: unknown, type: unknown): string {
    const name = typeof type === "number" ? read(enumObject, String(type)) : undefined;
    return typeof name === "string" ? name : String(type);
}

/** From any node, go up through `parent` to the top. A loop or a very long chain stops the climb. */
export function findRoot(node: unknown): unknown {
    let current = node;
    for (let steps = 0; steps < 100; steps++) {
        const parent = read(current, "parent");
        if (!isObject(parent)) return current;
        current = parent;
    }
    return current;
}

/** Walk down through `layout` arrays. Only structure is kept. */
export function walkTree(root: unknown, enumObject: unknown, limits: ProbeLimits): TreeDump {
    const nodes: NodeInfo[] = [];
    const seen = new Set<unknown>();
    let truncated = false;

    const visit = (node: unknown, depth: number) => {
        if (!isObject(node) || seen.has(node)) return;
        if (nodes.length >= limits.maxNodes || depth > limits.maxDepth) {
            truncated = true;
            return;
        }
        seen.add(node);
        const layout = read(node, "layout");
        const children = Array.isArray(layout) ? layout : [];
        nodes.push({
            key: textOrNull(read(node, "key")),
            type: typeNameOf(enumObject, read(node, "type")),
            depth,
            children: children.length,
            parentKey: textOrNull(read(read(node, "parent"), "key")),
            hasUseTitle: isSet(read(node, "useTitle")),
            hasUseSubnavLabel: isSet(read(node, "useSubnavLabel")),
            hasRender: isSet(read(node, "render"))
        });
        for (const child of children) visit(child, depth + 1);
    };

    visit(root, 0);
    return { rootFound: isObject(root), nodeCount: nodes.length, truncated, nodes };
}

/** Find a node of the directory without knowing its layout: common property names first, then any map value. */
export function locateRoot(directory: unknown): unknown {
    for (const name of ["root", "rootNode", "layout"]) {
        const candidate = read(directory, name);
        if (isObject(candidate) && !Array.isArray(candidate)) return findRoot(candidate);
    }
    for (const name of ["entries", "nodes", "map", "directory", "index"]) {
        const collection = read(directory, name);
        let first: unknown;
        if (collection instanceof Map) first = collection.values().next().value;
        else if (isObject(collection)) first = Object.values(collection)[0];
        if (isObject(first)) return findRoot(read(first, "node") ?? first);
    }
    return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// The page: component names only

export interface FiberStep {
    name: string;
    source: string | null;
}

/** Name of a React element type: a function's name, or the wrapped function of memo and forwardRef. */
function typeName(type: unknown): { name: string; fn: unknown; } {
    if (typeof type === "function") return { name: String(read(type, "displayName") ?? read(type, "name") ?? "(anonymous)"), fn: type };
    if (typeof type === "string") return { name: type, fn: null };
    const inner = read(type, "type") ?? read(type, "render");
    if (typeof inner === "function") return { name: String(read(inner, "displayName") ?? read(inner, "name") ?? "(wrapped)"), fn: inner };
    return { name: "(other)", fn: null };
}

/**
 * From a DOM element, go up its React fiber chain. Only `type` is looked at: never props, state or text.
 * `source` is kept for the first function components only, enough to find them in Discord's code.
 */
export function fiberChain(element: unknown, limits: ProbeLimits, withSource = 8): FiberStep[] {
    const key = ownKeys(element).find(k => k.startsWith("__reactFiber$"));
    let fiber = key ? read(element, key) : undefined;
    const steps: FiberStep[] = [];
    let withSourceLeft = withSource;
    for (let i = 0; i < limits.maxFiberSteps && isObject(fiber); i++) {
        const { name, fn } = typeName(read(fiber, "type"));
        const isHostTag = fn === null;
        steps.push({
            name: redact(name),
            source: !isHostTag && withSourceLeft > 0 ? functionSource(fn, 1500) : null
        });
        if (!isHostTag && withSourceLeft > 0) withSourceLeft--;
        fiber = read(fiber, "return");
    }
    return steps;
}

export interface DocumentLike {
    querySelectorAll(selector: string): ArrayLike<unknown>;
}

function domDump(document: DocumentLike | undefined, limits: ProbeLimits) {
    if (!document) return { available: false };
    const items = Array.from(document.querySelectorAll("[data-settings-sidebar-item]"));
    const keys = items.slice(0, 60).map(item => {
        try {
            const getter = read(item, "getAttribute");
            return typeof getter === "function" ? textOrNull(getter.call(item, "data-settings-sidebar-item")) : null;
        } catch {
            return null;
        }
    });
    return { available: true, sidebarItemCount: items.length, sidebarItemKeys: keys, fiberChain: items.length ? fiberChain(items[0], limits) : [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Putting it together

export interface ProbeEnv {
    finders: { byProps<T = unknown>(...props: string[]): Finder<T>; };
    /** How long to wait for the navigation controller: Settings may not be loaded until the owner opens it. Default 10 minutes. */
    waitMs?: number;
    dump(name: string, text: string): void;
    document?: DocumentLike;
    /** Runs `work` after `ms` milliseconds (the page needs a moment to draw the settings after they open). */
    later(work: () => void, ms: number): void;
    limits?: ProbeLimits;
}

export const PROBE_DUMP_NAME = "settings-probe";

/**
 * Tiny files with the steps the probe has reached, so a silent probe can still be understood. Each step goes to its own file
 * (`settings-probe-step-1`, `-2`...): writing the same file again and again within milliseconds can fail on Windows.
 */
export const PROBE_PROGRESS_NAME = "settings-probe-step";

function controllerReport(controller: unknown) {
    return { propertyNames: ownKeys(controller), methodNames: methodNames(controller) };
}

function directoryReport(directory: unknown, limits: ProbeLimits) {
    const sources: Record<string, string | null> = {};
    for (const name of methodNames(directory).slice(0, 12)) sources[name] = functionSource(read(directory, name), limits.maxSourceChars);
    const constructor = read(directory, "constructor");
    return {
        ownKeys: ownKeys(directory),
        methodNames: methodNames(directory),
        constructorName: textOrNull(read(constructor, "name")),
        constructorSource: functionSource(constructor, limits.maxSourceChars),
        methodSources: sources
    };
}

/** Build the whole report for one moment. Never throws. */
export function buildReport(status: string, enumObject: unknown, controller: unknown, directory: unknown, document: DocumentLike | undefined, limits: ProbeLimits) {
    const enumValues: Record<string, unknown> = {};
    for (const name of ownKeys(enumObject)) if (typeof read(enumObject, name) === "number") enumValues[name] = read(enumObject, name);

    const root = directory === undefined ? undefined : locateRoot(directory);
    return {
        probe: "settings",
        version: 1,
        status,
        enumValues,
        controller: controller === undefined ? null : controllerReport(controller),
        directory: directory === undefined ? null : directoryReport(directory, limits),
        tree: walkTree(root, enumObject, limits),
        dom: domDump(document, limits)
    };
}

function write(env: ProbeEnv, report: unknown, limits: ProbeLimits): void {
    let text = JSON.stringify(report, null, 1);
    if (text.length > limits.maxDumpChars) text = JSON.stringify({ ...(report as Dictionary), tree: "too large, cut", dom: "too large, cut" });
    try {
        env.dump(PROBE_DUMP_NAME, text);
    } catch {
        // The probe must never disturb Discord.
    }
}

/**
 * Start the probe. It waits for the navigation controller, watches for Settings to open, writes one report, and puts
 * the controller back as it was. Returns a function that stops it early.
 */
export function startSettingsProbe(env: ProbeEnv): () => void {
    const limits = env.limits ?? DEFAULT_LIMITS;
    let stopped = false;
    let restore: (() => void) | null = null;
    let reports = 0;
    const trail: string[] = [];

    const mark = (step: string) => {
        trail.push(redact(step));
        try {
            env.dump(`${PROBE_PROGRESS_NAME}-${trail.length}`, JSON.stringify({ trail }));
        } catch {
            // The probe must never disturb Discord.
        }
    };

    const stop = () => {
        stopped = true;
        restore?.();
        restore = null;
    };

    const onOpened = (enumObject: unknown, controller: unknown, directory: unknown) => {
        // The window needs a moment to draw its sidebar; the report is written after that.
        mark("settings-opened");
        env.later(() => {
            if (stopped) return;
            try {
                const report = buildReport(directory === undefined ? "directory-not-found" : "ok", enumObject, controller, directory, env.document, limits);
                write(env, report, limits);
                reports++;
                mark(`report-written root=${report.tree.rootFound} nodes=${report.tree.nodeCount}`);
                // One good report is enough; an incomplete one is tried again the next time Settings opens (three times at most).
                if (report.tree.rootFound || reports >= 3) stop();
            } catch (error) {
                mark(`report-error ${error instanceof Error ? error.message : String(error)}`);
            }
        }, 1500);
    };

    mark("started");
    void (async () => {
        let enumObject: unknown;
        try {
            enumObject = await env.finders.byProps("ROOT", "SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM").ready(env.waitMs ?? 600_000);
        } catch {
            mark("enum-not-found");
            write(env, { probe: "settings", version: 1, status: "enum-not-found" }, limits);
            return;
        }
        mark("enum-found");

        let controller: Dictionary;
        try {
            controller = await env.finders.byProps<Dictionary>("navigate", "init", "maybeCreatePanelSnapshot").ready(env.waitMs ?? 600_000);
        } catch {
            mark("controller-not-found");
            write(env, { probe: "settings", version: 1, status: "controller-not-found", enumValues: Object.fromEntries(ownKeys(enumObject).filter(k => typeof read(enumObject, k) === "number").map(k => [k, read(enumObject, k)])) }, limits);
            return;
        }
        if (stopped) return;
        mark("controller-found");

        // Already open when the probe started?
        const already = read(controller, "accessibleDirectory");
        if (isObject(already)) onOpened(enumObject, controller, already);

        const original = read(controller, "init");
        if (typeof original !== "function") {
            mark("init-is-not-a-function");
            return;
        }
        try {
            const hadOwn = Object.prototype.hasOwnProperty.call(controller, "init");
            controller.init = function (this: unknown, ...args: unknown[]) {
                const result = Reflect.apply(original, this, args);
                mark("init-called");
                try {
                    const given = read(args[0], "accessibleDirectory");
                    onOpened(enumObject, controller, isObject(given) ? given : read(controller, "accessibleDirectory"));
                } catch {
                    // Observing must never break Discord.
                }
                return result;
            };
            // Put it back exactly as it was: a method of the class stays a method of the class.
            restore = () => {
                if (hadOwn) controller.init = original;
                else delete controller.init;
            };
            mark("init-wrapped");
        } catch {
            // A frozen object cannot be wrapped; the report written above (if any) is all we get.
            mark("init-could-not-be-wrapped");
        }
    })();

    return stop;
}
