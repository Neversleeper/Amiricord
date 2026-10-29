/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import type { PluginCard } from "../src/api/pluginCards";
import { makeErrorBoundary } from "../src/plugins/Settings/ErrorBoundary";
import { defaultButtonGroups, defaultChoices, defaultQuickActions, defaultSettings } from "../src/plugins/Settings/mainItems";
import { MainTabDeps, makeMainTab } from "../src/plugins/Settings/MainTab";
import type { EngineStatus } from "../src/renderer/engine";

// --- A tiny stand-in for React: elements are plain objects, and `render` expands function components the way React would. -----------------

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

/** useState gives the next value from `initial` (in the order components ask), and records every call of the setter. */
function fakeReact(initial: unknown[] = [], calls: unknown[] = []) {
    const queue = [...initial];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, (value: unknown) => { calls.push(value); }]) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    return { react, calls };
}

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

/** Expand every function component into what it returns, so the tree holds only plain elements and text. */
function render(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(render);
    if (!isEl(node)) return node;
    if (typeof node.type === "function") {
        const children = node.children.length <= 1 ? node.children[0] : node.children;
        return render((node.type as (props: unknown) => unknown)({ ...node.props, ...(children === undefined ? {} : { children }) }));
    }
    return { ...node, children: node.children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined).map(render) };
}

function findAll(node: unknown, test: (el: El) => boolean, found: El[] = []): El[] {
    if (!isEl(node)) return found;
    if (test(node)) found.push(node);
    for (const child of node.children) findAll(child, test, found);
    return found;
}

function textOf(node: unknown): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!isEl(node)) return "";
    return node.children.map(textOf).join("");
}

const hasClass = (el: El, name: string) => typeof el.props.className === "string" && el.props.className.split(" ").includes(name);

afterEach(() => { setReactSource(undefined); });

// --- The error boundary ----------------------------------------------------------------------------------------------------------------

describe("the error boundary of the settings tabs", () => {
    type Boundary = new (props: { label: string; children?: unknown; }) => { state: { failed: boolean; message: string; }; props: { label: string; children?: unknown; }; render(): unknown; componentDidCatch(error: unknown): void; setState(s: unknown): void; };
    const make = (react: ReactLike, report: (label: string, error: unknown) => void = () => undefined) => makeErrorBoundary(react, report) as unknown as Boundary & { getDerivedStateFromError(error: unknown): { failed: boolean; message: string; }; };

    it("draws what it was given while nothing has failed", () => {
        const { react } = fakeReact();
        setReactSource(() => react);
        const Boundary = make(react);
        const child = { type: "div", props: {}, children: [] };
        const instance = new Boundary({ label: "The tab", children: child });
        assert.deepEqual(instance.state, { failed: false, message: "" });
        assert.equal(instance.render(), child);
    });

    it("turns an error into a state with a short message, and shows a message and a Try again button instead of the tab", () => {
        const { react } = fakeReact();
        setReactSource(() => react);
        const Boundary = make(react);
        assert.deepEqual(Boundary.getDerivedStateFromError(new Error("it broke")), { failed: true, message: "it broke" });
        assert.equal(Boundary.getDerivedStateFromError("plain text").message, "plain text");
        assert.equal(Boundary.getDerivedStateFromError(new Error("x".repeat(1000))).message.length, 300);

        const instance = new Boundary({ label: "The tab", children: "never drawn" });
        instance.state = { failed: true, message: "it broke" };
        const tree = render(instance.render()) as El;
        assert.equal(tree.props.role, "alert");
        assert.match(textOf(tree), /The tab could not be drawn/);
        assert.match(textOf(tree), /it broke/);
        assert.ok(!textOf(tree).includes("never drawn"));
        const [button] = findAll(tree, el => el.type === "button");
        assert.equal(textOf(button), "Try again");
        let received: unknown;
        instance.setState = state => { received = state; };
        (button.props.onClick as () => void)();
        assert.deepEqual(received, { failed: false, message: "" });
    });

    it("reports the error with the label of what failed, and a report that throws does not make it worse", () => {
        const { react } = fakeReact();
        const seen: Array<[string, unknown]> = [];
        const Boundary = make(react, (label, error) => { seen.push([label, error]); });
        const failure = new Error("boom");
        new Boundary({ label: "The tab" }).componentDidCatch(failure);
        assert.deepEqual(seen, [["The tab", failure]]);
        const Hostile = make(react, () => { throw new Error("report failed"); });
        assert.doesNotThrow(() => new Hostile({ label: "x" }).componentDidCatch(new Error("a")));
    });

    it("draws the tab as it is, and does not fail, when React has no base class to extend", () => {
        const { react } = fakeReact();
        const plain = makeErrorBoundary({ ...react, Component: undefined }, () => undefined);
        assert.equal(plain({ label: "x", children: "kept" }), "kept");
    });
});

