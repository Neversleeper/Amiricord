/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Settings core plugin: puts the Amiricord section in Discord's settings. One patch on the module that builds the settings tree
// gives our function the root builder; everything that decides what to add is in `layout.ts` and is tested without Discord. The idea of
// hooking the tree builder is the one TestCord and Vencord use; the code here is written from scratch for the structure read on Canary
// (docs/analysis-09-settings-core.md). The plugin is core: it also runs in safe mode, so the owner can always reach the section.
// Design: docs/design-03-settings.md.

import banner from "../../../assets/amiricord-banner.webp";
import logo from "../../../assets/amiricord-logo.webp";
import patchNotes from "../../../NEWS.json";
import { currentReact } from "../../api/jsxRuntime";
import { DEFAULT_LOG_SIZE, LOG_SIZE_CHOICES, logSizeOf } from "../../api/notificationLog";
import type { PluginCard } from "../../api/pluginCards";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { OWNER_ONLY_PLUGINS, OWNERS, PROJECT_VERSION } from "../../shared/project";
import { releasedNews } from "../../shared/updates";
import { MATERIALS } from "../../shared/windowChoices";
import { type AuthorInfo, authorInfo, type RawDiscordUser } from "./authorModel";
import { CUSTOM_CSS_ELEMENT_ID, CUSTOM_CSS_MAX, keepLast, makeCustomCss } from "./customCss";
import { makeCustomCssWindow } from "./CustomCssWindow";
import { EntryRegistry } from "./entries";
import { makeErrorBoundary } from "./ErrorBoundary";
import { makeHomeLogo } from "./homeLogo";
import { makeSidebarIcon, PluginsIcon, PrivacyIcon, UpdaterIcon } from "./icon";
import { buildLayoutWithSection, FALLBACK_TYPES, readTypes, TYPE_NAMES } from "./layout";
import { defaultButtonGroups, defaultChoices, defaultQuickActions, defaultSettings, type LiveChoice, type LiveSwitch } from "./mainItems";
import { makeMainTab } from "./MainTab";
import { hideDiscordButtons, NATIVE_TITLE_BAR_STYLE_NAME, nativeTitleBarCss } from "./nativeTitleBar";
import { makeNotificationLogWindow } from "./NotificationLogWindow";
import { makeNotificationOptionsWindow } from "./NotificationOptionsWindow";
import { cardsForPerson } from "./pluginsModel";
import { makePluginsTab } from "./PluginsTab";
import { PLUGINS_TAB_CSS, PLUGINS_TAB_STYLE_NAME } from "./pluginsTabStyles";
import { makePluginWindow, type WindowParts } from "./PluginWindow";
import { makePrivacyTab } from "./PrivacyTab";
import { SETTINGS_CSS, SETTINGS_STYLE_NAME } from "./styles";
import { LAYOUT_MAX_CHARS, parseLayout, visibleTabs } from "./tabLayout";
import { makeTabsEditor } from "./TabsEditor";
import { makeUpdatesTab } from "./UpdatesTab";

const registry = new EntryRegistry();

/** What Editor Mode saved: one JSON text (docs/design-04-editor-mode.md). Read through `parseLayout`, so a damaged value is harmless. */
const settings = definePluginSettings({
    tabLayout: { type: "string", default: "", maxLength: LAYOUT_MAX_CHARS, description: "Which tabs of the Amiricord section are hidden, their order and the pinned ones (saved by Editor Mode)." },
    customCss: { type: "string", default: "", maxLength: CUSTOM_CSS_MAX, description: "Your own style sheet (saved by Edit Custom CSS)." },
    customCssOn: { type: "boolean", default: false, description: "Whether your own style sheet is applied to Discord." },
    showAmiricordLogo: { type: "boolean", default: false, description: "Whether the Discord logo of the Home button is swapped for the Amiricord logo." },
    removeMinimumSize: { type: "boolean", default: false, restartNeeded: true, description: "Whether the Discord window may be made smaller than the size Discord normally allows." },
    ctrlQToQuit: { type: "boolean", default: false, restartNeeded: true, description: "Whether Ctrl+Q closes the Discord window, as Alt+F4 does." },
    nativeTitleBar: { type: "boolean", default: false, restartNeeded: true, description: "Whether the Discord window uses the standard Windows title bar instead of Discord's own." },
    transparentWindow: { type: "boolean", default: false, restartNeeded: true, description: "Whether the Discord window is made see-through (needs a theme made for it)." },
    backgroundMaterial: { type: "select", default: "none", restartNeeded: true, options: MATERIALS.map(name => ({ label: name, value: name })), description: "The Windows background effect of the Discord window (none, mica, tabbed or acrylic)." },
    notificationCards: { type: "boolean", default: true, description: "Whether the notifications of plugins are drawn as cards in the corner of Discord's window." },
    notificationLog: { type: "boolean", default: true, description: "Whether the notifications of plugins are kept in the Notification Log (in memory, for this session)." },
    notificationLogSize: { type: "select", default: DEFAULT_LOG_SIZE, options: LOG_SIZE_CHOICES.map(size => ({ label: String(size), value: size })), description: "How many notifications the Notification Log keeps." }
});
let context: EnginePluginContext | undefined;
let nodeTypes: { get(): unknown; } | undefined;
let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;

