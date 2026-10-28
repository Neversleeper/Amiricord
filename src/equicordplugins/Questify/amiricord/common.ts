/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the Discord pieces this layer wraps have no types */

import type { ComponentType, ReactNode } from "react";

import { currentReact } from "../../../api/jsxRuntime";
import type { ModalRenderProps } from "../../../api/modals";
import { getContext, hasContext } from "./context";
import type { FluxStore, ModalOptions, ModalProps, User } from "./discordTypes";
import { lazyOf } from "./lazy";
import { findByPropsLazy, findStoreLazy } from "./webpack";

const react = () => currentReact() as any;

export const React: any = lazyOf(() => currentReact(), "React");
export const useState = ((...args: unknown[]) => react().useState(...args)) as typeof import("react").useState;
export const useEffect = ((...args: unknown[]) => react().useEffect(...args)) as typeof import("react").useEffect;
export const useMemo = ((...args: unknown[]) => react().useMemo(...args)) as typeof import("react").useMemo;
export const useRef = ((...args: unknown[]) => react().useRef(...args)) as typeof import("react").useRef;

export function useStateFromStores<T>(stores: readonly FluxStore[], mapper: () => T, deps?: readonly unknown[], isEqual: (a: T, b: T) => boolean = Object.is): T {
    const [, redraw] = react().useState(0) as [number, (update: (n: number) => number) => void];
    const last = react().useRef(undefined) as { current: { value: T; } | undefined; };
    const next = mapper();
    if (!last.current || !isEqual(last.current.value, next)) last.current = { value: next };
    react().useEffect(() => {
        const onChange = () => redraw(n => n + 1);
        stores.forEach(store => store.addChangeListener(onChange));
        return () => stores.forEach(store => store.removeChangeListener(onChange));
    }, [...stores, ...(deps ?? [])]);
    return last.current.value;
}

export interface FluxDispatcherLike {
    dispatch(event: { type: string; [key: string]: any; }): void;
    subscribe(type: string, callback: (event: any) => void): void;
    unsubscribe(type: string, callback: (event: any) => void): void;
    wait(callback: () => void): void;
}

export interface UserStoreLike {
    getCurrentUser(): User | undefined;
    getUser(id: string): User | undefined;
}

export const FluxDispatcher = lazyOf<FluxDispatcherLike>(() => getContext().common.FluxDispatcher.get() as FluxDispatcherLike | undefined, "FluxDispatcher");
export const UserStore = lazyOf<UserStoreLike>(() => getContext().common.UserStore.get() as UserStoreLike | undefined, "UserStore");
export const AuthorizedAppsStore: FluxStore & { getNewestTokenForApplication(applicationId: string): { id: string; } | undefined; } = findStoreLazy("AuthorizedAppsStore");

interface RestRequest {
    url: string;
    body?: unknown;
    query?: unknown;
    retries?: number;
    oldFormErrors?: boolean;
    [key: string]: unknown;
}

export interface RestResponse {
    body: any;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    text: string;
}

type RestMethod = (request: RestRequest) => Promise<RestResponse>;

export const RestAPI: { get: RestMethod; post: RestMethod; put: RestMethod; patch: RestMethod; del: RestMethod; } = findByPropsLazy("getAPIBaseURL", "get", "post", "put", "del");

let transitionToFunction: ReturnType<ReturnType<typeof getContext>["finders"]["byCode"]> | undefined;

export const NavigationRouter = {
    transitionTo(path: string, ...rest: unknown[]): void {
        transitionToFunction ??= getContext().finders.byCode("transitionTo -");
        const transition = transitionToFunction.require() as (path: string, ...rest: unknown[]) => void;
        transition(path, ...rest);
    }
};

export interface ColorPickerProps {
    color?: number | null;
    onChange?(color: number): void;
    showEyeDropper?: boolean;
    [key: string]: any;
}

const toHex = (color: number | null | undefined): string => "#" + (Math.max(0, Math.min(0xffffff, Math.round(color ?? 0)))).toString(16).padStart(6, "0");

export const ColorPicker: ComponentType<ColorPickerProps> = function QuestifyColorPicker(props: ColorPickerProps) {
    const h = react().createElement;
    return h("input", {
        type: "color",
        value: toHex(props.color),
        disabled: props.disabled,
        style: { width: "100%", height: 32, padding: 0, border: "none", borderRadius: 4, background: "transparent", cursor: props.disabled ? "default" : "pointer" },
        onChange: (event: { target: { value: string; }; }) => props.onChange?.(parseInt(event.target.value.slice(1), 16)),
        onBlur: () => props.onClose?.()
    });
};

