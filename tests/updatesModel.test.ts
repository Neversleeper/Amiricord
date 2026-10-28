/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUpdatesModel, UPDATES_TEXT } from "../src/plugins/Settings/updatesModel";
import type { UpdateAnswer } from "../src/shared/updates";

const news = [{ version: "0.3.0", date: "2026-11-01", title: "Title", notes: ["Note"] }];

function setup(answers: { check?: UpdateAnswer | null | Error; install?: UpdateAnswer | null | Error; }) {
    const calls: string[] = [];
    const reply = (what: UpdateAnswer | null | Error | undefined) => { if (what instanceof Error) throw what; return what ?? null; };
    const model = createUpdatesModel({
        current: "0.2.0",
        check: async () => { calls.push("check"); return reply(answers.check); },
        install: async () => { calls.push("install"); return reply(answers.install); }
    });
    const phases: string[] = [];
    model.subscribe(() => { phases.push(model.getState().phase); });
    return { model, calls, phases };
}

describe("the Updates tab model", () => {
    it("starts idle, and only a check may be started", async () => {
        const { model, calls } = setup({});
        assert.deepEqual([model.getState().phase, model.getState().canCheck, model.getState().canInstall, model.getState().message], ["idle", true, false, UPDATES_TEXT.idle]);
        await model.install();
        assert.deepEqual(calls, [], "no install before a check found something");
    });

    it("shows that a newer version exists, with its news, and then installs it and asks for a restart", async () => {
        const { model, calls, phases } = setup({
            check: { status: "available", current: "0.2.0", latest: "0.3.0", news },
            install: { status: "installed", current: "0.2.0", installed: "0.3.0" }
        });
        await model.check();
        assert.deepEqual([model.getState().phase, model.getState().latest, model.getState().news, model.getState().canInstall], ["available", "0.3.0", news, true]);
        assert.equal(model.getState().message, UPDATES_TEXT.available("0.3.0", "0.2.0"));
        await model.install();
        assert.deepEqual([model.getState().phase, model.getState().message, model.getState().canInstall, model.getState().canCheck], ["installed", UPDATES_TEXT.installed("0.3.0"), false, true]);
        assert.deepEqual(calls, ["check", "install"]);
        assert.deepEqual(phases, ["checking", "available", "installing", "installed"]);
    });

    it("says you have the newest, and clears an older list of news", async () => {
        const { model } = setup({ check: { status: "up-to-date", current: "0.2.0", latest: "0.2.0" } });
        await model.check();
        assert.deepEqual([model.getState().phase, model.getState().news, model.getState().message], ["up-to-date", [], UPDATES_TEXT.upToDate("0.2.0")]);
    });

    it("shows the sentence of an error, and says so when the main process does not answer or fails", async () => {
        const failed = setup({ check: { status: "error", message: "could not reach the updates (offline)" } });
        await failed.model.check();
        assert.deepEqual([failed.model.getState().phase, failed.model.getState().message], ["error", "could not reach the updates (offline)."]);
        assert.equal(failed.model.getState().canCheck, true, "it can be tried again");
        const silent = setup({ check: null });
        await silent.model.check();
        assert.equal(silent.model.getState().message, UPDATES_TEXT.noAnswer);
        const thrown = setup({ check: new Error("bridge gone") });
        await thrown.model.check();
        assert.deepEqual([thrown.model.getState().phase, thrown.model.getState().message], ["error", UPDATES_TEXT.noAnswer]);
    });

    it("says nothing was changed when the install gets no answer or fails, and a check may follow", async () => {
        const { model } = setup({ check: { status: "available", current: "0.2.0", latest: "0.3.0", news: [] }, install: { status: "error", message: "renderer.js does not match its fingerprint, so it was not installed; nothing was changed" } });
        await model.check();
        await model.install();
        assert.deepEqual([model.getState().phase, model.getState().canInstall, model.getState().canCheck], ["error", false, true]);
        assert.match(model.getState().message, /nothing was changed\.$/);
        const noAnswer = setup({ check: { status: "available", current: "0.2.0", latest: "0.3.0", news: [] }, install: null });
        await noAnswer.model.check();
        await noAnswer.model.install();
        assert.equal(noAnswer.model.getState().message, UPDATES_TEXT.installNoAnswer);
    });

    it("does not start a second check while one is running", async () => {
        let release: (answer: UpdateAnswer) => void = () => undefined;
        let asked = 0;
        const model = createUpdatesModel({ current: "0.2.0", check: () => { asked++; return new Promise<UpdateAnswer>(resolve => { release = resolve; }); }, install: async () => null });
        const first = model.check();
        await model.check();
        assert.equal(asked, 1);
        assert.deepEqual([model.getState().phase, model.getState().canCheck], ["checking", false]);
        release({ status: "up-to-date", current: "0.2.0", latest: "0.2.0" });
        await first;
        assert.equal(model.getState().phase, "up-to-date");
    });
});
