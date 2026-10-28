/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The installer's command line and menu. With a command it works from flags and, for anything that changes files,
// only shows the plan unless `--yes` is given. With no command, in a terminal, it asks with menus.
// All the work is done by `commands.ts`; this file only asks, shows and passes on.

import { PROJECT_NAME } from "../shared/project";
import { classifyResources, State } from "./classify";
import { Context, EXIT, inject, InstallerError, Options, repair, restore, Result, status, uninject } from "./commands";
import { Branch, BRANCH_EXES, BRANCHES, findInstall } from "./discover";
import { Level, levelLabel, Style } from "./ui/ansi";
import type { KeySource } from "./ui/keys";
import { MenuIo, MenuItem, selectMenu, Tone } from "./ui/menu";

export type CommandName = "status" | "inject" | "repair" | "uninject" | "restore";

const RUNNERS: Record<CommandName, (ctx: Context, opts: Options) => Promise<Result>> = { status, inject, repair, uninject, restore };

const ALIASES: Record<string, CommandName> = {
    status: "status", inject: "inject", install: "inject", repair: "repair", uninject: "uninject", uninstall: "uninject", restore: "restore"
};

export interface Io {
    out(text: string): void;
    err(text: string): void;
    style: Style;
    /** Keys from a terminal, or null when the input is not interactive (then there is no menu). */
    keys: KeySource | null;
}

export interface ParsedArgs {
    command: CommandName | null;
    options: Options;
    /** Apply changes without asking. Without it, a changing command only shows its plan. */
    yes: boolean;
    help: boolean;
    errors: string[];
}

const TOOL = "pnpm installer";

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const parsed: ParsedArgs = { command: null, options: {}, yes: false, help: false, errors: [] };
    const needsValue = (flag: string, value: string | undefined): value is string => {
        if (value === undefined || value.startsWith("--")) {
            parsed.errors.push(`${flag} needs a value.`);
            return false;
        }
        return true;
    };

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        let inline: string | undefined;
        const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
        if (equals > 0) {
            inline = arg.slice(equals + 1);
            arg = arg.slice(0, equals);
        }
        const value = () => inline ?? argv[++i];

        switch (arg) {
            case "--branch": { const v = value(); if (needsValue(arg, v)) parsed.options.branch = v; break; }
            case "--from": { const v = value(); if (needsValue(arg, v)) parsed.options.from = v; break; }
            case "--dry-run": parsed.options.dryRun = true; break;
            case "--close-discord": parsed.options.closeDiscord = true; break;
            case "--force-close": parsed.options.forceClose = true; break;
            case "--no-restart": parsed.options.restart = false; break;
            case "--discard-stale": parsed.options.discardStale = true; break;
            case "--yes": case "-y": parsed.yes = true; break;
            case "--help": case "-h": parsed.help = true; break;
            default:
                if (arg.startsWith("-")) parsed.errors.push(`Unknown option ${arg}.`);
                else if (parsed.command === null && ALIASES[arg]) parsed.command = ALIASES[arg];
                else parsed.errors.push(`Unexpected "${arg}".`);
        }
    }
    return parsed;
}

