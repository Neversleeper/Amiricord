/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import type { EnginePluginContext } from "../src/renderer/engine";
import { CONFIRM_PHRASE, createController } from "../src/testcordplugins/DeleteMe/controller";
import plugin, { depsFor, openWindow, settings, targetOf } from "../src/testcordplugins/DeleteMe/index";
import manifest from "../src/testcordplugins/DeleteMe/plugin.json";
import { type PurgeDeps, type RawMessage } from "../src/testcordplugins/DeleteMe/purge";
import { DELETEME_CSS } from "../src/testcordplugins/DeleteMe/styles";
import { progressOf, renderWindow, type WindowActions, type WindowParts } from "../src/testcordplugins/DeleteMe/view";

const ME = "me";
const mine = (id: string, content = `text ${id}`): RawMessage => ({ id, author: { id: ME }, content, type: 0 });

function fakeDeps(pages: RawMessage[][] = [], overrides: Partial<PurgeDeps> = {}) {
    const removed: string[] = [];
    let page = 0;
    const gates: Array<() => void> = [];
    const world = {
        removed, gates,
        failFor: new Set<string>(),
        /** When set, every deletion waits for `release()` before it happens. */
        hold: false
    };
    const deps: PurgeDeps = {
        me: ME,
        list: async () => pages[page++] ?? [],
        remove: async id => {
            if (world.hold) await new Promise<void>(resolve => { gates.push(resolve); });
            if (world.failFor.has(id)) throw { status: 500, body: { message: "nope" } };
            removed.push(id);
        },
        sleep: async () => undefined,
        options: () => ({ delayMs: 0, skipPinned: true }),
        ...overrides
    };
    return Object.assign(world, { deps });
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

async function ready(ids = ["a", "b", "c"]) {
    const world = fakeDeps([ids.map(id => mine(id))]);
    const controller = createController(world.deps, "#general");
    await controller.scan();
    return { world, controller };
}

describe("DeleteMe: the window's steps", () => {
    it("starts doing nothing, and tells the person to scan first", () => {
        const controller = createController(fakeDeps().deps, "#general");
        const state = controller.getState();
        assert.equal(state.phase, "idle");
        assert.equal(state.channelName, "#general");
        assert.deepEqual([state.canScan, state.canStart, state.canStop], [true, false, false]);
        assert.match(state.message, /Nothing is deleted yet/);
    });

    it("scans, says how many it found, and asks for the word before anything can be deleted", async () => {
        const { controller } = await ready();
        const state = controller.getState();
        assert.equal(state.phase, "ready");
        assert.deepEqual([state.found, state.scanned, state.deleted, state.failed], [3, 3, 0, 0]);
        assert.match(state.message, new RegExp(`Found 3 of your messages \\(3 read\\)\\. Type ${CONFIRM_PHRASE} to unlock`));
        assert.equal(state.canStart, false);
    });

    it("unlocks the delete button only for the exact word, and only after a scan", async () => {
        const idle = createController(fakeDeps().deps, "x");
        idle.setConfirm(CONFIRM_PHRASE);
        assert.equal(idle.getState().confirm, "");
        const { controller } = await ready();
        for (const wrong of ["delete", "DELETE ", "DELET", "", "DELETEDELETE"]) {
            controller.setConfirm(wrong);
            assert.equal(controller.getState().canStart, false, JSON.stringify(wrong));
        }
        controller.setConfirm(CONFIRM_PHRASE);
        assert.equal(controller.getState().canStart, true);
        controller.setConfirm("x".repeat(50));
        assert.equal(controller.getState().confirm.length, 20);
    });

    it("says there is nothing to delete, and never unlocks, when it found nothing", async () => {
        const world = fakeDeps([[{ id: "z", author: { id: "other" }, type: 0 }]]);
        const controller = createController(world.deps, "x");
        await controller.scan();
        controller.setConfirm(CONFIRM_PHRASE);
        const state = controller.getState();
        assert.equal(state.phase, "ready");
        assert.match(state.message, /no messages here/);
        assert.match(state.message, /(1 messages read: 1 from other accounts, 0 of yours that Discord does not let you delete, 0 of yours pinned and kept.)/);
        assert.equal(state.canStart, false);
    });

    it("warns when the scan stopped before the oldest message", async () => {
        const pages = Array.from({ length: 500 }, (_, p) => Array.from({ length: 100 }, (_, i) => mine(`m${p}-${i}`)));
        const controller = createController(fakeDeps(pages).deps, "x");
        await controller.scan();
        assert.match(controller.getState().message, /stopped before the oldest message/);
    });

    it("deletes what was found when told, in order, with a line in the feed for each, newest first", async () => {
        const { world, controller } = await ready();
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const state = controller.getState();
        assert.deepEqual(world.removed, ["a", "b", "c"]);
        assert.equal(state.phase, "done");
        assert.deepEqual([state.deleted, state.failed, state.confirm], [3, 0, ""]);
        assert.equal(state.message, "Done: 3 deleted, 0 failed.");
        assert.deepEqual(state.feed.map(line => [line.id, line.kind, line.text]), [["c", "killed", "text c"], ["b", "killed", "text b"], ["a", "killed", "text a"]]);
        assert.deepEqual([state.canStart, state.canScan, state.canStop], [false, true, false]);
    });

    it("does not delete without the word, or twice, or before a scan", async () => {
        const idle = fakeDeps();
        const never = createController(idle.deps, "x");
        await never.start();
        assert.deepEqual(idle.removed, []);
        const { world, controller } = await ready();
        await controller.start();
        assert.deepEqual(world.removed, []);
        controller.setConfirm(CONFIRM_PHRASE);
        const first = controller.start();
        const second = controller.start();
        await Promise.all([first, second]);
        assert.deepEqual(world.removed, ["a", "b", "c"]);
        await controller.start();
        assert.deepEqual(world.removed, ["a", "b", "c"], "the list was used up");
    });

    it("shows the failures with their reason and counts them", async () => {
        const { world, controller } = await ready();
        world.failFor.add("b");
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const state = controller.getState();
        assert.deepEqual([state.deleted, state.failed], [2, 1]);
        assert.deepEqual(state.feed.find(line => line.kind === "failed"), { id: "b", kind: "failed", text: "text b", note: "nope" });
        assert.equal(state.message, "Done: 2 deleted, 1 failed.");
    });

    it("ends with an error when ten deletions in a row fail", async () => {
        const ids = Array.from({ length: 10 + 2 }, (_, i) => `m${i}`);
        const { world, controller } = await ready(ids);
        for (const id of ids) world.failFor.add(id);
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const state = controller.getState();
        assert.equal(state.phase, "error");
        assert.match(state.message, new RegExp(`${10} deletions in a row failed\\. 0 deleted\\.`));
    });

    it("stops at the next message when asked, and says how far it got", async () => {
        const { world, controller } = await ready();
        world.hold = true;
        controller.setConfirm(CONFIRM_PHRASE);
        const running = controller.start();
        await flush();
        assert.equal(controller.getState().phase, "running");
        assert.equal(controller.getState().canStop, true);
        controller.stop();
        world.gates.shift()!();
        await running;
        const state = controller.getState();
        assert.equal(state.phase, "stopped");
        assert.deepEqual(world.removed, ["a"]);
        assert.equal(state.message, "Stopped: 1 deleted, 0 failed.");
    });

    it("stops a scan, throws the scan away, and deletes nothing", async () => {
        let release!: () => void;
        const world = fakeDeps([], { list: async () => { await new Promise<void>(resolve => { release = resolve; }); return [mine("a")]; } });
        const controller = createController(world.deps, "x");
        const scanning = controller.scan();
        await flush();
        assert.equal(controller.getState().phase, "scanning");
        assert.equal(controller.getState().canScan, false);
        controller.stop();
        release();
        await scanning;
        const state = controller.getState();
        assert.equal(state.phase, "idle");
        assert.match(state.message, /scan was stopped/);
        assert.equal(state.found, 0);
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        assert.deepEqual(world.removed, []);
    });

    it("ignores a second scan while one is running", async () => {
        let calls = 0;
        let release!: () => void;
        const world = fakeDeps([], { list: async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return []; } });
        const controller = createController(world.deps, "x");
        const first = controller.scan();
        await flush();
        const second = controller.scan();
        release();
        await Promise.all([first, second]);
        assert.equal(calls, 1);
    });

    it("clears the typed word when it scans again", async () => {
        const world = fakeDeps([[mine("a")], [mine("a")]]);
        const controller = createController(world.deps, "x");
        await controller.scan();
        controller.setConfirm(CONFIRM_PHRASE);
        assert.equal(controller.getState().canStart, true);
        await controller.scan();
        assert.equal(controller.getState().confirm, "");
        assert.equal(controller.getState().canStart, false);
    });

    it("works again after it was stopped: a new scan and a new deletion are not stopped at once", async () => {
        const world = fakeDeps([[mine("a"), mine("b")], [mine("a"), mine("b")]]);
        const controller = createController(world.deps, "x");
        await controller.scan();
        world.hold = true;
        controller.setConfirm(CONFIRM_PHRASE);
        const running = controller.start();
        await flush();
        controller.stop();
        world.gates.shift()!();
        await running;
        assert.equal(controller.getState().phase, "stopped");
        world.hold = false;
        await controller.scan();
        assert.equal(controller.getState().phase, "ready", "the new scan went through");
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        assert.equal(controller.getState().phase, "done", "the new deletion went through");
        assert.deepEqual(world.removed, ["a", "a", "b"]);
    });

    it("ignores stop when nothing is running", async () => {
        const { controller } = await ready();
        controller.stop();
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        assert.equal(controller.getState().phase, "done", "the stop did not carry over");
    });

    it("scans again from the start after finishing, clearing the old numbers", async () => {
        const world = fakeDeps([[mine("a")], [mine("b"), mine("c")]]);
        const controller = createController(world.deps, "x");
        await controller.scan();
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        await controller.scan();
        const state = controller.getState();
        assert.deepEqual([state.phase, state.found, state.deleted, state.feed.length, state.confirm], ["ready", 2, 0, 0, ""]);
    });

    it("tells what went wrong when Discord's list fails, and lets the person try again", async () => {
        let fail = true;
        const world = fakeDeps([], { list: async () => { if (fail) throw new Error("offline"); return [mine("a")]; } });
        const controller = createController(world.deps, "x");
        await controller.scan();
        assert.equal(controller.getState().phase, "error");
        assert.equal(controller.getState().message, "The scan failed: offline");
        assert.equal(controller.getState().canScan, true);
        fail = false;
        await controller.scan();
        assert.equal(controller.getState().phase, "ready");
    });

    it("tells what went wrong when something unexpected breaks the deleting", async () => {
        const { world, controller } = await ready();
        world.deps.sleep = async () => { throw "weird"; };
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        assert.equal(controller.getState().phase, "error");
        assert.equal(controller.getState().message, "Deleting failed: weird");
    });

    it("keeps the last 200 lines only", async () => {
        const ids = Array.from({ length: 200 + 5 }, (_, i) => `m${i}`);
        const { controller } = await ready(ids);
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const feed = controller.getState().feed;
        assert.equal(feed.length, 200);
        assert.equal(feed[0].id, `m${ids.length - 1}`);
    });

    it("tells whoever listens about every change, and stops when they leave or the window closes", async () => {
        const controller = createController(fakeDeps([[mine("a")]]).deps, "x");
        let heard = 0;
        const leave = controller.subscribe(() => { heard++; });
        await controller.scan();
        const afterScan = heard;
        assert.ok(afterScan >= 3);
        leave();
        controller.setConfirm(CONFIRM_PHRASE);
        assert.equal(heard, afterScan);
        let late = 0;
        controller.subscribe(() => { late++; });
        controller.dispose();
        controller.setConfirm("x");
        await controller.scan();
        assert.equal(late, 0);
    });

    it("stops everything when the window is closed in the middle of deleting", async () => {
        const { world, controller } = await ready();
        world.hold = true;
        controller.setConfirm(CONFIRM_PHRASE);
        const running = controller.start();
        await flush();
        controller.dispose();
        world.gates.shift()!();
        await running;
        assert.deepEqual(world.removed, ["a"]);
        assert.equal(controller.getState().phase, "running", "nothing is told after it closed");
        assert.deepEqual([controller.getState().deleted, controller.getState().feed.length], [0, 0], "and nothing changes in what it holds");
    });
});

