/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Windows title bar" of the main tab: the main process builds the window with the standard Windows bar (src/main/windowHook.ts), but Discord's page still draws its own bar under it,
// with its own minimize, maximize and close buttons, so the buttons would be there twice. This style hides only those three buttons (the part of Discord's bar named `winButtons_…`;
// the hash after the name changes with each build of Discord, so the name is matched by its start); the back and forward buttons, the title and the inbox stay. It is added at start
// and only then, never when the switch changes, because the bar only changes at the next start, and hiding Discord's buttons before that would leave no buttons at all.
// It is not added when the transparent window is on (that window has no standard bar, Discord's buttons are then the only ones) or in safe mode (the window options are not applied).
// Found in the shapes of the top of the page the owner's Discord wrote (build 655747). Not verified: how the bar looks with the buttons hidden.

/** The name of the style element in the page (`amiricord-style-Settings-native-title-bar`). */
export const NATIVE_TITLE_BAR_STYLE_NAME = "native-title-bar";

export function nativeTitleBarCss(): string {
    return "[class*=\"winButtons_\"] { display: none !important; }";
}

/** Whether Discord's own window buttons should be hidden: the standard bar is on, the transparent window is not, and Discord is not in safe mode. */
export function hideDiscordButtons(state: { nativeTitleBar: unknown; transparentWindow: unknown; safeMode: boolean; }): boolean {
    return state.nativeTitleBar === true && state.transparentWindow !== true && !state.safeMode;
}
