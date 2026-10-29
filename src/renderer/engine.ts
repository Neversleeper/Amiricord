/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Puts the pieces together inside the page: decides which plugins run, registers their patches, hooks Discord's
// Webpack, starts the plugins stage by stage, and reports everything that happens to the main process.
// It never touches Electron or the DOM directly (they come in through options), so it is tested with fakes.
// Design: docs/design-02-core.md sections 4 to 8.

import { buildChatBar, ChatBarHub, type ChatBarPage, type PluginChatBar } from "../api/chatBar";
import { buildCommands, commandHub, type PluginCommands } from "../api/commands";
import type { ReactLike } from "../api/common";
import { buildCommon, PluginCommon } from "../api/commonStores";
import { type ContextMenuDocument, createContextMenuLayer, type PluginContextMenu } from "../api/contextMenu";
import { buildContextMenus, ContextMenuHub, type MenuPage, type PluginContextMenus } from "../api/contextMenus";
import { COMPONENT_NAMES, declareCommon, PluginComponents } from "../api/discordComponents";
import { FALLBACK_CSS } from "../api/fallbackStyles";
import { FluxDispatcherLike, FluxHandlers, subscribeFlux } from "../api/flux";
import { setReactSource } from "../api/jsxRuntime";
import { LifecycleEvent, LifecycleOptions, PluginContext, PluginLifecycle, PluginRuntime } from "../api/lifecycle";
import { locateMenuParts, type MenuParts } from "../api/menuParts";
import { buildModals, PluginModals } from "../api/modals";
import { buildNative, PluginNativeCaller } from "../api/native";
import { type NativeMenuHub, nativeMenus } from "../api/nativeMenus";
import { createNotificationLayer, type PluginNotifications } from "../api/notifications";
import { buildPluginCards, PluginCard, PluginSource } from "../api/pluginCards";
import { describeSettings, isPluginSettings, PluginSettingsAnswer, PluginSettingsComponent } from "../api/pluginSettings";
import { PluginSwitch, ToggleResult } from "../api/pluginSwitch";
import { buildSecrets, PluginSecrets } from "../api/secrets";
import { buildServerList, type PluginServerList, serverList } from "../api/serverList";
import { SettingsClient } from "../api/settingsClient";
import { buildSettingsTabs, type PluginSettingsTabs, settingsTabs } from "../api/settingsTabs";
import { type AudioLike, createSoundLayer, locateSoundContext, type PluginSounds } from "../api/sounds";
import { buildStorage, indexedDbBackend, IndexedDbFactory, PluginStorage, StorageBackend } from "../api/storage";
import { pageStyleHost, StyleHandle, StyleHost, StyleManager } from "../api/styles";
import { buildToasts, type PluginToasts, type ToastPage } from "../api/toasts";
import { buildUserArea, type PluginUserArea, userArea } from "../api/userArea";
import { type BlockLog, parseBlockLog } from "../shared/blocks";
import { computeEnabledSet, PluginInfo } from "../shared/enabledSet";
import { HealthEvent, redact } from "../shared/health";
import { BootInfo } from "../shared/ipc";
import { ENGINE_APIS, Stage } from "../shared/manifest";
import { parsePrivacyAnswer, parseProviderTest, PrivacyAnswer, ProviderTestAnswer } from "../shared/privacy";
import { parseChangeResult, PrivacyChange, PrivacyChangeResult } from "../shared/privacyChange";
import { PROJECT_NAME, PROJECT_VERSION } from "../shared/project";
import type { JsonValue, SettingsChange } from "../shared/settings";
import { emptyNetworkCounts, NetworkCounts, parseFirewallAnswer } from "../shared/shields";
import { parseUpdateAnswer, type UpdateAnswer, type UpdateRequest } from "../shared/updates";
import { PatchDefinition } from "../webpack/compileModule";
import { FinderEngine } from "../webpack/finders";
import { PatchRegistry } from "../webpack/patchRegistry";
import { ResolutionCache } from "../webpack/resolutionCache";
import { installWebpackHook } from "../webpack/webpackHook";
import { readBuildNumber } from "./buildNumber";
import { buildComponentsReport, ComponentsDocument, REACT_PROPS } from "./probes/componentsProbe";
import { DocumentLike as ProbeDocument, startSettingsProbe } from "./probes/settingsProbe";
import { SelfTest, SelfTestOptions, SelfTestResult, startSelfTest } from "./selfTest";
import { WreqLike, WreqView } from "./wreqView";

/** What the page may do with the main process. The preload provides it. */
export interface Bridge {
    bootInfo: BootInfo;
    sendHealth(event: HealthEvent): void;
    cleanBoot(): void;
    /** Ask the main process to keep a change of a plugin choice or setting. The main process checks it again. */
    changeSetting(change: SettingsChange): void;
    /** Ask the main process to restart Discord. Only core plugins reach it, through `ctx.plugins.restart`. */
    restart(): void;
    /** Ask the main process to open the data folder in the file explorer. Only core plugins reach it, through `ctx.engine.openDataFolder`. */
    openDataFolder(): void;
    /** Ask the main process to turn safe mode off for the next start. Only core plugins reach it, through `ctx.engine.leaveSafeMode`. */
    leaveSafeMode?(): void;
    /** Ask the main process how many requests its firewall cancelled. Read only; the answer is checked field by field before it is used. */
    firewallStatus?(): Promise<unknown>;
    /** Send a plugin's call for its own main-process function and wait for the answer. The main process checks it again (`src/main/nativeHost.ts`). */
    native?(message: unknown): Promise<unknown>;
    /** Write, clear or ask about a plugin's own secret. The main process checks it again and never sends a secret back (`src/main/secretStore.ts`). */
    secret?(message: unknown): Promise<unknown>;
    /** Ask the main process for the read-only snapshot of the Privacy & Security tab. The answer is checked field by field before it is used. */
    privacyStatus?(): Promise<unknown>;
    /** Ask the main process to test one provider of its table by id (asks the provider a question, applies nothing). */
    testProvider?(id: string): Promise<unknown>;
    /** Ask the main process to make one change of the Privacy & Security tab. It asks the person itself when the change weakens protection. */
    changePrivacy?(change: unknown): Promise<unknown>;
    /** Ask the main process for the list of recent blocks. Read only; checked field by field before it is used. */
    blockLog?(): Promise<unknown>;
    /** Ask the main process to look for a newer version or install it (the Updates tab). The answer is checked field by field before it is used. */
    updates?(message: unknown): Promise<unknown>;
    /** Development only: write a text into the probe folder. Missing unless dev mode is on. */
    devDump?(name: string, text: string): void;
}

