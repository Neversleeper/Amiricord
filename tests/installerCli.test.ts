/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { buildAsar } from "../src/installer/asar";
import { classifyResources } from "../src/installer/classify";
import { Io, main, overviewLines, parseArgs } from "../src/installer/cli";
import { Context, EXIT } from "../src/installer/commands";
import { DIST_FILES } from "../src/installer/dist";
import { Platform } from "../src/installer/platform";
import { makeStyle, stripAnsi } from "../src/installer/ui/ansi";
import { Key, KeySource } from "../src/installer/ui/keys";

let root: string;
let resources: string;
let ctx: Context & { platform: FakePlatform; };

class FakePlatform implements Platform {
    running = 0;
    closeWorks = true;
    calls: string[] = [];
    async listProcesses() { return Array.from({ length: this.running }, (_, i) => i + 1); }
    async closeProcesses(exe: string) {
        this.calls.push(`close ${exe}`);
        if (!this.closeWorks) throw new Error("did not exit");
        this.running = 0;
    }
    async killProcesses(exe: string) { this.calls.push(`kill ${exe}`); this.running = 0; }
    async start(_root: string, exe: string) { this.calls.push(`start ${exe}`); }
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "amiricord-cli-"));
    resources = join(root, "local", "DiscordCanary", "app-1.0.1", "resources");
    mkdirSync(resources, { recursive: true });
    const source = join(root, "build");
    mkdirSync(source);
    for (const name of DIST_FILES) writeFileSync(join(source, name), `build: ${name}`);
    writeFileSync(join(resources, "app.asar"), buildAsar({ "package.json": JSON.stringify({ main: "boot.js" }), "boot.js": Buffer.alloc(80 * 1024, 1) }));
    ctx = { localAppData: join(root, "local"), dataDir: join(root, "data"), distSource: source, platform: new FakePlatform() };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const key = (name: string): Key => (/^[0-9]$/.test(name) ? { name: "digit", digit: Number(name) } : { name } as Key);

/** An Io that records what is written and feeds the given keys. `keys` omitted means no terminal. */
function fakeIo(keys?: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const queue = keys ? keys.map(key) : null;
    const source: KeySource | null = queue ? { next: async () => queue.shift() ?? null } : null;
    const io: Io = { out: t => { out.push(t); }, err: t => { err.push(t); }, style: makeStyle(false), keys: source };
    return { io, text: () => stripAnsi(out.join("")), errors: () => stripAnsi(err.join("")), keysLeft: () => queue?.length ?? 0 };
}

const state = async () => (await classifyResources(resources)).state;

describe("parseArgs", () => {
    it("reads a command, its options and the aliases", () => {
        const p = parseArgs(["install", "--branch", "canary", "--close-discord", "--force-close", "--no-restart", "--dry-run", "--yes"]);
        assert.equal(p.command, "inject");
        assert.deepEqual(p.options, { branch: "canary", closeDiscord: true, forceClose: true, restart: false, dryRun: true });
        assert.equal(p.yes, true);
        assert.deepEqual(p.errors, []);
        assert.equal(parseArgs(["uninstall"]).command, "uninject");
        assert.equal(parseArgs(["repair", "--discard-stale"]).options.discardStale, true);
    });

    it("accepts --option=value and short flags", () => {
        const p = parseArgs(["restore", "--branch=ptb", "--from=canary-app-1-20260101-000000", "-y", "-h"]);
        assert.equal(p.options.branch, "ptb");
        assert.equal(p.options.from, "canary-app-1-20260101-000000");
        assert.equal(p.yes, true);
        assert.equal(p.help, true);
    });

    it("reports what it does not understand", () => {
        assert.equal(parseArgs(["--nope"]).errors[0], "Unknown option --nope.");
        assert.match(parseArgs(["inject", "extra"]).errors[0], /Unexpected "extra"/);
        assert.match(parseArgs(["inject", "--branch"]).errors[0], /needs a value/);
        assert.match(parseArgs(["inject", "--branch", "--yes"]).errors[0], /needs a value/);
        assert.match(parseArgs(["inject", "status"]).errors[0], /Unexpected "status"/);
    });

    it("has no command by default", () => {
        assert.equal(parseArgs([]).command, null);
    });
});

