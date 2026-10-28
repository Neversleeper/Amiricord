/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nativeWindowOf, type WebContentsLike } from "../src/main/nativeWindow";

function contents(over: Partial<{ destroyed: boolean; opens: boolean; throwsOn: "isDestroyed" | "openDevTools" | "isDevToolsOpened" | null; }> = {}) {
    const log = { opened: 0, asked: 0 };
    const fake: WebContentsLike = {
        isDestroyed: () => { if (over.throwsOn === "isDestroyed") throw new Error("gone"); return over.destroyed === true; },
        openDevTools: () => { if (over.throwsOn === "openDevTools") throw new Error("no"); log.opened++; },
        isDevToolsOpened: () => { if (over.throwsOn === "isDevToolsOpened") throw new Error("no"); log.asked++; return over.opens !== false; }
    };
    return { fake, log };
}

describe("the window that made a native call", () => {
    it("can open its tools while it exists, and cannot once it is destroyed", () => {
        assert.equal(nativeWindowOf(contents().fake).canOpenDevTools(), true);
        assert.equal(nativeWindowOf(contents({ destroyed: true }).fake).canOpenDevTools(), false);
    });

    it("never asks to open anything when only asked whether it can", () => {
        const { fake, log } = contents();
        nativeWindowOf(fake).canOpenDevTools();
        assert.deepEqual(log, { opened: 0, asked: 0 });
    });

    it("opens its tools once and says whether they were open right after", () => {
        const open = contents({ opens: true });
        assert.equal(nativeWindowOf(open.fake).openDevTools(), true);
        assert.deepEqual(open.log, { opened: 1, asked: 1 });
        const closedAgain = contents({ opens: false });
        assert.equal(nativeWindowOf(closedAgain.fake).openDevTools(), false, "Discord may close them at once");
        assert.equal(closedAgain.log.opened, 1);
    });

    it("does not touch a window that is destroyed", () => {
        const { fake, log } = contents({ destroyed: true });
        assert.equal(nativeWindowOf(fake).openDevTools(), false);
        assert.deepEqual(log, { opened: 0, asked: 0 });
    });

    it("answers false instead of throwing when the window fails", () => {
        for (const throwsOn of ["isDestroyed", "openDevTools", "isDevToolsOpened"] as const) {
            const window = nativeWindowOf(contents({ throwsOn }).fake);
            assert.doesNotThrow(() => { window.canOpenDevTools(); window.openDevTools(); }, throwsOn);
            assert.equal(window.openDevTools(), false, throwsOn);
        }
        assert.equal(nativeWindowOf(contents({ throwsOn: "isDestroyed" }).fake).canOpenDevTools(), false);
    });
});
