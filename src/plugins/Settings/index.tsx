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
import type { PluginCard } from "../../api/pluginCards";
import { definePluginSettings } from "../../api/pluginSettings";
import { settingsTabs } from "../../api/settingsTabs";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { OWNER_ONLY_PLUGINS, OWNERS, PROJECT_VERSION } from "../../shared/project";
import { releasedNews } from "../../shared/updates";
import { type AuthorInfo, authorInfo, type RawDiscordUser } from "./authorModel";
import { EntryRegistry } from "./entries";
import { makeErrorBoundary } from "./ErrorBoundary";
import { makeSidebarIcon, PluginsIcon, PrivacyIcon, UpdaterIcon } from "./icon";
import { buildLayoutWithSection, FALLBACK_TYPES, readTypes, type SettingsEntry, TYPE_NAMES } from "./layout";
import { defaultButtonGroups, defaultChoices, defaultQuickActions, defaultSettings } from "./mainItems";
import { makeMainTab } from "./MainTab";
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
    tabLayout: { type: "string", default: "", maxLength: LAYOUT_MAX_CHARS, description: "Which tabs of the Amiricord section are hidden, their order and the pinned ones (saved by Editor Mode)." }
});
let context: EnginePluginContext | undefined;
let nodeTypes: { get(): unknown; } | undefined;
let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;

/** The error boundary class, made the first time something is drawn, when React certainly exists. */
function boundary() {
    Boundary ??= makeErrorBoundary(currentReact(), (what, error) => { context?.reportError(what, error); });
    return Boundary;
}

/** The tabs of the section: Amiricord's own, in the sidebar order, then the ones plugins added (each drawn inside the error boundary, with a plain icon when it brought none). */
function allTabs(): SettingsEntry[] {
    const fromPlugins = settingsTabs.list().map(({ key, title, panelTitle, Component, icon }): SettingsEntry => ({
        key, title, panelTitle, icon: icon ?? PluginsIcon, Component: guarded(`The tab of ${title}`, Component as () => unknown)
    }));
    return [...registry.list(), ...fromPlugins];
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
            entries: () => (context ? visibleTabs(allTabs(), parseLayout(settings.store.tabLayout)) : []),
            onError: error => { context?.reportError("settings layout", error); }
        });
    },

    start(ctx) {
        if (!ctx.engine || !ctx.plugins) throw new Error("the Settings plugin needs the engine and plugin cards of a core plugin");
        const { engine, plugins } = ctx;
        context = ctx;
        nodeTypes = ctx.finders.byProps(...TYPE_NAMES);
        ctx.addStyle(SETTINGS_CSS, SETTINGS_STYLE_NAME);

        const removeMain = registry.register({
            key: "amiricord",
            title: "Amiricord",
            panelTitle: "Amiricord Settings",
            Component: guarded("The Amiricord tab", makeMainTab({
                leaveSafeMode: () => { engine.leaveSafeMode(); plugins.restart(); },
                status: () => engine.status(),
                cards: () => plugins.cards(),
                quickActions: defaultQuickActions({ openDataFolder: () => { engine.openDataFolder(); }, restart: () => { plugins.restart(); } }),
                settings: defaultSettings(),
                choices: defaultChoices(),
                buttonGroups: defaultButtonGroups(),
                logo,
                banner,
                editor: guarded("The tab editor", makeTabsEditor({
                    title: "Amiricord",
                    tabs: () => allTabs().map(({ key, title, icon }) => ({ key, title, icon })),
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
