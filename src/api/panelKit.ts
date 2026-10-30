/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of a tab a plugin adds to the settings (`ctx.settingsTabs`): cards, fields, lists and tiles drawn with Discord's own colour variables, so they follow the theme the
// person uses (a plain `<input>` or `<button>` is white in a dark Discord). Buttons are Discord's own when it was found (`ctx.components.Button`); the switch and the rest are
// ours. A plugin adds `PANEL_CSS` with `ctx.addStyle` once, removes it when it stops, and draws with `panelKit`.

/* eslint-disable @typescript-eslint/no-explicit-any -- React's createElement has no types here (as in ProfilePresets and TokenLogin) */

export const PANEL_CSS = `
.amiricord-panel { display: flex; flex-direction: column; gap: 16px; font-size: 14px; color: var(--text-default, var(--text-normal, #dbdee1)); }
.amiricord-panel-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 8px; border: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); background: var(--card-background-default, var(--background-secondary, #2b2d31)); }
.amiricord-panel-card-warn { border-color: var(--status-warning, #f0b232); }
.amiricord-panel-title { font-size: 16px; font-weight: 600; color: var(--header-primary, var(--text-strong, #f2f3f5)); }
.amiricord-panel-note { font-size: 13px; line-height: 1.4; color: var(--text-muted, #949ba4); }
.amiricord-panel-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.amiricord-panel-input, .amiricord-panel-area, .amiricord-panel-select { box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); border-radius: 4px; font-size: 14px; color: var(--text-default, var(--text-normal, #dbdee1)); background: var(--input-background-default, var(--input-background, #1e1f22)); outline: none; }
.amiricord-panel-input, .amiricord-panel-select { flex: 1 1 180px; min-width: 0; }
.amiricord-panel-input:focus, .amiricord-panel-area:focus, .amiricord-panel-select:focus { border-color: var(--brand-500, var(--brand-experiment, #5865f2)); }
.amiricord-panel-area { width: 100%; min-height: 160px; resize: vertical; font-family: var(--font-code, monospace); font-size: 12px; line-height: 1.45; }
.amiricord-panel-btn { padding: 8px 16px; border: 0; border-radius: 4px; font-size: 14px; cursor: pointer; color: #fff; background: var(--button-secondary-background, var(--interactive-background-default, #4e5058)); }
.amiricord-panel-btn:disabled { opacity: .5; cursor: default; }
.amiricord-panel-btn-primary { background: var(--brand-500, var(--brand-experiment, #5865f2)); }
.amiricord-panel-btn-danger { background: var(--status-danger, #da373c); }
.amiricord-panel-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); }
.amiricord-panel-item-body { flex: 1 1 auto; min-width: 0; }
.amiricord-panel-item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amiricord-panel-item-sub { font-size: 12px; color: var(--text-muted, #949ba4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amiricord-panel-avatar { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: var(--background-modifier-hover, rgba(255, 255, 255, .07)); }
.amiricord-panel-thumb { display: block; width: 100%; aspect-ratio: 16 / 9; border-radius: 6px; object-fit: cover; background: var(--background-modifier-hover, rgba(255, 255, 255, .07)); }
.amiricord-panel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.amiricord-panel-tile { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); background: var(--background-base-low, var(--background-tertiary, #232428)); }
.amiricord-panel-tile-text { font-size: 13px; line-height: 1.4; color: var(--text-muted, #949ba4); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.amiricord-panel-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.amiricord-panel-chip { padding: 1px 6px; border-radius: 4px; font-size: 11px; color: var(--text-muted, #949ba4); background: var(--background-modifier-hover, rgba(255, 255, 255, .07)); }
.amiricord-panel-switch { position: relative; flex: 0 0 auto; width: 40px; height: 24px; padding: 0; border: 0; border-radius: 12px; cursor: pointer; background: var(--border-muted, var(--primary-500, #80848e)); }
.amiricord-panel-switch-on { background: var(--status-positive, #248046); }
.amiricord-panel-switch-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .1s; }
.amiricord-panel-switch-on .amiricord-panel-switch-knob { left: 19px; }
`;