interface Element { type: unknown; props: Record<string, unknown>; children: unknown[]; }
const make = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children });
const parts: WindowParts = { Root: "Root", Header: "Header", Content: "Content", CloseButton: "Close" };

function walk(node: unknown, visit: (element: Element) => void) {
    if (node && typeof node === "object" && "type" in node) {
        const element = node as Element;
        visit(element);
        for (const child of element.children) walk(child, visit);
    }
}
const find = (node: unknown, test: (element: Element) => boolean) => { const found: Element[] = []; walk(node, element => { if (test(element)) found.push(element); }); return found; };
const byClass = (node: unknown, name: string) => find(node, element => String(element.props.className ?? "").split(" ").includes(name));
const text = (node: unknown): string => (typeof node === "string" ? node : node && typeof node === "object" && "children" in node ? (node as Element).children.map(text).join("") : "");

function actionsFor() {
    const calls: string[] = [];
    const actions: WindowActions = {
        scan: () => { calls.push("scan"); }, start: () => { calls.push("start"); }, stop: () => { calls.push("stop"); },
        setConfirm: value => { calls.push(`confirm:${value}`); }, close: () => { calls.push("close"); }
    };
    return { calls, actions };
}

describe("DeleteMe: how the window looks", () => {
    it("says what it does and that it cannot be undone, and which conversation it is about", async () => {
        const { controller } = await ready();
        const tree = renderWindow(make as never, parts, controller.getState(), actionsFor().actions) as Element;
        assert.equal(tree.type, "Root");
        assert.equal(tree.props.label, "DeleteMe");
        assert.match(text(byClass(tree, "vc-deleteme-warning")[0]), /cannot be undone/);
        assert.match(text(byClass(tree, "vc-deleteme-warning")[0]), /Messages of other people are never touched/);
        assert.equal(text(byClass(tree, "vc-deleteme-current-channel")[0]), "Conversation: #general");
        assert.equal(find(tree, element => element.type === "Header").length, 1);
        assert.equal(find(tree, element => element.type === "Close").length, 1);
    });

    it("shows the three numbers, the status and the progress", async () => {
        const { world, controller } = await ready();
        world.failFor.add("b");
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const tree = renderWindow(make as never, parts, controller.getState(), actionsFor().actions);
        assert.deepEqual(byClass(tree, "vc-deleteme-stat").map(stat => text(stat)), ["3found", "2deleted", "1failed"]);
        const status = byClass(tree, "vc-deleteme-status")[0];
        assert.equal(status.props["data-state"], "done");
        assert.equal(text(status), "Done: 2 deleted, 1 failed.");
        assert.deepEqual((byClass(tree, "vc-deleteme-progressbar-fill")[0].props.style as { width: string; }).width, "100%");
    });

    it("measures the progress, never past 100, and 100 when it finished with nothing to do", () => {
        assert.equal(progressOf({ found: 4, deleted: 1, failed: 0, phase: "running" }), 25);
        assert.equal(progressOf({ found: 3, deleted: 1, failed: 1, phase: "running" }), 67);
        assert.equal(progressOf({ found: 2, deleted: 5, failed: 0, phase: "running" }), 100);
        assert.equal(progressOf({ found: 0, deleted: 0, failed: 0, phase: "idle" }), 0);
        assert.equal(progressOf({ found: 0, deleted: 0, failed: 0, phase: "done" }), 100);
    });

    it("shows the box for the word only when there is something to delete, and sends what is typed", async () => {
        const idle = createController(fakeDeps().deps, "x");
        assert.equal(byClass(renderWindow(make as never, parts, idle.getState(), actionsFor().actions), "vc-deleteme-confirm-input").length, 0);
        const { controller } = await ready();
        const { calls, actions } = actionsFor();
        const tree = renderWindow(make as never, parts, controller.getState(), actions);
        const input = byClass(tree, "vc-deleteme-confirm-input")[0];
        assert.equal(input.props.placeholder, `Type ${CONFIRM_PHRASE} to unlock`);
        assert.equal(input.props.autoComplete, "off");
        (input.props.onChange as (event: unknown) => void)({ target: { value: "DEL" } });
        assert.deepEqual(calls, ["confirm:DEL"]);
        const empty = createController(fakeDeps([[]]).deps, "x");
        await empty.scan();
        assert.equal(byClass(renderWindow(make as never, parts, empty.getState(), actionsFor().actions), "vc-deleteme-confirm-input").length, 0, "nothing found: no box");
    });

    it("enables each button only when it can do something, and wires it to its action", async () => {
        const { controller } = await ready();
        const { calls, actions } = actionsFor();
        const buttons = (state: ReturnType<typeof controller.getState>) => byClass(renderWindow(make as never, parts, state, actions), "vc-deleteme-button");
        let [scan, remove, stop] = buttons(controller.getState());
        assert.deepEqual([text(scan), text(remove), text(stop)], ["Scan again", "Delete my messages", "Stop"]);
        assert.deepEqual([scan.props.disabled, remove.props.disabled, stop.props.disabled], [false, true, true]);
        controller.setConfirm(CONFIRM_PHRASE);
        [scan, remove, stop] = buttons(controller.getState());
        assert.equal(remove.props.disabled, false);
        for (const button of [scan, remove, stop]) (button.props.onClick as () => void)();
        assert.deepEqual(calls, ["scan", "start", "stop"]);
        const fresh = buttons(createController(fakeDeps().deps, "x").getState());
        assert.equal(text(fresh[0]), "Scan");
        const closeProps = renderWindow(make as never, parts, controller.getState(), actions) as Element;
        (closeProps.props.onClose as () => void)();
        assert.equal(calls.at(-1), "close");
    });

    it("draws the box for the word only while the scan is waiting for it", async () => {
        const { controller } = await ready();
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const tree = renderWindow(make as never, parts, controller.getState(), actionsFor().actions);
        assert.equal(controller.getState().found, 3);
        assert.equal(byClass(tree, "vc-deleteme-confirm-input").length, 0, "after deleting, the box is gone");
    });

    it("turns the scan button off while it scans or deletes", async () => {
        const world = fakeDeps([], { list: async () => { await new Promise(() => undefined); return []; } });
        const controller = createController(world.deps, "x");
        void controller.scan();
        await flush();
        const [scan, , stop] = byClass(renderWindow(make as never, parts, controller.getState(), actionsFor().actions), "vc-deleteme-button");
        assert.deepEqual([scan.props.disabled, stop.props.disabled], [true, false]);
    });

    it("closes from the close button of the header too", async () => {
        const { controller } = await ready();
        const { calls, actions } = actionsFor();
        const tree = renderWindow(make as never, parts, controller.getState(), actions);
        const close = find(tree, element => element.type === "Close")[0];
        (close.props.onClick as () => void)();
        assert.deepEqual(calls, ["close"]);
    });

    it("lists what was deleted and what failed, with the reason", async () => {
        const { world, controller } = await ready();
        world.failFor.add("a");
        controller.setConfirm(CONFIRM_PHRASE);
        await controller.start();
        const tree = renderWindow(make as never, parts, controller.getState(), actionsFor().actions);
        const lines = byClass(tree, "vc-deleteme-line");
        assert.deepEqual(lines.map(line => line.props.className), ["vc-deleteme-line vc-deleteme-line-killed", "vc-deleteme-line vc-deleteme-line-killed", "vc-deleteme-line vc-deleteme-line-failed"]);
        assert.deepEqual(lines.map(line => text(byClass(line, "vc-deleteme-tag")[0])), ["deleted", "deleted", "failed"]);
        assert.deepEqual(lines.map(line => text(byClass(line, "vc-deleteme-content")[0])), ["text c", "text b", "text a"]);
        assert.deepEqual(lines.map(line => byClass(line, "vc-deleteme-channel-badge").length), [0, 0, 1]);
        assert.equal(text(byClass(lines[2], "vc-deleteme-channel-badge")[0]), "nope");
    });
});

