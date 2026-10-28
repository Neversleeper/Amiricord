/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// DeleteMe: deletes the account's OWN messages in the conversation that is open, slowly, after a scan, a typed confirmation and a button. The look comes from the
// plugin DeleteMe of TestCord (only its style file was available; the code is written for Amiricord). It is opened from the gear of its card in the Plugins tab.
// Deliberately NOT carried over: deleting across a whole server or all conversations (one conversation at a time is easier to check and to stop). NOT verified
// against a real Discord: the names of Discord's functions (found by their properties) and what its servers answer.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import { makeErrorBoundary } from "../../plugins/Settings/ErrorBoundary";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { createController, type DeleteController } from "./controller";
import { PAGE_SIZE, type PurgeDeps, type PurgeOptions, type RawMessage } from "./purge";
import { DELETEME_CSS } from "./styles";
import { renderWindow, type WindowParts } from "./view";

export const settings = definePluginSettings({
    delayMs: { type: "number", default: 1200, min: 500, max: 10_000, integer: true, description: "Wait between two deletions (ms). Lower is faster and more likely to be slowed down by Discord." },
    skipPinned: { type: "boolean", default: true, description: "Keep your pinned messages." }
});

type RestRequest = { url: string; query?: Record<string, unknown>; };
type RestMethod = (request: RestRequest) => Promise<{ body?: unknown; }>;
interface RestApi { get: RestMethod; del: RestMethod; }

let context: EnginePluginContext | undefined;
let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;
let styleName: { remove(): void; } | undefined;

/** Everything the engine needs to read and delete in the conversation that is open now, or why it cannot. */
export function targetOf(ctx: EnginePluginContext): { channelId: string; me: string; channelName: string; } | string {
    const channelId = ctx.common.SelectedChannelStore.get()?.getChannelId();
    if (!channelId) return "Open the conversation you want to clean first.";
    const me = ctx.common.UserStore.get()?.getCurrentUser()?.id;
    if (!me) return "Discord's user information is not ready yet. Try again in a moment.";
    const name = ctx.common.ChannelStore.get()?.getChannel(channelId)?.name;
    return { channelId, me, channelName: name ? `#${name}` : "this conversation" };
}

export function depsFor(RestAPI: RestApi, channelId: string, me: string): PurgeDeps {
    return {
        me,
        async list(before) {
            const query: Record<string, unknown> = { limit: PAGE_SIZE };
            if (before) query.before = before;
            const answer = await RestAPI.get({ url: `/channels/${channelId}/messages`, query });
            return Array.isArray(answer.body) ? answer.body as RawMessage[] : [];
        },
        async remove(id) {
            await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
        },
        sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); }),
        options: (): PurgeOptions => ({ delayMs: settings.store.delayMs, skipPinned: settings.store.skipPinned })
    };
}

function Window({ controller, parts, onClose }: { controller: DeleteController; parts: WindowParts; onClose(): void; }) {
    const react = currentReact();
    const state = react.useSyncExternalStore(controller.subscribe, controller.getState);
    return renderWindow(react.createElement as never, parts, state, {
        scan: () => { void controller.scan(); },
        start: () => { void controller.start(); },
        stop: () => { controller.stop(); },
        setConfirm: text => { controller.setConfirm(text); },
        close: onClose
    }) as never;
}

/** Opens the window for the conversation that is open now. */
export function openWindow(ctx: EnginePluginContext): string | undefined {
    const target = targetOf(ctx);
    if (typeof target === "string") {
        ctx.toasts.show(target, "failure");
        return undefined;
    }
    const RestAPI = ctx.finders.byProps<RestApi>("get", "post", "put", "del").get();
    if (!RestAPI) {
        ctx.toasts.show("Discord's request function was not found. Try again in a moment.", "failure");
        return undefined;
    }
    const parts: WindowParts = {
        Root: ctx.components.ModalRoot.get(),
        Header: ctx.components.ModalHeader.get(),
        Content: ctx.components.ModalContent.get(),
        CloseButton: ctx.components.ModalCloseButton.get()
    };
    const controller = createController(depsFor(RestAPI, target.channelId, target.me), target.channelName);
    // The deleting itself goes through `RestAPI.del`, the same call Discord's own "Delete message" makes.
    return ctx.modals.open(props => {
        Boundary ??= makeErrorBoundary(currentReact(), (label, error) => { ctx.reportError(label, error); });
        return currentReact().createElement(Boundary as never, { label: "DeleteMe" }, currentReact().createElement(Window as never, {
            controller, parts,
            onClose: () => { controller.dispose(); props.onClose(); }
        }));
    }, { onCloseCallback: () => { controller.dispose(); } });
}

/** What shows in the plugin's settings window: a note and the button that opens DeleteMe. */
function SettingsPart({ onClose }: { onClose(): void; }) {
    const react = currentReact();
    const h = react.createElement;
    return h("div", { className: "vc-deleteme-modal" },
        h("div", { className: "vc-deleteme-warning" }, h("strong", null, "Deletes your own messages in the conversation that is open."), h("span", null, "Open the conversation first, then press the button. Nothing is deleted before you scan and type DELETE.")),
        h("div", { className: "vc-deleteme-actions" }, h("button", {
            type: "button", className: "vc-deleteme-button vc-deleteme-button-danger",
            onClick: () => { if (context && openWindow(context) !== undefined) onClose(); }
        }, "Open DeleteMe"))) as never;
}

const plugin: PluginCode = {
    settings,
    settingsComponent: SettingsPart as never,
    start(ctx) {
        context = ctx;
        styleName = ctx.addStyle(DELETEME_CSS, "deleteme");
    },
    stop() {
        styleName?.remove();
        styleName = undefined;
        context?.modals.closeAll();
        context = undefined;
    }
};

export default plugin;
