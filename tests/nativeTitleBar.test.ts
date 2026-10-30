/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refuseCss } from "../src/api/styles";
import { hideDiscordButtons, NATIVE_TITLE_BAR_STYLE_NAME, nativeTitleBarCss } from "../src/plugins/Settings/nativeTitleBar";

describe("hiding Discord's own window buttons", () => {
    it("hides only the three window buttons, matched by the start of their name, and passes the rules every plugin's style must pass", () => {
        const css = nativeTitleBarCss();
        assert.equal(css, "[class*=\"winButtons_\"] { display: none !important; }");
        assert.equal(refuseCss(css), undefined);
        assert.equal(NATIVE_TITLE_BAR_STYLE_NAME, "native-title-bar");
    });

    it("hides them only when the standard bar is on, the transparent window is not, and Discord is not in safe mode", () => {
        assert.equal(hideDiscordButtons({ nativeTitleBar: true, transparentWindow: false, safeMode: false }), true);
        assert.equal(hideDiscordButtons({ nativeTitleBar: true, transparentWindow: undefined, safeMode: false }), true);
        assert.equal(hideDiscordButtons({ nativeTitleBar: false, transparentWindow: false, safeMode: false }), false);
        assert.equal(hideDiscordButtons({ nativeTitleBar: true, transparentWindow: true, safeMode: false }), false, "the transparent window has no standard bar");
        assert.equal(hideDiscordButtons({ nativeTitleBar: true, transparentWindow: false, safeMode: true }), false);
        for (const odd of ["true", 1, null, undefined]) assert.equal(hideDiscordButtons({ nativeTitleBar: odd, transparentWindow: false, safeMode: false }), false, String(odd));
    });
});
