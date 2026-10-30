/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Show the Amiricord logo" of the main tab: swaps the Discord logo of the Home button (the first button of the server list) for Amiricord's. It is done with a style only, so it
// needs no patch of Discord's code and no restart, and switching it off takes it away at once. The picture is the logo the Settings plugin already carries, as an image
// address (a `data:image/` one; anything else is not used, so the style can never reach the network). The Home button is found by `data-list-item-id="guildsnav___home"`, the
// name Discord gives it in its server list (the owner's own theme uses it too). Not applied in safe mode, which starts Discord without anything the owner added.
// Not verified in a real Discord: how the logo sits inside the round button.

import type { StyleHandle } from "../../api/styles";

/** The name of the style element in the page (`amiricord-style-Settings-amiricord-logo`). */
export const HOME_LOGO_STYLE_NAME = "amiricord-logo";

const HOME = "[data-list-item-id=\"guildsnav___home\"]";

/** Whether this is a picture given in the address itself (the only kind the style uses). */
export function isImageData(value: unknown): value is string {
    return typeof value === "string" && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value);
}

/** The style that hides Discord's logo in the Home button and draws `logo` in its place. */
export function homeLogoCss(logo: string): string {
    return [
        `${HOME} svg { display: none !important; }`,
        `${HOME} [class*="childWrapper"] { background-image: url("${logo}") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 64% !important; }`
    ].join("\n");
}

export interface HomeLogoDeps {
    /** The picture to draw. Not used when it is not an image given in the address. */
    logo: string;
    /** Whether the switch is on. */
    read(): boolean;
    /** The engine's `addStyle` for the Settings plugin. May throw. */
    add(css: string, name: string): StyleHandle;
    safeMode(): boolean;
    /** Something went wrong that the person should find in the health report. */
    report(source: string, error: unknown): void;
}

export interface HomeLogo {
    /** Make the page match the switch: add the style, or take it away. Never throws. */
    apply(): void;
    /** Take the style out (the plugin stops). */
    stop(): void;
    /** Whether the page has the style right now. */
    applied(): boolean;
}

export function makeHomeLogo(deps: HomeLogoDeps): HomeLogo {
    let handle: StyleHandle | undefined;
    const drop = () => {
        const old = handle;
        handle = undefined;
        try {
            old?.remove();
        } catch (error) {
            deps.report("Amiricord logo", error);
        }
    };
    return {
        apply() {
            try {
                if (!deps.read() || deps.safeMode()) return drop();
                if (!isImageData(deps.logo)) {
                    drop();
                    deps.report("Amiricord logo", new Error("the logo is not an image given in the address, so it is not used"));
                    return;
                }
                handle ??= deps.add(homeLogoCss(deps.logo), HOME_LOGO_STYLE_NAME);
            } catch (error) {
                handle = undefined;
                deps.report("Amiricord logo", error);
            }
        },
        stop: drop,
        applied: () => handle !== undefined
    };
}
