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

import { buildAsar, buildLoaderAsar } from "../src/installer/asar";
import { BACKUP_MANIFEST, listBackups } from "../src/installer/backup";
import { classifyResources } from "../src/installer/classify";
import { Context, EXIT, inject, InstallerError, Options, repair, restore, status, uninject } from "../src/installer/commands";
import { DIST_FILES } from "../src/installer/dist";
import { hashFile } from "../src/installer/hash";
import { parseTasklist, Platform } from "../src/installer/platform";
import { Fsx, nodeFsx } from "../src/installer/transaction";

let local: string;
let data: string;
let source: string;
let resources: string;
beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "amiricord-commands-"));
    local = join(root, "local");
    data = join(root, "data");
    source = join(root, "build");
    resources = join(local, "DiscordCanary", "app-1.0.1", "resources");
    mkdirSync(resources, { recursive: true });
    mkdirSync(source);
    for (const name of DIST_FILES) writeFileSync(join(source, name), `build 1: ${name}`);
});
afterEach(() => { rmSync(join(local, ".."), { recursive: true, force: true }); });

/** Something that looks like Discord's own app.asar. */
const original = (tag = "a") => buildAsar({ "package.json": JSON.stringify({ name: "discord", main: "app_bootstrap/index.js" }), "app_bootstrap/data.bin": Buffer.alloc(100 * 1024, tag.charCodeAt(0)) });

const put = (name: string, data: Buffer | string) => writeFileSync(join(resources, name), data);
const originalHash = () => hashFile(join(resources, "app.asar"));

class FakePlatform implements Platform {
    running = 0;
    closeWorks = true;
    killWorks = true;
    calls: string[] = [];
    async listProcesses() { return Array.from({ length: this.running }, (_, i) => i + 1); }
    async closeProcesses(exe: string) {
        this.calls.push(`close ${exe}`);
        if (!this.closeWorks) throw new Error("did not exit");
        this.running = 0;
    }
    async killProcesses(exe: string) {
        this.calls.push(`kill ${exe}`);
        if (!this.killWorks) throw new Error("still alive");
        this.running = 0;
    }
    async start(root: string, exe: string) { this.calls.push(`start ${exe} in ${root}`); }
}

let clock = 0;
function context(extra: Partial<Context> = {}): Context & { platform: FakePlatform; } {
    return { localAppData: local, dataDir: data, distSource: source, platform: new FakePlatform(), now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, clock++)), ...extra } as Context & { platform: FakePlatform; };
}

const canary: Options = { branch: "canary" };

async function refuses(promise: Promise<unknown>, exit: number, text?: RegExp) {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof InstallerError, String(error));
        assert.equal(error.exit, exit, error.message);
        if (text) assert.match(error.message, text);
        return true;
    });
}

const names = () => readdirSync(resources).sort();

describe("choosing the target", () => {
    it("needs a valid branch and an installed Discord", async () => {
        await refuses(status(context(), {}), EXIT.USAGE, /branch is missing/);
        await refuses(status(context(), { branch: "auto" }), EXIT.USAGE, /not a branch/);
        await refuses(status(context(), { branch: "ptb" }), EXIT.NOT_FOUND, /not found/);
    });
});

describe("status", () => {
    it("tells the state, whether Discord runs, the engine and the backups", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 3;
        const res = await status(ctx, canary);
        assert.equal(res.stateBefore, "pristine");
        const text = res.messages.join("\n");
        assert.match(text, /app-1\.0\.1: pristine/);
        assert.match(text, /3 processes/);
        assert.match(text, /not complete/);
        assert.match(text, /0 backup\(s\)/);
    });

    it("changes nothing", async () => {
        put("app.asar", original());
        await status(context(), canary);
        assert.deepEqual(names(), ["app.asar"]);
        assert.equal(existsSync(data), false);
    });
});

