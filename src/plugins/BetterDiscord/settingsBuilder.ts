/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings description comes from a BetterDiscord plugin */

// BdApi.UI.buildSettingsPanel: turns the list of settings a BetterDiscord plugin describes (`{ type: "switch", id, name, note, value }`...) into plain DOM, which is
// what `getSettingsPanel` may return. Types: switch, text, number, dropdown, radio, slider, color and category. Another type is drawn as a text box, so the value
// can still be seen and changed. Written for Amiricord from BetterDiscord's documented description.

export interface SettingItem {
    type: string;
    id?: string;
    name?: string;
    note?: string;
    value?: any;
    options?: Array<{ label: string; value: any; }>;
    min?: number;
    max?: number;
    step?: number;
    settings?: SettingItem[];
    collapsible?: boolean;
    shown?: boolean;
}

export interface SettingsPanelOptions {
    settings: SettingItem[];
    /** Called with the id of the category (null at top level), the id of the setting and the new value. */
    onChange(category: string | null, id: string, value: any): void;
}

export const SETTINGS_PANEL_CSS = `
.amiricord-bd-panel { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; color: var(--text-normal, #dbdee1); }
.amiricord-bd-setting { display: flex; flex-direction: column; gap: 4px; }
.amiricord-bd-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.amiricord-bd-name { font-weight: 600; }
.amiricord-bd-note { font-size: 12px; opacity: 0.7; }
.amiricord-bd-panel input[type="text"], .amiricord-bd-panel input[type="number"], .amiricord-bd-panel select { background: var(--input-background, #1e1f22); color: inherit; border: 1px solid transparent; border-radius: 4px; padding: 6px 8px; }
.amiricord-bd-category { border-left: 2px solid rgba(255,255,255,0.12); padding-left: 12px; display: flex; flex-direction: column; gap: 14px; }
.amiricord-bd-category > .amiricord-bd-name { cursor: pointer; }
`;

export function buildSettingsPanel(document: Document, options: SettingsPanelOptions): HTMLElement {
    const make = (tag: string, className?: string, text?: string): HTMLElement => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };

    const drawItem = (item: SettingItem, category: string | null): HTMLElement => {
        const wrap = make("div", "amiricord-bd-setting");
        const row = make("div", "amiricord-bd-row");
        const change = (value: any) => {
            try {
                options.onChange(category, String(item.id), value);
            } catch (error) {
                console.error("[BdApi.UI] the plugin's onChange threw", error);
            }
        };

        if (item.type === "category") {
            const box = make("div", "amiricord-bd-category");
            const title = make("div", "amiricord-bd-name", item.name ?? "");
            const body = make("div", "amiricord-bd-panel");
            for (const inner of item.settings ?? []) body.append(drawItem(inner, item.id ?? null));
            let shown = item.shown !== false;
            body.style.display = shown ? "" : "none";
            if (item.collapsible !== false) title.addEventListener("click", () => { shown = !shown; body.style.display = shown ? "" : "none"; });
            box.append(title, body);
            return box;
        }

        row.append(make("div", "amiricord-bd-name", item.name ?? ""));
        let control: HTMLElement;
        switch (item.type) {
            case "switch": {
                const input = make("input") as HTMLInputElement;
                input.type = "checkbox";
                input.checked = Boolean(item.value);
                input.addEventListener("change", () => { change(input.checked); });
                control = input;
                break;
            }
            case "number":
            case "slider": {
                const input = make("input") as HTMLInputElement;
                input.type = item.type === "slider" ? "range" : "number";
                if (item.min !== undefined) input.min = String(item.min);
                if (item.max !== undefined) input.max = String(item.max);
                if (item.step !== undefined) input.step = String(item.step);
                input.value = String(item.value ?? 0);
                input.addEventListener("input", () => { change(Number(input.value)); });
                control = input;
                break;
            }
            case "dropdown": {
                const select = make("select") as HTMLSelectElement;
                for (const choice of item.options ?? []) {
                    const option = make("option", undefined, String(choice.label)) as HTMLOptionElement;
                    option.value = String(choice.value);
                    option.selected = choice.value === item.value;
                    select.append(option);
                }
                select.addEventListener("change", () => {
                    const chosen = (item.options ?? []).find(choice => String(choice.value) === select.value);
                    change(chosen ? chosen.value : select.value);
                });
                control = select;
                break;
            }
            case "radio": {
                const group = make("div");
                for (const choice of item.options ?? []) {
                    const label = make("label");
                    const input = make("input") as HTMLInputElement;
                    input.type = "radio";
                    input.name = String(item.id);
                    input.checked = choice.value === item.value;
                    input.addEventListener("change", () => { if (input.checked) change(choice.value); });
                    label.append(input, ` ${String(choice.label)}`);
                    group.append(label, make("br"));
                }
                control = group;
                break;
            }
            case "color": {
                const input = make("input") as HTMLInputElement;
                input.type = "color";
                input.value = String(item.value ?? "#000000");
                input.addEventListener("input", () => { change(input.value); });
                control = input;
                break;
            }
            default: {
                const input = make("input") as HTMLInputElement;
                input.type = "text";
                input.value = item.value === undefined ? "" : String(item.value);
                input.addEventListener("change", () => { change(input.value); });
                control = input;
            }
        }
        row.append(control);
        wrap.append(row);
        if (item.note) wrap.append(make("div", "amiricord-bd-note", item.note));
        return wrap;
    };

    const panel = make("div", "amiricord-bd-panel");
    const style = make("style", undefined, SETTINGS_PANEL_CSS);
    panel.append(style);
    for (const item of options.settings ?? []) panel.append(drawItem(item, null));
    return panel;
}
