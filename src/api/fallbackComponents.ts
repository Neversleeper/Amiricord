/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Our own small components, used only when Discord's could not be found. Plain elements with class names that start
// with `amiricord-`; their look comes from `fallbackStyles.ts`, which borrows Discord's colors. They are deliberately
// simple: they exist so a settings screen keeps working, not to compete with Discord's own.

import type { ReactLike } from "./common";

export interface ButtonProps {
    onClick?(): void;
    disabled?: boolean;
    /** `"primary"` is the highlighted one. */
    variant?: "primary" | "secondary" | "danger";
    children?: unknown;
}

export interface SwitchProps {
    checked: boolean;
    onChange(checked: boolean): void;
    disabled?: boolean;
    /** Read out by screen readers. */
    label?: string;
}

export interface TextInputProps {
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    disabled?: boolean;
}

export interface SelectProps {
    value: string | number;
    options: ReadonlyArray<{ label: string; value: string | number; }>;
    onChange(value: string | number): void;
    disabled?: boolean;
}

export interface CardProps { children?: unknown; }

export type BadgeTone = "neutral" | "good" | "warning" | "danger";

export interface BadgeProps {
    tone?: BadgeTone;
    children?: unknown;
}

export interface HeadingProps {
    /** 1 to 3. */
    level?: 1 | 2 | 3;
    children?: unknown;
}

export interface TextProps {
    muted?: boolean;
    children?: unknown;
}

export type ModalSize = "small" | "medium" | "large" | "dynamic";

export interface ModalRootProps {
    size?: ModalSize;
    /** Called when the person presses Escape, clicks outside the window or clicks the close button. */
    onClose?(): void;
    /** What screen readers call the window. */
    label?: string;
    /** Extra class names, inline style and text direction of the window itself (a plugin may colour or size its own window). */
    className?: string;
    style?: unknown;
    dir?: string;
    children?: unknown;
}

/**
 * Discord's own Dialog: draws a `div` that is a modal dialog with Discord's focus lock around its children. It takes a `ref` (the element is handed to it) and the
 * usual div props (class, label, style, text direction). Read from Discord's code (docs/analysis-51-modal-focus-lock.md). Our window sits inside it when it was found.
 */
export type DialogBox = (props: { ref: { current: unknown; }; className?: string; style?: unknown; dir?: string; "aria-label"?: string; children?: unknown; }) => unknown;

export interface ModalPartProps {
    /** Extra class names, so a plugin's own styles can size or colour the part. */
    className?: string;
    children?: unknown;
}

export interface ModalCloseButtonProps { onClick?(): void; }

/** The little of the page's `document` the modal needs, so it can be looked at without a page. */
export interface ModalDocument {
    addEventListener(type: "keydown", listener: (event: { key: string; }) => void): void;
    removeEventListener(type: "keydown", listener: (event: { key: string; }) => void): void;
    activeElement?: unknown;
}

interface FocusableElement { focus(): void; contains(other: unknown): boolean; }

const MODAL_SIZES: Record<ModalSize, string> = { small: "small", medium: "medium", large: "large", dynamic: "dynamic" };

const TONES: Record<BadgeTone, string> = { neutral: "neutral", good: "good", warning: "warning", danger: "danger" };