type Variant = "primary" | "secondary" | "danger";

export interface PanelParts {
    react: any;
    /** Discord's own button (as `ctx.components.Button.get()`), when it was found. */
    Button?: any;
}

export interface ButtonOptions { variant?: Variant; disabled?: boolean; key?: string; }

const join = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

/** The pieces of a settings tab, drawn with React from `parts`. */
export function panelKit(parts: PanelParts) {
    const h = parts.react.createElement;
    return {
        h,
        panel: (...children: unknown[]) => h("div", { className: "amiricord-panel" }, ...children),
        card: (children: unknown[], warn = false) => h("div", { className: join("amiricord-panel-card", warn && "amiricord-panel-card-warn") }, ...children),
        title: (text: string) => h("div", { className: "amiricord-panel-title" }, text),
        note: (text: string) => h("div", { className: "amiricord-panel-note" }, text),
        row: (...children: unknown[]) => h("div", { className: "amiricord-panel-row" }, ...children),
        chips: (items: readonly string[]) => items.length === 0 ? null : h("div", { className: "amiricord-panel-chips" }, items.map(item => h("span", { key: item, className: "amiricord-panel-chip" }, item))),
        /** A button; Discord's own when it was found (its label is plain text), ours when not. */
        button: (label: string, onClick: () => void, options: ButtonOptions = {}) => {
            const variant = options.variant ?? "secondary";
            if (parts.Button) return h(parts.Button, { key: options.key, onClick, disabled: options.disabled === true, variant }, label);
            return h("button", { key: options.key, type: "button", onClick, disabled: options.disabled === true, className: join("amiricord-panel-btn", variant === "primary" && "amiricord-panel-btn-primary", variant === "danger" && "amiricord-panel-btn-danger") }, label);
        },
        input: (props: { value: string; onChange(value: string): void; placeholder?: string; type?: string; maxLength?: number; }) => h("input", {
            className: "amiricord-panel-input", value: props.value, placeholder: props.placeholder, type: props.type ?? "text", maxLength: props.maxLength, autoComplete: "off", spellCheck: false,
            onChange: (event: any) => { props.onChange(event.target.value as string); }
        }),
        area: (props: { value: string; onChange(value: string): void; placeholder?: string; rows?: number; }) => h("textarea", {
            className: "amiricord-panel-area", value: props.value, placeholder: props.placeholder, spellCheck: false, rows: props.rows,
            onChange: (event: any) => { props.onChange(event.target.value as string); }
        }),
        select: (props: { value: string; options: ReadonlyArray<{ label: string; value: string; }>; onChange(value: string): void; }) => h("select", {
            className: "amiricord-panel-select", value: props.value, onChange: (event: any) => { props.onChange(event.target.value as string); }
        }, props.options.map(option => h("option", { key: option.value, value: option.value }, option.label))),
        switch: (props: { checked: boolean; onChange(checked: boolean): void; label: string; }) => h("button", {
            type: "button", role: "switch", "aria-checked": props.checked, "aria-label": props.label,
            className: join("amiricord-panel-switch", props.checked && "amiricord-panel-switch-on"), onClick: () => { props.onChange(!props.checked); }
        }, h("span", { className: "amiricord-panel-switch-knob" })),
        /** A round picture (an account's); a grey disc while there is none. */
        avatar: (url: string | undefined) => url === undefined ? h("span", { className: "amiricord-panel-avatar" }) : h("img", { className: "amiricord-panel-avatar", src: url, alt: "", draggable: false }),
        /** One line of a list: what is at the left (a switch, maybe), the name and a smaller line, and the buttons. */
        item: (key: string, lead: unknown, name: string, sub: string, actions: unknown[]) => h("div", { key, className: "amiricord-panel-item" },
            lead,
            h("div", { className: "amiricord-panel-item-body" }, h("div", { className: "amiricord-panel-item-name" }, name), sub === "" ? null : h("div", { className: "amiricord-panel-item-sub" }, sub)),
            ...actions)
    };
}
