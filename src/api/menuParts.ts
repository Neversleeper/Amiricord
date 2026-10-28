/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's own menu pieces (`Menu`, `MenuGroup`, `MenuItem`, `MenuSeparator`, `MenuCheckboxItem`) so a plugin can build entries for a native menu with the real
// components. Discord's Menu component does not look at what an element IS: it compares `element.type` with the exports of one small module (the "barrel"), whose
// exports are empty marker functions (`function(){return null}`). So the real pieces are those markers, and the Menu is the component of the module that compares
// with them. Their minified names change with every Discord build, but the code that compares them has fixed words (`type:"separator"`, `"groupstart"`,
// `"checkbox"`, `"customitem"`, `hideScroller`, `"flexible"`), so the names are read from that code at run time: the module of the Menu is found by its text, the
// barrel is the module it imports for those comparisons, and each marker is the export named in its comparison. Read from the code of Discord build 652418; when
// any step does not match, the answer is `undefined` and nothing is guessed. Design: docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md (section 2c).

import type { ModuleView } from "../webpack/finders";

export interface MenuParts {
    Menu: unknown;
    MenuGroup: unknown;
    MenuItem: unknown;
    MenuSeparator: unknown;
    MenuCheckboxItem: unknown;
}

/** What the text of the Menu's module says about it. */
export interface MenuModuleFacts {
    /** The local name of the Menu function, and the name it is exported under. */
    component: string;
    exportName: string;
    /** The module that holds the markers, and the export name of each. */
    barrelId: string;
    separator: string;
    group: string;
    item: string;
    checkbox: string;
}

const ID = "[\\w$]+";

const COMPONENT = new RegExp(`function (${ID})\\(${ID}\\)\\{let\\{navId:${ID},variant:${ID}="flexible",hideScroller:`);
const SEPARATOR = new RegExp(`${ID}\\.type===(${ID})\\.(${ID})\\)return ${ID}\\.push\\(\\{type:"separator"`);
const GROUP = new RegExp(`${ID}\\.type===${ID}\\.(${ID})\\)\\{let ${ID}=${ID}\\(${ID}\\.props\\.children\\);return ${ID}\\.length>0&&\\(${ID}\\.push\\(\\{type:"groupstart"`);
const ITEM = new RegExp(`${ID}\\.type===${ID}\\.(${ID})\\)return ${ID}\\.push\\(null!=${ID}\\.props\\.render\\?\\{type:"customitem"`);
const CHECKBOX = new RegExp(`${ID}\\.type===${ID}\\.(${ID})\\)return ${ID}\\.push\\(\\{type:"checkbox"`);

const escape = (text: string) => text.replace(/[$]/g, "\\$&");

/** Read the facts from the source of a module, or undefined when it is not the Menu's module or its code is not the shape this knows. */
export function readMenuModule(source: string): MenuModuleFacts | undefined {
    const component = COMPONENT.exec(source)?.[1];
    const separator = SEPARATOR.exec(source);
    const group = GROUP.exec(source)?.[1];
    const item = ITEM.exec(source)?.[1];
    const checkbox = CHECKBOX.exec(source)?.[1];
    if (!component || !separator || !group || !item || !checkbox) return undefined;
    const barrelName = separator[1];
    const barrelId = new RegExp(`[,;({\\s]${escape(barrelName)}=${ID}\\((\\d+)\\)`).exec(source)?.[1];
    const exportName = new RegExp(`\\.d\\(${ID},\\{(?:[^}]*?,)?(${ID}):\\(\\)=>${escape(component)}[,}]`).exec(source)?.[1];
    if (!barrelId || !exportName) return undefined;
    return { component, exportName, barrelId, separator: separator[2], group, item, checkbox };
}

/** The text that every candidate module must have, so the others are not parsed. */
const CANDIDATE = ["hideScroller", "\"flexible\"", "type:\"groupstart\""] as const;

/** Find Discord's menu pieces through the module view. Runs only the module of the Menu and its barrel. Undefined when anything is missing. */
export function locateMenuParts(view: Pick<ModuleView, "ids" | "sourceOf" | "exportsOf">): MenuParts | undefined {
    for (const id of view.ids()) {
        let source: string | undefined;
        try {
            source = view.sourceOf(id);
        } catch {
            continue;
        }
        if (source === undefined || !CANDIDATE.every(text => source!.includes(text))) continue;
        const facts = readMenuModule(source);
        if (!facts) continue;
        try {
            const menuExports = view.exportsOf(id, true) as Record<string, unknown> | undefined;
            const barrel = view.exportsOf(facts.barrelId, true) as Record<string, unknown> | undefined;
            const Menu = menuExports?.[facts.exportName];
            const parts: MenuParts = {
                Menu,
                MenuSeparator: barrel?.[facts.separator],
                MenuGroup: barrel?.[facts.group],
                MenuItem: barrel?.[facts.item],
                MenuCheckboxItem: barrel?.[facts.checkbox]
            };
            if (Object.values(parts).every(part => typeof part === "function")) return parts;
        } catch {
            continue;
        }
    }
    return undefined;
}