/** What the settings page shows about the engine. Plain data. */
export interface EngineStatus {
    version: string;
    /** Discord's build number, or null when it could not be read. */
    discordBuild: number | null;
    safeMode: boolean;
    safeModeReason: string | null;
    /** True when this session entered safe mode by itself (after failed starts), not because the owner asked. */
    enteredSafeMode: boolean;
    quarantine: string[];
    devMode: boolean;
    /** Things wrong with the setup, for the owner to read. */
    problems: string[];
    /** The privacy self-test results so far (empty when it did not run or has not finished). */
    selfTests: SelfTestResult[];
    /** What privacy plugins stopped inside Discord, before it left the page, this session. Never mixed with what the network rules cancel. */
    stopped: Record<StoppedKind, number>;
    /** When the last one of each kind was stopped (milliseconds of this page's clock), or null when none was. */
    stoppedAt: Record<StoppedKind, number | null>;
    /** What the network firewall cancelled this session (main process). Counted apart from `stopped`; the page can only read it, and it is as old as the last answer. */
    network: NetworkCounts;
    /** One plain line about encrypted DNS, as the main process wrote it (empty until it has answered). */
    dns: string;
}

/** The kinds of thing a privacy plugin can say it stopped inside Discord. */
export type StoppedKind = "analytics" | "metrics" | "crash-reports";
export const STOPPED_KINDS: readonly StoppedKind[] = ["analytics", "metrics", "crash-reports"];

export interface EnginePluginContext extends PluginContext {
    /** Report an error that happened in this plugin's own code (a screen that failed to draw, for example). It goes to the health report. */
    reportError(source: string, error: unknown): void;
    /** The engine's own status and actions. Only core plugins get it. */
    engine?: {
        status(): EngineStatus;
        openDataFolder(): void;
        /** Turn safe mode off for the next start (the caller restarts Discord after). */
        leaveSafeMode(): void;
        /** The read-only snapshot of the Privacy & Security tab from the main process (null when it did not answer or the answer was not in the expected form). */
        privacy(): Promise<PrivacyAnswer | null>;
        /** "Test now" for one provider by id. Asks the provider a question and applies nothing. */
        testProvider(id: string): Promise<ProviderTestAnswer | null>;
        /** One change of the tab (a telemetry switch or the encrypted DNS choice). The main process decides and may ask the person; null when it did not answer. */
        changePrivacy(change: PrivacyChange): Promise<PrivacyChangeResult | null>;
        /** The recent blocks, grouped. Null when the main process did not answer or the answer was not in the expected form. */
        blocks(): Promise<BlockLog | null>;
        /** Look for a newer version ("check") or install it ("install"). Null when the main process did not answer or the answer was not in the expected form. */
        updates(request: UpdateRequest): Promise<UpdateAnswer | null>;
    };
    /**
     * Discord's modules that have already run, with their exports and original source. Only a plugin whose manifest declares `permissions.code.dynamic` gets it: it lets code
     * look through every export, which a finder (a named question) does not. Used by the BetterDiscord layer.
     */
    modules?: { loaded(): Array<{ id: string; exports: unknown; }>; sourceOf(id: string): string | undefined; };
    /** Finders that report their misses against this plugin. */
    finders: ReturnType<FinderEngine["forPlugin"]>;
    /** Discord's stores and dispatcher by name, found through this plugin's own finders. See `src/api/commonStores.ts`. */
    common: PluginCommon;
    /** Items added to Discord's own right-click menu (next to ctx.contextMenu, which draws a menu of its own). They go when the plugin stops. See `src/api/contextMenus.ts`. */
    menuItems: PluginContextMenus;
    /** Things drawn in Discord's server list (above, in, below). They go when the plugin stops. See `src/api/serverList.ts`. */
    serverList: PluginServerList;
    /** Buttons in the user panel at the bottom left. They go when the plugin stops. See `src/api/userArea.ts`. */
    userArea: PluginUserArea;
    /** A tab in the Amiricord section of Discord's settings. It goes when the plugin stops. See `src/api/settingsTabs.ts`. */
    settingsTabs: PluginSettingsTabs;
    /** Slash commands. They go when the plugin stops. See `src/api/commands.ts`. */
    commands: PluginCommands;
    /** Buttons in the row at the right of the message box. They go when the plugin stops. See `src/api/chatBar.ts`. */
    chatBar: PluginChatBar;
    /** A short message at the bottom of the page. See `src/api/toasts.ts`. */
    toasts: PluginToasts;
    /** Opens Discord's dialogs and closes what this plugin left open when it stops. See `src/api/modals.ts`. */
    modals: PluginModals;
    /** Small cards inside Discord's window, taken away when the plugin stops. No permission needed. See `src/api/notifications.ts`. */
    notifications: PluginNotifications;
    /** Discord's own sounds by name: `list()` and `play(name, volume)`; stopped when the plugin stops. No permission needed. See `src/api/sounds.ts`. */
    sounds: PluginSounds;
    /** A menu at the pointer, or on a right click on matching elements; closed when the plugin stops. No permission needed. See `src/api/contextMenu.ts`. */
    contextMenu: PluginContextMenu;
    /** Calls to this plugin's own main-process functions (its `native` file). See `src/api/native.ts`. */
    native: PluginNativeCaller;
    /** This plugin's secrets (the names in `secrets` of its plugin.json): write, forget, ask whether one exists. Never read. See `src/api/secrets.ts`. */
    secrets: PluginSecrets;
    /** This plugin's own data (lists, favourites): plain JSON under keys only it can see, kept in Discord's page. See `src/api/storage.ts`. */
    storage: PluginStorage;
    /** React and Discord's own components (button, text, window pieces...), each with our own as a fallback; the fallbacks' CSS is added the first time one is asked for. See `src/api/discordComponents.ts`. */
    components: PluginComponents;
    /**
     * Every plugin's choices and settings, readable and writable. Only core plugins get it (the Settings plugin needs it);
     * any other plugin reaches its own settings through `settings` in its code.
     */
    settingsAdmin?: SettingsClient;
    /** The cards of every plugin for the Plugins page, with their state right now. Only core plugins get it. */
    plugins?: {
        cards(): PluginCard[];
        card(id: string): PluginCard | undefined;
        /**
         * Turn a plugin on or off and save the choice. Plugins without patches change on the spot; the rest wait for a restart
         * (`restart-needed`). Core plugins cannot be turned off, and a plugin that others need cannot be turned off while they run.
         */
        toggle(id: string, enabled: boolean): Promise<ToggleResult>;
        /** Restart Discord now. The calling screen must have asked the user first: calls and unsent drafts are lost. */
        restart(): void;
        /**
         * The declared settings of a plugin as plain data, with their values now. Only a plugin whose code is running can be read: for a
         * plugin that declares settings but is off the answer is `not-loaded` (its code is never loaded just to read them).
         */
        settingsOf(id: string): PluginSettingsAnswer;
        /** The component a running plugin draws in its settings window, or undefined (off, unknown, none given, or not a function). */
        settingsComponentOf(id: string): PluginSettingsComponent | undefined;
        /** Change one setting of a running plugin through its own declaration (a wrong type or a value out of its limits is refused). Returns why it was refused, or null. */
        setSetting(id: string, key: string, value: JsonValue): string | null;
        /** Forget the saved values of a running plugin's settings, so the defaults apply again. Its on/off choice is not touched. Returns why it was refused, or null. */
        resetSettings(id: string): string | null;
    };
    /** Add CSS to the page. It is removed when the plugin stops or fails to start. See `src/api/styles.ts`. */
    addStyle(css: string, name?: string): StyleHandle;
    /** Counts one thing a privacy plugin stopped inside Discord (it shows in the engine status). Only core plugins get it. */
    privacy?: { stopped(kind: StoppedKind): void; paused(): boolean; };
}