export const TextInput: ComponentType<any> = function QuestifyTextInput(props: any) {
    const h = react().createElement;
    return h("input", {
        type: props.type ?? "text",
        className: props.className,
        placeholder: props.placeholder,
        "aria-label": props["aria-label"],
        value: props.value ?? "",
        disabled: props.disabled,
        style: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "3px", border: "1px solid var(--border-subtle, #3f4147)", background: "var(--input-background, var(--background-secondary, #1e1f22))", color: "var(--text-default, var(--text-normal, #dbdee1))" },
        onChange: (event: { target: { value: string; }; }) => { props.onChange?.(event.target.value); }
    });
};

export const Slider: ComponentType<any> = function QuestifySlider(props: any) {
    const h = react().createElement;
    const [value, setValue] = react().useState(props.initialValue ?? props.minValue ?? 0) as [number, (value: number) => void];
    return h("input", {
        type: "range",
        className: props.className,
        min: props.minValue ?? 0,
        max: props.maxValue ?? 100,
        value,
        disabled: props.disabled,
        style: { width: "100%" },
        onChange: (event: { target: { value: string; }; }) => {
            const next = Number(event.target.value);
            setValue(next);
            props.onValueChange?.(next);
        }
    });
};

interface ModalAction {
    text: string;
    variant?: string;
    disabled?: boolean;
    onClick?(): void;
}

interface QuestifyModalProps extends ModalProps {
    title?: string;
    size?: "sm" | "md" | "lg" | string;
    dismissable?: boolean;
    actions?: ModalAction[];
    children?: ReactNode;
}

const MODAL_SIZES: Record<string, "small" | "medium" | "large"> = { sm: "small", md: "medium", lg: "large" };

export function Modal(props: QuestifyModalProps): ReactNode {
    const { ModalRoot, ModalHeader, ModalContent, ModalFooter, Button } = getContext().components;
    const Root = ModalRoot.get(), Header = ModalHeader.get(), Content = ModalContent.get(), Footer = ModalFooter.get(), Action = Button.get();
    if (!Root || !Header || !Content || !Footer || !Action) return null;
    const h = react().createElement;
    const actions = props.actions ?? [];
    return h(Root, { size: MODAL_SIZES[props.size ?? "md"] ?? "medium", onClose: props.dismissable === false ? undefined : props.onClose, label: props.title },
        props.title ? h(Header, null, props.title) : null,
        h(Content, null, props.children),
        actions.length ? h(Footer, null, ...actions.map((action, index) => h(Action, {
            key: index,
            onClick: action.onClick,
            disabled: action.disabled,
            variant: action.variant === "primary" ? "primary" : action.variant?.startsWith("critical") ? "danger" : "secondary"
        }, action.text))) : null);
}

export function openModal(render: (props: ModalRenderProps) => ReactNode, options?: ModalOptions): string | undefined {
    return getContext().modals.open(render as (props: ModalRenderProps) => unknown, options);
}

const marker = () => () => null;
const MenuMarker = {
    Menu: marker(),
    MenuGroup: marker(),
    MenuItem: marker(),
    MenuSeparator: marker(),
    MenuCheckboxItem: marker(),
    MenuControlItem: marker(),
    MenuRadioItem: marker()
} as const;
export const Menu: Record<string, ComponentType<any>> = MenuMarker as unknown as Record<string, ComponentType<any>>;
const menuMarkers = new Set<unknown>(Object.values(MenuMarker));

interface MenuEntry { kind: "item" | "separator"; label?: string; action?: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; }

function collectMenuEntries(node: unknown, out: MenuEntry[]): void {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) { node.forEach(child => collectMenuEntries(child, out)); return; }
    const element = node as { type?: unknown; props?: Record<string, any>; };
    if (typeof element !== "object" || !element.props) return;
    const props = element.props;
    if (element.type === MenuMarker.MenuSeparator) {
        out.push({ kind: "separator" });
    } else if (element.type === MenuMarker.MenuItem || element.type === MenuMarker.MenuCheckboxItem || element.type === MenuMarker.MenuRadioItem) {
        out.push({
            kind: "item",
            label: typeof props.label === "string" ? props.label : String(props.label ?? ""),
            action: typeof props.action === "function" ? props.action : undefined,
            disabled: !!props.disabled,
            danger: props.color === "danger",
            checked: props.checked === true
        });
    } else if (element.type === MenuMarker.MenuGroup) {
        const before = out.length;
        collectMenuEntries(props.children, out);
        if (out.length > before) out.push({ kind: "separator" });
    } else if (typeof element.type === "function" && !menuMarkers.has(element.type)) {
        // A component of the plugin's own (for example the quest button's menu): run it and read what it returns.
        try {
            collectMenuEntries((element.type as (menuProps: Record<string, unknown>) => unknown)(props), out);
        } catch {
            // A component that needs hooks cannot be read outside a render.
        }
    } else {
        collectMenuEntries(props.children, out);
    }
}

let closeOpenMenu: (() => void) | null = null;

