/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the BdApi takes and gives whatever a BetterDiscord plugin uses */

// The `BdApi` object a BetterDiscord plugin sees. One is made for each plugin (`createBdApi`), so what the plugin adds through it (patches, styles, watchers,
// tooltips) is known and taken away when the plugin stops. The shape follows BetterDiscord's documented API: `BdApi.Patcher.before("Name", ...)` with the plugin's name
// first, or `new BdApi("Name")` for the same functions with the name already filled in. Written for Amiricord from BetterDiscord's documentation. What is NOT done, and says so once when a plugin asks: ContextMenu.patch / buildMenu
// (Discord's menu tree is not patched by this layer), Commands, Themes.

import type { ReactLike } from "../../api/common";
import { type BdData } from "./bdData";
import { type BdDom } from "./bdDom";
import { BdUtils } from "./bdUtils";
import { type BdWebpack } from "./bdWebpack";
import type { Patcher } from "./patcher";
import { buildSettingsPanel, type SettingsPanelOptions } from "./settingsBuilder";

export type ToastKind = "info" | "success" | "failure";

/** What the API needs from the rest of Amiricord. The plugin code gives the real ones; tests give fakes. */
export interface BdHost {
    patcher: Patcher;
    data: BdData;
    dom: BdDom;
    webpack: BdWebpack;
    page: { document: Document; fetch?: typeof fetch; };
    react(): ReactLike | undefined;
    reactDom(): any;
    toast(message: string, kind: ToastKind): void;
    /** Open a window drawn by `render`; returns its key. Undefined when the window cannot be opened (no React / components yet). */
    openModal(render: (props: { onClose(): void; }) => unknown): string | undefined;
    closeModal(key: string): void;
    log(level: "log" | "info" | "warn" | "error" | "debug", caller: string, ...args: unknown[]): void;
    plugins: {
        list(): Array<{ id: string; name: string; enabled: boolean; instance: unknown; }>;
        enable(name: string): void;
        disable(name: string): void;
        reload(name: string): void;
    };
}

const TOAST_KINDS: Record<string, ToastKind> = { info: "info", "": "info", success: "success", error: "failure", danger: "failure", warn: "info", warning: "info" };

export interface CreatedBdApi {
    /** The object handed to the plugin as `BdApi`. */
    BdApi: any;
    /** Take away everything the plugin added through the API. Safe to call twice. */
    dispose(): void;
}

