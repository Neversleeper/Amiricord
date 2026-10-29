/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The installer's commands: status, inject, repair, uninject and restore. Each one first reads the state of Discord's
// `resources` folder and only goes on from states that make sense for it. Anything that changes files takes a verified
// backup first and runs as one transaction that is undone if any step or the final check fails.
// Discord is closed only when the caller allows it, and reopened afterwards if the installer closed it.
// Design: docs/analysis-08-installer-patching.md.

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import { enableDiscordDevTools } from "../main/discordDevTools";
import { BootState, forgetUnfinishedBoot, parseBootState, serializeBootState } from "../shared/bootState";
import { buildLoaderAsar } from "./asar";
import { BackupInfo, createBackup, listBackups, readBackup, verifyBackup } from "./backup";
import { Classification, classifyResources, LEFTOVER_NAMES, State } from "./classify";
import { AppFolder, Branch, BRANCH_DIRS, BRANCH_EXES, findInstall, Install, isBranch } from "./discover";
import { carryOldFiles, DIST_ENTRY, distPaths, distSwapSteps, missingDistFiles, stageDist, verifyInstalledDist } from "./dist";
import { hashFile } from "./hash";
import { Platform } from "./platform";
import { CommitStep, describeStep, Fsx, nodeFsx, runTransaction, Step } from "./transaction";

export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, RUNNING: 3, STATE: 4, NOT_FOUND: 5 } as const;

/** A refusal or failure that has a plain explanation for the owner. `exit` is the code the command line returns. */
export class InstallerError extends Error {
    constructor(message: string, readonly exit: number, readonly kind: string) {
        super(message);
        this.name = "InstallerError";
    }
}

export interface Context {
    /** `%LOCALAPPDATA%` */
    localAppData: string;
    /** `%APPDATA%\Amiricord`: the shared parent. Each Discord has its own folder inside it (`stable`, `canary`, `ptb`) for its engine and data; the backups stay here. */
    dataDir: string;
    /** The project's `dist` folder, where `pnpm build` writes. */
    distSource: string;
    platform: Platform;
    fsx?: Fsx;
    now?: () => Date;
    closeTimeoutMs?: number;
    /** Live progress, one short line at a time (the menu prints them with coloured labels). Optional; it can never stop an operation. */
    log?: (level: "INFO" | "OK" | "WARN" | "ERROR", text: string) => void;
}

export interface Options {
    /** Required, and one of stable, canary, ptb. There is deliberately no automatic mode. */
    branch?: string;
    /** Show what would happen and change nothing. */
    dryRun?: boolean;
    /** Allow closing Discord if it is running (normal close first). */
    closeDiscord?: boolean;
    /** Also allow a forced close when it does not exit normally. */
    forceClose?: boolean;
    /** Reopen Discord afterwards when the installer closed it. Default true. */
    restart?: boolean;
    /** repair only: allow throwing away the stale `_app.asar` (it stays in the backup). */
    discardStale?: boolean;
    /** restore only: name of a backup folder; default is the newest backup of the pristine state. */
    from?: string;
}