export const ContextMenuApi = {
    openContextMenu(event: unknown, render: () => ReactNode): void {
        const page = (globalThis as { document?: Document; }).document;
        if (!page?.body) return;
        ContextMenuApi.closeContextMenu();
        const entries: MenuEntry[] = [];
        collectMenuEntries(render(), entries);
        while (entries.length && entries[entries.length - 1].kind === "separator") entries.pop();
        if (!entries.length) return;

        const mouse = event as { clientX?: number; clientY?: number; preventDefault?: () => void; stopPropagation?: () => void; } | null;
        mouse?.preventDefault?.();
        mouse?.stopPropagation?.();

        const engineMenu = hasContext() ? getContext().contextMenu : undefined;
        if (engineMenu && typeof engineMenu.open === "function") {
            const items = entries.map((entry, index) => entry.kind === "separator"
                ? { separator: true as const }
                : {
                    id: `questify-menu-${index}`,
                    label: entry.label ?? "",
                    action: entry.action ?? (() => undefined),
                    disabled: entry.disabled,
                    danger: entry.danger,
                    ...(entry.checked ? { checked: true } : {})
                });
            if (engineMenu.open({ clientX: mouse?.clientX ?? 0, clientY: mouse?.clientY ?? 0, preventDefault: () => undefined }, items)) return;
        }

        const menu = page.createElement("div");
        menu.setAttribute("role", "menu");
        Object.assign(menu.style, {
            position: "fixed", zIndex: "2147483000", minWidth: "188px", padding: "6px 8px", borderRadius: "8px",
            background: "var(--background-base-lowest, #111214)", border: "1px solid var(--border-subtle, rgba(255,255,255,.08))",
            boxShadow: "0 8px 16px rgba(0,0,0,.4)", fontFamily: "var(--font-primary, sans-serif)", fontSize: "14px", color: "var(--text-default, #dbdee1)"
        });
        for (const entry of entries) {
            if (entry.kind === "separator") {
                const line = page.createElement("div");
                Object.assign(line.style, { height: "1px", margin: "4px 0", background: "var(--border-subtle, rgba(255,255,255,.08))" });
                menu.appendChild(line);
                continue;
            }
            const row = page.createElement("div");
            row.setAttribute("role", "menuitem");
            row.textContent = (entry.checked ? "\u2713 " : "") + (entry.label ?? "");
            Object.assign(row.style, {
                padding: "6px 8px", borderRadius: "4px", lineHeight: "20px", cursor: entry.disabled ? "not-allowed" : "pointer",
                opacity: entry.disabled ? "0.5" : "1", color: entry.danger ? "#f23f42" : "inherit", userSelect: "none"
            });
            if (!entry.disabled) {
                row.addEventListener("mouseenter", () => { row.style.background = "var(--background-mod-subtle, rgba(255,255,255,.08))"; });
                row.addEventListener("mouseleave", () => { row.style.background = ""; });
                row.addEventListener("click", clickEvent => {
                    clickEvent.stopPropagation();
                    ContextMenuApi.closeContextMenu();
                    try { entry.action?.(); } catch (error) { console.error("[Questify] context menu action failed", error); }
                });
            }
            menu.appendChild(row);
        }
        page.body.appendChild(menu);

        const view = page.defaultView ?? (globalThis as unknown as Window);
        const rect = menu.getBoundingClientRect();
        const left = Math.max(4, Math.min(mouse?.clientX ?? 0, view.innerWidth - rect.width - 4));
        const top = Math.max(4, Math.min(mouse?.clientY ?? 0, view.innerHeight - rect.height - 4));
        menu.style.left = left + "px";
        menu.style.top = top + "px";

        const onOutside = (outsideEvent: Event) => { if (!menu.contains(outsideEvent.target as Node)) ContextMenuApi.closeContextMenu(); };
        const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); ContextMenuApi.closeContextMenu(); } };
        const timer = setTimeout(() => {
            page.addEventListener("mousedown", onOutside, true);
            page.addEventListener("contextmenu", onOutside, true);
            page.addEventListener("keydown", onKey, true);
        }, 0);
        closeOpenMenu = () => {
            clearTimeout(timer);
            page.removeEventListener("mousedown", onOutside, true);
            page.removeEventListener("contextmenu", onOutside, true);
            page.removeEventListener("keydown", onKey, true);
            menu.remove();
            closeOpenMenu = null;
        };
    },
    closeContextMenu(): void {
        if (hasContext()) getContext().contextMenu?.close?.();
        closeOpenMenu?.();
    }
};

export function showToast(data: { text: string; variant?: string; }): void {
    const page = (globalThis as { document?: Document; }).document;
    if (!page?.body) return;
    const toast = page.createElement("div");
    toast.textContent = data.text;
    toast.setAttribute("role", "status");
    Object.assign(toast.style, {
        position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", zIndex: "99999", maxWidth: "80vw",
        padding: "10px 16px", borderRadius: "8px", font: "500 14px sans-serif", color: "#fff",
        background: data.variant === "critical" ? "#da373c" : "#2b2d31", boxShadow: "0 4px 12px rgba(0,0,0,.4)"
    });
    page.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