describe("with a command (no menu)", () => {
    it("shows the plan and changes nothing unless told with --yes", async () => {
        const t = fakeIo();
        const code = await main(["inject", "--branch", "canary"], t.io, ctx);
        assert.equal(code, EXIT.OK);
        assert.match(t.text(), /What would happen:/);
        assert.match(t.text(), /Add --yes to apply this/);
        assert.equal(await state(), "pristine");
        assert.equal(existsSync(ctx.dataDir), false);
    });

    it("applies with --yes and ends with a success line", async () => {
        const t = fakeIo();
        assert.equal(await main(["inject", "--branch", "canary", "--yes"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /✔ Success!/);
        assert.equal(await state(), "patched");
    });

    it("says after the result where Amiricord is installed, one line per Discord found", async () => {
        const stableResources = join(root, "local", "Discord", "app-1.0.9", "resources");
        mkdirSync(stableResources, { recursive: true });
        writeFileSync(join(stableResources, "app.asar"), buildAsar({ "index.js": "require(\"C:\\\\other\\\\patcher.js\")", "package.json": JSON.stringify({ name: "discord", main: "index.js" }) }));
        const t = fakeIo();
        assert.equal(await main(["inject", "--branch", "canary", "--yes"], t.io, ctx), EXIT.OK);
        const text = t.text();
        assert.ok(text.indexOf("✔ Success!") < text.indexOf("Amiricord on this PC:"), "after the result");
        assert.match(text, /✔ Canary app-1\.0\.1 {2}Amiricord installed/);
        assert.match(text, /! Stable app-1\.0\.9 {2}another mod is installed/);
        assert.match(text, /· Ptb {4}not found/);
    });

    it("shows the overview for status, a plan and a dry run too, and says not installed when it is not", async () => {
        for (const args of [["status", "--branch", "canary"], ["inject", "--branch", "canary"], ["inject", "--branch", "canary", "--yes", "--dry-run"]]) {
            const t = fakeIo();
            assert.equal(await main(args, t.io, ctx), EXIT.OK);
            assert.match(t.text(), /· Canary app-1\.0\.1 {2}Amiricord not installed/, args.join(" "));
        }
    });

    it("says that an install could not be read, without failing, and shows the others", async () => {
        const broken = { ...ctx, get localAppData(): string { throw new Error("no access"); } } as Context;
        const lines = stripAnsi((await overviewLines(broken, makeStyle(false))).join("\n"));
        assert.match(lines, /Amiricord on this PC:/);
        assert.equal((lines.match(/could not be read/g) ?? []).length, 3);
    });

    it("shows the overview after restore too", async () => {
        await main(["inject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        await main(["uninject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        const backups = readdirSync(join(ctx.dataDir, "backups"));
        assert.ok(backups.length > 0);
        const t = fakeIo();
        assert.equal(await main(["restore", "--branch", "canary", "--from", backups[0]!, "--yes"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Amiricord on this PC:/);
    });

    it("shows the overview after uninject, and not after a failure", async () => {
        await main(["inject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        const un = fakeIo();
        assert.equal(await main(["uninject", "--branch", "canary", "--yes"], un.io, ctx), EXIT.OK);
        assert.match(un.text(), /Amiricord on this PC:/);
        assert.match(un.text(), /Canary app-1.0.1 {2}Amiricord not installed/);
        const failed = fakeIo();
        assert.equal(await main(["status", "--branch", "ptb"], failed.io, ctx), EXIT.NOT_FOUND);
        assert.doesNotMatch(failed.text(), /Amiricord on this PC:/);
    });

    it("never changes anything on --dry-run, even with --yes", async () => {
        const t = fakeIo();
        await main(["inject", "--branch", "canary", "--yes", "--dry-run"], t.io, ctx);
        assert.equal(await state(), "pristine");
        assert.match(t.text(), /Nothing was changed/);
    });

    it("runs status without asking", async () => {
        const t = fakeIo();
        assert.equal(await main(["status", "--branch", "canary"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /pristine/);
    });

    it("says why it failed, with the right exit code", async () => {
        const noBranch = fakeIo();
        assert.equal(await main(["inject"], noBranch.io, ctx), EXIT.USAGE);
        assert.match(noBranch.errors(), /❌ Failed! The branch is missing/);

        const noDiscord = fakeIo();
        assert.equal(await main(["status", "--branch", "ptb"], noDiscord.io, ctx), EXIT.NOT_FOUND);

        ctx.platform.running = 1;
        const running = fakeIo();
        assert.equal(await main(["inject", "--branch", "canary", "--yes"], running.io, ctx), EXIT.RUNNING);
        assert.equal(await state(), "pristine");
    });

    it("closes and reopens Discord with the flags, and not without them", async () => {
        ctx.platform.running = 1;
        const t = fakeIo();
        assert.equal(await main(["inject", "--branch", "canary", "--yes", "--close-discord"], t.io, ctx), EXIT.OK);
        assert.deepEqual(ctx.platform.calls, ["close DiscordCanary.exe", "start DiscordCanary.exe"]);
    });

    it("prints help, and refuses bad arguments and a menu with no terminal", async () => {
        const help = fakeIo();
        assert.equal(await main(["--help"], help.io, ctx), EXIT.OK);
        assert.match(help.text(), /installer/);

        const bad = fakeIo();
        assert.equal(await main(["--nope"], bad.io, ctx), EXIT.USAGE);
        assert.match(bad.errors(), /Unknown option/);

        const none = fakeIo();
        assert.equal(await main([], none.io, ctx), EXIT.USAGE);
        assert.match(none.errors(), /needs a terminal/);
    });
});

describe("a short command in a terminal (pnpm inject), like TestCord's installer", () => {
    it("asks only which Discord and goes ahead, with labelled lines and no second question", async () => {
        const t = fakeIo(["enter"]);
        assert.equal(await main(["inject"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Select Discord install to patch/);
        assert.doesNotMatch(t.text(), /What would you like to do/);
        assert.doesNotMatch(t.text(), /Apply this\?/);
        assert.doesNotMatch(t.text(), /What would happen:/);
        assert.match(t.text(), /✔ Canary - /);
        assert.match(t.text(), /INFO\s+Patching /);
        assert.match(t.text(), /OK\s+Backup made and checked\./);
        assert.match(t.text(), /INFO\s+Successfully patched /);
        assert.match(t.text(), /To undo: pnpm uninject/);
        assert.match(t.text(), /✔ Success!/);
        assert.equal(t.keysLeft(), 0);
        assert.equal(await state(), "patched");
    });

    it("changes nothing when cancelled with Esc", async () => {
        const t = fakeIo(["escape"]);
        assert.equal(await main(["inject"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Cancelled\. Nothing was changed\./);
        assert.equal(await state(), "pristine");
        assert.equal(existsSync(ctx.dataDir), false);
    });

    it("says in a WARN line that an open Discord is closed and reopened, then does it", async () => {
        ctx.platform.running = 2;
        const t = fakeIo(["enter"]);
        assert.equal(await main(["inject"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /WARN\s+DiscordCanary\.exe is open\. It will be closed and reopened/);
        assert.match(t.text(), /INFO\s+Closing DiscordCanary\.exe/);
        assert.match(t.text(), /INFO\s+Reopening Discord/);
        assert.deepEqual(ctx.platform.calls, ["close DiscordCanary.exe", "start DiscordCanary.exe"]);
        assert.match(t.text(), /✔ Success!\n\nAmiricord on this PC:\n/, "the menu way says it too");
        assert.match(t.text(), /✔ Canary app-1\.0\.1 {2}Amiricord installed/);
    });

    it("forces the close straight away when Discord does not exit, with no question and no long wait", async () => {
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        const t = fakeIo(["enter"]);
        assert.equal(await main(["inject"], t.io, ctx), EXIT.OK);
        assert.doesNotMatch(t.text() + t.errors(), /Force Discord to close\?/);
        assert.ok(ctx.platform.calls.includes("kill DiscordCanary.exe"));
        assert.equal(await state(), "patched");
        assert.equal(t.keysLeft(), 0);
    });

    it("runs status after choosing the Discord, with no confirmation", async () => {
        const t = fakeIo(["enter"]);
        assert.equal(await main(["status"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /pristine/);
        assert.equal(t.keysLeft(), 0);
    });

    it("unpatches what was installed, the same way, and says how to put it back", async () => {
        await main(["inject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        assert.equal(await state(), "patched");
        const t = fakeIo(["enter"]);
        assert.equal(await main(["uninject"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Select Discord install to unpatch/);
        assert.match(t.text(), /INFO\s+Successfully unpatched /);
        assert.match(t.text(), /To put Amiricord back: pnpm inject/);
        assert.equal(await state(), "pristine");
    });

    it("repairs a desynced install straight away, keeping the old original in the backup", async () => {
        writeFileSync(join(resources, "_app.asar"), buildAsar({ "package.json": JSON.stringify({ main: "old.js" }), "old.js": Buffer.alloc(80 * 1024, 2) }));
        assert.equal(await state(), "desynced");
        const t = fakeIo(["enter"]);
        assert.equal(await main(["repair"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Select Discord install to repair/);
        assert.match(t.text(), /INFO\s+Successfully repaired /);
        assert.equal(await state(), "patched");
    });

    it("keeps the plan and the question for restore, which replaces files from a backup", async () => {
        await main(["inject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        await main(["uninject", "--branch", "canary", "--yes"], fakeIo().io, ctx);
        const t = fakeIo(["enter", "enter"]);
        assert.equal(await main(["restore"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Which Discord\?/);
        assert.match(t.text(), /What would happen:/);
        assert.match(t.text(), /Apply this\?/);
        assert.match(t.text(), /Cancelled\. Nothing was changed\./);
    });

    it("keeps the long form working: with --branch there is no menu", async () => {
        const t = fakeIo([]);
        assert.equal(await main(["inject", "--branch", "canary"], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Add --yes to apply this/);
        assert.doesNotMatch(t.text(), /Which Discord\?/);
        assert.equal(await state(), "pristine");
    });
});

describe("the menu", () => {
    it("installs after choosing the Discord, the action and an explicit yes", async () => {
        // Canary is the only Discord found; Install is the first action; "2" is "Yes, apply it".
        const t = fakeIo(["enter", "enter", "2"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Which Discord\?/);
        assert.match(t.text(), /Canary · app-1\.0\.1 · Amiricord not installed/);
        assert.match(t.text(), /What would happen:/);
        assert.match(t.text(), /Apply this\?/);
        assert.match(t.text(), /✔ Success!/);
        assert.equal(await state(), "patched");
    });

    it("cannot apply by pressing Enter all the way through", async () => {
        const t = fakeIo(["enter", "enter", "enter", "enter", "enter"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Cancelled\. Nothing was changed\./);
        assert.equal(await state(), "pristine");
        assert.equal(existsSync(ctx.dataDir), false);
    });

    it("cancels at any menu with Esc", async () => {
        for (const keys of [["escape"], ["enter", "escape"], ["enter", "enter", "escape"]]) {
            const t = fakeIo(keys);
            assert.equal(await main([], t.io, ctx), EXIT.OK);
            assert.match(t.text(), /Cancelled/);
            assert.equal(await state(), "pristine");
        }
    });

    it("quits from the action menu", async () => {
        const t = fakeIo(["enter", "6"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Cancelled/);
    });

    it("shows the status without asking for confirmation", async () => {
        const t = fakeIo(["enter", "5"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /pristine/);
        assert.equal(t.keysLeft(), 0);
    });

    it("warns that Discord will be closed and reopened, then does it", async () => {
        ctx.platform.running = 3;
        const t = fakeIo(["enter", "enter", "2"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Discord is open\. It will be closed and reopened; unsent drafts and an active call are lost\./);
        assert.deepEqual(ctx.platform.calls, ["close DiscordCanary.exe", "start DiscordCanary.exe"]);
    });

    it("asks before forcing a close, and leaves everything alone on No", async () => {
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        const t = fakeIo(["enter", "enter", "2", "enter"]);
        assert.equal(await main([], t.io, ctx), EXIT.RUNNING);
        assert.match(t.text() + t.errors(), /Force Discord to close\?/);
        assert.equal(await state(), "pristine");
        assert.ok(!ctx.platform.calls.includes("kill DiscordCanary.exe"));
    });

    it("forces the close on Yes", async () => {
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        const t = fakeIo(["enter", "enter", "2", "2"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        // The first try asked for a normal close and failed; the second asks again (short wait) and then forces it.
        assert.deepEqual(ctx.platform.calls.slice(0, 3), ["close DiscordCanary.exe", "close DiscordCanary.exe", "kill DiscordCanary.exe"]);
        assert.equal(await state(), "patched");
    });

    it("finds no Discord and says so", async () => {
        rmSync(join(root, "local", "DiscordCanary"), { recursive: true });
        const t = fakeIo(["enter"]);
        assert.equal(await main([], t.io, ctx), EXIT.NOT_FOUND);
        assert.match(t.errors(), /No Discord was found/);
    });

    it("lists every branch it finds, with Stable not blocked", async () => {
        mkdirSync(join(root, "local", "Discord", "app-1.0.9", "resources"), { recursive: true });
        writeFileSync(join(root, "local", "Discord", "app-1.0.9", "resources", "app.asar"), buildAsar({ "package.json": "{}" }));
        const t = fakeIo(["escape"]);
        await main([], t.io, ctx);
        assert.match(t.text(), /1\. Stable · app-1\.0\.9/);
        assert.match(t.text(), /2\. Canary · app-1\.0\.1/);
    });

    it("repairs a desynced install, saying the old file is discarded", async () => {
        writeFileSync(join(resources, "_app.asar"), buildAsar({ "package.json": JSON.stringify({ main: "old.js" }), "old.js": Buffer.alloc(80 * 1024, 2) }));
        assert.equal(await state(), "desynced");
        const t = fakeIo(["enter", "2", "2"]);
        assert.equal(await main([], t.io, ctx), EXIT.OK);
        assert.match(t.text(), /Discord was updated, needs repair/);
        assert.match(t.text(), /old _app\.asar left by the earlier Discord is discarded/);
        assert.equal(await state(), "patched");
        assert.deepEqual(readdirSync(resources).sort(), ["_app.asar", "app.asar"]);
    });
});
