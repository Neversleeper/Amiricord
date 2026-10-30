/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 */

import type { EnginePluginContext } from "../../renderer/engine";
import type { JsonValue } from "../../shared/settings";

export type RedeemStatus = "success" | "failed";
export type RedeemType = "nitro" | "decoration" | "other";

export interface RedeemLog {
    id: string;
    code: string;
    status: RedeemStatus;
    type: RedeemType;
    error?: string;
    channelId?: string;
    messageId?: string;
    timestamp: number;
}

export interface LogStore {
    subscribe(listener: () => void): () => void;
    getLogs(): RedeemLog[];
    loadLogs(): Promise<RedeemLog[]>;
    addLog(entry: Omit<RedeemLog, "id" | "timestamp">): void;
    clearLogs(): Promise<void>;
}

const STORE_KEY = "AutoRedeem_logs";
const MAX_LOGS = 5000;
/**
 * `ctx.storage` keeps one value of at most 1 048 576 characters of JSON and refuses anything bigger (the old DataStore had no such limit), and 5000 logs written
 * as objects come close to it. So the logs are saved in a compact form (see `encodeLogs`), and if they would still not fit the oldest ones are left out of
 * the saved copy (memory keeps all of them until Discord restarts).
 */
const MAX_SAVED_CHARS = 900_000;
const STATUS_CODES: Record<RedeemStatus, string> = { success: "s", failed: "f" };
const TYPE_CODES: Record<RedeemType, string> = { nitro: "n", decoration: "d", other: "o" };

type SavedLog = [id: string, code: string, status: string, type: string, error: string | null, channelId: string | null, messageId: string | null, timestamp: number];

const isString = (value: unknown): value is string => typeof value === "string";

function encodeLogs(logs: readonly RedeemLog[]): JsonValue {
    const rows: SavedLog[] = logs.map(log => [
        log.id, log.code, STATUS_CODES[log.status], TYPE_CODES[log.type],
        log.error ?? null, log.channelId ?? null, log.messageId ?? null, log.timestamp
    ]);
    // Newest first, so the oldest are the tail: drop from there until the saved text fits.
    while (rows.length > 0 && JSON.stringify(rows).length > MAX_SAVED_CHARS) rows.length = Math.floor(rows.length * 0.9);
    return { v: 1, logs: rows };
}

function decodeLogs(saved: JsonValue | undefined): RedeemLog[] {
    if (typeof saved !== "object" || saved === null || Array.isArray(saved) || saved.v !== 1 || !Array.isArray(saved.logs)) return [];
    const logs: RedeemLog[] = [];
    for (const row of saved.logs) {
        if (!Array.isArray(row) || row.length !== 8) continue;
        const [id, code, status, type, error, channelId, messageId, timestamp] = row;
        const statusName = (Object.keys(STATUS_CODES) as RedeemStatus[]).find(name => STATUS_CODES[name] === status);
        const typeName = (Object.keys(TYPE_CODES) as RedeemType[]).find(name => TYPE_CODES[name] === type);
        if (!isString(id) || !isString(code) || !statusName || !typeName || typeof timestamp !== "number") continue;
        const log: RedeemLog = { id, code, status: statusName, type: typeName, timestamp };
        if (isString(error)) log.error = error;
        if (isString(channelId)) log.channelId = channelId;
        if (isString(messageId)) log.messageId = messageId;
        logs.push(log);
    }
    return logs;
}

/** The redeem log, kept in memory and saved through `ctx.storage` (this plugin's own data in Discord's page). One store per plugin run. */
export function createLogStore(ctx: Pick<EnginePluginContext, "storage" | "reportError">): LogStore {
    const listeners = new Set<() => void>();
    let logs: RedeemLog[] = [];
    let loaded = false;
    let loadPromise: Promise<RedeemLog[]> | null = null;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const persistWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void; }> = [];

    const notify = () => { for (const l of listeners) l(); };

    function persistLogs() {
        return new Promise<void>((resolve, reject) => {
            persistWaiters.push({ resolve, reject });
            if (persistTimer !== undefined) return;
            persistTimer = setTimeout(() => {
                persistTimer = undefined;
                const snapshot = logs;
                const waiters = persistWaiters.splice(0);
                void Promise.resolve().then(() => ctx.storage.set(STORE_KEY, encodeLogs(snapshot))).then(
                    () => { for (const waiter of waiters) waiter.resolve(); },
                    error => {
                        ctx.reportError("AutoRedeem logs", error);
                        for (const waiter of waiters) waiter.reject(error);
                    }
                );
            }, 100);
        });
    }

    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    };

    const getLogs = () => logs;

    async function loadLogs() {
        if (loaded) return logs;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            const saved = await ctx.storage.get(STORE_KEY).catch(() => undefined);
            if (!loaded) {
                const savedLogs = decodeLogs(saved);
                const existingIds = new Set(logs.map(log => log.id));
                logs = [...logs, ...savedLogs.filter(log => !existingIds.has(log.id))].slice(0, MAX_LOGS);
                loaded = true;
                notify();
                if (logs.length !== savedLogs.length) void persistLogs().catch(() => { });
            }
            return logs;
        })();
        try {
            return await loadPromise;
        } finally {
            loadPromise = null;
        }
    }

    function addLog(entry: Omit<RedeemLog, "id" | "timestamp">) {
        logs = [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() }, ...logs].slice(0, MAX_LOGS);
        notify();
        void persistLogs().catch(() => { });
    }

    async function clearLogs() {
        logs = [];
        loaded = true;
        notify();
        await persistLogs();
    }

    return { subscribe, getLogs, loadLogs, addLog, clearLogs };
}
