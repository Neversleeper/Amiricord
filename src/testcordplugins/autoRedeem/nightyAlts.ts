/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * Main-process code: it runs through the plugin's native bridge (`entry.main` of plugin.json), never in the page.
 */

import { Buffer } from "buffer";
import { type FSWatcher, watch } from "fs";
import { open } from "fs/promises";
import { resolve, sep } from "path";
import process from "process";

import type { NativeHostApi } from "../../main/nativeHost";
import type { NightyGiftDetection } from "./types";

const GIFT_LOG_REGEX = /\[GIFT DETECTED\] Account: (.{1,100}?) \| Code: ([a-zA-Z0-9]{16,24}) \| Server: (.{1,500}?) \| Channel: (.{1,200}?) \| Author: (.{1,100}?)\s*$/;
const MAX_READ_BYTES = 1024 * 1024;
/**
 * One call of `waitForNightyGiftCode` never stays open longer than this. Amiricord's native host answers an error when a call has not
 * answered in 120 000 ms, and a call that errors out would leave its waiter behind to swallow the next gift code. The page asks again right away.
 */
const WAIT_IDLE_MS = 60_000;

/** What `waitForNightyGiftCode` answers: a gift, "nothing yet, ask again", or "the watcher is not running" (the page stops asking). */
export type NightyWaitResult =
    | { status: "gift"; detection: NightyGiftDetection; }
    | { status: "idle"; }
    | { status: "stopped"; };

let watcher: FSWatcher | undefined;
let logPath = "";
let logOffset = 0;
let pendingText = "";
let reading = false;
let readAgain = false;
const giftQueue: NightyGiftDetection[] = [];
const seenCodes = new Set<string>();
const waiters: Array<(detection: NightyGiftDetection | null) => void> = [];

function enqueueGift(detection: NightyGiftDetection) {
    if (seenCodes.has(detection.code)) return;
    seenCodes.add(detection.code);

    const waiter = waiters.shift();
    if (waiter) waiter(detection);
    else giftQueue.push(detection);
}

async function readNewLogEntries() {
    if (reading) {
        readAgain = true;
        return;
    }

    reading = true;
    try {
        const file = await open(logPath, "r");
        try {
            const { size } = await file.stat();
            if (size < logOffset) {
                logOffset = 0;
                pendingText = "";
            }
            if (size === logOffset) return;

            const length = Math.min(size - logOffset, MAX_READ_BYTES);
            const position = size - length;
            if (position > logOffset) pendingText = "";

            const buffer = Buffer.alloc(length);
            const { bytesRead } = await file.read(buffer, 0, length, position);
            logOffset = size;
            pendingText += buffer.toString("utf8", 0, bytesRead);

            const lines = pendingText.split(/\r?\n/);
            pendingText = lines.pop() ?? "";
            for (const line of lines) {
                const match = line.match(GIFT_LOG_REGEX);
                if (!match) continue;

                enqueueGift({
                    accountName: match[1].trim(),
                    code: match[2],
                    guildName: match[3].trim(),
                    channelName: match[4].trim(),
                    authorName: match[5].trim()
                });
            }
        } finally {
            await file.close();
        }
    } catch {
        logOffset = 0;
        pendingText = "";
    } finally {
        reading = false;
        if (readAgain) {
            readAgain = false;
            void readNewLogEntries();
        }
    }
}

function handleLogChange() {
    void readNewLogEntries();
}

function stopWatcher() {
    watcher?.close();
    watcher = undefined;
    logPath = "";
    logOffset = 0;
    pendingText = "";
    reading = false;
    readAgain = false;
    giftQueue.length = 0;
    seenCodes.clear();
    for (const waiter of waiters.splice(0)) waiter(null);
}

export async function startNightyAltDetection(_host: NativeHostApi): Promise<string | null> {
    stopWatcher();

    const appData = process.env.APPDATA;
    if (!appData) return "Nighty's data folder could not be found. Alt detection only works on Windows.";

    const logsRoot = resolve(appData, "Nighty Selfbot", "data", "scripts", "logs");
    logPath = resolve(logsRoot, "nitro_sniper.log");
    if (!logPath.startsWith(`${logsRoot}${sep}`)) return "Nighty's Nitro Sniper log path is invalid.";

    try {
        const file = await open(logPath, "r");
        try {
            logOffset = (await file.stat()).size;
        } finally {
            await file.close();
        }

        watcher = watch(logPath, handleLogChange);
        watcher.once("error", stopWatcher);
        return null;
    } catch {
        stopWatcher();
        return "Nighty's Nitro Sniper log could not be opened.";
    }
}

export function waitForNightyGiftCode(_host: NativeHostApi): Promise<NightyWaitResult> {
    const detection = giftQueue.shift();
    if (detection) return Promise.resolve({ status: "gift", detection });
    if (!watcher) return Promise.resolve({ status: "stopped" });

    return new Promise<NightyWaitResult>(resolve => {
        const waiter = (found: NightyGiftDetection | null) => {
            clearTimeout(timer);
            resolve(found ? { status: "gift", detection: found } : { status: "stopped" });
        };
        const timer = setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            resolve({ status: "idle" });
        }, WAIT_IDLE_MS);
        waiters.push(waiter);
    });
}

export function stopNightyAltDetection(_host: NativeHostApi) {
    stopWatcher();
}
