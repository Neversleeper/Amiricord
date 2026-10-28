/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildModals, type ModalRender, type ModalsFinders } from "../src/api/modals";
import type { Finder } from "../src/webpack/finders";

/** Discord's opener and closer as fakes: they keep what they were asked, and the test can leave either out. */
function setup(options: { opener?: boolean; closer?: boolean; openReturns?: unknown; closeThrows?: boolean; openThrows?: boolean; } = {}) {
    const { opener = true, closer = true, openReturns } = options;
    const opened: Array<{ render: ModalRender; options: unknown; }> = [];
    const closed: string[] = [];
    const asked: string[][] = [];
    let counter = 0;
    const finders: ModalsFinders = {
        byCode: <T>(...snippets: string[]) => {
            asked.push(snippets);
            const found = snippets[0] === "stackNextByDefault:"
                ? (opener ? (render: ModalRender, opts?: unknown) => { if (options.openThrows) throw new Error("wrong function"); opened.push({ render, options: opts }); return openReturns === undefined ? `key${++counter}` : openReturns; } : undefined)
                : (closer ? (key: string) => { closed.push(key); if (options.closeThrows) throw new Error("already gone"); } : undefined);
            return { get: () => found } as unknown as Finder<T>;
        }
    };
    const undos: Array<() => void> = [];
    const errors: Array<[string, unknown]> = [];
    const modals = buildModals(finders, undo => { undos.push(undo); }, (source, error) => { errors.push([source, error]); });
    return { modals, opened, closed, undos, errors, asked };
}

const render: ModalRender = () => null;

describe("buildModals", () => {
    it("opens a modal with Discord's opener, hands over the draw function and the options, and returns the key", () => {
        const t = setup();
        const options = { modalKey: "mine" };
        assert.equal(t.modals.open(render, options), "key1");
        assert.equal(t.opened[0].render, render);
        assert.equal(t.opened[0].options, options);
        assert.equal(t.modals.open(render), "key2");
    });

    it("looks for the opener by the three option names only that function takes, and for the closer by its call of the close callback", () => {
        const t = setup();
        t.modals.open(render);
        t.modals.close("x");
        assert.deepEqual(t.asked, [["stackNextByDefault:", "dismissable:", "onCloseCallback:"], [".onCloseCallback()"]]);
    });

    it("reports an opener that throws against the plugin, gives back undefined and remembers nothing", () => {
        const t = setup({ openThrows: true });
        assert.equal(t.modals.open(render), undefined);
        assert.equal(t.errors.length, 1);
        assert.equal(t.errors[0][0], "modals open");
        assert.equal(t.undos.length, 0);
    });

    it("gives back undefined, and opens nothing, when Discord's opener is not found", () => {
        const t = setup({ opener: false });
        assert.equal(t.modals.open(render), undefined);
        assert.equal(t.undos.length, 0);
    });

    it("gives back undefined when the opener does not return a key, and does not remember it", () => {
        const t = setup({ openReturns: 42 });
        assert.equal(t.modals.open(render), undefined);
        t.modals.closeAll();
        assert.deepEqual(t.closed, []);
    });

    it("closes one modal by key", () => {
        const t = setup();
        const key = t.modals.open(render)!;
        t.modals.close(key);
        assert.deepEqual(t.closed, [key]);
        t.modals.closeAll();
        assert.deepEqual(t.closed, [key], "a closed modal is not closed again");
    });

    it("registers one undo at the first open, and that undo closes every modal still open", () => {
        const t = setup();
        assert.equal(t.undos.length, 0);
        t.modals.open(render);
        const second = t.modals.open(render)!;
        t.modals.open(render);
        assert.equal(t.undos.length, 1);
        t.modals.close(second);
        t.undos[0]();
        assert.deepEqual(t.closed, ["key2", "key1", "key3"]);
    });

    it("does nothing when the closer is not found, without an error", () => {
        const t = setup({ closer: false });
        const key = t.modals.open(render)!;
        t.modals.close(key);
        t.undos[0]();
        assert.deepEqual(t.errors, []);
    });

    it("reports a closer that throws against the plugin and still closes the others", () => {
        const t = setup({ closeThrows: true });
        t.modals.open(render);
        t.modals.open(render);
        t.undos[0]();
        assert.deepEqual(t.closed, ["key1", "key2"]);
        assert.deepEqual(t.errors.map(e => e[0]), ["modals close", "modals close"]);
    });
});
