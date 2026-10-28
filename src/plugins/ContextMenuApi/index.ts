/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ContextMenuApi, a core plugin: the two patches behind `ctx.contextMenu.addNative` (see `src/api/nativeMenus.ts`). It does nothing until a plugin adds an entry.
// 1. In every module that writes a menu's `navId` as text (`navId:"quests-entry"`), the object that holds it also gets `contextMenuAPIArguments`, the arguments of the
//    function that makes the menu, so a callback can see what that code was given (for a Quest tile, its `quest`). A `navId` that is a variable (as in a destructuring) is not matched.
// 2. In the module of Discord's Menu component, the function that starts `function X(e){let{navId:..,variant:..="flexible",hideScroller:` first hands its props to
//    `patchMenu`, which gives back the same props, or props with the list of children the callbacks of that `navId` left.
// Both patches are optional and lazy: Discord loads those modules when the first menu opens, and a Discord that moved the text only means that no entry is added. The texts
// were read from Discord build 652418 (the Menu module, the Quest tile menu). Written from scratch.

import { nativeMenus } from "../../api/nativeMenus";
import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode & { patchMenu(props: unknown): unknown; } = {
    patches: [
        {
            find: "navId:\"",
            all: true,
            lazy: true,
            required: false,
            replacements: [{ match: /navId:(?=")/g, replace: "contextMenuAPIArguments:typeof arguments!=\"undefined\"?arguments:[],navId:", perMatch: true }]
        },
        {
            find: "hideScroller:",
            lazy: true,
            required: false,
            replacements: [{ match: /(function \i\((\i)\)\{)(let\{navId:\i,variant:\i="flexible",hideScroller:)/, replace: "$1$2=$self.patchMenu($2);$3" }]
        }
    ],

    /** Called by Discord's Menu component with its props, before it draws. Never throws: on any trouble the menu gets its own props back. */
    patchMenu(props) {
        try {
            return nativeMenus.patchProps(props);
        } catch {
            return props;
        }
    }
};

export default plugin;