/** The error boundary class, made the first time something is drawn, when React certainly exists. */
function boundary() {
    Boundary ??= makeErrorBoundary(currentReact(), (what, error) => { context?.reportError(what, error); });
    return Boundary;
}

/** A tab drawn inside the error boundary. */
function guarded(label: string, Inner: () => unknown) {
    return function Guarded() {
        const Safe = boundary();
        return <Safe label={label}><Inner /></Safe>;
    };
}

const plugin: PluginCode & { buildLayout(builder: { key?: unknown; buildLayout(): unknown; }): unknown; } = {
    settings,

    patches: [{
        // The module that builds Discord's settings tree; the match gives our function the builder where Discord calls `.buildLayout()` on it.
        find: ".buildLayout().map",
        // Discord builds the settings tree in a chunk that loads only when Settings is opened, not at start.
        lazy: true,
        replacements: [{ match: /(\i)\.buildLayout\(\)(?=\.map)/, replace: "$self.buildLayout($1)" }]
    }],

    /** Called by the patched Discord code instead of `builder.buildLayout()`. */
    buildLayout(builder) {
        return buildLayoutWithSection(builder, {
            types: () => readTypes(nodeTypes?.get()) ?? FALLBACK_TYPES,
            entries: () => (context ? visibleTabs(registry.list(), parseLayout(settings.store.tabLayout)) : []),
            onError: error => { context?.reportError("settings layout", error); }
        });
    },

    start(ctx) {
        if (!ctx.engine || !ctx.plugins) throw new Error("the Settings plugin needs the engine and plugin cards of a core plugin");
        const { engine, plugins } = ctx;
        context = ctx;
        nodeTypes = ctx.finders.byProps(...TYPE_NAMES);
        ctx.addStyle(SETTINGS_CSS, SETTINGS_STYLE_NAME);

        // The owner's own style sheet: applied from the two saved settings now and whenever either changes (the switch of the main tab or the editor window).
        const customCss = makeCustomCss({
            read: () => ({ on: settings.store.customCssOn, text: settings.store.customCss }),
            add: (css, name) => ctx.addStyle(css, name),
            safeMode: () => engine.status().safeMode,
            keepLast: () => {
                const page = (globalThis as { document?: Parameters<typeof keepLast>[0]; MutationObserver?: new (callback: () => void) => ReturnType<Parameters<typeof keepLast>[2]>; });
                const { document, MutationObserver } = page;
                return document && MutationObserver ? keepLast(document, CUSTOM_CSS_ELEMENT_ID, callback => new MutationObserver(callback)) : () => undefined;
            },
            report: (source, error) => { ctx.reportError(source, error); }
        });
        customCss.apply();
        ctx.onDispose(settings.onChange("customCss", () => { customCss.apply(); }));
        ctx.onDispose(settings.onChange("customCssOn", () => { customCss.apply(); }));
        ctx.onDispose(customCss.stop);
        // A switch of the main tab that is one saved true or false of this plugin: read, written (a refusal goes to the health report) and heard when it changes elsewhere.
        const liveSwitch = (key: "customCssOn" | "showAmiricordLogo" | "removeMinimumSize" | "ctrlQToQuit" | "nativeTitleBar" | "transparentWindow", what: string): LiveSwitch => ({
            get: () => settings.store[key],
            set: on => {
                try {
                    settings.store[key] = on;
                } catch (error) {
                    ctx.reportError(`saving the ${what} switch`, error);
                }
            },
            subscribe: listener => settings.onChange(key, () => { listener(); })
        });
        const customCssSwitch = liveSwitch("customCssOn", "Custom CSS");

        // The Amiricord logo in the place of Discord's in the Home button: a style, added while the switch is on.
        const homeLogo = makeHomeLogo({
            logo,
            read: () => settings.store.showAmiricordLogo,
            add: (css, name) => ctx.addStyle(css, name),
            safeMode: () => engine.status().safeMode,
            report: (source, error) => { ctx.reportError(source, error); }
        });
        homeLogo.apply();
        ctx.onDispose(settings.onChange("showAmiricordLogo", () => { homeLogo.apply(); }));
        ctx.onDispose(homeLogo.stop);

        // With the standard Windows bar on, Discord's own window buttons would be there twice: hide them. Decided once, at start (see nativeTitleBar.ts).
        try {
            if (hideDiscordButtons({ nativeTitleBar: settings.store.nativeTitleBar, transparentWindow: settings.store.transparentWindow, safeMode: engine.status().safeMode })) {
                ctx.addStyle(nativeTitleBarCss(), NATIVE_TITLE_BAR_STYLE_NAME);
            }
        } catch (error) {
            ctx.reportError("Windows title bar", error);
        }
        const homeLogoSwitch = liveSwitch("showAmiricordLogo", "Amiricord logo");

        // The window options are read by the main process when Discord starts (src/main/windowOptions.ts), so changing one only saves it; the page says "Restart" next to each.
        const noMinimumSizeSwitch = liveSwitch("removeMinimumSize", "minimum window size");
        const ctrlQSwitch = liveSwitch("ctrlQToQuit", "Ctrl+Q");
        const titleBarSwitch = liveSwitch("nativeTitleBar", "Windows title bar");
        const transparentSwitch = liveSwitch("transparentWindow", "transparent window");
        const materialChoice: LiveChoice = {
            get: () => Math.max(0, MATERIALS.indexOf(settings.store.backgroundMaterial)),
            set: index => {
                const name = MATERIALS[index];
                if (name === undefined) return;
                try {
                    settings.store.backgroundMaterial = name;
                } catch (error) {
                    ctx.reportError("saving the window background effect", error);
                }
            },
            subscribe: listener => settings.onChange("backgroundMaterial", () => { listener(); })
        };

        const removeMain = registry.register({
            key: "amiricord",
            title: "Amiricord",
            panelTitle: "Amiricord Settings",
            Component: guarded("The Amiricord tab", makeMainTab({
                leaveSafeMode: () => { engine.leaveSafeMode(); plugins.restart(); },
                status: () => engine.status(),
                cards: () => plugins.cards(),
                quickActions: defaultQuickActions({
                    openDataFolder: () => { engine.openDataFolder(); },
                    openCssEditor: () => { openCssEditor(); },
                    openNotificationLog: () => { openNotificationLog(); },
                    openNotificationOptions: () => { openNotificationOptions(); },
                    openHealthReport: () => { engine.openHealthReport(); },
                    openSourceCode: () => { engine.openSourceCode(); },
                    restart: () => { plugins.restart(); }
                }),
                settings: defaultSettings({ "custom-css": customCssSwitch, "amiricord-icon": homeLogoSwitch, "no-min-size": noMinimumSizeSwitch, "ctrl-q": ctrlQSwitch, "native-title-bar": titleBarSwitch, "transparent": transparentSwitch }),
                choices: defaultChoices({ "background-material": materialChoice }),
                buttonGroups: defaultButtonGroups({ openNotificationLog: () => { openNotificationLog(); }, openNotificationOptions: () => { openNotificationOptions(); } }),
                logo,
                banner,
                editor: guarded("The tab editor", makeTabsEditor({
                    title: "Amiricord",
                    tabs: () => registry.list().map(({ key, title, icon }) => ({ key, title, icon })),
                    read: () => settings.store.tabLayout,
                    write: text => {
                        try {
                            settings.store.tabLayout = text;
                        } catch (error) {
                            ctx.reportError("saving the tab layout", error);
                        }
                    }
                }))
            })),
            icon: makeSidebarIcon(logo)
        });
        ctx.onDispose(removeMain);

        ctx.addStyle(PLUGINS_TAB_CSS, PLUGINS_TAB_STYLE_NAME);

        // The window of a plugin (gear or "i"): drawn with the engine's window pieces inside the modal layer of Discord. The component is made once per
        // opening, so Discord drawing the layer again does not start it over (and lose what is being typed).
        const windowParts = (): WindowParts | undefined => {
            const found = {
                ModalRoot: ctx.components.ModalRoot.get(), ModalHeader: ctx.components.ModalHeader.get(), ModalContent: ctx.components.ModalContent.get(),
                ModalFooter: ctx.components.ModalFooter.get(), ModalCloseButton: ctx.components.ModalCloseButton.get()
            };
            return Object.values(found).every(Boolean) ? found as unknown as WindowParts : undefined;
        };
        // The Discord name and picture of an author, as Discord shows them now (an animated picture stays animated). First from Discord's own store of users it already
        // knows, then, if the person is not there, from Discord's own user request (the one its client makes for any profile). A miss is not remembered.
        const authorLookups = new Map<string, Promise<AuthorInfo | null>>();
        const lookupAuthor = (id: string): Promise<AuthorInfo | null> => {
            let known = authorLookups.get(id);
            if (!known) {
                known = (async () => {
                    const store = ctx.common.UserStore.get() as unknown as { getUser(id: string): RawDiscordUser | undefined; } | undefined;
                    const cached = authorInfo(id, store?.getUser(id));
                    if (cached) return cached;
                    const rest = ctx.finders.byProps<{ get(request: { url: string; }): Promise<{ body?: unknown; }>; }>("get", "post", "put", "del", "!Request", "!getXHR").get();
                    return rest ? authorInfo(id, (await rest.get({ url: `/users/${id}` })).body as RawDiscordUser) : null;
                })().catch(() => null);
                authorLookups.set(id, known);
                void known.then(found => { if (found === null) authorLookups.delete(id); });
            }
            return known;
        };
        const openDetails = (card: PluginCard): boolean => {
            const parts = windowParts();
            if (!parts) return false;
            const Window = makePluginWindow({
                card: id => plugins.card(id),
                settingsOf: id => plugins.settingsOf(id),
                setSetting: (id, key, value) => plugins.setSetting(id, key, value),
                resetSettings: id => plugins.resetSettings(id),
                componentOf: id => plugins.settingsComponentOf(id),
                guard: boundary(),
                lookupAuthor,
                parts
            });
            return ctx.modals.open(props => {
                const Safe = boundary();
                return <Safe label="The plugin window"><Window id={card.id} onClose={() => { props.onClose(); }} /></Safe>;
            }) !== undefined;
        };

        // The Notification Log keeps only as many as the size the owner chose: a smaller size drops the oldest ones at once.
        ctx.onDispose(settings.onChange("notificationLogSize", size => { engine.notificationLog.trim(logSizeOf(size)); }));

        // The two windows of the notifications: the log (what plugins showed in this session) and its options. Each is made once per opening, like the other windows.
        const openInWindow = (what: string, make: (parts: WindowParts) => (props: { onClose(): void; }) => unknown): void => {
            const parts = windowParts();
            if (!parts) {
                ctx.reportError(what, new Error("Discord's window pieces were not found, so the window cannot open"));
                return;
            }
            const Window = make(parts) as (props: { onClose(): void; }) => never;
            ctx.modals.open(props => {
                const Safe = boundary();
                return <Safe label={what}><Window onClose={() => { props.onClose(); }} /></Safe>;
            });
        };
        const openNotificationLog = () => {
            openInWindow("The Notification Log window", parts => makeNotificationLogWindow({
                list: () => engine.notificationLog.list(), clear: () => { engine.notificationLog.clear(); },
                subscribe: listener => engine.notificationLog.subscribe(listener), version: () => engine.notificationLog.version(), parts
            }));
        };
        const openNotificationOptions = () => {
            openInWindow("The notification options window", parts => makeNotificationOptionsWindow({
                read: () => ({ cards: settings.store.notificationCards, log: settings.store.notificationLog, size: logSizeOf(settings.store.notificationLogSize) }),
                set: change => {
                    try {
                        if (change.cards !== undefined) settings.store.notificationCards = change.cards;
                        if (change.log !== undefined) settings.store.notificationLog = change.log;
                        if (change.size !== undefined) settings.store.notificationLogSize = logSizeOf(change.size) as (typeof LOG_SIZE_CHOICES)[number];
                    } catch (error) {
                        ctx.reportError("saving the notification options", error);
                    }
                },
                parts
            }));
        };

        // The Custom CSS editor: a window with the engine's pieces, made once per opening so Discord drawing the layer again does not lose what is typed.
        const openCssEditor = () => {
            const parts = windowParts();
            if (!parts) {
                ctx.reportError("the Custom CSS editor", new Error("Discord's window pieces were not found, so the editor cannot open"));
                return;
            }
            const Editor = makeCustomCssWindow({
                read: () => ({ on: settings.store.customCssOn, text: settings.store.customCss }),
                save: text => {
                    try {
                        settings.store.customCss = text;
                        return null;
                    } catch (error) {
                        return error instanceof Error ? error.message : String(error);
                    }
                },
                setOn: on => { customCssSwitch.set(on); },
                safeMode: () => engine.status().safeMode,
                parts
            });
            ctx.modals.open(props => {
                const Safe = boundary();
                return <Safe label="The Custom CSS window"><Editor onClose={() => { props.onClose(); }} /></Safe>;
            });
        };

        const removePlugins = registry.register({
            key: "plugins",
            title: "Plugins",
            panelTitle: "Plugins",
            Component: guarded("The Plugins tab", makePluginsTab({
                // Some plugins (Badges) are not for people to see; their card is drawn only for the owners.
                cards: () => cardsForPerson(plugins.cards(), OWNER_ONLY_PLUGINS, OWNERS.map(owner => owner.discordId), ctx.common.UserStore.get()?.getCurrentUser()?.id),
                toggle: (id, enabled) => plugins.toggle(id, enabled),
                restart: () => { plugins.restart(); },
                openDetails
            })),
            icon: PluginsIcon
        });
        ctx.onDispose(removePlugins);

        // Privacy & Security (P7a shows, P7b changes through the main process, which asks the person when a change weakens protection). NoTrack's two switches are on unless the owner saved "false".
        const noTrack = (key: string) => ctx.settingsAdmin?.getValue("NoTrack", key) !== false;
        const removePrivacy = registry.register({
            key: "privacy",
            title: "Privacy & Security",
            panelTitle: "Privacy & Security",
            Component: guarded("The Privacy & Security tab", makePrivacyTab({
                status: () => engine.status(),
                cards: () => plugins.cards(),
                read: () => engine.privacy(),
                test: id => engine.testProvider(id),
                change: change => engine.changePrivacy(change),
                blocks: () => engine.blocks(),
                restart: () => { plugins.restart(); },
                telemetry: () => ({ usage: noTrack("disableAnalytics"), crash: noTrack("disableCrashReports") })
            })),
            icon: PrivacyIcon
        });
        ctx.onDispose(removePrivacy);

        // Updates: look for a newer version on the project's GitHub releases and install it (the main process does the work, and only when a button is pressed).
        const removeUpdates = registry.register({
            key: "updater",
            title: "Updates",
            panelTitle: "Updates",
            Component: guarded("The Updates tab", makeUpdatesTab({
                current: PROJECT_VERSION,
                history: releasedNews(patchNotes, PROJECT_VERSION),
                lookupAuthor,
                check: () => engine.updates({ type: "check" }),
                install: () => engine.updates({ type: "install" }),
                restart: () => { plugins.restart(); }
            })),
            icon: UpdaterIcon
        });
        ctx.onDispose(removeUpdates);
    },

    stop() {
        context = undefined;
        nodeTypes = undefined;
    }
};

export default plugin;
