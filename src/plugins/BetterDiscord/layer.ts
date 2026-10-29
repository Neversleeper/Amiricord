/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Puts the pieces of the BetterDiscord layer together from what Amiricord's plugin context offers. Kept apart from `index.tsx` so it can be tested with a fake context.

import type { ReactLike } from "../../api/common";
import type { JsonValue } from "../../shared/settings";
import { createBdApi, type ToastKind } from "./bdApi";
import { createBdData } from "./bdData";
import { createBdDom, type DomPage } from "./bdDom";
import { createBdWebpack, type ModuleEntry } from "./bdWebpack";
import { BdManager, type BdSourceFile } from "./manager";
import { createPatcher } from "./patcher";
import { runPluginSource } from "./runner";

/** The part of the plugin context the layer uses. */
export interface LayerContext {
    modules: { loaded(): ModuleEntry[]; sourceOf(id: string): string | undefined; };
    storage: { get(key: string): Promise<JsonValue | undefined>; set(key: string, value: JsonValue): Promise<void>; };
    toasts: { show(message: string, kind?: ToastKind): void; };
    modals: { open(render: (props: { transitionState: number; onClose(): void; }) => unknown): string | undefined; close(key: string): void; };
    react(): ReactLike | undefined;
    reportError(source: string, error: unknown): void;
    /** The page: its document, window pieces and `fetch`. */
    page: DomPage & { fetch?: typeof fetch; };
    /** The object plugins see as `window` and `global`. */
    pageGlobal: unknown;
}

export interface BdLayer {
    manager: BdManager;
    /** Stop every plugin and take back what they added. The saved list of plugins that are on is kept. */
    dispose(): void;
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;

export function createBdLayer(ctx: LayerContext, files: readonly BdSourceFile[]): BdLayer {
    const dataKey = (plugin: string) => `data-${plugin.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const patcher = createPatcher((caller, where, error) => { ctx.reportError(`${caller}: ${where}`, error); });
    const dom = createBdDom(ctx.page);
    const webpack = createBdWebpack({ loaded: () => ctx.modules.loaded(), sourceOf: id => ctx.modules.sourceOf(id) });
    const data = createBdData({
        read: async plugin => {
            // Without a database the plugin simply starts with nothing saved.
            const value = await ctx.storage.get(dataKey(plugin)).catch((error: unknown) => { ctx.reportError(`${plugin}: reading its data`, error); return undefined; });
            return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
        },
        write: (plugin, value) => ctx.storage.set(dataKey(plugin), value as JsonValue),
        onError: (plugin, error) => { ctx.reportError(`${plugin}: saving its data`, error); }
    });

    // `manager` is read when a plugin asks about other plugins, which can only happen after it exists.
    const holder: { manager?: BdManager; } = {};
    const managerOf = (): BdManager => holder.manager!;
    const host = {
        patcher, data, dom, webpack,
        page: ctx.page,
        react: () => ctx.react(),
        reactDom: () => webpack.getByKeys("createPortal", "flushSync") ?? webpack.getByKeys("render", "createPortal"),
        toast: (message: string, kind: ToastKind) => { ctx.toasts.show(message, kind); },
        openModal: (render: (props: { onClose(): void; }) => unknown) => ctx.modals.open(render),
        closeModal: (key: string) => { ctx.modals.close(key); },
        log: (level: typeof LEVELS[number], caller: string, ...args: unknown[]) => { console[LEVELS.includes(level) ? level : "log"](`[${caller}]`, ...args); },
        plugins: {
            list: () => managerOf().instances(),
            enable: (name: string) => { void managerOf().enable(managerOf().list().find(p => p.name === name || p.id === name)?.id ?? name); },
            disable: (name: string) => { void managerOf().disable(managerOf().list().find(p => p.name === name || p.id === name)?.id ?? name); },
            reload: (name: string) => { void managerOf().reload(managerOf().list().find(p => p.name === name || p.id === name)?.id ?? name); }
        }
    };

    const manager = new BdManager({
        data,
        page: ctx.pageGlobal,
        makeApi: name => createBdApi(host, name),
        run: runPluginSource,
        readEnabled: async () => {
            const value = await ctx.storage.get("enabled").catch((error: unknown) => { ctx.reportError("reading the list of plugins that are on", error); return undefined; });
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
        },
        writeEnabled: ids => ctx.storage.set("enabled", ids),
        report: (plugin, where, error) => { ctx.reportError(`${plugin}: ${where}`, error); },
        watch: callback => {
            const observer = new ctx.page.MutationObserver(callback);
            observer.observe(ctx.page.document.body, { subtree: true, childList: true });
            return () => { observer.disconnect(); };
        }
    });
    holder.manager = manager;
    manager.register(files);

    return {
        manager,
        dispose() {
            manager.stopAll();
            void data.flush();
        }
    };
}