/** Build the fallback components for a React. Pure: it only calls `createElement`. */
export function makeFallbackComponents(react: ReactLike, getDocument: () => ModalDocument | undefined = () => (globalThis as { document?: ModalDocument; }).document, dialogBox?: DialogBox) {
    const h = react.createElement.bind(react);
    /** Put the focus on the window when it appears, unless it is already somewhere inside it. A function that never changes, so a redraw does not take the focus back. */
    const focusWindow = (element: FocusableElement | null) => {
        if (element && !element.contains(getDocument()?.activeElement)) element.focus();
    };

    return {
        Button: ({ onClick, disabled, variant = "secondary", children }: ButtonProps) =>
            h("button", { type: "button", className: `amiricord-button amiricord-button-${variant}`, disabled: !!disabled, onClick: () => { if (!disabled) onClick?.(); } }, children),

        Switch: ({ checked, onChange, disabled, label }: SwitchProps) =>
            h("button", {
                type: "button", role: "switch", "aria-checked": checked, "aria-label": label, disabled: !!disabled,
                className: `amiricord-switch${checked ? " amiricord-switch-on" : ""}`,
                onClick: () => { if (!disabled) onChange(!checked); }
            }, h("span", { className: "amiricord-switch-knob" })),

        TextInput: ({ value, onChange, placeholder, disabled }: TextInputProps) =>
            h("input", {
                type: "text", className: "amiricord-input", value, placeholder, disabled: !!disabled,
                onChange: (event: { target: { value: string; }; }) => { onChange(event.target.value); }
            }),

        Select: ({ value, options, onChange, disabled }: SelectProps) =>
            h("select", {
                className: "amiricord-select", value, disabled: !!disabled,
                onChange: (event: { target: { value: string; }; }) => {
                    // The browser gives the choice back as text; the option's own value (text or number) is what the caller gets.
                    const chosen = options.find(option => String(option.value) === event.target.value);
                    if (chosen) onChange(chosen.value);
                }
            }, ...options.map(option => h("option", { key: String(option.value), value: option.value }, option.label))),

        Card: ({ children }: CardProps) => h("div", { className: "amiricord-card" }, children),

        Badge: ({ tone = "neutral", children }: BadgeProps) =>
            h("span", { className: `amiricord-badge amiricord-badge-${TONES[tone] ?? "neutral"}` }, children),

        Heading: ({ level = 2, children }: HeadingProps) => h(`h${level}`, { className: `amiricord-heading amiricord-heading-${level}` }, children),

        Text: ({ muted, children }: TextProps) => h("div", { className: `amiricord-text${muted ? " amiricord-text-muted" : ""}` }, children),

        Divider: () => h("hr", { className: "amiricord-divider" }),

        /** A window with its own dark backdrop. Escape and a click outside it call `onClose`. Used when Discord's own window pieces were not found. */
        ModalRoot: ({ size = "medium", onClose, label, className, style, dir, children }: ModalRootProps) => {
            // With Discord's dialog box the lock needs a ref object, so the focus is taken from an effect instead of a callback ref.
            const box = dialogBox ? react.useState(() => ({ current: null as FocusableElement | null }))[0] : undefined;
            react.useEffect(() => {
                const page = getDocument();
                if (!page || !onClose) return undefined;
                const onKey = (event: { key: string; }) => { if (event.key === "Escape") onClose(); };
                page.addEventListener("keydown", onKey);
                return () => { page.removeEventListener("keydown", onKey); };
            }, [onClose]);
            if (dialogBox && box) {
                react.useEffect(() => {
                    focusWindow(box.current);
                    return undefined;
                }, []);
            }
            const windowClass = `amiricord-modal amiricord-modal-${MODAL_SIZES[size] ?? "medium"}${className ? ` ${className}` : ""}`;
            return h("div", {
                className: "amiricord-modal-backdrop",
                onMouseDown: (event: { target: unknown; currentTarget: unknown; }) => { if (event.target === event.currentTarget) onClose?.(); }
            }, dialogBox && box
                ? h(dialogBox, { ref: box, className: windowClass, style, dir, "aria-label": label }, children)
                : h("div", { className: windowClass, role: "dialog", "aria-modal": true, "aria-label": label, tabIndex: -1, ref: focusWindow, style, dir }, children));
        },

        ModalHeader: ({ className, children }: ModalPartProps) => h("div", { className: `amiricord-modal-header${className ? ` ${className}` : ""}` }, children),

        ModalContent: ({ className, children }: ModalPartProps) => h("div", { className: `amiricord-modal-content${className ? ` ${className}` : ""}` }, children),

        ModalFooter: ({ className, children }: ModalPartProps) => h("div", { className: `amiricord-modal-footer${className ? ` ${className}` : ""}` }, children),

        ModalCloseButton: ({ onClick }: ModalCloseButtonProps) =>
            h("button", { type: "button", className: "amiricord-modal-close", "aria-label": "Close", onClick: () => { onClick?.(); } }, "×")
    };
}

export type FallbackComponents = ReturnType<typeof makeFallbackComponents>;
