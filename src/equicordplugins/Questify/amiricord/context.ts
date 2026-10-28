/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { EnginePluginContext } from "../../../renderer/engine";

let current: EnginePluginContext | undefined;

export function bindContext(ctx: EnginePluginContext): void {
    current = ctx;
}

export function getContext(): EnginePluginContext {
    if (!current) throw new Error("Questify: the engine has not started this plugin yet");
    return current;
}

export function hasContext(): boolean {
    return current !== undefined;
}

export function reportProblem(source: string, error: unknown): void {
    try {
        current?.reportError(`Questify ${source}`, error);
    } catch {
    }
}

const reportedOnce = new Set<string>();

export function reportProblemOnce(source: string, message: string): void {
    if (reportedOnce.has(source)) return;
    reportedOnce.add(source);
    reportProblem(source, new Error(message));
}
