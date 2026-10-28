/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs in Discord's page before Discord's own scripts. It is a thin bridge: it asks the main process for the boot
// decision and the page script, exposes three functions to the page, and runs the page script.
// It only imports Electron, so it works in a sandboxed preload (which cannot read files).
// Not verified yet: that the page script runs before Discord's first script. That is checked on Canary.

import { contextBridge, ipcRenderer, webFrame } from "electron";

import { BootInfo, IPC, isTrustedSender } from "../shared/ipc";
import { PROJECT_NAME } from "../shared/project";
import { buildRendererScript, makeBridgeKey } from "./script";

function boot() {
    // Only the top page of Discord. Frames inside it (captchas, embeds) get nothing.
    if (webFrame.parent !== null || !isTrustedSender(location.href)) return;

    const bootInfo = ipcRenderer.sendSync(IPC.bootInfo) as BootInfo | null;
    const bundle = ipcRenderer.sendSync(IPC.rendererCode) as string | null;
    if (!bootInfo || !bundle) return;

    const key = makeBridgeKey();
    contextBridge.exposeInMainWorld(key, {
        bootInfo,
        sendHealth: (event: unknown) => { ipcRenderer.send(IPC.health, event); },
        cleanBoot: () => { ipcRenderer.send(IPC.cleanBoot); },
        changeSetting: (change: unknown) => { ipcRenderer.send(IPC.settingsChange, change); },
        restart: () => { ipcRenderer.send(IPC.restart); },
        openDataFolder: () => { ipcRenderer.send(IPC.openDataFolder); },
        leaveSafeMode: () => { ipcRenderer.send(IPC.leaveSafeMode); },
        firewallStatus: () => ipcRenderer.invoke(IPC.firewall) as Promise<unknown>,
        native: (message: unknown) => ipcRenderer.invoke(IPC.native, message) as Promise<unknown>,
        secret: (message: unknown) => ipcRenderer.invoke(IPC.secret, message) as Promise<unknown>,
        privacyStatus: () => ipcRenderer.invoke(IPC.privacy) as Promise<unknown>,
        testProvider: (id: string) => ipcRenderer.invoke(IPC.privacyTest, id) as Promise<unknown>,
        changePrivacy: (change: unknown) => ipcRenderer.invoke(IPC.privacyChange, change) as Promise<unknown>,
        blockLog: () => ipcRenderer.invoke(IPC.privacyLog) as Promise<unknown>,
        updates: (message: unknown) => ipcRenderer.invoke(IPC.updates, message) as Promise<unknown>,
        // Only offered in dev mode; the main process checks again before it writes anything.
        ...(bootInfo.devMode ? { devDump: (name: string, text: string) => { ipcRenderer.send(IPC.devDump, { name, text }); } } : {})
    });

    void webFrame.executeJavaScript(buildRendererScript(bundle, key));
}

try {
    boot();
} catch (error) {
    // Discord must still start if the mod cannot.
    console.error(`[${PROJECT_NAME}] could not start:`, error);
}
