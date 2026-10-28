/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { dataDirectory, MainController } from "../src/main/mainController";
import { parseBootState } from "../src/shared/bootState";
import { DEV_DUMP_MAX_BYTES, DEV_FLAG_FILE } from "../src/shared/ipc";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-main-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Every controller gets a timer that never fires, so no file is written behind the test's back. */
function make(now = 1000) {
    let clock = now;
    const scheduler = { set: () => 1, clear: () => { /* nothing is ever scheduled for real */ } };
    return new MainController({ dataDir: dir, now: () => clock++, health: { scheduler, newSessionId: () => "session" } });
}

const bootFile = () => join(dir, "state.json");
const savedBoot = () => parseBootState(readFileSync(bootFile(), "utf8")).state;

describe("dataDirectory", () => {
    it("is the project folder inside APPDATA", () => {
        assert.equal(dataDirectory({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }), join("C:\\Users\\x\\AppData\\Roaming", "Amiricord"));
    });

    it("is null when there is no APPDATA", () => {
        assert.equal(dataDirectory({}), null);
        assert.equal(dataDirectory({ APPDATA: "" }), null);
    });
});

describe("starting", () => {
    it("starts clean on a first run and writes the counter before anything else can fail", () => {
        const info = make().start();
        assert.deepEqual(info, { safeMode: false, safeModeReason: null, quarantine: [], enteredSafeMode: false, problems: [], devMode: false, settings: { schema: 1, plugins: {} } });
        assert.equal(savedBoot().bootAttempts, 1);
    });

    it("counts boots that were never reported clean and enters safe mode at the limit", () => {
        for (let i = 0; i < 3; i++) make().start();
        const info = make().start();
        assert.equal(info.safeMode, true);
        assert.equal(info.enteredSafeMode, true);
        assert.match(info.safeModeReason ?? "", /did not finish/);
    });

    it("a clean boot resets the counter", () => {
        for (let i = 0; i < 2; i++) {
            const controller = make();
            controller.start();
            controller.cleanBoot();
        }
        assert.equal(savedBoot().bootAttempts, 0);
        assert.equal(make().start().safeMode, false);
    });

    it("starts with defaults and says so when the boot state file is damaged", () => {
        writeFileSync(bootFile(), "{ not json");
        const info = make().start();
        assert.equal(info.safeMode, false);
        assert.ok(info.problems.length > 0);
    });

    it("reports a file it cannot write instead of throwing", () => {
        writeFileSync(join(dir, "blocker"), "a file where a folder is needed");
        const controller = new MainController({ dataDir: join(dir, "blocker"), health: { scheduler: { set: () => 1, clear: () => { /* none */ } } } });
        const info = controller.start();
        assert.ok(info.problems.some(p => p.includes("could not be written")));
    });

    it("hands the quarantine list to the page at start", () => {
        const first = make();
        first.start();
        for (let i = 0; i < 3; i++) first.recordHealth({ type: "start-failed", plugin: "Bad", error: "x" });
        assert.deepEqual(make().start().quarantine, ["Bad"]);
    });
});

describe("health events", () => {
    it("quarantines a plugin after three start failures and saves it", () => {
        const controller = make();
        controller.start();
        const event = { type: "start-failed", plugin: "Bad", error: "x" } as const;
        assert.deepEqual(controller.recordHealth(event), { quarantined: false });
        assert.deepEqual(controller.recordHealth(event), { quarantined: false });
        assert.deepEqual(controller.recordHealth(event), { quarantined: true });
        assert.deepEqual(savedBoot().quarantine.map(q => q.id), ["Bad"]);
        assert.deepEqual(controller.bootInfo().quarantine, ["Bad"]);
    });

    it("does not count other events as start failures", () => {
        const controller = make();
        controller.start();
        for (let i = 0; i < 5; i++) controller.recordHealth({ type: "runtime-error", plugin: "A", source: "s", error: "x" });
        assert.deepEqual(controller.bootInfo().quarantine, []);
        assert.equal(controller.health.state.current.plugins.A.runtimeErrors, 5);
    });

    it("writes the health file when it is disposed", () => {
        const controller = make();
        controller.start();
        controller.recordHealth({ type: "started", plugin: "A", ms: 3 });
        controller.dispose();
        assert.match(readFileSync(join(dir, "health.json"), "utf8"), /"A"/);
    });
});

describe("boots that were cut short", () => {
    it("does not count a boot that ends by Discord closing normally before it was reported clean", () => {
        make().start();
        assert.equal(savedBoot().bootAttempts, 1);
        const second = make();
        second.start();
        assert.equal(savedBoot().bootAttempts, 2);
        second.dispose();
        assert.equal(savedBoot().bootAttempts, 1);
        second.dispose();
        assert.equal(savedBoot().bootAttempts, 1, "closing twice takes nothing more away");
    });

    it("does not enter safe mode after many restarts that each closed normally", () => {
        for (let i = 0; i < 8; i++) {
            const controller = make();
            controller.start();
            controller.dispose();
        }
        const last = make();
        assert.equal(last.start().safeMode, false);
    });

    it("still enters safe mode when the boots never closed (a crash gives no chance to say so)", () => {
        for (let i = 0; i < 3; i++) make().start();
        const fourth = make();
        const info = fourth.start();
        assert.equal(info.safeMode, true);
        assert.equal(info.enteredSafeMode, true);
    });

    it("leaves a clean boot at zero when it closes afterwards", () => {
        const controller = make();
        controller.start();
        controller.cleanBoot();
        controller.dispose();
        assert.equal(savedBoot().bootAttempts, 0);
    });
});