export function createBdApi(host: BdHost, pluginName: string): CreatedBdApi {
    const callers = new Set<string>([pluginName]);
    const tooltips: Array<{ hide(): void; }> = [];
    const warned = new Set<string>();
    const notSupported = (what: string) => {
        if (warned.has(what)) return;
        warned.add(what);
        host.log("warn", pluginName, `${what} is not supported by Amiricord's BetterDiscord layer yet; the call did nothing`);
    };
    const use = (caller: unknown): string => {
        const name = typeof caller === "string" && caller ? caller : pluginName;
        callers.add(name);
        return name;
    };

    const Patcher = {
        before: (caller: string, target: unknown, key: string, cb: any, opts?: any) => host.patcher.before(use(caller), target, key, cb, opts),
        after: (caller: string, target: unknown, key: string, cb: any, opts?: any) => host.patcher.after(use(caller), target, key, cb, opts),
        instead: (caller: string, target: unknown, key: string, cb: any, opts?: any) => host.patcher.instead(use(caller), target, key, cb, opts),
        unpatchAll: (caller: string) => { host.patcher.unpatchAll(use(caller)); }
    };
    const Data = {
        save: (plugin: string, key: string, value: unknown) => { host.data.save(use(plugin), key, value); },
        load: (plugin: string, key: string) => host.data.load(use(plugin), key),
        delete: (plugin: string, key: string) => { host.data.delete(use(plugin), key); },
        recache: (plugin: string) => host.data.recache(use(plugin))
    };
    const DOM = {
        get screenWidth() { return host.dom.screenWidth; },
        get screenHeight() { return host.dom.screenHeight; },
        addStyle: (id: string, css: string) => { host.dom.addStyle(pluginName, id, css); },
        removeStyle: (id: string) => { host.dom.removeStyle(pluginName, id); },
        createElement: host.dom.createElement,
        parseHTML: host.dom.parseHTML,
        onAdded: (selector: string, cb: (element: Element) => void) => host.dom.onAdded(pluginName, selector, cb),
        onRemoved: (node: Node, cb: () => void) => host.dom.onRemoved(pluginName, node, cb),
        animate: (update: (progress: number) => void, duration: number, opts?: any) => host.dom.animate(pluginName, update, duration, opts),
        escapeHTML: host.dom.escapeHTML
    };
    const Logger = {
        log: (caller: string, ...args: unknown[]) => { host.log("log", String(caller), ...args); },
        info: (caller: string, ...args: unknown[]) => { host.log("info", String(caller), ...args); },
        warn: (caller: string, ...args: unknown[]) => { host.log("warn", String(caller), ...args); },
        error: (caller: string, ...args: unknown[]) => { host.log("error", String(caller), ...args); },
        debug: (caller: string, ...args: unknown[]) => { host.log("debug", String(caller), ...args); },
        stacktrace: (caller: string, message: string, error: any) => { host.log("error", String(caller), message, error); }
    };

    const element = (type: unknown, props?: unknown, ...children: unknown[]) => host.react()?.createElement(type, props, ...children);
    const text = (content: unknown): unknown => (typeof content === "string" || typeof content === "number" ? element("div", { style: { whiteSpace: "pre-wrap" } }, String(content)) : content);

    const UI = {
        showToast(message: string, options: { type?: string; } | number = {}) {
            const type = typeof options === "object" && options !== null ? String(options.type ?? "") : "";
            host.toast(String(message), TOAST_KINDS[type] ?? "info");
        },
        alert(title: string, body: unknown) {
            const key = host.openModal(({ onClose }) => element("div", { style: { padding: 16, display: "flex", flexDirection: "column", gap: 12 } },
                element("div", { style: { fontWeight: 700, fontSize: 18 } }, String(title)), text(body), element("button", { type: "button", onClick: onClose }, "Okay")));
            if (key === undefined) host.page.document.defaultView?.alert(`${title}\n\n${typeof body === "string" ? body : ""}`);
        },
        showConfirmationModal(title: string, content: unknown, options: { confirmText?: string; cancelText?: string; onConfirm?(): void; onCancel?(): void; danger?: boolean; } = {}): string | undefined {
            const { confirmText = "Okay", cancelText = "Cancel", onConfirm, onCancel } = options;
            const opened: { key?: string; } = {};
            const close = () => { if (opened.key !== undefined) host.closeModal(opened.key); };
            const key = opened.key = host.openModal(() => element("div", { style: { padding: 16, display: "flex", flexDirection: "column", gap: 12 } },
                element("div", { style: { fontWeight: 700, fontSize: 18 } }, String(title)), text(content),
                element("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                    element("button", { type: "button", onClick: () => { close(); onCancel?.(); } }, cancelText),
                    element("button", { type: "button", onClick: () => { close(); onConfirm?.(); } }, confirmText))));
            if (key === undefined) {
                const win = host.page.document.defaultView;
                if (win?.confirm(`${title}\n\n${typeof content === "string" ? content : ""}`)) onConfirm?.();
                else onCancel?.();
            }
            return key;
        },
        showNotice(content: unknown, options: { timeout?: number; } = {}) {
            // A toast is what this layer has; a plugin's notice with buttons is shown as its text.
            host.toast(typeof content === "string" ? content : "A plugin shows a notice", "info");
            void options;
            return () => undefined;
        },
        createTooltip(target: HTMLElement, label: string, options: { style?: Record<string, string>; } = {}) {
            const doc = host.page.document;
            const tip = doc.createElement("div");
            tip.textContent = String(label);
            tip.style.cssText = "position:fixed;z-index:100000;padding:6px 10px;border-radius:6px;font-size:13px;pointer-events:none;background:var(--background-floating,#111214);color:var(--text-normal,#dbdee1);box-shadow:0 4px 12px rgba(0,0,0,.4);";
            if (options.style) Object.assign(tip.style, options.style);
            let shown = false;
            const hide = () => { if (shown) { shown = false; tip.remove(); } };
            const show = () => {
                if (shown) return;
                shown = true;
                doc.body.appendChild(tip);
                const box = target.getBoundingClientRect();
                tip.style.left = `${box.left + box.width / 2 - tip.offsetWidth / 2}px`;
                tip.style.top = `${box.top - tip.offsetHeight - 8}px`;
            };
            target.addEventListener("mouseenter", show);
            target.addEventListener("mouseleave", hide);
            const handle = { show, hide, get label() { return tip.textContent ?? ""; }, set label(value: string) { tip.textContent = String(value); }, disconnect() { hide(); target.removeEventListener("mouseenter", show); target.removeEventListener("mouseleave", hide); } };
            tooltips.push(handle);
            return handle;
        },
        buildSettingsPanel: (options: SettingsPanelOptions) => buildSettingsPanel(host.page.document, options),
        openModal: (render: (props: { onClose(): void; }) => unknown) => host.openModal(render),
        closeModal: (key: string) => { host.closeModal(key); }
    };

    const ReactUtils = {
        getInternalInstance(node: any) {
            if (!node) return null;
            const key = Object.keys(node).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
            return key ? node[key] : null;
        },
        getOwnerInstance(node: any, options: { include?: string[]; exclude?: string[]; filter?: (instance: any) => boolean; } = {}) {
            let fiber = ReactUtils.getInternalInstance(node);
            const { include, exclude = ["Popout", "Tooltip", "Scroller", "BackgroundFlash"], filter = () => true } = options;
            while (fiber) {
                const instance = fiber.stateNode;
                if (instance && !(instance instanceof (host.page.document.defaultView as any)?.HTMLElement) && typeof instance === "object") {
                    const name = fiber.type?.displayName ?? fiber.type?.name ?? "";
                    const allowed = include ? include.includes(name) : !exclude.includes(name);
                    if (allowed && filter(instance)) return instance;
                }
                fiber = fiber.return;
            }
            return null;
        },
        wrapElement(target: any) {
            const react = host.react();
            if (!react) return target;
            return react.createElement("div", { ref: (div: HTMLElement | null) => { if (div && target instanceof (host.page.document.defaultView as any).Node) div.append(target); } });
        }
    };

    const stateFromStores = (): ((stores: unknown[], selector: () => unknown, deps?: unknown, compare?: unknown) => unknown) | undefined =>
        host.webpack.getByStrings("useStateFromStores") ?? host.webpack.getModule((m: any) => typeof m === "function" && /useStateFromStores/.test(String(m)), { searchExports: true });
    const Hooks = {
        useStateFromStores(stores: unknown, selector: () => unknown, deps?: unknown, compare?: unknown) {
            const hook = stateFromStores();
            const list = Array.isArray(stores) ? stores : [stores];
            return hook ? hook(list, selector, deps, compare) : selector();
        },
        useForceUpdate() {
            const react = host.react();
            const [, update] = ((react as unknown as { useReducer?(reducer: (n: number) => number, initial: number): [number, () => void]; } | undefined)?.useReducer?.((n: number) => n + 1, 0)) ?? [0, () => undefined];
            return update;
        }
    };

    const Components = {
        get Button() { return (props: any) => element("button", { type: "button", ...props }, props?.children); },
        get Switch() { return (props: any) => element("input", { type: "checkbox", checked: !!props?.value, onChange: (e: any) => props?.onChange?.(e.target.checked) }); },
        get Text() { return (props: any) => element("span", props, props?.children); },
        get Tooltip() { return (props: any) => element("span", { title: typeof props?.text === "string" ? props.text : undefined }, typeof props?.children === "function" ? props.children({}) : props?.children); },
        get ErrorBoundary() { return (props: any) => props?.children ?? null; }
    };

    const ContextMenu = {
        patch: (_navId: string, _callback: unknown) => { notSupported("ContextMenu.patch"); return () => undefined; },
        unpatch: (_navId: string, _callback: unknown) => { /* nothing was patched */ },
        buildMenu: () => { notSupported("ContextMenu.buildMenu"); return undefined; },
        open: () => { notSupported("ContextMenu.open"); },
        close: () => { /* nothing opened */ }
    };
    const Commands = { register: () => { notSupported("Commands.register"); return () => undefined; }, unregister: () => undefined, unregisterAll: () => undefined };
    const Themes = { getAll: () => [], get: () => undefined, isEnabled: () => false, enable: () => { notSupported("Themes"); }, disable: () => undefined, toggle: () => undefined, reload: () => undefined, folder: "" };
    const Plugins = {
        folder: "",
        getAll: () => host.plugins.list().map(p => p.instance),
        get: (name: string) => host.plugins.list().find(p => p.name === name || p.id === name)?.instance,
        isEnabled: (name: string) => host.plugins.list().some(p => (p.name === name || p.id === name) && p.enabled),
        enable: (name: string) => { host.plugins.enable(name); },
        disable: (name: string) => { host.plugins.disable(name); },
        toggle(name: string) { if (Plugins.isEnabled(name)) host.plugins.disable(name); else host.plugins.enable(name); },
        reload: (name: string) => { host.plugins.reload(name); }
    };
    const Net = { fetch: (url: string, options?: any) => (host.page.fetch ?? fetch)(url, options) };

    const statics: Record<string, any> = {
        Patcher, Data, DOM, Logger, UI, Utils: BdUtils, ReactUtils, Hooks, Components, ContextMenu, Commands, Themes, Plugins, Net,
        Webpack: host.webpack,
        get React() { return host.react(); },
        get ReactDOM() { return host.reactDom(); },
        get Flux() { return host.webpack.getByKeys("Store", "Dispatcher") ?? host.webpack.getByKeys("subscribe", "dispatch"); },
        version: "1.12.0",
        // Old names that many plugins still call.
        injectCSS: (id: string, css: string) => { DOM.addStyle(id, css); },
        clearCSS: (id: string) => { DOM.removeStyle(id); },
        loadData: Data.load,
        saveData: Data.save,
        deleteData: Data.delete,
        getData: Data.load,
        setData: Data.save,
        showToast: UI.showToast,
        alert: UI.alert,
        showConfirmationModal: UI.showConfirmationModal,
        findModule: host.webpack.findModule,
        findModuleByProps: host.webpack.findModuleByProps,
        findModuleByDisplayName: host.webpack.findModuleByDisplayName,
        getInternalInstance: ReactUtils.getInternalInstance,
        suppressErrors: <T extends (...args: any[]) => any>(fn: T, label = "") => (...args: Parameters<T>) => {
            try { return fn(...args); } catch (error) { host.log("error", pluginName, label, error); return undefined; }
        }
    };

    /** `new BdApi("Name")`: the same functions with the plugin's name already filled in. */
    class BdApi {
        readonly Patcher: any;
        readonly Data: any;
        readonly Logger: any;
        readonly DOM = DOM;
        readonly UI = UI;
        readonly Utils = BdUtils;
        readonly Webpack = host.webpack;
        readonly ReactUtils = ReactUtils;
        readonly Hooks = Hooks;
        readonly Components = Components;
        readonly ContextMenu = ContextMenu;
        readonly Commands = Commands;
        readonly Plugins = Plugins;
        readonly Themes = Themes;
        readonly Net = Net;
        constructor(name?: string) {
            const owner = use(name);
            this.Patcher = {
                before: (target: unknown, key: string, cb: any, opts?: any) => Patcher.before(owner, target, key, cb, opts),
                after: (target: unknown, key: string, cb: any, opts?: any) => Patcher.after(owner, target, key, cb, opts),
                instead: (target: unknown, key: string, cb: any, opts?: any) => Patcher.instead(owner, target, key, cb, opts),
                unpatchAll: () => { Patcher.unpatchAll(owner); }
            };
            this.Data = {
                save: (key: string, value: unknown) => { Data.save(owner, key, value); },
                load: (key: string) => Data.load(owner, key),
                delete: (key: string) => { Data.delete(owner, key); },
                recache: () => Data.recache(owner)
            };
            this.Logger = Object.fromEntries(["log", "info", "warn", "error", "debug"].map(level => [level, (...args: unknown[]) => { host.log(level as "log", owner, ...args); }]));
            this.Logger.stacktrace = (message: string, error: unknown) => { host.log("error", owner, message, error); };
        }
        get React() { return host.react(); }
        get ReactDOM() { return host.reactDom(); }
        get version() { return statics.version as string; }
    }
    for (const key of Object.keys(statics)) {
        const descriptor = Object.getOwnPropertyDescriptor(statics, key)!;
        Object.defineProperty(BdApi, key, { ...descriptor, configurable: true, enumerable: true });
    }

    return {
        BdApi,
        dispose() {
            for (const name of callers) host.patcher.unpatchAll(name);
            host.dom.cleanup(pluginName);
            for (const tip of tooltips.splice(0)) tip.hide();
        }
    };
}