/** What the engine needs from a plugin's declared settings (see `definePluginSettings`). */
export interface BindableSettings {
    bind(client: SettingsClient, pluginId: string): void;
    unbind(): void;
}

/** What a plugin's code gives the engine. */
export interface PluginCode {
    patches?: PatchDefinition[];
    /** The plugin's declared settings. The engine attaches them to the plugin before anything starts. */
    settings?: BindableSettings;
    /** Something the plugin draws in its own settings window, below its declared settings (see `PluginSettingsComponent`). Only used while the plugin runs. */
    settingsComponent?: PluginSettingsComponent;
    /** Handlers for Discord's own events, by event type. Subscribed after `start` succeeds and taken back when the plugin stops. See `src/api/flux.ts`. */
    flux?: FluxHandlers;
    start?(ctx: EnginePluginContext): void | Promise<void>;
    stop?(ctx: EnginePluginContext): void | Promise<void>;
}

export interface RegistryView {
    plugins: ReadonlyArray<PluginInfo & PluginSource & { startAt: Stage; deferrable: boolean; }>;
    startOrder: readonly string[];
}

export interface EngineOptions {
    bridge: Bridge;
    registry: RegistryView;
    /** The user's saved plugin choices. */
    choices: Readonly<Record<string, boolean | undefined>>;
    /** Get a plugin's code. May throw: that counts as the plugin failing to start. Only called for plugins that will run. */
    loadPlugin(id: string): PluginCode;
    /** Discord's build number when it is already known. Otherwise it is read from the page when Webpack is found. */
    build?: number | null;
    /** Where the page keeps `GLOBAL_ENV`. Default: `globalThis`. */
    clientGlobal?: unknown;
    cache?: ResolutionCache;
    /** Where plugins' CSS is put. Default: <style> elements in the page. */
    styleHost?: StyleHost;
    /** The page's document, where plugins' notification cards and context menus are drawn. Default: the global one. */
    document?: ContextMenuDocument;
    /** Where plugins' own data is kept. Default: IndexedDB of the page, when it has one. */
    storage?: StorageBackend;
    /** Where Webpack's assignments are caught. Default: `Function.prototype`. */
    hookTarget?: object;
    getStack?: () => string;
    /** Where the global entry is defined. Default: `globalThis`. */
    globalObject?: object;
    /** Calls back once the page's DOM is ready. Default uses `document`. */
    whenDomReady?: (callback: () => void) => void;
    /** Runs work after a delay. Default `setTimeout`. */
    later?: (work: () => void, ms: number) => void;
    /** How long after the last stage the boot counts as clean. Default 5000. */
    cleanBootDelayMs?: number;
    lifecycle?: LifecycleOptions;
    /** Dev mode only: how long the settings probe waits for Discord's settings code (default 10 minutes). */
    probeWaitMs?: number;
    /** Where entries for Discord's own menus are kept. Default: the one hub of the page, which the patch of the core plugin ContextMenuApi uses. */
    nativeMenus?: NativeMenuHub;
    /**
     * The privacy self-test of the start (does the client tell Discord it has mods?). It runs only when this is given, with the page's
     * WebSocket class; the engine adds the reading of Discord's properties and the reporting. Left out in tests that do not need it.
     */
    selfTest?: Pick<SelfTestOptions, "webSocket" | "maxSends" | "maxMs" | "pollMs" | "now">;
}

