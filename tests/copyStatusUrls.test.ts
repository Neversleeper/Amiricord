/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { EnginePluginContext } from "../src/renderer/engine";
import plugin from "../src/testcordplugins/CopyStatusUrls/index";
import manifest from "../src/testcordplugins/CopyStatusUrls/plugin.json";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const names = ["navigator"];
const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

afterEach(() => {
    plugin.stop!(undefined as never);
    for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
});

function page(options: { copy?: (text: string) => Promise<void>; } = {}) {
    const copied: string[] = [];
    define("navigator", { clipboard: { writeText: options.copy ?? (async (text: string) => { copied.push(text); }) } });
    return { copied };
}

function fakeContext(lookup: (activity: unknown, userId: string) => Promise<{ button_urls?: string[]; }>) {
    const toasts: Array<[string, string | undefined]> = [];
    const asked: string[][] = [];
    const errors: Array<{ source: string; error: unknown; }> = [];
    const ctx = {
        finders: { byCode: (...snippets: string[]) => { asked.push(snippets); return { ready: async () => lookup }; } },
        toasts: { show: (message: string, kind?: string) => { toasts.push([message, kind]); } },
        reportError: (source: string, error: unknown) => { errors.push({ source, error }); }
    };
    return { ctx: ctx as unknown as EnginePluginContext, toasts, asked, errors };
}

const props = { user: { id: "42" }, activity: { name: "Crunchyroll" } };

describe("CopyStatusUrls", () => {
    it("adds a right-click to the status buttons of the module that holds the Crunchyroll button", () => {
        const patch: RegisteredPatch = { ...plugin.patches![0], plugin: "CopyStatusUrls" };
        const source = "function(e,t,n){function q(e){let{application:t}=e;return(0,i.jsx)(K.FD,{text:X.intl.string(X.t.BjYzmC),onClick:u,fullWidth:!0})}"
            + "function eo(e){let{user:t,activity:n,onAction:r}=e;return a===M?(0,i.jsx)(\"div\",{children:n.buttons.map((e,a)=>(0,i.jsx)(K.FD,{text:s?X.intl.string(X.t.I6JG46):e,onClick:e=>{r?.({action:s?\"PRESS_WATCH_ON_CRUNCHYROLL_BUTTON\":\"PRESS_CUSTOM_BUTTON\"}),el({user:t,activity:n,index:a})}},a))})"
            + ":(0,i.jsx)(\"div\",{children:n.buttons.map((e,a)=>(0,i.jsx)(K.FD,{text:s?X.intl.string(X.t.I6JG46):e,fullWidth:!0,onClick:e=>{el({user:t,activity:n,index:a})}},a))})}}";
        const result = compileModule("9", source, [patch]);
        assert.equal(result.outcomes[0].replacements[0].status, "applied");
        assert.equal(result.code.split("onContextMenu:").length - 1, 2, "one right-click for each of the two layouts of the status buttons");
        assert.match(result.code, /text:s\?X\.intl\.string\(X\.t\.I6JG46\):e,onContextMenu:[^,]*\.makeContextMenu\(arguments\[0\],a\),onClick:e=>/);
        assert.match(result.code, /fullWidth:!0,onContextMenu:[^,]*\.makeContextMenu\(arguments\[0\],a\),onClick:e=>/);
        assert.match(result.code, /\(0,i\.jsx\)\(K\.FD,\{text:X\.intl\.string\(X\.t\.BjYzmC\),onClick:u,fullWidth:!0\}\)/, "the first onClick of the module (add to current games) is left as it was");
        assert.equal(compileModule("9", "function(e,t,n){function g(e){return h({onClick:a,index:n})}}", [patch]).outcomes.length, 0, "another module is left alone");
    });

    it("looks for Discord's metadata function when it starts", () => {
        const setup = fakeContext(async () => ({}));
        plugin.start!(setup.ctx);
        assert.deepEqual(setup.asked, [["null/undefined"]]);
    });

    it("copies the link of the button that was clicked and says so", async () => {
        const where = page();
        const lookups: unknown[][] = [];
        const setup = fakeContext(async (activity, userId) => { lookups.push([activity, userId]); return { button_urls: ["https://a.example/x", "https://b.example/y"] }; });
        plugin.start!(setup.ctx);
        await plugin.makeContextMenu(props, 1)();
        assert.deepEqual(where.copied, ["https://b.example/y"]);
        assert.deepEqual(lookups, [[props.activity, "42"]]);
        assert.deepEqual(setup.toasts, [["Copied URL", "success"]]);
        assert.deepEqual(setup.errors, []);
    });

    it("says it could not copy, and reports why, when the link is missing, the lookup fails or the clipboard refuses", async () => {
        for (const make of [
            () => ({ lookup: async () => ({ button_urls: ["https://a.example/x"] }), index: 3, copy: undefined }),
            () => ({ lookup: async () => ({}), index: 0, copy: undefined }),
            () => ({ lookup: async () => { throw new Error("offline"); }, index: 0, copy: undefined }),
            () => ({ lookup: async () => ({ button_urls: ["https://a.example/x"] }), index: 0, copy: async () => { throw new Error("denied"); } })
        ]) {
            const attempt = make();
            const where = page(attempt.copy ? { copy: attempt.copy } : {});
            const setup = fakeContext(attempt.lookup);
            plugin.start!(setup.ctx);
            await plugin.makeContextMenu(props, attempt.index)();
            assert.deepEqual(where.copied, []);
            assert.deepEqual(setup.toasts, [["Error copying URL", "failure"]]);
            assert.equal(setup.errors.length, 1);
            assert.equal(setup.errors[0].source, "CopyStatusUrls");
            plugin.stop!(undefined as never);
        }
    });

    it("does nothing but say so after it was stopped", async () => {
        const where = page();
        const setup = fakeContext(async () => ({ button_urls: ["https://a.example/x"] }));
        plugin.start!(setup.ctx);
        const handler = plugin.makeContextMenu(props, 0);
        plugin.stop!(undefined as never);
        await handler();
        assert.deepEqual(where.copied, []);
        assert.equal(setup.errors.length, 0, "there is nobody to report to");
    });

    it("declares the clipboard and nothing else", () => {
        assert.deepEqual(manifest.permissions, { system: { clipboard: true } });
        assert.equal(manifest.startAt, "init");
        assert.equal(manifest.origin, "testcord");
    });
});
