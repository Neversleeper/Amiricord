/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs file steps as one unit: if any step (or the final check) fails, every step already done is undone, last first.
// Deletions that cannot be undone are kept for the end and only run once everything else worked.

import { constants as fsConstants, copyFile, rename, rm, writeFile } from "node:fs/promises";

export interface Fsx {
    rename(from: string, to: string): Promise<void>;
    /** Create a file; fails if it already exists, so nothing is overwritten by accident. */
    writeFile(path: string, data: Buffer): Promise<void>;
    /** Copy a file; fails if the destination already exists. */
    copy(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
}

export const nodeFsx: Fsx = {
    rename: (from, to) => rename(from, to),
    writeFile: (path, data) => writeFile(path, data, { flag: "wx" }),
    copy: (from, to) => copyFile(from, to, fsConstants.COPYFILE_EXCL),
    remove: path => rm(path, { recursive: true, force: true })
};

export type Step =
    | { type: "rename"; from: string; to: string; }
    | { type: "write"; path: string; data: Buffer; }
    | { type: "copy"; from: string; to: string; };

export interface CommitStep {
    type: "remove";
    path: string;
}

export function describeStep(step: Step | CommitStep): string {
    switch (step.type) {
        case "rename": return `rename ${step.from} -> ${step.to}`;
        case "write": return `write ${step.path} (${step.data.length} bytes)`;
        case "copy": return `copy ${step.from} -> ${step.to}`;
        case "remove": return `delete ${step.path}`;
    }
}

export type TransactionResult =
    | { ok: true; commitErrors: string[]; }
    | { ok: false; error: unknown; rolledBack: boolean; undoErrors: string[]; };

export interface TransactionOptions {
    fsx: Fsx;
    steps: readonly Step[];
    commit?: readonly CommitStep[];
    /** Runs after all steps; if it throws, everything is undone. */
    verify?: () => Promise<void>;
    /** Called before each step and at the end, to keep a written record of what was tried. */
    journal?: (event: "step" | "rollback" | "done", data: unknown) => Promise<void> | void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runTransaction(options: TransactionOptions): Promise<TransactionResult> {
    const { fsx, steps, commit = [], verify, journal } = options;
    const done: Step[] = [];

    try {
        for (const step of steps) {
            await journal?.("step", describeStep(step));
            if (step.type === "rename") await fsx.rename(step.from, step.to);
            else if (step.type === "copy") await fsx.copy(step.from, step.to);
            else await fsx.writeFile(step.path, step.data);
            done.push(step);
        }
        await verify?.();
    } catch (error) {
        const undoErrors: string[] = [];
        for (const step of done.reverse()) {
            try {
                if (step.type === "rename") await fsx.rename(step.to, step.from);
                else await fsx.remove(step.type === "copy" ? step.to : step.path);
            } catch (undoError) {
                undoErrors.push(`${describeStep(step)}: ${message(undoError)}`);
            }
        }
        await journal?.("rollback", { undoErrors });
        return { ok: false, error, rolledBack: undoErrors.length === 0, undoErrors };
    }

    const commitErrors: string[] = [];
    for (const step of commit) {
        try {
            await fsx.remove(step.path);
        } catch (error) {
            commitErrors.push(`${describeStep(step)}: ${message(error)}`);
        }
    }
    await journal?.("done", { commitErrors });
    return { ok: true, commitErrors };
}