export interface Engine {
    /** Plugins that run, in start order. */
    enabled: readonly string[];
    /** Things wrong with the input or the setup, for the health report. */
    problems: readonly string[];
    lifecycle: PluginLifecycle;
    patches: PatchRegistry;
    /** Settles when every stage has finished. */
    done: Promise<void>;
}

/** Texts looked for in Discord's module sources by the dev-mode search. */
const SETTINGS_NEEDLES = ["[SettingsDirectory]", "$Root", "billing_section", "parentSidebarItemKey"] as const;

/**
 * Texts looked for by the dev-mode search to find where Discord builds its analytics, metrics and mod detection (piece P3 of design 05,
 * docs/analysis-15-notrack.md). Only the code of Discord's modules is read; the result is redacted like every other dump.
 */
const NOTRACK_NEEDLES = [
    "AnalyticsActionHandlers", "analyticsTrackingStoreMaker", "requestDrain", "submitEventsImmediately",
    ".METRICS_V2", "_intervalId=", "has_client_mods", "getSuperPropertiesBase64", "DiscordSentry"
] as const;

/**
 * Texts looked for by the dev-mode search to find the code of Discord's modal opener and closer (docs/analysis-35-modal-opener.md). Only module code is read;
 * the result is redacted like every other dump.
 */
const MODAL_NEEDLES = ["modalKey:", "onCloseRequest:null!=", "onCloseCallback&&", ".onCloseCallback()", "MODAL_PUSH", "MODAL_POP"] as const;

/**
 * Texts looked for by the dev-mode search to find where Discord keeps the names and files of its sounds (piece P4 of docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md).
 * Only module code is read; the result is redacted like every other dump.
 */
const SOUND_NEEDLES = ["discodo", "message1", "bop_message1", ".mp3"] as const;

/**
 * Texts looked for by the dev-mode search to find Discord's own window piece (`ModalRoot`) and its focus lock, so the plugin windows can use them
 * (docs/analysis-51-modal-focus-lock.md). Only module code is read; the result is redacted like every other dump.
 */
/**
 * Texts looked for by the dev-mode search for the patches of a Quests plugin: where they are in Discord's code and whether that module has already run (`loaded`).
 * Written every round even when nothing is found, because "not registered yet" (its chunk was not downloaded) is an answer too.
 */
/**
 * Texts looked for by the dev-mode search to find where Discord draws its context menus and their parts (the menu, its items, groups, separators and check items),
 * and the menu of a Quest tile (`quests-entry`). Written every round even with no hit; each hit says whether its module has already run.
 */
const MENU_NEEDLES = ["\"quests-entry\"", "navId:", "role:\"menu\"", "role:\"menuitem\"", "\"menuitemcheckbox\"", "role:\"separator\"", "openContextMenuLazy"] as const;
const QUEST_NEEDLES = ["QUEST_HOME)},[]),", ".ALL)}):(", "questNameHeadingId"] as const;
const DIALOG_NEEDLES = ["\"data-dialog\":\"modal\"", "setFocusLockDisabled:"] as const;
const MODAL_PARTS_NEEDLES = ["\"aria-modal\":", "returnFocus", "FocusLock", "data-no-focus-lock", "focusin", "tabbable"] as const;

const describe = (value: unknown) => (value instanceof Error ? `${value.name}: ${value.message}` : String(value));

interface DocumentLike {
    readyState: string;
    addEventListener(type: string, listener: () => void, options: { once: boolean; }): void;
}

// Read through globalThis: this file is also type-checked and tested outside a browser.
const defaultWhenDomReady = (callback: () => void) => {
    const document = (globalThis as { document?: DocumentLike; }).document;
    if (!document || document.readyState !== "loading") callback();
    else document.addEventListener("DOMContentLoaded", callback, { once: true });
};

