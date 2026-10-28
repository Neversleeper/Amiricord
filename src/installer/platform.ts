/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the installer needs from the operating system: see which Discord programs are running, close them, start Discord.
// Windows only for now. Commands receive a `Platform`, so tests use a fake one and never touch a real process.

import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Platform {
    /** Process ids of every running process with this program name. */
    listProcesses(exe: string): Promise<number[]>;
    /** Ask them to close normally (no force) and wait. Throws if some are still running after `timeoutMs`. */
    closeProcesses(exe: string, timeoutMs: number): Promise<void>;
    /** Force them to close. Throws if some are still running afterwards. */
    killProcesses(exe: string): Promise<void>;
    /** Start Discord the way Discord's own shortcut does. `root` is the branch folder that holds `Update.exe`. */
    start(root: string, exe: string): Promise<void>;
}

/** Read the output of `tasklist /FO CSV /NH`: lines like `"DiscordCanary.exe","1234","Console","1","123,456 K"`. */
export function parseTasklist(output: string, exe: string): number[] {
    const pids: number[] = [];
    for (const line of output.split(/\r?\n/)) {
        const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (match && match[1].toLowerCase() === exe.toLowerCase()) pids.push(Number(match[2]));
    }
    return pids;
}

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

async function list(exe: string): Promise<number[]> {
    const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/FO", "CSV", "/NH"], { windowsHide: true });
    return parseTasklist(stdout, exe);
}

async function waitUntilGone(exe: string, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if ((await list(exe)).length === 0) return;
        if (Date.now() >= deadline) throw new Error(`${exe} is still running ${what}`);
        await sleep(300);
    }
}

export const windowsPlatform: Platform = {
    listProcesses: list,

    async closeProcesses(exe, timeoutMs) {
        // taskkill fails when there is nothing to close or it could not close; the check below decides which one it was.
        await run("taskkill", ["/IM", exe], { windowsHide: true }).catch(() => undefined);
        await waitUntilGone(exe, timeoutMs, `after ${timeoutMs} ms`);
    },

    async killProcesses(exe) {
        await run("taskkill", ["/F", "/IM", exe], { windowsHide: true }).catch(() => undefined);
        await waitUntilGone(exe, 10_000, "after a forced close");
    },

    async start(root, exe) {
        const update = join(root, "Update.exe");
        await access(update);
        // Squirrel's standard way to start the newest app-X folder, detached from this program.
        spawn(update, ["--processStart", exe], { detached: true, stdio: "ignore" }).unref();
    }
};