describe("inject", () => {
    it("patches a pristine Discord, keeps the original as _app.asar, installs the engine and makes a backup", async () => {
        put("app.asar", original());
        const hash = await originalHash();
        const res = await inject(context(), canary);

        assert.equal(res.stateBefore, "pristine");
        assert.equal(res.stateAfter, "patched");
        assert.deepEqual(names(), ["app.asar", "_app.asar"].sort());
        assert.equal(await hashFile(join(resources, "_app.asar")), hash);

        const c = await classifyResources(resources);
        assert.equal(c.state, "patched");
        assert.equal(c.loader?.modPath, join(data, "canary", "dist", "main.js"));
        for (const name of DIST_FILES) assert.equal(readFileSync(join(data, "canary", "dist", name), "utf8"), `build 1: ${name}`);
        assert.deepEqual(readdirSync(data).sort(), ["backups", "canary"]);
        assert.deepEqual(readdirSync(join(data, "canary")).sort(), ["dist"]);

        const backups = await listBackups(join(data, "backups"));
        assert.equal(backups.length, 1);
        assert.equal(backups[0].manifest.state, "pristine");
        assert.equal(res.backupDir, backups[0].dir);
    });

    it("with dry run shows the plan and changes nothing at all", async () => {
        put("app.asar", original());
        const res = await inject(context(), { ...canary, dryRun: true });
        assert.equal(res.dryRun, true);
        assert.ok(res.plan.length >= 5);
        assert.deepEqual(names(), ["app.asar"]);
        assert.equal(existsSync(data), false);
    });

    it("runs again on a patched Discord to refresh the loader and the engine, and backs up again", async () => {
        put("app.asar", original());
        const ctx = context();
        await inject(ctx, canary);
        for (const name of DIST_FILES) writeFileSync(join(source, name), `build 2: ${name}`);
        const res = await inject(ctx, canary);

        assert.equal(res.stateBefore, "patched");
        assert.equal(res.stateAfter, "patched");
        assert.equal(readFileSync(join(data, "canary", "dist", "main.js"), "utf8"), "build 2: main.js");
        assert.deepEqual(names(), ["app.asar", "_app.asar"].sort());
        assert.equal(existsSync(join(data, "canary", "dist.old")), false);
        assert.equal((await listBackups(join(data, "backups"))).length, 2);
    });

    it("refuses what it must not touch, and leaves everything as it was", async () => {
        const foreign = buildAsar({ "index.js": "require(\"C:\\\\other.js\")", "package.json": JSON.stringify({ main: "index.js" }) });
        const cases: Array<[string, () => void, number, RegExp]> = [
            ["another mod's loader", () => { put("app.asar", foreign); put("_app.asar", original()); }, EXIT.STATE, /foreign-loader/],
            ["a desynced install", () => { put("app.asar", original()); put("_app.asar", original("b")); }, EXIT.STATE, /Use repair/],
            ["our loader without the original", () => { put("app.asar", buildLoaderAsar("x")); }, EXIT.STATE, /broken/],
            ["leftover files", () => { put("app.asar", original()); put("app.asar.amiricord-new", "x"); }, EXIT.STATE, /cut short/],
            ["a folder in place of app.asar", () => { mkdirSync(join(resources, "app.asar")); }, EXIT.STATE, /unsupported/]
        ];
        for (const [label, setup, exit, text] of cases) {
            for (const name of readdirSync(resources)) rmSync(join(resources, name), { recursive: true, force: true });
            setup();
            const before = names();
            await refuses(inject(context(), canary), exit, text);
            assert.deepEqual(names(), before, label);
            assert.equal(existsSync(join(data, "canary", "dist")), false, label);
        }
    });

    it("needs a complete build", async () => {
        put("app.asar", original());
        rmSync(join(source, "renderer.js"));
        await refuses(inject(context(), canary), EXIT.USAGE, /pnpm build/);
        assert.deepEqual(names(), ["app.asar"]);
    });

    it("undoes everything when a step fails, including the engine copy", async () => {
        put("app.asar", original());
        const hash = await originalHash();
        let renames = 0;
        const flaky: Fsx = { ...nodeFsx, rename: async (from, to) => { if (++renames === 3) throw new Error("disk problem"); await nodeFsx.rename(from, to); } };
        await refuses(inject(context({ fsx: flaky }), canary), EXIT.ERROR, /Everything was undone/);

        assert.deepEqual(names(), ["app.asar"]);
        assert.equal(await originalHash(), hash);
        // The staged copy goes back to its staging folder (ours, cleared on the next try); the live engine folder is not there.
        assert.equal(existsSync(join(data, "canary", "dist")), false);
    });

    it("keeps the earlier engine copy when a refresh fails", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        for (const name of DIST_FILES) writeFileSync(join(source, name), `build 2: ${name}`);
        const failing: Fsx = { ...nodeFsx, writeFile: async () => { throw new Error("cannot write"); } };
        await refuses(inject(context({ fsx: failing }), canary), EXIT.ERROR, /Everything was undone/);
        assert.equal(readFileSync(join(data, "canary", "dist", "main.js"), "utf8"), "build 1: main.js");
        assert.equal((await classifyResources(resources)).state, "patched");
    });
});