// --- The main tab ----------------------------------------------------------------------------------------------------------------------

const status = (extra: Partial<EngineStatus> = {}): EngineStatus => ({
    version: "0.1.0", discordBuild: 650101, safeMode: false, safeModeReason: null, enteredSafeMode: false, quarantine: [], devMode: false, problems: [], selfTests: [], stopped: { analytics: 0, metrics: 0, "crash-reports": 0 }, stoppedAt: { analytics: null, metrics: null, "crash-reports": null }, network: { "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 }, dns: "", ...extra
});

const card = (id: string, state: Partial<PluginCard["state"]> = {}, core = false): PluginCard => ({
    id, name: `Name of ${id}`, version: "1.0.0", description: "", origin: "amiricord", license: "GPL-3.0-or-later", authors: [], credits: [], tags: [], dependencies: [],
    core, experimental: false, legacy: false, replacedBy: null, requiresRestart: "auto", restartToToggle: false, hasSettings: false, riskySettings: [], risk: { level: "low", label: null, reasons: [] },
    hosts: [], telemetryHosts: [], compatibility: "ok",
    state: { chosen: undefined, wanted: true, running: false, lifecycle: undefined, error: null, reason: undefined, neededBy: [], skipped: undefined, restartNeeded: false, ...state }
});

function mainTab(extra: Partial<MainTabDeps> = {}, hooks: { initial?: unknown[]; } = {}) {
    const fake = fakeReact(hooks.initial);
    setReactSource(() => fake.react);
    const log: string[] = [];
    const deps: MainTabDeps = {
        status: () => status(), leaveSafeMode: () => { log.push("leave-safe-mode"); }, cards: () => [],
        quickActions: defaultQuickActions({
            openDataFolder: () => { log.push("folder"); }, openHealthReport: () => { log.push("health"); }, openSourceCode: () => { log.push("source"); }, restart: () => { log.push("restart"); }
        }),
        settings: defaultSettings(), choices: defaultChoices(), buttonGroups: defaultButtonGroups(),
        logo: "data:image/webp;base64,AAAA", editor: () => ({ type: "div", props: { className: "editor-stub" }, children: [] }), ...extra
    };
    const tree = render(makeMainTab(deps)()) as El;
    return { tree, log, calls: fake.calls };
}

describe("the main tab", () => {
    const rowValue = (tree: El, name: string) => {
        const row = findAll(tree, el => hasClass(el, "amiricord-row")).find(el => textOf(findAll(el, c => hasClass(c, "amiricord-row-name"))[0]) === name);
        assert.ok(row, `a row called ${name}`);
        return textOf(findAll(row, el => hasClass(el, "amiricord-row-value"))[0]);
    };

    it("starts with the Settings tabs card, then a banner with the logo and the state of the engine, and no tall card of text", () => {
        const { tree } = mainTab();
        const [tab] = findAll(tree, el => hasClass(el, "amiricord-tab"));
        const [first, second] = tab.children as El[];
        assert.ok(hasClass(first, "editor-stub"), "the editor card is first");
        assert.ok(hasClass(second, "amiricord-banner"), "the banner is second");
        assert.equal(findAll(second, el => el.type === "img").length, 1, "only the logo without a banner picture");
        assert.equal(textOf(second), "Engine runningDiscord build 650101");
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-hero") || hasClass(el, "amiricord-pill")).length, 0);
    });

    it("draws the banner picture behind the logo when it is given, and says when the engine needs attention", () => {
        const withArt = mainTab({ banner: "data:image/webp;base64,BBBB" });
        const [banner] = findAll(withArt.tree, el => hasClass(el, "amiricord-banner"));
        const images = findAll(banner, el => el.type === "img");
        assert.equal(images.length, 2);
        assert.ok(hasClass(images[0], "amiricord-banner-art"), "the picture comes first, so the logo is drawn over it");
        assert.equal(images[0].props["aria-hidden"], "true");

        const safe = mainTab({ status: () => status({ safeMode: true }) });
        assert.match(textOf(findAll(safe.tree, el => hasClass(el, "amiricord-banner"))[0]), /^Safe mode/);
        const problem = mainTab({ status: () => status({ problems: ["x"] }) });
        assert.match(textOf(findAll(problem.tree, el => hasClass(el, "amiricord-banner"))[0]), /^Needs attention/);
        const unknown = mainTab({ status: () => status({ discordBuild: null }) });
        assert.equal(textOf(findAll(unknown.tree, el => hasClass(el, "amiricord-banner"))[0]), "Engine running");
    });

    it("shows the version, the Discord build and the plugin count in the engine status rows", () => {
        const { tree } = mainTab({ cards: () => [card("A", { running: true }), card("B", { running: true }), card("C")] });
        assert.equal(rowValue(tree, "Version"), "Amiricord 0.1.0");
        assert.equal(rowValue(tree, "Discord build"), "650101");
        assert.match(rowValue(tree, "Plugins"), /2 of 3 plugins on/);
        assert.equal(rowValue(tree, "Safe mode"), "Off");
    });

    it("does not count the core plugin that draws the page as an installed plugin that is on", () => {
        const only = mainTab({ cards: () => [card("Settings", { running: true }, true)] });
        assert.equal(rowValue(only.tree, "Plugins"), "1 core plugin, no plugins installed yet");

        const mixed = mainTab({ cards: () => [card("Settings", { running: true }, true), card("A", { running: true }), card("B")] });
        assert.equal(rowValue(mixed.tree, "Plugins"), "1 core plugin, 1 of 2 plugins on");

        const two = mainTab({ cards: () => [card("S1", {}, true), card("S2", {}, true)] });
        assert.match(rowValue(two.tree, "Plugins"), /^2 core plugins/);
    });

    it("has the banner and the quick actions in cards and the status in rows like TestCord's main tab", () => {
        const { tree } = mainTab();
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-card")).length, 2, "the banner and the card of the quick actions");
        assert.equal(findAll(tree, el => el.type === "hr").length, 2, "a divider before the settings and another before the status");
        assert.deepEqual(findAll(tree, el => hasClass(el, "amiricord-heading")).map(textOf), ["Shortcuts", "Window and behavior", "Notifications", "Engine status"]);
    });

    it("says when the build is unknown, and shows safe mode, quarantine and developer mode in their rows", () => {
        const { tree } = mainTab({ status: () => status({ discordBuild: null, safeMode: true, safeModeReason: "two failed starts", quarantine: ["A", "B"], devMode: true }) });
        assert.equal(rowValue(tree, "Discord build"), "Unknown");
        assert.equal(rowValue(tree, "Safe mode"), "On: two failed starts");
        assert.equal(rowValue(tree, "Quarantined plugins"), "A, B");
        assert.equal(rowValue(tree, "Developer mode"), "On");
    });

    it("draws the logo, and a letter instead when the image fails to load", () => {
        const ok = mainTab();
        const [img] = findAll(ok.tree, el => el.type === "img");
        assert.equal(img.props.src, "data:image/webp;base64,AAAA");
        (img.props.onError as () => void)();
        assert.deepEqual(ok.calls, [true]);

        const failed = mainTab({}, { initial: [true] });
        assert.equal(findAll(failed.tree, el => el.type === "img").length, 0);
        assert.equal(textOf(findAll(failed.tree, el => hasClass(el, "amiricord-logo-fallback"))[0]), "A");
        assert.equal(findAll(mainTab({ logo: "" }).tree, el => hasClass(el, "amiricord-logo-fallback")).length, 1);
    });

    it("has the six tiles in the order of TestCord's grid; the four that work are live and the rest look the same, do nothing and name why on hover", () => {
        const t = mainTab();
        const [actions] = findAll(t.tree, el => hasClass(el, "amiricord-actions"));
        const tiles = findAll(actions, el => el.type === "button");
        assert.deepEqual(tiles.map(textOf), ["Notification Log", "Edit Custom CSS", "Relaunch Discord", "Open Settings Folder", "Health Report", "View Source Code"]);
        const soon = tiles.filter(tile => hasClass(tile, "amiricord-soon"));
        assert.deepEqual(soon.map(textOf), ["Notification Log", "Edit Custom CSS"]);
        for (const tile of soon) {
            assert.equal(tile.props["aria-disabled"], "true");
            assert.equal(tile.props["data-soon"], "Coming soon");
            assert.equal(tile.props.onClick, undefined, `${textOf(tile)} does nothing`);
        }
        const open = tiles.find(tile => textOf(tile) === "Open Settings Folder")!;
        assert.equal(hasClass(open, "amiricord-soon"), false);
        (open.props.onClick as () => void)();
        assert.deepEqual(t.log, ["folder"]);
        for (const name of ["Health Report", "View Source Code"]) {
            const tile = tiles.find(candidate => textOf(candidate) === name)!;
            assert.equal(hasClass(tile, "amiricord-soon"), false, name);
            (tile.props.onClick as () => void)();
        }
        assert.deepEqual(t.log, ["folder", "health", "source"]);
    });

    it("lists the window and behavior settings: seven switches, all off and marked, with a note that says they are not built yet; telemetry is not here, it belongs to Privacy & Security", () => {
        const { tree } = mainTab();
        const rows = findAll(tree, el => hasClass(el, "amiricord-switch-row"));
        assert.deepEqual(rows.map(row => textOf(findAll(row, el => hasClass(el, "amiricord-switch-title"))[0]).replace(/Coming soon|Restart/g, "")), [
            "Show the Amiricord logo", "Custom CSS", "Windows title bar",
            "Transparent window", "Remove minimum window size", "Ctrl+Q to quit", "React Developer Tools"
        ]);
        for (const row of rows) {
            const [toggle] = findAll(row, el => el.props.role === "switch");
            assert.equal(toggle.props["aria-checked"], "false");
            assert.equal(toggle.props["aria-disabled"], "true");
            assert.ok(textOf(row).includes("Coming soon"));
            assert.equal(toggle.props.onClick, undefined);
        }
        assert.equal(rows.filter(row => textOf(row).includes("Restart")).length, 5, "the five window options say they need a restart");
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-warning")).length, 1, "only transparency carries a warning");
        assert.match(textOf(findAll(tree, el => hasClass(el, "amiricord-notice"))[0]), /not built yet/);
    });

    it("has the window background drop-down and the Notifications buttons after the switches", () => {
        const { tree } = mainTab();
        const [choice] = findAll(tree, el => hasClass(el, "amiricord-choice"));
        assert.match(textOf(choice), /Window background effect/);
        assert.match(textOf(choice), /Coming soon/);
        const [select] = findAll(choice, el => el.props.role === "combobox");
        assert.equal(textOf(select), "None");
        assert.equal(select.props["aria-disabled"], "true");
        const [group] = findAll(tree, el => hasClass(el, "amiricord-group"));
        assert.match(textOf(group), /Discord's own message notifications are not affected/);
        const buttons = findAll(group, el => el.type === "button");
        assert.deepEqual(buttons.map(textOf), ["Notification options", "Open the log"]);
        assert.ok(buttons.every(button => button.props["aria-disabled"] === "true" && button.props.onClick === undefined));
    });

    it("turns an entry live when its feature exists: no tag, an active switch, a working tile and a working button", () => {
        const log: string[] = [];
        const { tree } = mainTab({
            quickActions: [{ id: "x", title: "Do X", Icon: () => null, run: () => { log.push("x"); } }],
            settings: [{ id: "s", title: "Setting S", description: "d" }],
            choices: [{ id: "c", title: "Choice C", description: "d", choices: ["A", "B"] }],
            buttonGroups: [{ id: "g", title: "Group G", description: "d", buttons: [{ id: "b", title: "Button B", run: () => { log.push("b"); } }] }]
        });
        const tile = findAll(tree, el => el.type === "button" && textOf(el) === "Do X")[0];
        (tile.props.onClick as () => void)();
        const button = findAll(tree, el => el.type === "button" && textOf(el) === "Button B")[0];
        (button.props.onClick as () => void)();
        assert.deepEqual(log, ["x", "b"]);
        const row = findAll(tree, el => hasClass(el, "amiricord-switch-row"))[0];
        assert.ok(!textOf(row).includes("Coming soon"));
        assert.equal(findAll(row, el => el.props.role === "switch")[0].props["aria-disabled"], "false");
        assert.ok(!textOf(findAll(tree, el => hasClass(el, "amiricord-choice"))[0]).includes("Coming soon"));
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-soon")).length, 0);
    });

    it("never relaunches at the first click: it asks, and only the confirmation relaunches", () => {
        const first = mainTab();
        const relaunch = findAll(first.tree, el => el.type === "button" && textOf(el) === "Relaunch Discord")[0];
        (relaunch.props.onClick as () => void)();
        assert.deepEqual(first.log, [], "the first click does not relaunch");
        assert.deepEqual(first.calls, [true], "it only opens the question");

        const asking = mainTab({}, { initial: [false, true] });
        const [confirm] = findAll(asking.tree, el => hasClass(el, "amiricord-confirm"));
        assert.match(textOf(confirm), /closes any call and loses messages you have not sent/);
        assert.equal(findAll(asking.tree, el => el.type === "button" && textOf(el) === "Relaunch Discord").length, 0);
        const now = findAll(confirm, el => el.type === "button" && textOf(el) === "Relaunch now")[0];
        (now.props.onClick as () => void)();
        assert.deepEqual(asking.log, ["restart"]);
        const cancel = findAll(confirm, el => el.type === "button" && textOf(el) === "Cancel")[0];
        (cancel.props.onClick as () => void)();
        assert.deepEqual(asking.calls, [false]);
        assert.deepEqual(asking.log, ["restart"], "cancel does not relaunch");
    });

    it("lists the engine status as plain rows, with Off and None when there is nothing to say", () => {
        const { tree } = mainTab();
        const rows = findAll(tree, el => hasClass(el, "amiricord-row")).map(textOf);
        assert.deepEqual(rows, [
            "VersionAmiricord 0.1.0", "Discord build650101", "Plugins0 core plugins, no plugins installed yet",
            "Safe modeOff", "Privacy checkRunning", "Stopped inside DiscordNothing yet", "Cancelled on the networkNothing yet", "Encrypted DNSNot known yet", "Token kept safeNothing needed", "Quarantined pluginsNone", "Waiting for a restartNo plugin", "Developer modeOff", "ProblemsNone"
        ]);
    });

    it("says what was stopped inside Discord, in plain words, and 'Nothing yet' when nothing was", () => {
        const row = (stopped: EngineStatus["stopped"]) => rowValue(mainTab({ status: () => status({ stopped }) }).tree, "Stopped inside Discord");
        assert.equal(row({ analytics: 0, metrics: 0, "crash-reports": 0 }), "Nothing yet");
        assert.equal(row({ analytics: 1, metrics: 0, "crash-reports": 0 }), "1 usage event");
        assert.equal(row({ analytics: 12, metrics: 3, "crash-reports": 0 }), "12 usage events, 3 metrics");
        assert.equal(row({ analytics: 0, metrics: 1, "crash-reports": 1 }), "1 metric, 1 crash report hook");
    });

    it("says what the network firewall cancelled, in plain words, and 'Nothing yet' when nothing was", () => {
        const row = (network: EngineStatus["network"]) => rowValue(mainTab({ status: () => status({ network }) }).tree, "Cancelled on the network");
        assert.equal(row({ "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 }), "Nothing yet");
        assert.equal(row({ "usage-reports": 1, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 }), "1 usage report");
        assert.equal(row({ "usage-reports": 12, metrics: 3, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 }), "12 usage reports, 3 metrics reports");
        assert.equal(row({ "usage-reports": 0, metrics: 1, "crash-reports": 2, "telemetry-host": 1, "host-rules": 0, "token-stripped": 0 }), "1 metrics report, 2 crash reports, 1 telemetry ping");
        assert.equal(row({ "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 3, "token-stripped": 0 }), "3 blocked by your rules");
        assert.equal(row({ "usage-reports": 2, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 1, "token-stripped": 0 }), "2 usage reports, 1 blocked by your rules");
    });

    it("says how many requests had the token removed, and 'Nothing needed' when none did, apart from the cancelled ones", () => {
        const zero = { "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 };
        const token = (n: number) => rowValue(mainTab({ status: () => status({ network: { ...zero, "token-stripped": n } }) }).tree, "Token kept safe");
        assert.equal(token(0), "Nothing needed");
        assert.equal(token(1), "1 request had the token removed");
        assert.equal(token(12), "12 requests had the token removed");
        const cancelled = rowValue(mainTab({ status: () => status({ network: { ...zero, "token-stripped": 7 } }) }).tree, "Cancelled on the network");
        assert.equal(cancelled, "Nothing yet", "a removed header is not a cancelled request");
    });

    it("shows the line about encrypted DNS as the main process wrote it, or 'Not known yet' before it did", () => {
        const dns = (line: string) => rowValue(mainTab({ status: () => status({ dns: line }) }).tree, "Encrypted DNS");
        assert.equal(dns(""), "Not known yet");
        assert.equal(dns("Off"), "Off");
        assert.equal(dns("Configured: Quad9, automatic, answered in 38 ms"), "Configured: Quad9, automatic, answered in 38 ms");
    });

    it("shows what the privacy self-test found, says a failure loudly, and never calls 'not seen' a pass", () => {
        const check = (selfTests: EngineStatus["selfTests"]) => rowValue(mainTab({ status: () => status({ selfTests }) }).tree, "Privacy check");
        const result = (name: "super-properties" | "first-gateway-message", verdict: "pass" | "fail" | "not-seen") => ({ name, status: verdict, detail: "d", ms: 5 });
        assert.equal(check([]), "Running");
        assert.equal(check([result("super-properties", "pass"), result("first-gateway-message", "pass")]), "properties passed, first message passed");
        assert.equal(check([result("super-properties", "pass"), result("first-gateway-message", "not-seen")]), "properties passed, first message not seen");
        assert.match(check([result("super-properties", "pass"), result("first-gateway-message", "fail")]), /^FAILED: Discord was told this client has mods \(properties passed, first message FAILED\)$/);
    });

    it("makes the banner ask for attention when the privacy self-test failed", () => {
        const failed = mainTab({ status: () => status({ selfTests: [{ name: "super-properties", status: "fail", detail: "d", ms: 1 }] }) });
        assert.match(textOf(findAll(failed.tree, el => hasClass(el, "amiricord-banner"))[0]), /^Needs attention/);
        const notSeen = mainTab({ status: () => status({ selfTests: [{ name: "super-properties", status: "not-seen", detail: "d", ms: 1 }] }) });
        assert.match(textOf(findAll(notSeen.tree, el => hasClass(el, "amiricord-banner"))[0]), /^Engine running/);
    });

    it("tells why safe mode is on and whether the engine entered it by itself, and names what waits for a restart", () => {
        const { tree } = mainTab({
            status: () => status({ safeMode: true, safeModeReason: "two failed starts", enteredSafeMode: true, quarantine: ["Bad"], devMode: true, problems: ["one", "two"] }),
            cards: () => [card("A", { restartNeeded: true }), card("B"), card("C", { restartNeeded: true })]
        });
        const rows = Object.fromEntries(findAll(tree, el => hasClass(el, "amiricord-row")).map(row => [textOf(row.children[0]), textOf(row.children[1])]));
        assert.equal(rows["Safe mode"], "On: two failed starts (entered by itself after failed starts)");
        assert.equal(rows["Quarantined plugins"], "Bad");
        assert.equal(rows["Waiting for a restart"], "Name of A, Name of C");
        assert.equal(rows["Developer mode"], "On");
        assert.equal(rows.Problems, "one; two");
    });

    it("says safe mode is on even without a reason", () => {
        const { tree } = mainTab({ status: () => status({ safeMode: true }) });
        const row = findAll(tree, el => hasClass(el, "amiricord-row")).find(el => textOf(el.children[0]) === "Safe mode")!;
        assert.equal(textOf(row.children[1]), "On");
    });

    it("reads the status again each time it is drawn, so it is never stale", () => {
        let version = "0.1.0";
        const fake = fakeReact();
        setReactSource(() => fake.react);
        const Tab = makeMainTab({ status: () => status({ version }), leaveSafeMode: () => undefined, cards: () => [], quickActions: [], settings: [], choices: [], buttonGroups: [], logo: "", editor: () => null });
        assert.match(textOf(render(Tab())), /Amiricord 0\.1\.0/);
        version = "0.2.0";
        assert.match(textOf(render(Tab())), /Amiricord 0\.2\.0/);
    });
});
