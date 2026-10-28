/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_LIMITS, fiberChain, findRoot, functionSource, locateRoot, methodNames, PROBE_DUMP_NAME, PROBE_PROGRESS_NAME, startSettingsProbe, walkTree } from "../src/renderer/probes/settingsProbe";
import { FinderEngine, ModuleView } from "../src/webpack/finders";

// ---------------------------------------------------------------------------------------------------------------------
// A small imitation of what the probe will meet in Discord

const LayoutType: Record<string | number, string | number> = {
    0: "ROOT", 1: "SECTION", 2: "SIDEBAR_ITEM", 3: "PANEL", 5: "CATEGORY", 19: "CUSTOM",
    ROOT: 0, SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19
};

interface FakeNode { type: number; key: string; layout?: FakeNode[]; parent?: FakeNode; useTitle?: () => string; render?: () => void; }

function node(type: number, key: string, children: FakeNode[] = [], extra: Partial<FakeNode> = {}): FakeNode {
    const n: FakeNode = { type, key, layout: children, ...extra };
    for (const child of children) child.parent = n;
    return n;
}

function makeTree() {
    const custom = node(19, "account_custom", [], { render: () => undefined });
    const category = node(5, "account_category", [custom]);
    const panel = node(3, "account_panel", [category], { useTitle: () => "title" });
    const item = node(2, "account_sidebar_item", [panel], { useTitle: () => "title" });
    const section = node(1, "user_section", [item]);
    return { root: node(0, "root", [section]), custom, category, panel, item, section };
}

class Directory {
    secretToken = "";
    constructor(public root: FakeNode) { }
    entry(key: string) { return { key, node: this.root }; }
    getPanelOrThrow(key: string) { return { key }; }
}

class Controller {
    accessibleDirectory: Directory | null = null;
    initCalls = 0;
    init(props: { accessibleDirectory: Directory; secret?: string; }) { this.initCalls++; this.accessibleDirectory = props.accessibleDirectory; return "initialised"; }
    navigate() { return undefined; }
    maybeCreatePanelSnapshot() { return undefined; }
}

class FakeView implements ModuleView {
    modules = new Map<string, unknown>();
    ids() { return [...this.modules.keys()]; }
    exportsOf(id: string) { return this.modules.get(id); }
    sourceOf(id: string) { return this.modules.has(id) ? `source of ${id}` : undefined; }
}