describe("one folder per Discord", () => {
    const addStable = () => {
        const stable = join(local, "Discord", "app-1.0.2", "resources");
        mkdirSync(stable, { recursive: true });
        writeFileSync(join(stable, "app.asar"), original("s"));
        return stable;
    };

    it("puts the engine of each Discord in its own folder, and the loader points into it", async () => {
        put("app.asar", original());
        const stable = addStable();
        await inject(context(), canary);
        await inject(context(), { branch: "stable" });
        assert.deepEqual(readdirSync(data).sort(), ["backups", "canary", "stable"]);
        assert.equal((await classifyResources(resources)).loader?.modPath, join(data, "canary", "dist", "main.js"));
        assert.equal((await classifyResources(stable)).loader?.modPath, join(data, "stable", "dist", "main.js"));
    });

    it("keeps the other Discord's engine as it is when one is refreshed or removed", async () => {
        put("app.asar", original());
        addStable();
        await inject(context(), canary);
        await inject(context(), { branch: "stable" });
        for (const name of DIST_FILES) writeFileSync(join(source, name), `build 2: ${name}`);
        await inject(context(), canary);
        assert.equal(readFileSync(join(data, "canary", "dist", "main.js"), "utf8"), "build 2: main.js");
        assert.equal(readFileSync(join(data, "stable", "dist", "main.js"), "utf8"), "build 1: main.js", "the other Discord keeps its own engine");
        await uninject(context(), canary);
        assert.equal(existsSync(join(data, "stable", "dist", "main.js")), true);
    });

    it("keeps the backups of all Discords together, named after their branch", async () => {
        put("app.asar", original());
        addStable();
        await inject(context(), canary);
        await inject(context(), { branch: "stable" });
        const backups = readdirSync(join(data, "backups")).sort();
        assert.equal(backups.length, 2);
        assert.match(backups[0]!, /^canary-/);
        assert.match(backups[1]!, /^stable-/);
    });

    it("says in the status where the engine of that Discord is", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        const res = await status(context(), canary);
        assert.ok(res.messages.join("\n").includes(`The engine is installed in ${join(data, "canary", "dist")}`), res.messages.join("\n"));
        assert.ok(!res.messages.join("\n").includes(join(data, "stable")), "no other Discord's folder is named");
    });

    it("tells in the uninject plan which engine folder stays", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        const plan = await uninject(context(), { ...canary, dryRun: true });
        assert.ok(plan.plan.some(line => line.includes(join(data, "canary", "dist"))));
    });
});

