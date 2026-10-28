/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeRestart, planRelaunch, RelaunchPlan } from "../src/main/relaunch";

const EXE = "C:\\Users\\someone\\AppData\\Local\\DiscordCanary\\app-1.0.1281\\DiscordCanary.exe";
const UPDATE = "C:\\Users\\someone\\AppData\\Local\\DiscordCanary\\Update.exe";

describe("planRelaunch", () => {
    it("starts Discord again through Squirrel's Update.exe next to the app folder, with the name of the running exe", () => {
        const asked: string[] = [];
        const plan = planRelaunch({ execPath: EXE, platform: "win32", exists: path => { asked.push(path); return path === UPDATE; } });
        assert.deepEqual(plan, { execPath: UPDATE, args: ["--processStart", "DiscordCanary.exe"] });
        assert.deepEqual(asked, [UPDATE]);
    });

    it("works for every branch, because it takes the names from the running exe", () => {
        const stable = "D:\\Apps\\Discord\\app-1.0.9\\Discord.exe";
        const plan = planRelaunch({ execPath: stable, platform: "win32", exists: () => true });
        assert.deepEqual(plan, { execPath: "D:\\Apps\\Discord\\Update.exe", args: ["--processStart", "Discord.exe"] });
    });

    it("gives nothing without Update.exe, so Electron's own relaunch is used", () => {
        assert.equal(planRelaunch({ execPath: EXE, platform: "win32", exists: () => false }), null);
    });

    it("gives nothing outside Windows, even if a file with that name exists", () => {
        for (const platform of ["linux", "darwin"]) {
            assert.equal(planRelaunch({ execPath: "/opt/discord/Discord", platform, exists: () => true }), null, platform);
        }
    });
});

describe("makeRestart", () => {
    function setup(plan: RelaunchPlan | null, options: { disposeThrows?: boolean; } = {}) {
        const log: string[] = [];
        const restart = makeRestart({
            dispose: () => { log.push("dispose"); if (options.disposeThrows) throw new Error("disk full"); },
            plan,
            relaunch: opts => { log.push(opts ? `relaunch ${opts.execPath} ${opts.args.join(" ")}` : "relaunch default"); },
            exit: code => { log.push(`exit ${code}`); }
        });
        return { restart, log };
    }

    it("writes what is waiting, then relaunches with the plan, then exits", () => {
        const t = setup({ execPath: UPDATE, args: ["--processStart", "DiscordCanary.exe"] });
        assert.equal(t.restart(), true);
        assert.deepEqual(t.log, ["dispose", `relaunch ${UPDATE} --processStart DiscordCanary.exe`, "exit 0"]);
    });

    it("uses Electron's own relaunch when there is no plan", () => {
        const t = setup(null);
        t.restart();
        assert.deepEqual(t.log, ["dispose", "relaunch default", "exit 0"]);
    });

    it("restarts only once, however many requests come", () => {
        const t = setup(null);
        assert.equal(t.restart(), true);
        assert.equal(t.restart(), false);
        assert.equal(t.restart(), false);
        assert.deepEqual(t.log, ["dispose", "relaunch default", "exit 0"]);
    });

    it("restarts anyway when the last write fails", () => {
        const t = setup(null, { disposeThrows: true });
        assert.equal(t.restart(), true);
        assert.deepEqual(t.log, ["dispose", "relaunch default", "exit 0"]);
    });
});