export function startEngine(options: EngineOptions): Engine {
    const { bridge, registry } = options;
    const problems: string[] = [];
    const send = (event: HealthEvent) => {
        try {
            bridge.sendHealth(event);
        } catch {
            // The bridge failing must never stop Discord from starting.
        }
    };

    // 1. Which plugins run. Safe mode and quarantine are decided before anything is registered.
    const info = bridge.bootInfo;
    const set = computeEnabledSet({
        plugins: registry.plugins,
        startOrder: registry.startOrder,
        choices: options.choices,
        bootState: { safeMode: info.safeMode, quarantine: info.quarantine.map(id => ({ id, reason: "", at: 0 })) },
        engineApis: ENGINE_APIS
    });
    problems.push(...set.problems);
    send({ type: "enabled", plugins: set.enabled });
    let build = options.build ?? null;
    send({ type: "discord-build", build });

    // 2. Load the code of the plugins that run, attach their settings and register their patches.
    const settingsClient = new SettingsClient(info.settings, change => { bridge.changeSetting(change); });
    const patches = new PatchRegistry();
    const codes = new Map<string, PluginCode>();
    const loadErrors = new Map<string, unknown>();
    /** Plugins whose settings are attached right now. */
    const attached = new Set<string>();
    for (const id of set.enabled) {
        try {
            const code = options.loadPlugin(id);
            code.settings?.bind(settingsClient, id);
            attached.add(id);
            codes.set(id, code);
            for (const patch of code.patches ?? []) patches.add({ ...patch, plugin: id });
        } catch (error) {
            loadErrors.set(id, error);
        }
    }

    // 3. Finders look at Discord's Webpack through a view that is filled in when the main instance is found.
    const view = new WreqView();
    const finders = new FinderEngine({
        view,
        cache: options.cache,
        onMiss: miss => send({ type: "finder-miss", plugin: miss.plugin, finder: miss.description, required: miss.required })
    });

    // JSX in plugins draws with Discord's own React, looked up when a screen is drawn. CSS from plugins goes through one manager.
    const reactFinder = finders.forPlugin("common").byProps<ReactLike>(...REACT_PROPS);
    setReactSource(() => reactFinder.get());
    const page = (globalThis as { document?: Parameters<typeof pageStyleHost>[0]; }).document;
    const styles = new StyleManager(options.styleHost ?? (page ? pageStyleHost(page) : { create: () => { throw new Error("there is no page to add styles to"); }, attach: () => undefined }));

    // 4. The lifecycle. A plugin whose code could not be loaded fails at its own start, so it is reported and counted like any other failure.
    const byId = new Map(registry.plugins.map(p => [p.id, p]));
    // The cards of the Plugins page, made fresh at each call from the registry, the start decision and the state of the lifecycle
    // (which is created below; the cards are only asked for once plugins run).
    const cards = () => buildPluginCards({
        plugins: registry.plugins,
        enabledSet: set,
        choiceOf: id => settingsClient.getEnabled(id),
        build,
        stateOf: id => lifecycle.stateOf(id),
        errorOf: id => lifecycle.errorOf(id)
    });
    let selfTest: SelfTest | undefined;
    const stopped: Record<StoppedKind, number> = { analytics: 0, metrics: 0, "crash-reports": 0 };
    const stoppedAt: Record<StoppedKind, number | null> = { analytics: null, metrics: null, "crash-reports": null };
    // Whether protection is paused is decided in the main process. The page only remembers the last snapshot it was given, and the time it runs out;
    // it never sets this on its own word, and a pause the main process stopped is noticed at the next snapshot (the tab asks every few seconds).
    let pausedUntil: number | null = null;
    const privacyApi = {
        stopped: (kind: StoppedKind) => { if (kind in stopped) { stopped[kind]++; stoppedAt[kind] = Date.now(); } },
        paused: () => pausedUntil !== null && Date.now() < pausedUntil
    };
    // The firewall lives in the main process; the page asks for its counters when the status is read (at most once a second) and shows the last answer.
    let network = emptyNetworkCounts();
    let dns = "";
    let askedAt = -Infinity;
    const refreshNetwork = () => {
        const now = Date.now();
        if (!bridge.firewallStatus || now - askedAt < 1000) return;
        askedAt = now;
        try {
            bridge.firewallStatus().then(answer => {
                const parsed = parseFirewallAnswer(answer);
                if (parsed) {
                    network = parsed.counts;
                    dns = parsed.dns;
                }
            }, () => undefined);
        } catch {
            // The main process not answering only leaves the last numbers.
        }
    };
    refreshNetwork();
    const engineApi = {
        status: (): EngineStatus => (refreshNetwork(), {
            version: PROJECT_VERSION, discordBuild: build, safeMode: info.safeMode, safeModeReason: info.safeModeReason,
            enteredSafeMode: info.enteredSafeMode, quarantine: [...info.quarantine], devMode: info.devMode, problems: [...info.problems, ...problems],
            selfTests: selfTest?.results() ?? [],
            stopped: { ...stopped },
            stoppedAt: { ...stoppedAt },
            network: { ...network },
            dns
        }),
        openDataFolder: () => { bridge.openDataFolder(); },
        leaveSafeMode: () => { bridge.leaveSafeMode?.(); },
        privacy: async (): Promise<PrivacyAnswer | null> => {
            try {
                const answer = bridge.privacyStatus ? parsePrivacyAnswer(await bridge.privacyStatus()) : null;
                if (answer) pausedUntil = answer.pause ? Date.now() + answer.pause.remainingMs : null;
                return answer;
            } catch {
                return null;
            }
        },
        updates: async (request: UpdateRequest): Promise<UpdateAnswer | null> => {
            try {
                return bridge.updates ? parseUpdateAnswer(await bridge.updates(request)) : null;
            } catch {
                return null;
            }
        },
        blocks: async (): Promise<BlockLog | null> => {
            try {
                return bridge.blockLog ? parseBlockLog(await bridge.blockLog()) : null;
            } catch {
                return null;
            }
        },
        changePrivacy: async (change: PrivacyChange): Promise<PrivacyChangeResult | null> => {
            try {
                return bridge.changePrivacy ? parseChangeResult(await bridge.changePrivacy(change)) : null;
            } catch {
                return null;
            }
        },
        testProvider: async (id: string): Promise<ProviderTestAnswer | null> => {
            try {
                return bridge.testProvider ? parseProviderTest(await bridge.testProvider(id)) : null;
            } catch {
                return null;
            }
        }
    };
    /** The settings of a plugin whose code is running; undefined for any other. */
    const runningSettings = (id: string) => {
        const settings = attached.has(id) ? codes.get(id)?.settings : undefined;
        return isPluginSettings(settings) ? settings : undefined;
    };
    const pluginCards = {
        cards,
        card: (id: string) => cards().find(card => card.id === id),
        toggle: (id: string, enabled: boolean) => pluginSwitch.toggle(id, enabled),
        restart: () => { bridge.restart(); },
        settingsOf: (id: string): PluginSettingsAnswer => {
            const settings = runningSettings(id);
            const entry = byId.get(id);
            if (settings) return { state: "ready", settings: describeSettings(settings, entry?.riskySettings ?? []) };
            // "Not loaded" is only for a plugin whose code is not attached (it is off). A running plugin that hands over something else is not trusted.
            return { state: entry?.hasSettings === true && !attached.has(id) ? "not-loaded" : "none" };
        },
        settingsComponentOf: (id: string): PluginSettingsComponent | undefined => {
            const component = attached.has(id) ? codes.get(id)?.settingsComponent : undefined;
            return typeof component === "function" ? component : undefined;
        },
        setSetting: (id: string, key: string, value: JsonValue): string | null => {
            const settings = runningSettings(id);
            if (!settings) return "that plugin has no settings that can be changed now";
            if (typeof key !== "string" || !Object.hasOwn(settings.definition, key)) return `"${String(key)}" is not a setting of that plugin`;
            try {
                (settings.store as Record<string, unknown>)[key] = value;
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        resetSettings: (id: string): string | null => {
            const settings = runningSettings(id);
            if (!settings) return "that plugin has no settings that can be reset now";
            try {
                settings.reset();
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        }
    };
    // The page's own database, when it has one. A plugin that asks for storage without it gets a clear error, nothing else is affected.
    const pageIndexedDb = (globalThis as { indexedDB?: IndexedDbFactory; }).indexedDB;
    const storageBackend = options.storage ?? (pageIndexedDb ? indexedDbBackend(pageIndexedDb) : undefined);
    // React and the components every plugin may draw with. Nothing is looked up until a plugin asks; a component that Discord's code did not give is ours, and that is
    // told once in the health report. Our own components' CSS goes into the page the first time any of them is asked for, and stays.
    const commonParts = declareCommon(finders.forPlugin("common"), name => send({ type: "finder-miss", plugin: "common", finder: `component ${name}`, required: false }));
    const addCommonStyle = styles.forRun("common", () => undefined);
    let commonStyleAdded = false;
    const pluginComponents = { react: commonParts.react } as unknown as PluginComponents;
    for (const name of COMPONENT_NAMES) {
        Object.defineProperty(pluginComponents, name, {
            enumerable: true,
            get: () => {
                if (!commonStyleAdded) {
                    commonStyleAdded = true;
                    try {
                        addCommonStyle(FALLBACK_CSS, "fallback-components");
                    } catch (error) {
                        send({ type: "runtime-error", plugin: "common", source: "fallback styles", error: describe(error) });
                    }
                }
                return commonParts[name];
            }
        });
    }
    // The corner where plugins' notification cards go, made the first time one is shown; its CSS goes into the page then and stays.
    const pageDocument = options.document ?? (globalThis as unknown as { document?: ContextMenuDocument; }).document;
    const addPageStyle = (css: string, name: string, what: string) => {
        try {
            addCommonStyle(css, name);
        } catch (error) {
            send({ type: "runtime-error", plugin: "common", source: what, error: describe(error) });
        }
    };
    // Discord's own menu pieces are looked for in the source of its modules; a miss is tried again only after a few seconds, because the search reads every module.
    let menuPartsFound: MenuParts | undefined;
    let menuPartsTriedAt: number | undefined;
    const findMenuParts = (): MenuParts | undefined => {
        if (menuPartsFound) return menuPartsFound;
        const now = Date.now();
        if (menuPartsTriedAt !== undefined && now - menuPartsTriedAt < 5000) return undefined;
        menuPartsTriedAt = now;
        menuPartsFound = locateMenuParts(view);
        return menuPartsFound;
    };
    const contextMenuLayer = createContextMenuLayer({
        document: pageDocument,
        addStyle: css => { addPageStyle(css, "context-menu", "context menu styles"); },
        native: options.nativeMenus ?? nativeMenus,
        menuParts: findMenuParts
    });
    const notificationLayer = createNotificationLayer({
        document: pageDocument,
        setTimeout: (work, ms) => setTimeout(work, ms),
        clearTimeout: timer => { clearTimeout(timer as ReturnType<typeof setTimeout>); },
        addStyle: css => { addPageStyle(css, "notifications", "notification styles"); }
    });
    const soundLayer = createSoundLayer({
        locate: () => locateSoundContext(view),
        createAudio: url => {
            const make = (globalThis as unknown as { Audio?: new (src: string) => AudioLike; }).Audio;
            return make ? new make(url) : undefined;
        },
        now: () => Date.now()
    });
    // The page's own pieces, when there is a page. Plugins started without one (tests) get messages and menus that do nothing.
    const thePage = globalThis as unknown as Partial<MenuPage & ToastPage>;
    const havePage = thePage.document !== undefined && thePage.MutationObserver !== undefined;
    const menuHub = havePage
        ? new ContextMenuHub(globalThis as unknown as MenuPage, css => { addCommonStyle(css, "context-menus"); }, (plugin, source, error) => { send({ type: "runtime-error", plugin, source, error: describe(error) }); })
        : undefined;
    const chatBarHub = havePage && (globalThis as unknown as Partial<ChatBarPage>).setTimeout !== undefined
        ? new ChatBarHub(globalThis as unknown as ChatBarPage, (css, name) => { addCommonStyle(css, name); }, (plugin, source, error) => { send({ type: "runtime-error", plugin, source, error: describe(error) }); })
        : undefined;
    const makeRuntime = (id: string): PluginRuntime => {
        const info = byId.get(id)!;
        const context = (ctx: PluginContext): EnginePluginContext => {
            const pluginFinders = finders.forPlugin(id);
            const reportError = (source: string, error: unknown) => { send({ type: "runtime-error", plugin: id, source, error: describe(error) }); };
            return {
                ...ctx,
                finders: pluginFinders,
                common: buildCommon(pluginFinders),
                menuItems: menuHub ? buildContextMenus(menuHub, id, ctx.onDispose) : { add: () => undefined },
                serverList: buildServerList(serverList, id, ctx.onDispose),
                userArea: buildUserArea(userArea, id, ctx.onDispose),
                settingsTabs: buildSettingsTabs(settingsTabs, id, ctx.onDispose),
                commands: buildCommands(commandHub, id, ctx.onDispose, reportError),
                chatBar: chatBarHub ? buildChatBar(chatBarHub, id, ctx.onDispose) : { add: () => false, refresh: () => undefined },
                toasts: havePage ? buildToasts(globalThis as unknown as ToastPage, css => { addCommonStyle(css, "toasts"); }, ctx.onDispose) : { show: () => undefined },
                modals: buildModals(pluginFinders, ctx.onDispose, reportError),
                notifications: notificationLayer.forPlugin(id, ctx.onDispose, reportError),
                sounds: soundLayer.forPlugin(id, ctx.onDispose, reportError),
                contextMenu: contextMenuLayer.forPlugin(id, ctx.onDispose, reportError),
                native: buildNative(id, bridge.native?.bind(bridge)),
                secrets: buildSecrets(id, bridge.secret?.bind(bridge)),
                storage: buildStorage(id, storageBackend),
                components: pluginComponents,
                addStyle: styles.forRun(id, ctx.onDispose),
                reportError,
                ...(info.permissions?.code.dynamic === true ? { modules: { loaded: () => view.loadedModules(), sourceOf: (moduleId: string) => view.sourceOf(moduleId) } } : {}),
                ...(info.core ? { settingsAdmin: settingsClient, plugins: pluginCards, engine: engineApi, privacy: privacyApi } : {})
            };
        };
        return {
            id,
            startAt: info.startAt,
            deferrable: info.deferrable,
            dependencies: info.dependencies,
            start: ctx => {
                if (loadErrors.has(id)) throw loadErrors.get(id);
                const code = codes.get(id);
                const pluginContext = context(ctx);
                const started = code?.start?.(pluginContext);
                const handlers = code?.flux;
                if (!handlers) return started;
                // After start() has finished, and once Discord's dispatcher exists. A plugin cannot be stopped while it is starting, and if
                // the wait fails the start fails and is rolled back, so nothing can stay subscribed.
                return Promise.resolve(started)
                    .then(() => pluginContext.finders.byProps<FluxDispatcherLike>("dispatch", "subscribe").ready())
                    .then(dispatcher => {
                        ctx.onDispose(subscribeFlux(dispatcher, handlers, (type, error) => { pluginContext.reportError(`flux ${type}`, error); }));
                    });
            },
            stop: ctx => codes.get(id)?.stop?.(context(ctx))
        };
    };

    const lifecycle = new PluginLifecycle(set.enabled.map(makeRuntime), {
        ...options.lifecycle,
        onEvent: (event: LifecycleEvent) => {
            if (event.type === "started") send({ type: "started", plugin: event.plugin, ms: event.ms });
            else if (event.type === "start-failed") send({ type: "start-failed", plugin: event.plugin, error: event.error });
            else if (event.type !== "stopped") send({ type: "runtime-error", plugin: event.plugin, source: event.type, error: event.error });
            options.lifecycle?.onEvent?.(event);
        }
    });

    // Plugins turned on or off while Discord runs. `prepare` does for one plugin what the loop above did at start, and a failure to
    // load is kept like at start so the plugin shows as failed instead of vanishing.
    const pluginSwitch = new PluginSwitch({
        plugins: registry.plugins.map(p => ({ id: p.id, core: p.core, dependencies: p.dependencies, hasPatches: p.hasPatches ?? false, requiresRestart: p.requiresRestart ?? "auto", hasNative: p.hasNative ?? false })),
        engineApis: ENGINE_APIS,
        stateOf: id => lifecycle.stateOf(id),
        errorOf: id => lifecycle.errorOf(id),
        start: id => lifecycle.startPlugin(id),
        stop: id => lifecycle.stopPlugin(id),
        prepare: id => {
            try {
                let code = codes.get(id);
                if (!code) {
                    code = options.loadPlugin(id);
                    // Patches only work while Discord loads its modules. If the scan of the build missed them, wait for a restart.
                    if (code.patches?.length) return "restart";
                }
                if (!attached.has(id)) {
                    code.settings?.bind(settingsClient, id);
                    attached.add(id);
                }
                codes.set(id, code);
                loadErrors.delete(id);
            } catch (error) {
                loadErrors.set(id, error);
            }
            if (!lifecycle.has(id)) lifecycle.add(makeRuntime(id));
            return "ready";
        },
        release: id => {
            codes.get(id)?.settings?.unbind();
            attached.delete(id);
        },
        choiceOf: id => settingsClient.getEnabled(id),
        setChoice: (id, enabled) => settingsClient.setEnabled(id, enabled),
        blockedReason: id => (info.safeMode ? "safe mode is on, so only core plugins run" : info.quarantine.includes(id) ? "it is in quarantine" : undefined)
    });

    // 5. The global entry that patched code calls back into: it only looks a plugin up by id.
    try {
        Object.defineProperty(options.globalObject ?? globalThis, PROJECT_NAME, {
            value: Object.freeze({ plugin: (id: string) => codes.get(id) }),
            enumerable: false,
            writable: false,
            configurable: false
        });
    } catch (error) {
        problems.push(`the global entry could not be defined (${describe(error)})`);
    }

    // 6. Hook Webpack. Patches are already registered, so every module Discord loads from now on can be patched.
    let mainFound!: () => void;
    const webpackReady = new Promise<void>(resolve => { mainFound = resolve; });

    installWebpackHook({
        target: options.hookTarget,
        getStack: options.getStack,
        wrapOptions: {
            registry: patches,
            getBuild: () => build,
            onCompiled: result => {
                for (const outcome of result.outcomes) {
                    send({
                        type: "patch",
                        plugin: outcome.plugin,
                        find: outcome.find,
                        moduleId: outcome.moduleId,
                        required: outcome.required,
                        status: outcome.status,
                        replacements: outcome.replacements.map(r => ({ match: r.match, status: r.status, ...(r.error ? { error: r.error } : {}) }))
                    });
                }
            },
            onError: failure => {
                for (const plugin of failure.plugins) {
                    send({
                        type: "runtime-error",
                        plugin,
                        source: `module ${failure.moduleId} (${failure.phase}${failure.fellBack ? ", original used" : ""})`,
                        error: describe(failure.error)
                    });
                }
            },
            onModuleLoaded: (id, exports) => {
                // First note what the module exported, then tell anyone waiting for it.
                view.record(id, exports);
                finders.notifyLoaded(id);
            }
        },
        onMain: wreq => {
            view.wreq = wreq as unknown as WreqLike;
            // Discord's inline script has run by now, so the page knows its build number.
            if (build === null) {
                build = readBuildNumber(options.clientGlobal ?? globalThis);
                if (build !== null) send({ type: "discord-build", build });
            }
            mainFound();
        }
    });

    // 7. Start the stages in order. Each waits for what it needs.
    const whenDomReady = options.whenDomReady ?? defaultWhenDomReady;
    const later = options.later ?? ((work, ms) => { setTimeout(work, ms); });

    // The privacy self-test starts now, as early as the page script runs, so the first gateway message is covered. The properties
    // object is read as soon as Discord's module that builds it can be found.
    if (options.selfTest) {
        try {
            const propertiesFinder = finders.forPlugin("self-test").byProps("getSuperPropertiesBase64");
            selfTest = startSelfTest({
                ...options.selfTest,
                later,
                getSuperProperties: () => {
                    // `peek`, not `get`: until Discord has loaded the module this is asked for every second and must not count as a miss.
                    const module = propertiesFinder.peek() as { getSuperPropertiesBase64?: () => unknown; } | undefined;
                    return typeof module?.getSuperPropertiesBase64 === "function" ? module.getSuperPropertiesBase64() : undefined;
                },
                report: result => { send({ type: "self-test", name: result.name, status: result.status, detail: result.detail, ms: result.ms }); }
            });
        } catch (error) {
            problems.push(`the privacy self-test could not start (${describe(error)})`);
        }
    }

    // Development only (the dev flag file exists): the settings probe reads the structure of Discord's settings once.
    if (info.devMode && bridge.devDump) {
        const dump = bridge.devDump.bind(bridge);
        startSettingsProbe({
            finders: finders.forPlugin("settings-probe"),
            dump,
            document: (globalThis as { document?: ProbeDocument; }).document,
            waitMs: options.probeWaitMs,
            later
        });

        // What the module view knows, written every 10 seconds for two minutes (names and counts only).
        let rounds = 0;
        let bestComponentsScore = -1;
        const report = () => {
            try {
                const search = finders.forPlugin("debug").byProps("ROOT", "SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM").get();
                bridge.devDump?.("engine-debug", JSON.stringify({ round: rounds, enumFoundByFinder: search !== undefined, finderStats: finders.stats(), ...view.debugSummary("Z6") }));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord builds the settings tree: its code, searched in memory (the lazy chunks only exist once Settings has opened).
            try {
                const hits = view.searchSources(SETTINGS_NEEDLES);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord builds its analytics and metrics and its mod detection, searched in memory the same way.
            try {
                const hits = view.searchSources(NOTRACK_NEEDLES, 4, 700);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search-notrack", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord opens and closes its modals.
            try {
                const hits = view.searchSources(MODAL_NEEDLES, 6, 900);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search-modals", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord keeps the names and files of its sounds.
            try {
                const hits = view.searchSources(SOUND_NEEDLES, 8, 500);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search-sounds", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord draws its context menus and their parts. Written even with no hit.
            try {
                const hits = view.searchSources(MENU_NEEDLES, 6, 900);
                bridge.devDump?.("module-search-menus", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where the Quests code is, and whether its modules have run. Written even with no hit.
            try {
                const hits = view.searchSources(QUEST_NEEDLES, 6, 700);
                bridge.devDump?.("module-search-quests", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // The whole source of Discord's dialog box modules (small ones), to see what they export.
            try {
                const hits = view.searchSources(DIALOG_NEEDLES, 3, 2500);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search-dialog", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // Where Discord keeps its window piece and the lock that keeps the focus inside the top window.
            try {
                const hits = view.searchSources(MODAL_PARTS_NEEDLES, 6, 700);
                if (Object.values(hits).some(list => list.length > 0)) bridge.devDump?.("module-search-modal-parts", redact(JSON.stringify({ round: rounds, hits })));
            } catch {
                // Debug output must never disturb Discord.
            }
            // The building blocks on screen, once Settings is open. The fullest picture seen is the one kept.
            try {
                const page = (globalThis as { document?: ComponentsDocument; }).document;
                if (page && Array.from(page.querySelectorAll("[data-settings-sidebar-item]")).length > 0) {
                    const components = buildComponentsReport({ document: page, react: finders.forPlugin("debug").byProps(...REACT_PROPS) });
                    const score = Object.values(components.dom).reduce((sum, kind) => sum + kind.count, 0);
                    if (score > bestComponentsScore) {
                        bestComponentsScore = score;
                        bridge.devDump?.("components", redact(JSON.stringify(components)));
                    }
                }
            } catch {
                // Debug output must never disturb Discord.
            }
            if (++rounds < 12) later(report, 10_000);
        };
        later(report, 5_000);
    }
    const domReady = new Promise<void>(resolve => whenDomReady(resolve));

    const done = (async () => {
        await lifecycle.startStage("init", set.enabled);
        await webpackReady;
        await lifecycle.startStage("webpackReady", set.enabled);
        await domReady;
        await lifecycle.startStage("domReady", set.enabled);

        // Discord loads some modules only when a screen opens, so judging "never found" right away would blame plugins unfairly.
        // Patches that say so (`lazy`) are not judged at all: found the day the screen opens, or never, we cannot tell from here.
        later(() => {
            for (const patch of patches.neverMatched().filter(p => !p.lazy)) {
                send({ type: "patch-no-module", plugin: patch.plugin, find: String(patch.find), required: patch.required ?? true });
            }
            bridge.cleanBoot();
        }, options.cleanBootDelayMs ?? 5000);
    })();

    return { enabled: set.enabled, problems, lifecycle, patches, done };
}