describe("a new folder starts from the old layout", () => {
    const oldFiles = () => {
        mkdirSync(data, { recursive: true });
        writeFileSync(join(data, "settings.json"), '{"schema":1,"plugins":{"Settings":{"values":{"x":1}}}}');
        writeFileSync(join(data, "firewall.json"), '{"schema":1,"rules":[]}');
        for (const name of ["health.json", "state.json", "boot-trace.log", "dev.flag"]) writeFileSync(join(data, name), "old " + name);
        mkdirSync(join(data, "probe"));
        writeFileSync(join(data, "probe", "x.json"), "{}");
    };

    it("copies the settings and the host rules, and nothing else, leaving the old files in place", async () => {
        put("app.asar", original());
        oldFiles();
        await inject(context(), canary);
        assert.deepEqual(readdirSync(join(data, "canary")).sort(), ["dist", "firewall.json", "settings.json"]);
        assert.equal(readFileSync(join(data, "canary", "settings.json"), "utf8"), readFileSync(join(data, "settings.json"), "utf8"));
        for (const name of ["settings.json", "firewall.json", "health.json", "state.json", "boot-trace.log", "dev.flag", "probe"]) assert.equal(existsSync(join(data, name)), true, name + " stays");
    });

    it("does not overwrite what the new folder already has, and does not copy again on a refresh", async () => {
        put("app.asar", original());
        oldFiles();
        await inject(context(), canary);
        writeFileSync(join(data, "canary", "settings.json"), "the new choices");
        writeFileSync(join(data, "settings.json"), "changed in the old place");
        await inject(context(), canary);
        assert.equal(readFileSync(join(data, "canary", "settings.json"), "utf8"), "the new choices");
    });

    it("copies only what exists, and says nothing when there is no old layout", async () => {
        put("app.asar", original());
        const plan = await inject(context(), { ...canary, dryRun: true });
        assert.ok(!plan.plan.some(line => /own folder/.test(line)));
        mkdirSync(data, { recursive: true });
        writeFileSync(join(data, "settings.json"), "{}");
        const withOne = await inject(context(), { ...canary, dryRun: true });
        const line = withOne.plan.find(l => /own folder/.test(l))!;
        assert.match(line, /settings\.json start as copies/);
        assert.doesNotMatch(line, /firewall\.json/);
    });

    it("shows the copy in the plan and changes nothing on a dry run", async () => {
        put("app.asar", original());
        oldFiles();
        const plan = await inject(context(), { ...canary, dryRun: true });
        assert.match(plan.plan.join("\n"), /canary gets its own folder .*settings\.json and firewall\.json start as copies of the old ones/);
        assert.equal(existsSync(join(data, "canary")), false);
    });

    it("does not copy a folder or something that is not a file", async () => {
        put("app.asar", original());
        mkdirSync(join(data, "settings.json"), { recursive: true });
        await inject(context(), canary);
        assert.equal(existsSync(join(data, "canary", "settings.json")), false);
    });

    it("undoes the copy together with the rest when the patch fails", async () => {
        put("app.asar", original());
        oldFiles();
        const failing: Fsx = { ...nodeFsx, writeFile: async () => { throw new Error("disk full"); } };
        await assert.rejects(inject(context({ fsx: failing }), canary));
        assert.equal(existsSync(join(data, "canary", "settings.json")), false);
        assert.equal(existsSync(join(data, "settings.json")), true);
        assert.equal((await classifyResources(resources)).state, "pristine");
    });
});