describe("leaving safe mode", () => {
    it("turns safe mode off and forgets the failed boots for the next start", () => {
        for (let i = 0; i < 3; i++) make().start();
        const controller = make();
        assert.equal(controller.start().safeMode, true);
        controller.leaveSafeMode();
        assert.equal(savedBoot().safeMode, false);
        assert.equal(savedBoot().bootAttempts, 0);
        controller.dispose();
        assert.equal(savedBoot().bootAttempts, 0, "closing afterwards does not take away what is not there");
        assert.equal(make().start().safeMode, false);
    });
});

describe("dev mode and dev dumps", () => {
    const probeFolder = () => join(dir, "probe");

    it("is off by default, and a dump is refused and writes nothing", () => {
        const controller = make();
        assert.equal(controller.start().devMode, false);
        assert.match(controller.devDump({ name: "x", text: "{}" }) ?? "", /dev mode is off/);
        assert.equal(existsSync(probeFolder()), false);
    });

    it("turns on only if the flag file existed when Discord started", () => {
        const before = make();
        before.start();
        writeFileSync(join(dir, DEV_FLAG_FILE), "");
        // Created while running: nothing changes until the next start.
        assert.equal(before.bootInfo().devMode, false);
        assert.match(before.devDump({ name: "x", text: "{}" }) ?? "", /dev mode is off/);
        assert.equal(make().start().devMode, true);
    });

    it("writes an accepted dump into the probe folder, replacing an earlier one, and leaves no temporary file", () => {
        writeFileSync(join(dir, DEV_FLAG_FILE), "");
        const controller = make();
        controller.start();
        assert.equal(controller.devDump({ name: "settings", text: "{\"a\":1}" }), null);
        assert.equal(controller.devDump({ name: "settings", text: "{\"a\":2}" }), null);
        assert.equal(readFileSync(join(probeFolder(), "settings.json"), "utf8"), "{\"a\":2}");
        assert.deepEqual(readdirSync(probeFolder()), ["settings.json"]);
    });

    it("refuses bad names and oversized texts even in dev mode, and nothing leaves the probe folder", () => {
        writeFileSync(join(dir, DEV_FLAG_FILE), "");
        const controller = make();
        controller.start();
        for (const name of ["../escape", "a/b", "..", "UPPER"]) {
            assert.match(controller.devDump({ name, text: "x" }) ?? "", /refused/);
        }
        assert.match(controller.devDump({ name: "big", text: "x".repeat(DEV_DUMP_MAX_BYTES + 1) }) ?? "", /refused/);
        assert.equal(existsSync(probeFolder()), false);
        assert.equal(existsSync(join(dir, "escape.json")), false);
    });

    it("reports a write problem as text instead of throwing", () => {
        writeFileSync(join(dir, DEV_FLAG_FILE), "");
        mkdirSync(probeFolder());
        writeFileSync(join(probeFolder(), "blocked.json"), "x");
        // A folder where the file should go cannot be replaced by a file.
        rmSync(join(probeFolder(), "blocked.json"));
        mkdirSync(join(probeFolder(), "blocked.json"));
        const controller = make();
        controller.start();
        assert.ok(controller.devDump({ name: "blocked", text: "x" }));
    });
});

describe("a dump that cannot be written", () => {
    it("leaves a line in probe/errors.log and still returns the error", () => {
        writeFileSync(join(dir, DEV_FLAG_FILE), "");
        mkdirSync(join(dir, "probe", "blocked.json"), { recursive: true });
        const controller = make();
        controller.start();
        assert.ok(controller.devDump({ name: "blocked", text: "x" }));
        const log = readFileSync(join(dir, "probe", "errors.log"), "utf8");
        assert.match(log, /blocked: /);
    });
});

describe("settings through the controller", () => {
    const enable = (plugin: string, enabled: boolean | null = true) => ({ type: "plugin-enabled", plugin, enabled });

    it("hands the saved settings to the page at start", () => {
        writeFileSync(join(dir, "settings.json"), JSON.stringify({ schema: 1, plugins: { Saved: { enabled: false, values: { size: 2 } } } }));
        const info = make().start();
        assert.deepEqual(info.settings, { schema: 1, plugins: { Saved: { enabled: false, values: { size: 2 } } } });
        assert.deepEqual(info.problems, []);
    });

    it("keeps a change from the page, shows it in the boot info and writes it when the app quits", () => {
        const controller = make();
        controller.start();
        assert.equal(controller.changeSetting(enable("A")), null);
        assert.deepEqual(controller.bootInfo().settings.plugins.A, { enabled: true });
        controller.dispose();
        assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).plugins.A.enabled, true);
        assert.deepEqual(make().start().settings.plugins.A, { enabled: true });
    });

    it("refuses a bad change and keeps the settings as they were", () => {
        const controller = make();
        controller.start();
        assert.match(controller.changeSetting({ type: "plugin-enabled", plugin: "__proto__", enabled: true }) ?? "", /refused/);
        assert.match(controller.changeSetting("nonsense") ?? "", /refused/);
        assert.deepEqual(controller.bootInfo().settings, { schema: 1, plugins: {} });
    });

    it("reports a damaged settings file as a problem and starts with the defaults", () => {
        writeFileSync(join(dir, "settings.json"), "{ not json");
        const info = make().start();
        assert.deepEqual(info.settings, { schema: 1, plugins: {} });
        assert.ok(info.problems.some(p => p.includes("settings file")));
    });
});