export interface Result {
    command: string;
    branch: Branch;
    dryRun: boolean;
    appVersion: string | null;
    resources: string | null;
    stateBefore: State | null;
    stateAfter: State | null;
    /** What would be done, or was done, step by step. */
    plan: string[];
    warnings: string[];
    messages: string[];
    backupDir: string | null;
    closedDiscord: boolean;
    restarted: boolean;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function say(ctx: Context, level: "INFO" | "OK" | "WARN" | "ERROR", text: string): void {
    try {
        ctx.log?.(level, text);
    } catch {
        // Showing progress is a help; it must never stop the operation.
    }
}

export function validateBranch(value: string | undefined): Branch {
    if (!value) throw new InstallerError("The branch is missing: use stable, canary or ptb. There is deliberately no automatic mode.", EXIT.USAGE, "usage");
    if (!isBranch(value)) throw new InstallerError(`"${value}" is not a branch. Use stable, canary or ptb.`, EXIT.USAGE, "usage");
    return value;
}

function newResult(command: string, branch: Branch, dryRun: boolean): Result {
    return {
        command, branch, dryRun, appVersion: null, resources: null, stateBefore: null, stateAfter: null,
        plan: [], warnings: [], messages: [], backupDir: null, closedDiscord: false, restarted: false
    };
}

async function resolveTarget(ctx: Context, branch: Branch): Promise<{ install: Install; app: AppFolder; }> {
    const install = await findInstall(ctx.localAppData, branch);
    if (!install?.active) {
        throw new InstallerError(`Discord ${branch} was not found in ${join(ctx.localAppData, BRANCH_DIRS[branch])}.`, EXIT.NOT_FOUND, "not-found");
    }
    return { install, app: install.active };
}

const backupRoot = (ctx: Context) => join(ctx.dataDir, "backups");

/** The folder of one Discord's engine and data: `%APPDATA%\Amiricord\<branch>`. */
export const engineDir = (ctx: Context, branch: Branch) => join(ctx.dataDir, branch);

function refuseIfLeftovers(c: Classification): void {
    if (c.leftovers.length > 0) {
        throw new InstallerError(
            `A previous operation was cut short and left temporary files in resources (${c.leftovers.join(", ")}). Use restore to go back to a backup.`,
            EXIT.STATE, "leftovers"
        );
    }
}

function makeJournal(dir: string) {
    const file = join(dir, "journal.jsonl");
    return async (event: string, data: unknown) => {
        try {
            await appendFile(file, JSON.stringify({ at: new Date().toISOString(), event, data }) + "\n");
        } catch {
            // The journal is a help for support; it must never stop the operation.
        }
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Closing and reopening Discord

/** Returns true when the installer closed Discord (so it must reopen it later). Throws when Discord is running and may not be closed. */
async function ensureClosed(ctx: Context, branch: Branch, opts: Options, res: Result): Promise<boolean> {
    const exe = BRANCH_EXES[branch];
    const running = await ctx.platform.listProcesses(exe);
    if (running.length === 0) return false;

    const info = `${exe} is running (${running.length} processes).`;
    const mayClose = !!(opts.closeDiscord || opts.forceClose);
    if (opts.dryRun) {
        res.plan.unshift(mayClose
            ? `close ${exe} (normal close first${opts.forceClose ? ", forced if it does not exit" : ""}) and reopen it afterwards`
            : `BLOCKED: ${exe} is running`);
        if (!mayClose) res.warnings.push(`${info} To apply this for real, close it or allow the installer to close it.`);
        return false;
    }
    if (!mayClose) {
        throw new InstallerError(`${info} Close it completely (also its tray icon), or allow the installer to close it.`, EXIT.RUNNING, "running");
    }

    const timeout = ctx.closeTimeoutMs ?? (opts.forceClose ? 5_000 : 15_000);
    try {
        say(ctx, "INFO", `Closing ${exe}...`);
        await ctx.platform.closeProcesses(exe, timeout);
        res.messages.push(`Closed ${exe} normally.`);
    } catch (error) {
        if (!opts.forceClose) throw new InstallerError(`${exe} did not close normally (${message(error)}). Close it yourself, or allow a forced close.`, EXIT.RUNNING, "running");
        try {
            await ctx.platform.killProcesses(exe);
        } catch (killError) {
            throw new InstallerError(`${exe} could not be force-closed (${message(killError)}).`, EXIT.RUNNING, "running");
        }
        res.warnings.push(`${exe} did not exit normally, so it was force-closed (unsaved drafts and an active call were lost).`);
    }
    if ((await ctx.platform.listProcesses(exe)).length > 0) {
        throw new InstallerError(`${exe} is still running after it was asked to close.`, EXIT.RUNNING, "running");
    }
    await forgetClosedBoot(engineDir(ctx, branch));
    res.closedDiscord = true;
    return true;
}

/**
 * Closing Discord ourselves cuts a start short, and a start cut short would count towards safe mode (three in a row turn it on). It was not a failure, so it
 * is taken back. Best effort: a missing or unreadable file means there is nothing to take back.
 */
export async function forgetClosedBoot(folder: string): Promise<void> {
    const file = join(folder, "state.json");
    try {
        const before = parseBootState(await readFile(file, "utf8")).state;
        const after: BootState = forgetUnfinishedBoot(before);
        if (after.bootAttempts !== before.bootAttempts) await writeFile(file, serializeBootState(after), "utf8");
    } catch {
        // No file, or one that cannot be read or written: the engine starts from its own defaults.
    }
}

async function reopen(ctx: Context, install: Install, branch: Branch, opts: Options, res: Result): Promise<void> {
    if (opts.restart === false) return;
    try {
        say(ctx, "INFO", "Reopening Discord...");
        await ctx.platform.start(install.root, BRANCH_EXES[branch]);
        res.restarted = true;
        res.messages.push("Reopened Discord.");
    } catch (error) {
        res.warnings.push(`Discord could not be reopened (${message(error)}). Open it yourself.`);
    }
}

function failure(error: unknown, rolledBack: boolean, undoErrors: string[], res: Result): InstallerError {
    const tail = rolledBack
        ? "Everything was undone: Discord is as it was."
        : `WARNING: the undo had errors (${undoErrors.join("; ")}). Use restore with the backup in ${res.backupDir}.`;
    return new InstallerError(`${message(error)} ${tail}`, EXIT.ERROR, "apply");
}

// ---------------------------------------------------------------------------------------------------------------------
// status

export async function status(ctx: Context, opts: Options): Promise<Result> {
    const branch = validateBranch(opts.branch);
    const res = newResult("status", branch, false);
    const { app } = await resolveTarget(ctx, branch);
    res.appVersion = app.name;
    res.resources = app.resources;

    const c = await classifyResources(app.resources);
    res.stateBefore = res.stateAfter = c.state;
    res.messages.push(`Discord ${branch} ${app.name}: ${c.state}. ${c.reason}.`);
    if (c.loader?.modPath) res.messages.push(`The loader starts: ${c.loader.modPath}`);
    if (c.leftovers.length) res.warnings.push(`Temporary files left by a cut-short operation: ${c.leftovers.join(", ")}. Use restore.`);

    const running = await ctx.platform.listProcesses(BRANCH_EXES[branch]);
    res.messages.push(running.length ? `${BRANCH_EXES[branch]} is running (${running.length} processes).` : `${BRANCH_EXES[branch]} is not running.`);

    const engine = distPaths(engineDir(ctx, branch)).target;
    const missing = await missingDistFiles(engine);
    res.messages.push(missing.length ? `The installed engine in ${engine} is not complete (missing: ${missing.join(", ")}).` : `The engine is installed in ${engine}.`);

    const backups = (await listBackups(backupRoot(ctx))).filter(b => b.manifest.branch === branch);
    res.messages.push(`${backups.length} backup(s) for ${branch}.`);
    return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// inject and repair

async function patch(ctx: Context, opts: Options, command: "inject" | "repair"): Promise<Result> {
    const branch = validateBranch(opts.branch);
    const dryRun = !!opts.dryRun;
    const res = newResult(command, branch, dryRun);
    const { install, app } = await resolveTarget(ctx, branch);
    res.appVersion = app.name;
    res.resources = app.resources;

    const c = await classifyResources(app.resources);
    res.stateBefore = c.state;
    refuseIfLeftovers(c);

    const missing = await missingDistFiles(ctx.distSource);
    if (missing.length) {
        throw new InstallerError(`The build is incomplete (missing ${missing.join(", ")} in ${ctx.distSource}). Run "pnpm build" first.`, EXIT.USAGE, "no-build");
    }

    const discard = c.state === "desynced";
    if (discard) {
        if (command !== "repair") {
            throw new InstallerError("Discord was updated while patched: app.asar is a new original but an old _app.asar was left behind. Use repair.", EXIT.STATE, "desynced");
        }
        if (!opts.discardStale) {
            throw new InstallerError("Repair has to throw away the old _app.asar left by the earlier version (it is kept in the backup). Allow it with --discard-stale.", EXIT.STATE, "desynced");
        }
    } else if (c.state !== "pristine" && c.state !== "patched") {
        throw new InstallerError(`${command} cannot continue: state "${c.state}". ${c.reason}.${c.state === "broken" ? " Try restore." : ""}`, EXIT.STATE, c.state);
    }

    const P = (name: string) => join(app.resources, name);
    const branchDir = engineDir(ctx, branch);
    const paths = distPaths(branchDir);
    const modPath = join(paths.target, DIST_ENTRY);
    const loader = buildLoaderAsar(modPath);
    const swap = await distSwapSteps(paths);

    const carry = await carryOldFiles(ctx.dataDir, branchDir);
    const steps: Step[] = [...swap.steps, ...carry];
    const commit: CommitStep[] = swap.remove.map(path => ({ type: "remove", path }));
    if (discard) {
        steps.push({ type: "rename", from: P("_app.asar"), to: P("_app.asar.amiricord-restore") });
        commit.push({ type: "remove", path: P("_app.asar.amiricord-restore") });
    }
    steps.push({ type: "write", path: P("app.asar.amiricord-new"), data: loader });
    if (c.state === "patched") {
        steps.push({ type: "rename", from: P("app.asar"), to: P("app.asar.amiricord-old") });
        steps.push({ type: "rename", from: P("app.asar.amiricord-new"), to: P("app.asar") });
        commit.push({ type: "remove", path: P("app.asar.amiricord-old") });
    } else {
        steps.push({ type: "rename", from: P("app.asar"), to: P("_app.asar") });
        steps.push({ type: "rename", from: P("app.asar.amiricord-new"), to: P("app.asar") });
    }

    res.plan = [
        `back up app.asar${c.original.kind !== "missing" ? ", _app.asar" : ""} and build_info.json into ${backupRoot(ctx)} and check the copies`,
        `copy the build from ${ctx.distSource} to ${paths.staging} and check every file`,
        ...(carry.length ? [`${branch} gets its own folder ${branchDir}: ${carry.map(step => (step.type === "copy" ? basename(step.to) : "")).join(" and ")} start as copies of the old ones in ${ctx.dataDir} (the old files stay)`] : []),
        ...steps.map(describeStep),
        `check that app.asar is our loader pointing to ${modPath} and that Discord's original is unchanged`,
        ...commit.map(describeStep)
    ];
    res.stateAfter = "patched";

    await ensureClosed(ctx, branch, { ...opts, dryRun }, res);
    if (dryRun) return res;

    try {
        say(ctx, "INFO", `${command === "repair" ? "Repairing" : "Patching"} ${install.root}...`);
        say(ctx, "INFO", "Backing up Discord's files...");
        const backup = await createBackup({ resources: app.resources, backupRoot: backupRoot(ctx), branch, appVersion: app.name, state: c.state, now: ctx.now?.() });
        res.backupDir = backup.dir;
        say(ctx, "OK", "Backup made and checked.");
        const originalName = c.state === "patched" ? "_app.asar" : "app.asar";
        const originalHash = backup.manifest.files.find(f => f.name === originalName)?.sha256;

        say(ctx, "INFO", "Copying the engine...");
        const hashes = await stageDist(ctx.distSource, paths);

        say(ctx, "INFO", "Installing the loader and checking the result...");
        const result = await runTransaction({
            fsx: ctx.fsx ?? nodeFsx,
            steps,
            commit,
            journal: makeJournal(backup.dir),
            verify: async () => {
                const after = await classifyResources(app.resources);
                if (after.state !== "patched" || after.loader?.modPath !== modPath) throw new Error(`the check failed: Discord is in state ${after.state}`);
                if (originalHash && (await hashFile(P("_app.asar"))) !== originalHash) throw new Error("the check failed: _app.asar is not the backed-up original");
                const problems = await verifyInstalledDist(paths.target, hashes);
                if (problems.length) throw new Error(`the check failed: ${problems.join("; ")}`);
            }
        });
        if (!result.ok) throw failure(result.error, result.rolledBack, result.undoErrors, res);
        res.warnings.push(...result.commitErrors.map(e => `A temporary file could not be deleted: ${e}`));

        res.stateAfter = (await classifyResources(app.resources)).state;
        // Developer tools are on by default (docs/decisions.md). Discord is closed here, so its own files are not being written. Never stops the install.
        const devtools = enableDiscordDevTools(join(dirname(ctx.dataDir), BRANCH_DIRS[branch]));
        res.messages.push(...devtools.changed);
        res.warnings.push(...devtools.problems);
        res.messages.push(`${command === "repair" ? "Repaired" : "Patched"} ${app.name}. Backup: ${backup.dir}`);
        say(ctx, "INFO", `Successfully ${command === "repair" ? "repaired" : "patched"} ${install.root}`);
        return res;
    } finally {
        await reopen(ctx, install, branch, opts, res);
    }
}

export const inject = (ctx: Context, opts: Options) => patch(ctx, opts, "inject");

export const repair = (ctx: Context, opts: Options) => patch(ctx, opts, "repair");

// ---------------------------------------------------------------------------------------------------------------------
// uninject

export async function uninject(ctx: Context, opts: Options): Promise<Result> {
    const branch = validateBranch(opts.branch);
    const dryRun = !!opts.dryRun;
    const res = newResult("uninject", branch, dryRun);
    const { install, app } = await resolveTarget(ctx, branch);
    res.appVersion = app.name;
    res.resources = app.resources;

    const c = await classifyResources(app.resources);
    res.stateBefore = c.state;
    refuseIfLeftovers(c);

    if (c.state === "pristine") {
        res.stateAfter = "pristine";
        res.messages.push("Nothing to remove: app.asar is already Discord's original.");
        return res;
    }
    if (c.state !== "patched") {
        throw new InstallerError(`uninject cannot continue: state "${c.state}". ${c.reason}.${c.state === "broken" ? " Try restore." : ""}`, EXIT.STATE, c.state);
    }

    const P = (name: string) => join(app.resources, name);
    const steps: Step[] = [
        { type: "rename", from: P("app.asar"), to: P("app.asar.amiricord-old") },
        { type: "rename", from: P("_app.asar"), to: P("app.asar") }
    ];
    const commit: CommitStep[] = [{ type: "remove", path: P("app.asar.amiricord-old") }];
    res.plan = [
        `back up the current files into ${backupRoot(ctx)} and check the copies`,
        ...steps.map(describeStep),
        "check that app.asar is Discord's original again",
        ...commit.map(describeStep),
        `the engine files in ${distPaths(engineDir(ctx, branch)).target} and your data stay where they are`
    ];
    res.stateAfter = "pristine";

    await ensureClosed(ctx, branch, { ...opts, dryRun }, res);
    if (dryRun) return res;

    try {
        say(ctx, "INFO", `Unpatching ${install.root}...`);
        say(ctx, "INFO", "Backing up Discord's files...");
        const backup = await createBackup({ resources: app.resources, backupRoot: backupRoot(ctx), branch, appVersion: app.name, state: c.state, now: ctx.now?.() });
        res.backupDir = backup.dir;
        say(ctx, "OK", "Backup made and checked.");
        const originalHash = backup.manifest.files.find(f => f.name === "_app.asar")?.sha256;

        const result = await runTransaction({
            fsx: ctx.fsx ?? nodeFsx,
            steps,
            commit,
            journal: makeJournal(backup.dir),
            verify: async () => {
                const after = await classifyResources(app.resources);
                if (after.state !== "pristine") throw new Error(`the check failed: Discord is in state ${after.state}`);
                if (originalHash && (await hashFile(P("app.asar"))) !== originalHash) throw new Error("the check failed: app.asar is not the backed-up original");
            }
        });
        if (!result.ok) throw failure(result.error, result.rolledBack, result.undoErrors, res);
        res.warnings.push(...result.commitErrors.map(e => `A temporary file could not be deleted: ${e}`));

        res.stateAfter = (await classifyResources(app.resources)).state;
        res.messages.push(`Removed the loader from ${app.name}. Backup: ${backup.dir}`);
        say(ctx, "INFO", `Successfully unpatched ${install.root}`);
        return res;
    } finally {
        await reopen(ctx, install, branch, opts, res);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// restore

/** Backup folder names are plain names inside our own backup folder; anything with a path in it is refused. */
function isPlainName(name: string): boolean {
    return name.length > 0 && !isAbsolute(name) && !/[\\/]/.test(name) && name !== "." && name !== "..";
}

async function chooseBackup(ctx: Context, branch: Branch, app: AppFolder, from: string | undefined): Promise<BackupInfo> {
    let info: BackupInfo | null;
    if (from !== undefined) {
        if (!isPlainName(from)) throw new InstallerError(`"${from}" is not a backup name. Give only the folder name from the backups list.`, EXIT.USAGE, "usage");
        info = await readBackup(join(backupRoot(ctx), from));
        if (!info) throw new InstallerError(`The backup "${from}" does not exist or its manifest is damaged.`, EXIT.NOT_FOUND, "no-backup");
    } else {
        const all = await listBackups(backupRoot(ctx));
        info = all.find(b => b.manifest.branch === branch && b.manifest.appVersion === app.name && b.manifest.state === "pristine") ?? null;
        if (!info) throw new InstallerError(`There is no backup of ${app.name} (${branch}) taken while Discord was untouched. Nothing to restore from.`, EXIT.NOT_FOUND, "no-backup");
    }
    if (info.manifest.branch !== branch || info.manifest.appVersion !== app.name) {
        throw new InstallerError(
            `That backup is from ${info.manifest.branch} ${info.manifest.appVersion}, but the installed one is ${branch} ${app.name}. Discord was updated since, so it cannot be put back.`,
            EXIT.STATE, "backup-mismatch"
        );
    }
    return info;
}

export async function restore(ctx: Context, opts: Options): Promise<Result> {
    const branch = validateBranch(opts.branch);
    const dryRun = !!opts.dryRun;
    const res = newResult("restore", branch, dryRun);
    const { install, app } = await resolveTarget(ctx, branch);
    res.appVersion = app.name;
    res.resources = app.resources;

    const c = await classifyResources(app.resources);
    res.stateBefore = c.state;

    const backup = await chooseBackup(ctx, branch, app, opts.from);
    const problems = await verifyBackup(backup);
    if (problems.length) throw new InstallerError(`The backup is damaged (${problems.join("; ")}), so it will not be used.`, EXIT.ERROR, "bad-backup");

    const P = (name: string) => join(app.resources, name);
    const steps: Step[] = [];
    const commit: CommitStep[] = [];
    if (c.app.kind !== "missing") {
        steps.push({ type: "rename", from: P("app.asar"), to: P("app.asar.amiricord-old") });
        commit.push({ type: "remove", path: P("app.asar.amiricord-old") });
    }
    if (c.original.kind !== "missing") {
        steps.push({ type: "rename", from: P("_app.asar"), to: P("_app.asar.amiricord-restore") });
        commit.push({ type: "remove", path: P("_app.asar.amiricord-restore") });
    }
    const restored = backup.manifest.files.filter(f => f.name === "app.asar" || f.name === "_app.asar");
    for (const file of restored) steps.push({ type: "copy", from: join(backup.dir, file.name), to: P(file.name) });

    res.plan = [
        ...(c.leftovers.length ? [`delete the temporary files left by the cut-short operation: ${c.leftovers.join(", ")}`] : []),
        `back up the current files into ${backupRoot(ctx)} (if any) and check the copies`,
        ...steps.map(describeStep),
        `check that Discord is in state "${backup.manifest.state}" again and the files match the backup`,
        ...commit.map(describeStep)
    ];
    res.stateAfter = backup.manifest.state as State;

    await ensureClosed(ctx, branch, { ...opts, dryRun }, res);
    if (dryRun) return res;

    try {
        // The temporary names belong to us. Clearing them now makes room for the moves below; the verified backup is the safety net.
        for (const name of LEFTOVER_NAMES) await (ctx.fsx ?? nodeFsx).remove(P(name));

        if (c.app.kind !== "missing" || c.original.kind !== "missing") {
            res.backupDir = (await createBackup({ resources: app.resources, backupRoot: backupRoot(ctx), branch, appVersion: app.name, state: c.state, now: ctx.now?.() })).dir;
        }

        const result = await runTransaction({
            fsx: ctx.fsx ?? nodeFsx,
            steps,
            commit,
            journal: res.backupDir ? makeJournal(res.backupDir) : undefined,
            verify: async () => {
                const after = await classifyResources(app.resources);
                if (after.state !== backup.manifest.state) throw new Error(`the check failed: Discord is in state ${after.state}, expected ${backup.manifest.state}`);
                for (const file of restored) {
                    if ((await hashFile(P(file.name))) !== file.sha256) throw new Error(`the check failed: ${file.name} does not match the backup`);
                }
            }
        });
        if (!result.ok) throw failure(result.error, result.rolledBack, result.undoErrors, res);
        res.warnings.push(...result.commitErrors.map(e => `A temporary file could not be deleted: ${e}`));

        res.stateAfter = (await classifyResources(app.resources)).state;
        res.messages.push(`Restored ${app.name} from ${backup.dir}.`);
        return res;
    } finally {
        await reopen(ctx, install, branch, opts, res);
    }
}

export const COMMAND_NAMES = ["status", "inject", "repair", "uninject", "restore"] as const;