describe("closing and reopening Discord", () => {
    it("stops when Discord runs and closing is not allowed, touching nothing", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 2;
        await refuses(inject(ctx, canary), EXIT.RUNNING, /is running/);
        assert.deepEqual(names(), ["app.asar"]);
        assert.deepEqual(ctx.platform.calls, []);
    });

    it("closes it normally when allowed, patches, and reopens it", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 2;
        const res = await inject(ctx, { ...canary, closeDiscord: true });
        assert.deepEqual(ctx.platform.calls, ["close DiscordCanary.exe", `start DiscordCanary.exe in ${join(local, "DiscordCanary")}`]);
        assert.equal(res.closedDiscord, true);
        assert.equal(res.restarted, true);
    });

    it("does not reopen it when told not to", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 1;
        const res = await inject(ctx, { ...canary, closeDiscord: true, restart: false });
        assert.deepEqual(ctx.platform.calls, ["close DiscordCanary.exe"]);
        assert.equal(res.restarted, false);
    });

    it("starts Discord afterwards even when it was not running", async () => {
        put("app.asar", original());
        const ctx = context();
        const res = await inject(ctx, { ...canary, closeDiscord: true });
        assert.deepEqual(ctx.platform.calls, [`start DiscordCanary.exe in ${join(local, "DiscordCanary")}`]);
        assert.equal(res.closedDiscord, false);
        assert.equal(res.restarted, true);
    });

    it("does not start Discord when it was not running and restarting is off", async () => {
        put("app.asar", original());
        const ctx = context();
        const res = await inject(ctx, { ...canary, restart: false });
        assert.deepEqual(ctx.platform.calls, []);
        assert.equal(res.restarted, false);
    });

    it("force-closes only when allowed and the normal close failed, and warns about lost drafts", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        await refuses(inject(ctx, { ...canary, closeDiscord: true }), EXIT.RUNNING, /did not close normally/);
        assert.deepEqual(names(), ["app.asar"]);

        const forced = context();
        forced.platform.running = 1;
        forced.platform.closeWorks = false;
        const res = await inject(forced, { ...canary, forceClose: true });
        assert.deepEqual(forced.platform.calls.slice(0, 2), ["close DiscordCanary.exe", "kill DiscordCanary.exe"]);
        assert.match(res.warnings.join("\n"), /force-closed/);
        assert.equal(res.restarted, true);
    });

    it("takes back the start it cut short, so closing Discord does not push the engine towards safe mode", async () => {
        put("app.asar", original());
        const folder = join(data, "canary");
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "state.json"), JSON.stringify({ schema: 1, safeMode: false, safeModeReason: null, quarantine: [], startFailures: {}, bootAttempts: 2, lastBootAt: 5 }));
        const ctx = context();
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        await inject(ctx, { ...canary, forceClose: true });
        assert.equal(JSON.parse(readFileSync(join(folder, "state.json"), "utf8")).bootAttempts, 1);
    });

    it("closes Discord as before when the engine has no state file yet", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 1;
        const res = await inject(ctx, { ...canary, closeDiscord: true });
        assert.equal(res.closedDiscord, true);
        assert.equal(existsSync(join(data, "canary", "state.json")), false);
    });

    it("stops when even a forced close does not work", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 1;
        ctx.platform.closeWorks = false;
        ctx.platform.killWorks = false;
        await refuses(inject(ctx, { ...canary, forceClose: true }), EXIT.RUNNING, /could not be force-closed/);
        assert.deepEqual(names(), ["app.asar"]);
    });

    it("reopens Discord even when the patch failed and was undone", async () => {
        put("app.asar", original());
        const ctx = context({ fsx: { ...nodeFsx, writeFile: async () => { throw new Error("cannot write"); } } });
        ctx.platform.running = 1;
        await refuses(inject(ctx, { ...canary, closeDiscord: true }), EXIT.ERROR, /Everything was undone/);
        assert.ok(ctx.platform.calls.some(call => call.startsWith("start ")));
        assert.deepEqual(names(), ["app.asar"]);
    });

    it("with dry run only says what it would do", async () => {
        put("app.asar", original());
        const ctx = context();
        ctx.platform.running = 1;
        const blocked = await inject(ctx, { ...canary, dryRun: true });
        assert.match(blocked.plan[0], /BLOCKED/);
        const allowed = await inject(ctx, { ...canary, dryRun: true, closeDiscord: true });
        assert.match(allowed.plan[0], /close DiscordCanary\.exe/);
        assert.deepEqual(ctx.platform.calls, []);
    });
});

describe("repair", () => {
    it("fixes a desynced install only when allowed to discard the stale original, which stays in the backup", async () => {
        put("app.asar", original("n"));
        put("_app.asar", original("s"));
        const newOriginal = await originalHash();
        const staleHash = await hashFile(join(resources, "_app.asar"));

        await refuses(repair(context(), canary), EXIT.STATE, /--discard-stale/);
        const res = await repair(context(), { ...canary, discardStale: true });

        assert.equal(res.stateBefore, "desynced");
        assert.equal(res.stateAfter, "patched");
        assert.equal(await hashFile(join(resources, "_app.asar")), newOriginal);
        const backup = (await listBackups(join(data, "backups")))[0];
        assert.equal(backup.manifest.files.find(f => f.name === "_app.asar")?.sha256, staleHash);
        assert.deepEqual(names(), ["app.asar", "_app.asar"].sort());
    });

    it("also refreshes a patched install", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        assert.equal((await repair(context(), canary)).stateAfter, "patched");
    });
});