export function usage(style: Style): string {
    return [
        style.bold(`${PROJECT_NAME} installer`),
        "",
        `  ${TOOL}                          open the menu (needs a terminal)`,
        `  ${TOOL} <command>                 in a terminal: ask which Discord, show the plan, ask before changing anything`,
        `  ${TOOL} <command> --branch <stable|canary|ptb> [options]`,
        "",
        "Shortcuts: pnpm inject, pnpm uninject, pnpm repair, pnpm status (the same as the commands below).",
        "",
        "Commands",
        "  status      show the state of that Discord (changes nothing)",
        "  inject      install the loader and the engine (alias: install)",
        "  repair      fix an install after Discord updated (needs --discard-stale)",
        "  uninject    put Discord's original back (alias: uninstall)",
        "  restore     go back to a verified backup",
        "",
        "Options",
        "  --dry-run          show what would happen and change nothing",
        "  --yes              apply the change; without it a changing command only shows its plan",
        "  --close-discord    allow closing Discord if it is open (it is reopened afterwards)",
        "  --force-close      also allow a forced close if it does not exit normally",
        "  --no-restart       do not reopen Discord afterwards",
        "  --discard-stale    repair: allow discarding the old _app.asar (kept in the backup)",
        "  --from <name>      restore: a backup folder name instead of the newest untouched one",
        "  --help             this text"
    ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Showing results

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function formatResult(res: Result, style: Style): string[] {
    const lines = [style.bold(`${res.command} · ${titleCase(res.branch)}${res.appVersion ? ` · ${res.appVersion}` : ""}`)];
    if (res.plan.length) {
        lines.push(res.dryRun ? "What would happen:" : "What was done:");
        res.plan.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    }
    for (const warning of res.warnings) lines.push(`${style.yellow("!")} ${warning}`);
    for (const note of res.messages) lines.push(`  ${note}`);
    return lines;
}

export function printResult(io: Io, res: Result): void {
    io.out(formatResult(res, io.style).join("\n") + "\n");
    io.out(res.dryRun ? `${io.style.dim("Nothing was changed.")}\n` : `${io.style.green("✔ Success!")}\n`);
}

export function printFailure(io: Io, error: unknown): number {
    const known = error instanceof InstallerError;
    io.err(`${io.style.red("❌ Failed!")} ${error instanceof Error ? error.message : String(error)}\n`);
    return known ? error.exit : EXIT.ERROR;
}

// ---------------------------------------------------------------------------------------------------------------------
// The menu

const STATE_TEXT: Record<State, { text: string; tone: Tone; }> = {
    pristine: { text: "Amiricord not installed", tone: "normal" },
    patched: { text: "Amiricord installed", tone: "good" },
    desynced: { text: "Discord was updated, needs repair", tone: "warn" },
    broken: { text: "damaged, needs restore", tone: "warn" },
    "foreign-loader": { text: "another mod is installed", tone: "warn" },
    unsupported: { text: "unsupported layout", tone: "warn" }
};

interface Found {
    branch: Branch;
    state: State;
}

/**
 * Where Amiricord is installed: one line per Discord install found (the branch, its version and the state), so that the short commands
 * (`pnpm inject --branch canary`), which have no menu, still say which Discord has Amiricord. Reads only; never throws.
 */
export async function overviewLines(ctx: Context, style: Style): Promise<string[]> {
    const lines: string[] = [style.bold("Amiricord on this PC:")];
    for (const branch of BRANCHES) {
        let text: string;
        try {
            const install = await findInstall(ctx.localAppData, branch);
            if (!install?.active) {
                lines.push(`  ${style.dim("·")} ${titleCase(branch).padEnd(6)} ${style.dim("not found")}`);
                continue;
            }
            const shown = STATE_TEXT[(await classifyResources(install.active.resources)).state];
            const mark = shown.tone === "good" ? style.green("✔") : shown.tone === "warn" ? style.yellow("!") : style.dim("·");
            const words = shown.tone === "good" ? style.green(shown.text) : shown.tone === "warn" ? style.yellow(shown.text) : shown.text;
            text = `  ${mark} ${titleCase(branch).padEnd(6)} ${install.active.name}  ${words}`;
        } catch {
            text = `  ${style.dim("·")} ${titleCase(branch).padEnd(6)} ${style.dim("could not be read")}`;
        }
        lines.push(text);
    }
    return lines;
}

/** The overview goes after the result of every command that touches or shows a Discord install. */
const SHOWS_OVERVIEW = new Set<CommandName>(["inject", "uninject", "repair", "restore", "status"]);

/** `preset` is the action already chosen by a short command (`pnpm inject`): the menu then only asks which Discord. */
async function interactive(io: Io, ctx: Context, keys: KeySource, preset: CommandName | null = null): Promise<number> {
    const menu = { out: io.out, style: io.style, keys };
    io.out(`${io.style.bold(`${PROJECT_NAME} installer`)}\n\n`);

    const items: MenuItem<Found>[] = [];
    for (const branch of BRANCHES) {
        const install = await findInstall(ctx.localAppData, branch);
        if (!install?.active) continue;
        const { state } = await classifyResources(install.active.resources);
        const shown = STATE_TEXT[state];
        items.push({ label: `${titleCase(branch)} · ${install.active.name} · ${shown.text}`, detail: install.root, tone: shown.tone, value: { branch, state } });
    }
    if (items.length === 0) {
        io.err(`${io.style.red("❌ Failed!")} No Discord was found in ${ctx.localAppData}.\n`);
        return EXIT.NOT_FOUND;
    }

    // The short commands that can be undone from a verified backup (`pnpm inject`, `pnpm uninject`, `pnpm repair`) work like TestCord's installer:
    // choose the Discord and it goes ahead, with live labelled lines. Everything else keeps the plan and the question.
    const straight = preset !== null && STRAIGHT_TITLES[preset] ? preset : null;
    const target = await selectMenu(menu, straight ? STRAIGHT_TITLES[straight]! : "Which Discord?", items);
    if (!target) return cancelled(io);
    if (straight) return straightThrough(io, ctx, menu, straight, target);

    const action = preset ?? await selectMenu<CommandName | "quit">(menu, `What would you like to do with ${titleCase(target.branch)}?`, [
        { label: "Install (or refresh)", detail: "loader and engine", value: "inject" },
        { label: "Repair", detail: "after Discord updated", value: "repair" },
        { label: "Uninstall", detail: "put Discord's original back", value: "uninject" },
        { label: "Restore a backup", detail: "go back to an untouched copy", value: "restore" },
        { label: "Show status", detail: "changes nothing", value: "status" },
        { label: "Quit", value: "quit" }
    ]);
    if (!action || action === "quit") return cancelled(io);

    const options: Options = { branch: target.branch };
    if (action === "status") return finish(io, () => RUNNERS.status(ctx, options));

    if (action === "repair") options.discardStale = true;

    // First the plan, as a dry run, so the owner sees exactly what will be touched before anything is.
    const running = (await ctx.platform.listProcesses(BRANCH_EXES[target.branch])).length > 0;
    let plan: Result;
    try {
        plan = await RUNNERS[action](ctx, { ...options, dryRun: true, closeDiscord: running });
    } catch (error) {
        return printFailure(io, error);
    }
    io.out("\n" + formatResult(plan, io.style).join("\n") + "\n");
    if (running) io.out(`${io.style.yellow("!")} Discord is open. It will be closed and reopened; unsent drafts and an active call are lost.\n`);
    if (action === "repair" && target.state === "desynced") {
        io.out(`${io.style.yellow("!")} The old _app.asar left by the earlier Discord is discarded; it stays in the backup.\n`);
    }
    io.out(`${io.style.dim(`To undo later: Restore a backup in this menu, or ${TOOL} restore --branch ${target.branch}`)}\n\n`);

    // Cancel is the first and pre-selected item: pressing Enter twice in a row can never apply a change.
    const go = await selectMenu(menu, "Apply this?", [
        { label: "Cancel, change nothing", value: false },
        { label: "Yes, apply it", value: true }
    ], 0);
    if (!go) return cancelled(io);

    return finish(io, () => runAllowingForce(io, menu, ctx, action, options, running));
}

/** Run an action, closing Discord if it is open. When a normal close fails, ask before forcing it (the default answer is No). */
async function runAllowingForce(io: Io, menu: MenuIo, ctx: Context, action: CommandName, options: Options, running: boolean): Promise<Result> {
    try {
        return await RUNNERS[action](ctx, { ...options, closeDiscord: running });
    } catch (error) {
        if (error instanceof InstallerError && error.kind === "running" && /did not close normally/.test(error.message)) {
            io.err(`${io.style.yellow("!")} ${error.message}\n`);
            const force = await selectMenu(menu, "Force Discord to close? Unsent drafts and an active call are lost.", [
                { label: "No, leave Discord alone", value: false },
                { label: "Yes, force it", value: true }
            ], 0);
            if (force) return RUNNERS[action](ctx, { ...options, closeDiscord: true, forceClose: true });
        }
        throw error;
    }
}

const STRAIGHT_TITLES: Partial<Record<CommandName, string>> = {
    inject: "Select Discord install to patch (Enter to confirm)",
    uninject: "Select Discord install to unpatch (Enter to confirm)",
    repair: "Select Discord install to repair (Enter to confirm)"
};

/** Like TestCord's installer: no plan and no second question. What keeps it safe is the verified backup taken first and the undo that is always printed. */
async function straightThrough(io: Io, ctx: Context, menu: MenuIo, action: CommandName, target: Found): Promise<number> {
    const style = io.style;
    const line = (level: Level, text: string) => io.out(`${levelLabel(style, level)} ${text}\n`);
    const install = await findInstall(ctx.localAppData, target.branch);
    io.out(`${style.green("✔")} ${titleCase(target.branch)} - ${install?.root ?? ""}\n`);

    const running = (await ctx.platform.listProcesses(BRANCH_EXES[target.branch])).length > 0;
    if (running) line("WARN", `${BRANCH_EXES[target.branch]} is open. It will be closed and reopened; unsent drafts and an active call are lost.`);

    // Discord stays in the tray and ignores a polite close, so waiting for it only wastes the owner's time: the close is forced at once
    // (a very short polite try first), like TestCord's installer. The warning above already says what is lost.
    const options: Options = { branch: target.branch, ...(action === "repair" ? { discardStale: true } : {}), ...(running ? { closeDiscord: true, forceClose: true } : {}) };
    try {
        const res = await RUNNERS[action]({ ...ctx, log: line, closeTimeoutMs: 1_500 }, options);
        for (const warning of res.warnings) line("WARN", warning);
        if (res.plan.length === 0) for (const note of res.messages) line("INFO", note);
        else if (res.backupDir) {
            line("INFO", `Backup: ${res.backupDir}`);
            line("INFO", action === "uninject" ? "To put Amiricord back: pnpm inject" : `To undo: pnpm uninject, or ${TOOL} restore --branch ${target.branch}`);
        }
        io.out(`${style.green("✔ Success!")}\n`);
        io.out("\n" + (await overviewLines(ctx, style)).join("\n") + "\n");
        return EXIT.OK;
    } catch (error) {
        return printFailure(io, error);
    }
}

function cancelled(io: Io): number {
    io.out(`${io.style.dim("Cancelled. Nothing was changed.")}\n`);
    return EXIT.OK;
}

async function finish(io: Io, run: () => Promise<Result>): Promise<number> {
    try {
        printResult(io, await run());
        return EXIT.OK;
    } catch (error) {
        return printFailure(io, error);
    }
}

// ---------------------------------------------------------------------------------------------------------------------

/** Run the installer with these arguments. Returns the exit code. */
export async function main(argv: readonly string[], io: Io, ctx: Context): Promise<number> {
    const parsed = parseArgs(argv);
    if (parsed.help) {
        io.out(usage(io.style) + "\n");
        return EXIT.OK;
    }
    if (parsed.errors.length) {
        io.err(`${parsed.errors.map(e => `${io.style.red("❌")} ${e}`).join("\n")}\n\n${usage(io.style)}\n`);
        return EXIT.USAGE;
    }

    if (parsed.command === null) {
        if (!io.keys) {
            io.err(`${io.style.red("❌ Failed!")} The menu needs a terminal. Give a command instead.\n\n${usage(io.style)}\n`);
            return EXIT.USAGE;
        }
        return interactive(io, ctx, io.keys);
    }

    const command = parsed.command;

    // A short command in a terminal (`pnpm inject`) with no --branch: ask which Discord, then show the plan and ask before changing anything.
    if (io.keys && parsed.options.branch === undefined && !parsed.yes && !parsed.options.dryRun) {
        return interactive(io, ctx, io.keys, command);
    }

    const options = { ...parsed.options };
    // A command that changes files only shows its plan unless it was told to go ahead.
    const onlyShow = command !== "status" && !parsed.yes && !options.dryRun;
    if (onlyShow) options.dryRun = true;

    try {
        const res = await RUNNERS[command](ctx, options);
        printResult(io, res);
        if (onlyShow) io.out(`${io.style.yellow("!")} Add --yes to apply this.\n`);
        if (SHOWS_OVERVIEW.has(command)) io.out("\n" + (await overviewLines(ctx, io.style)).join("\n") + "\n");
        return EXIT.OK;
    } catch (error) {
        return printFailure(io, error);
    }
}