describe("DeleteMe: the plugin", () => {
    const savedSetTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    afterEach(() => {
        settings.unbind();
        if (savedSetTimeout) Object.defineProperty(globalThis, "setTimeout", savedSetTimeout);
    });

    function fakeContext(options: { channelId?: string | undefined; me?: string | undefined; channel?: { name?: string; } | undefined; rest?: unknown; } = {}) {
        const toasts: Array<[string, string | undefined]> = [];
        const opened: Array<{ render: unknown; options: { onCloseCallback?(): void; } | undefined; }> = [];
        const styles: Array<{ css: string; name?: string; removed: boolean; }> = [];
        const closed: string[] = [];
        const asked: string[][] = [];
        const reported: string[] = [];
        const ctx = {
            common: {
                SelectedChannelStore: { get: () => ({ getChannelId: () => ("channelId" in options ? options.channelId : "C1") }) },
                UserStore: { get: () => ({ getCurrentUser: () => (("me" in options ? options.me : ME) ? { id: "me" } : undefined) }) },
                ChannelStore: { get: () => ({ getChannel: () => ("channel" in options ? options.channel : { name: "general" }) }) }
            },
            finders: { byProps: (...names: string[]) => { asked.push(names); return { get: () => ("rest" in options ? options.rest : { get: async () => ({ body: [] }), del: async () => ({}) }) }; } },
            components: Object.fromEntries(["ModalRoot", "ModalHeader", "ModalContent", "ModalCloseButton"].map(name => [name, { get: () => name }])),
            modals: { open: (render: unknown, modalOptions?: { onCloseCallback?(): void; }) => { opened.push({ render, options: modalOptions }); return "key"; }, closeAll: () => { closed.push("all"); } },
            toasts: { show: (message: string, kind?: string) => { toasts.push([message, kind]); } },
            addStyle: (css: string, name?: string) => { const entry = { css, name, removed: false }; styles.push(entry); return { remove: () => { entry.removed = true; } }; },
            reportError: (source: string) => { reported.push(source); }
        };
        return { ctx: ctx as unknown as EnginePluginContext, toasts, opened, styles, closed, asked, reported };
    }

    it("finds the open conversation, the account and a name for the window, or says what is missing", () => {
        assert.deepEqual(targetOf(fakeContext().ctx), { channelId: "C1", me: "me", channelName: "#general" });
        assert.deepEqual(targetOf(fakeContext({ channel: {} }).ctx), { channelId: "C1", me: "me", channelName: "this conversation" });
        assert.deepEqual(targetOf(fakeContext({ channel: undefined }).ctx), { channelId: "C1", me: "me", channelName: "this conversation" });
        assert.match(String(targetOf(fakeContext({ channelId: undefined }).ctx)), /Open the conversation/);
        assert.match(String(targetOf(fakeContext({ me: undefined }).ctx)), /not ready yet/);
    });

    it("reads a page of 100 and goes back from the last message, and deletes by the message's own address", async () => {
        const calls: Array<{ method: string; request: { url: string; query?: Record<string, unknown>; }; }> = [];
        const rest = {
            get: async (request: { url: string; query?: Record<string, unknown>; }) => { calls.push({ method: "get", request }); return { body: [{ id: "1" }] }; },
            del: async (request: { url: string; }) => { calls.push({ method: "del", request }); return {}; }
        };
        settings.bind(new SettingsClient({ schema: 1, plugins: { DeleteMe: { values: { delayMs: 900, skipPinned: false } } } }, () => undefined), "DeleteMe");
        const deps = depsFor(rest as never, "C1", "me");
        assert.deepEqual(await deps.list(undefined), [{ id: "1" }]);
        await deps.list("55");
        await deps.remove("77");
        assert.deepEqual(calls, [
            { method: "get", request: { url: "/channels/C1/messages", query: { limit: 100 } } },
            { method: "get", request: { url: "/channels/C1/messages", query: { limit: 100, before: "55" } } },
            { method: "del", request: { url: "/channels/C1/messages/77" } }
        ]);
        assert.deepEqual(deps.options(), { delayMs: 900, skipPinned: false });
        assert.equal(deps.me, "me");
        rest.get = async () => ({ body: { not: "a list" } as never });
        assert.deepEqual(await deps.list(undefined), []);
    });

    it("waits with the page's timer", async () => {
        let asked = 0;
        Object.defineProperty(globalThis, "setTimeout", { value: (run: () => void, ms: number) => { asked = ms; run(); return 0; }, configurable: true, writable: true });
        await depsFor({} as never, "C", "me").sleep(321);
        assert.equal(asked, 321);
    });

    it("opens the window for the open conversation, and closes the controller when the window closes", () => {
        const world = fakeContext();
        const key = openWindow(world.ctx);
        assert.equal(key, "key");
        assert.deepEqual(world.asked, [["get", "post", "put", "del"]]);
        assert.equal(world.opened.length, 1);
        assert.equal(typeof world.opened[0].render, "function");
        assert.equal(typeof world.opened[0].options?.onCloseCallback, "function");
        assert.doesNotThrow(() => world.opened[0].options!.onCloseCallback!());
        assert.deepEqual(world.toasts, []);
    });

    it("does not open anything, and says why, without a conversation or without Discord's request function", () => {
        const none = fakeContext({ channelId: undefined });
        assert.equal(openWindow(none.ctx), undefined);
        assert.equal(none.toasts[0][1], "failure");
        assert.match(none.toasts[0][0], /Open the conversation/);
        assert.equal(none.opened.length, 0);
        const noRest = fakeContext({ rest: undefined });
        assert.equal(openWindow(noRest.ctx), undefined);
        assert.match(noRest.toasts[0][0], /request function was not found/);
        assert.equal(noRest.opened.length, 0);
    });

    it("adds its style when it starts, takes it away and closes its windows when it stops", () => {
        const world = fakeContext();
        plugin.start!(world.ctx);
        assert.deepEqual(world.styles.map(style => [style.css, style.name]), [[DELETEME_CSS, "deleteme"]]);
        plugin.stop!(world.ctx);
        assert.equal(world.styles[0].removed, true);
        assert.deepEqual(world.closed, ["all"]);
        assert.doesNotThrow(() => plugin.stop!(world.ctx));
    });

    it("keeps its settings inside their limits", () => {
        settings.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "DeleteMe");
        const store = settings.store as unknown as Record<string, unknown>;
        for (const [key, bad] of [["delayMs", 499], ["delayMs", 10_001], ["delayMs", 1000.5]] as const) assert.throws(() => { store[key] = bad; }, TypeError, `${key} ${bad}`);
        assert.deepEqual({ ...settings.store }, { delayMs: 1200, skipPinned: true });
    });

    it("declares that it deletes your own messages and reads the one conversation that is open", () => {
        assert.deepEqual(manifest.permissions, { account: { write: ["delete-own-messages"] }, messages: { read: "visible" } });
        assert.equal(manifest.enabledByDefault, false);
        assert.equal(manifest.startAt, "domReady");
    });
});