describe("uninject", () => {
    it("puts Discord's original back, keeps the engine and the data, and makes a backup", async () => {
        put("app.asar", original());
        const hash = await originalHash();
        await inject(context(), canary);
        const res = await uninject(context(), canary);

        assert.equal(res.stateAfter, "pristine");
        assert.equal(await originalHash(), hash);
        assert.deepEqual(names(), ["app.asar"]);
        assert.equal(existsSync(join(data, "canary", "dist", "main.js")), true);
        assert.equal((await listBackups(join(data, "backups"))).length, 2);
    });

    it("has nothing to do on a pristine Discord and refuses another mod's loader", async () => {
        put("app.asar", original());
        const res = await uninject(context(), canary);
        assert.match(res.messages[0], /Nothing to remove/);
        assert.deepEqual(names(), ["app.asar"]);

        rmSync(join(resources, "app.asar"));
        put("app.asar", buildAsar({ "index.js": "require(\"C:\\\\other.js\")", "package.json": JSON.stringify({ main: "index.js" }) }));
        put("_app.asar", original());
        await refuses(uninject(context(), canary), EXIT.STATE, /foreign-loader/);
    });
});

describe("restore", () => {
    it("goes back to the untouched Discord from the verified backup", async () => {
        put("app.asar", original());
        const hash = await originalHash();
        await inject(context(), canary);
        const res = await restore(context(), canary);

        assert.equal(res.stateAfter, "pristine");
        assert.equal(await originalHash(), hash);
        assert.deepEqual(names(), ["app.asar"]);
        // The state before the restore was backed up too, under its own name.
        assert.equal((await listBackups(join(data, "backups"))).length, 2);
    });

    it("recovers from a cut-short operation: leftovers are cleared and the state is verified", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        put("app.asar.amiricord-new", "half written");
        put("_app.asar.amiricord-restore", "junk");
        const res = await restore(context(), canary);
        assert.equal(res.stateAfter, "pristine");
        assert.deepEqual(names(), ["app.asar"]);
    });

    it("recovers a broken install where app.asar is gone", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        rmSync(join(resources, "app.asar"));
        assert.equal((await restore(context(), canary)).stateAfter, "pristine");
    });

    it("has no backup to use, or a backup of another Discord version, or a damaged one", async () => {
        put("app.asar", original());
        await refuses(restore(context(), canary), EXIT.NOT_FOUND, /no backup/i);

        await inject(context(), canary);
        const backup = (await listBackups(join(data, "backups")))[0];
        const manifestPath = join(backup.dir, BACKUP_MANIFEST);
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { appVersion: string; };

        writeFileSync(manifestPath, JSON.stringify({ ...manifest, appVersion: "app-0.9.9" }));
        await refuses(restore(context(), canary), EXIT.NOT_FOUND, /no backup/i);
        await refuses(restore(context(), { ...canary, from: backup.dir.split(/[\\/]/).pop() }), EXIT.STATE, /updated since/);

        writeFileSync(manifestPath, JSON.stringify(manifest));
        writeFileSync(join(backup.dir, "app.asar"), "damaged");
        await refuses(restore(context(), canary), EXIT.ERROR, /damaged/);
        assert.equal((await classifyResources(resources)).state, "patched");
    });

    it("refuses a backup name that is a path", async () => {
        put("app.asar", original());
        for (const from of ["..", "../x", "a\\b", "C:\\x", ""]) {
            await refuses(restore(context(), { ...canary, from }), EXIT.USAGE, /not a backup name/);
        }
    });

    it("with dry run changes nothing", async () => {
        put("app.asar", original());
        await inject(context(), canary);
        const res = await restore(context(), { ...canary, dryRun: true });
        assert.equal(res.dryRun, true);
        assert.equal((await classifyResources(resources)).state, "patched");
        assert.equal((await listBackups(join(data, "backups"))).length, 1);
    });
});

describe("parseTasklist", () => {
    it("reads the process ids of the program asked for", () => {
        const output = [
            "\"DiscordCanary.exe\",\"1234\",\"Console\",\"1\",\"123,456 K\"",
            "\"discordcanary.exe\",\"5678\",\"Console\",\"1\",\"9 K\"",
            "\"Other.exe\",\"9\",\"Console\",\"1\",\"1 K\""
        ].join("\r\n");
        assert.deepEqual(parseTasklist(output, "DiscordCanary.exe"), [1234, 5678]);
    });

    it("gives nothing when no process matches", () => {
        assert.deepEqual(parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n", "DiscordCanary.exe"), []);
        assert.deepEqual(parseTasklist("", "x.exe"), []);
    });
});