function setup(options: { withEnum?: boolean; withController?: boolean; waitMs?: number; document?: { querySelectorAll(selector: string): unknown[]; }; } = {}) {
    const view = new FakeView();
    const controller = new Controller();
    if (options.withEnum !== false) view.modules.set("963935", { Z6: LayoutType });
    if (options.withController !== false) view.modules.set("272053", { A: controller });
    const engine = new FinderEngine({ view, timeoutMs: 20 });
    // `dumps` holds the reports only; the small progress file is kept apart.
    const dumps: Array<{ name: string; text: string; }> = [];
    const progress: string[][] = [];
    const queue: Array<() => void> = [];
    const stop = startSettingsProbe({
        finders: engine.forPlugin("probe"),
        dump: (name, text) => {
            if (name.startsWith(PROBE_PROGRESS_NAME)) progress.push((JSON.parse(text) as { trail: string[]; }).trail);
            else dumps.push({ name, text });
        },
        document: options.document,
        later: work => { queue.push(work); },
        waitMs: options.waitMs ?? 20
    });
    const flush = () => { queue.splice(0).forEach(work => work()); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test reads a JSON report of a shape it does not declare
    const reports = () => dumps.map(d => JSON.parse(d.text) as Record<string, any>);
    const tick = () => new Promise(resolve => setTimeout(resolve, 5));
    const trail = () => progress.at(-1) ?? [];
    return { view, controller, engine, dumps, queue, stop, flush, reports, tick, trail };
}

// ---------------------------------------------------------------------------------------------------------------------

describe("walkTree and findRoot", () => {
    it("lists every node with its key, type name, children and which hooks it has, and nothing else", () => {
        const { root } = makeTree();
        const dump = walkTree(root, LayoutType, DEFAULT_LIMITS);
        assert.equal(dump.rootFound, true);
        assert.equal(dump.nodeCount, 6);
        assert.equal(dump.truncated, false);
        assert.deepEqual(dump.nodes.map(n => [n.key, n.type, n.depth, n.children]), [
            ["root", "ROOT", 0, 1], ["user_section", "SECTION", 1, 1], ["account_sidebar_item", "SIDEBAR_ITEM", 2, 1],
            ["account_panel", "PANEL", 3, 1], ["account_category", "CATEGORY", 4, 1], ["account_custom", "CUSTOM", 5, 0]
        ]);
        const panel = dump.nodes.find(n => n.key === "account_panel")!;
        assert.equal(panel.hasUseTitle, true);
        assert.equal(panel.parentKey, "account_sidebar_item");
        assert.equal(dump.nodes.find(n => n.key === "account_custom")!.hasRender, true);
        assert.deepEqual(Object.keys(panel).sort(), ["children", "depth", "hasRender", "hasUseSubnavLabel", "hasUseTitle", "key", "parentKey", "type"]);
    });

    it("stops at the node limit and the depth limit and says so, and survives a loop", () => {
        const { root } = makeTree();
        assert.equal(walkTree(root, LayoutType, { ...DEFAULT_LIMITS, maxNodes: 3 }).nodeCount, 3);
        assert.equal(walkTree(root, LayoutType, { ...DEFAULT_LIMITS, maxNodes: 3 }).truncated, true);
        const shallow = walkTree(root, LayoutType, { ...DEFAULT_LIMITS, maxDepth: 2 });
        assert.equal(shallow.nodeCount, 3);
        assert.equal(shallow.truncated, true);

        const a = node(0, "a");
        const b = node(1, "b", [a]);
        a.layout = [b];
        assert.equal(walkTree(a, LayoutType, DEFAULT_LIMITS).nodeCount, 2);
    });

    it("does not break on getters that throw or things that are not nodes", () => {
        const hostile = { get layout(): never { throw new Error("no"); }, get key(): never { throw new Error("no"); }, type: 2 };
        assert.equal(walkTree(hostile, LayoutType, DEFAULT_LIMITS).nodeCount, 1);
        assert.deepEqual(walkTree(undefined, LayoutType, DEFAULT_LIMITS), { rootFound: false, nodeCount: 0, truncated: false, nodes: [] });
        assert.equal(walkTree({ type: 99, key: "x" }, undefined, DEFAULT_LIMITS).nodes[0].type, "99");
    });

    it("climbs from a leaf to the root and stops on a parent loop", () => {
        const { root, custom } = makeTree();
        assert.equal(findRoot(custom), root);
        const a: { parent?: unknown; } = {};
        const b = { parent: a };
        a.parent = b;
        assert.ok(findRoot(a));
    });
});

describe("locateRoot", () => {
    it("finds the root through a property, or through any value of a map of entries", () => {
        const { root, custom } = makeTree();
        assert.equal(locateRoot({ root }), root);
        assert.equal(locateRoot({ rootNode: custom }), root);
        assert.equal(locateRoot({ entries: new Map([["k", { node: custom }]]) }), root);
        assert.equal(locateRoot({ nodes: { k: custom } }), root);
    });

    it("gives undefined when nothing looks like a node", () => {
        assert.equal(locateRoot({}), undefined);
        assert.equal(locateRoot(undefined), undefined);
        assert.equal(locateRoot({ entries: new Map() }), undefined);
    });
});

describe("source text and method names", () => {
    it("cuts long functions, redacts ids and e-mail addresses, and refuses non-functions", () => {
        const text = functionSource(function sample() { return "123456789012345678 someone@example.com"; }, 4096)!;
        assert.match(text, /<id>/);
        assert.match(text, /<email>/);
        assert.doesNotMatch(text, /123456789012345678|someone@example/);
        // eslint-disable-next-line no-new-func -- a function whose own source text is long
        assert.equal(functionSource(new Function(`return "${"x".repeat(500)}";`), 50)!.endsWith("…"), true);
        assert.equal(functionSource("text", 100), null);
        assert.equal(functionSource(undefined, 100), null);
    });

    it("lists the methods of a class instance without the constructor or Object's own", () => {
        assert.deepEqual(methodNames(new Directory(makeTree().root)), ["entry", "getPanelOrThrow"]);
        assert.deepEqual(methodNames({}), []);
        assert.deepEqual(methodNames(null), []);
    });
});

describe("fiberChain", () => {
    function fakeElement(touched: string[]) {
        function Sidebar() { return "sidebar"; }
        const Memo = { $$typeof: Symbol.for("react.memo"), type: function Wrapped() { return 1; } };
        const spy = (name: string) => ({ get(): never { touched.push(name); throw new Error(`${name} must not be read`); } });
        const host = { type: "div" };
        const makeFiber = (type: unknown, next?: unknown) => {
            const fiber: Record<string, unknown> = { type, return: next };
            for (const name of ["memoizedProps", "memoizedState", "pendingProps", "stateNode"]) Object.defineProperty(fiber, name, spy(name));
            return fiber;
        };
        const top = makeFiber("div");
        const chain = makeFiber(Sidebar, makeFiber(Memo, makeFiber(host.type, top)));
        return { "__reactFiber$abc": chain, getAttribute: () => "x" };
    }

    it("lists component names from the element upwards and never touches props, state or nodes", () => {
        const touched: string[] = [];
        const steps = fiberChain(fakeElement(touched), DEFAULT_LIMITS);
        assert.deepEqual(steps.map(s => s.name), ["Sidebar", "Wrapped", "div", "div"]);
        assert.match(steps[0].source ?? "", /sidebar/);
        assert.equal(steps[2].source, null);
        assert.deepEqual(touched, []);
    });

    it("gives nothing for an element without a fiber, and stops at the step limit", () => {
        assert.deepEqual(fiberChain({}, DEFAULT_LIMITS), []);
        assert.equal(fiberChain(fakeElement([]), { ...DEFAULT_LIMITS, maxFiberSteps: 2 }).length, 2);
    });
});

describe("the live probe", () => {
    it("waits for Settings to open, writes one report with the structure and the source of the directory, and puts init back", async () => {
        const t = setup();
        await t.tick();
        const originalInit = Controller.prototype.init;
        assert.notEqual(t.controller.init, originalInit, "init is wrapped while waiting");

        const directory = new Directory(makeTree().root);
        const result = t.controller.init({ accessibleDirectory: directory });
        assert.equal(result, "initialised", "Discord still gets its own result");
        assert.equal(t.controller.initCalls, 1);
        assert.equal(t.dumps.length, 0, "nothing is written until the window had time to draw");

        t.flush();
        assert.equal(t.dumps.length, 1);
        assert.equal(t.dumps[0].name, PROBE_DUMP_NAME);
        const report = t.reports()[0];
        assert.equal(report.status, "ok");
        assert.equal(report.enumValues.SIDEBAR_ITEM, 2);
        assert.equal(report.tree.nodeCount, 6);
        assert.equal(report.directory.constructorName, "Directory");
        assert.match(report.directory.constructorSource, /Directory/);
        assert.deepEqual(report.directory.methodNames, ["entry", "getPanelOrThrow"]);
        assert.ok(report.controller.methodNames.includes("navigate"));
        assert.equal(report.dom.available, false);
        // Back as Discord had it: the prototype method, not a wrapper.
        assert.equal(Object.prototype.hasOwnProperty.call(t.controller, "init"), false);
    });

    it("lists key names of the directory but never values, and nothing from the props it was given", async () => {
        const t = setup();
        await t.tick();
        let touched = false;
        const directory = new Directory(makeTree().root);
        directory.secretToken = "SECRETVALUE-do-not-dump";
        const props = { accessibleDirectory: directory, get secret() { touched = true; return "SECRET-PROP"; } };
        t.controller.init(props);
        t.flush();
        const text = t.dumps[0].text;
        assert.match(text, /secretToken/, "the key name is listed");
        assert.doesNotMatch(text, /SECRETVALUE|SECRET-PROP/);
        assert.equal(touched, false);
    });

    it("redacts what it writes", async () => {
        const t = setup();
        await t.tick();
        const tree = makeTree();
        tree.section.key = "user 123456789012345678 me@example.com";
        t.controller.init({ accessibleDirectory: new Directory(tree.root) });
        t.flush();
        assert.doesNotMatch(t.dumps[0].text, /123456789012345678|me@example/);
        assert.match(t.dumps[0].text, /<id>/);
    });

    it("reports at once when Settings was already open when the probe started", async () => {
        const t = setup();
        t.controller.accessibleDirectory = new Directory(makeTree().root);
        await t.tick();
        t.flush();
        assert.equal(t.reports()[0].tree.nodeCount, 6);
    });

    it("tries again the next time Settings opens when the root was not found, at most three times", async () => {
        const t = setup();
        await t.tick();
        for (let i = 0; i < 5; i++) {
            t.controller.init({ accessibleDirectory: {} as unknown as Directory });
            t.flush();
        }
        assert.equal(t.dumps.length, 3);
        assert.equal(t.reports()[0].tree.rootFound, false);
        assert.equal(t.reports()[0].status, "ok");
    });

    it("writes the DOM part: sidebar item keys and component names only", async () => {
        const element = { "__reactFiber$x": { type: function Item() { return 1; }, return: undefined }, getAttribute: () => "account_sidebar_item" };
        const t = setup({ document: { querySelectorAll: () => [element, element] } });
        await t.tick();
        t.controller.init({ accessibleDirectory: new Directory(makeTree().root) });
        t.flush();
        const dom = t.reports()[0].dom;
        assert.equal(dom.sidebarItemCount, 2);
        assert.deepEqual(dom.sidebarItemKeys, ["account_sidebar_item", "account_sidebar_item"]);
        assert.deepEqual(dom.fiberChain.map((s: { name: string; }) => s.name), ["Item"]);
    });

    it("says so when it cannot find the node types or the controller", async () => {
        const noEnum = setup({ withEnum: false });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(noEnum.reports()[0].status, "enum-not-found");

        const noController = setup({ withController: false });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(noController.reports()[0].status, "controller-not-found");
        assert.equal(noController.reports()[0].enumValues.CUSTOM, 19);
    });

    it("stops on request: init is put back and nothing is written afterwards", async () => {
        const t = setup();
        await t.tick();
        t.controller.init({ accessibleDirectory: new Directory(makeTree().root) });
        t.stop();
        t.flush();
        assert.equal(t.dumps.length, 0);
        assert.equal(Object.prototype.hasOwnProperty.call(t.controller, "init"), false);
    });

    it("never lets a failing dump disturb Discord", async () => {
        const view = new FakeView();
        const controller = new Controller();
        view.modules.set("1", { Z6: LayoutType });
        view.modules.set("2", { A: controller });
        const queue: Array<() => void> = [];
        startSettingsProbe({
            finders: new FinderEngine({ view, timeoutMs: 20 }).forPlugin("p"),
            dump: () => { throw new Error("disk full"); },
            later: work => { queue.push(work); }
        });
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.doesNotThrow(() => { controller.init({ accessibleDirectory: new Directory(makeTree().root) }); queue.splice(0).forEach(w => w()); });
    });
});

describe("the progress trail", () => {
    it("records each step reached, in order, in a small separate file", async () => {
        const t = setup();
        await t.tick();
        t.controller.init({ accessibleDirectory: new Directory(makeTree().root) });
        t.flush();
        assert.deepEqual(t.trail(), [
            "started", "enum-found", "controller-found", "init-wrapped", "init-called", "settings-opened", "report-written root=true nodes=6"
        ]);
    });

    it("says where it stopped when something is missing", async () => {
        const noEnum = setup({ withEnum: false });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.deepEqual(noEnum.trail(), ["started", "enum-not-found"]);

        const noController = setup({ withController: false });
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.deepEqual(noController.trail(), ["started", "enum-found", "controller-not-found"]);
    });

    it("says it saw the settings already open, and that a failing report is recorded instead of thrown", async () => {
        const t = setup();
        t.controller.accessibleDirectory = new Directory(makeTree().root);
        await t.tick();
        assert.ok(t.trail().includes("settings-opened"));
        // A document whose lookup throws makes the report fail; the error must end up in the trail.
        const broken = setup({ document: { querySelectorAll: () => { throw new Error("dom exploded"); } } });
        await broken.tick();
        broken.controller.init({ accessibleDirectory: new Directory(makeTree().root) });
        assert.doesNotThrow(() => broken.flush());
        assert.ok(broken.trail().some(step => step.startsWith("report-error dom exploded")), broken.trail().join(" | "));
    });
});
