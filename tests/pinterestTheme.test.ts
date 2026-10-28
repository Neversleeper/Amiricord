/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkValue, validateDefinition } from "../src/api/pluginSettings";
import { settings } from "../src/testcordplugins/PinterestTool/settings";
import {
    ensureReadableAccent, getAppearanceStyle, getContrastRatio, getPinterestFullStyle, getPinterestThemeStyle, getReadableTextOn, getRelativeLuminance, normalizeHexColor,
    PINTEREST_THEMES, resolveAppearance, resolvePinterestTheme
} from "../src/testcordplugins/PinterestTool/theme";

describe("Pinterest Tool: themes", () => {
    it("knows the five accent themes and falls back to Pinterest's own for anything else", () => {
        assert.deepEqual(PINTEREST_THEMES.map(t => t.value), ["pinterest", "blurple", "violet", "cyan", "emerald"]);
        for (const theme of PINTEREST_THEMES) assert.equal(resolvePinterestTheme(theme.value), theme.value);
        assert.equal(resolvePinterestTheme("custom"), "custom");
        assert.equal(resolvePinterestTheme("nonsense"), "pinterest");
        assert.equal(resolvePinterestTheme(undefined), "pinterest");
    });

    it("cleans a colour: six hex digits, with or without the mark, any case; anything else is the default amber", () => {
        assert.equal(normalizeHexColor("#AABBCC"), "#aabbcc");
        assert.equal(normalizeHexColor("aabbcc"), "#aabbcc");
        assert.equal(normalizeHexColor("  #123456 "), "#123456");
        for (const bad of ["", "#abc", "#12345", "#1234567", "#gggggg", "red", "rgb(1,2,3)"]) assert.equal(normalizeHexColor(bad), "#f59e0b", bad);
    });

    it("gives the variables of a fixed theme, and of a custom one built from the chosen colour", () => {
        const blurple = getPinterestThemeStyle("blurple");
        assert.equal(blurple["--pt-accent"], "#5865f2");
        assert.equal(blurple["--pt-accent-hover"], "#7380ff");
        assert.equal(blurple["--pt-accent-contrast"], "#ffffff");
        const custom = getPinterestThemeStyle("custom", "#336699");
        assert.equal(custom["--pt-accent"], "#336699");
        assert.equal(custom["--pt-accent-soft"], "rgba(51, 102, 153, .18)");
        assert.equal(custom["--pt-accent-hover"], "rgb(88, 130, 171)");
        assert.equal(getPinterestThemeStyle("custom", "not a color")["--pt-accent"], "#f59e0b");
        assert.equal(getPinterestThemeStyle("custom")["--pt-accent"], "#f59e0b");
    });

    it("picks dark or light text for the accent by how bright it is", () => {
        assert.equal(getPinterestThemeStyle("custom", "#ffff00")["--pt-accent-contrast"], "#111214");
        assert.equal(getPinterestThemeStyle("custom", "#000080")["--pt-accent-contrast"], "#ffffff");
    });
});

describe("Pinterest Tool: contrast", () => {
    it("measures brightness and contrast like the web standard", () => {
        assert.equal(getRelativeLuminance("#000000"), 0);
        assert.equal(getRelativeLuminance("#ffffff"), 1);
        assert.ok(Math.abs(getContrastRatio("#000000", "#ffffff") - 21) < 1e-9);
        assert.ok(Math.abs(getContrastRatio("#ffffff", "#ffffff") - 1) < 1e-9);
        assert.equal(getContrastRatio("#123456", "#abcdef"), getContrastRatio("#abcdef", "#123456"));
    });

    it("chooses black or white text, whichever reads better", () => {
        assert.equal(getReadableTextOn("#ffffff"), "#111214");
        assert.equal(getReadableTextOn("#000000"), "#ffffff");
        assert.equal(getReadableTextOn("#e60023"), "#ffffff");
    });

    it("nudges an accent that is too faint toward black or white until it can be read, and leaves a good one alone", () => {
        assert.equal(ensureReadableAccent("#e60023", "#ffffff"), "#e60023");
        const onWhite = ensureReadableAccent("#ffff99", "#ffffff");
        assert.ok(getContrastRatio(onWhite, "#ffffff") >= 4.5, onWhite);
        const onDark = ensureReadableAccent("#111122", "#1b2328");
        assert.ok(getContrastRatio(onDark, "#1b2328") >= 4.5, onDark);
        assert.equal(ensureReadableAccent("#777777", "#777777", 21), "#ffffff");
        assert.equal(ensureReadableAccent("garbage", "#ffffff", 1), "#f59e0b");
    });
});

describe("Pinterest Tool: appearance", () => {
    it("follows Discord only on Auto", () => {
        assert.equal(resolveAppearance("DARK", false), "dark");
        assert.equal(resolveAppearance("LIGHT", true), "light");
        assert.equal(resolveAppearance("AUTO", true), "dark");
        assert.equal(resolveAppearance("AUTO", false), "light");
    });

    it("gives the dark and light palettes, with the colour scheme and a readable accent for text", () => {
        const dark = getAppearanceStyle("dark", "#e60023");
        const light = getAppearanceStyle("light", "#e60023");
        assert.equal(dark["--pt-bg"], "#13191d");
        assert.equal(light["--pt-bg"], "#f1f5f4");
        assert.equal(dark.colorScheme, "dark");
        assert.equal(light.colorScheme, "light");
        assert.ok(getContrastRatio(dark["--pt-accent-text"], "#1b2328") >= 4.5);
        assert.ok(getContrastRatio(light["--pt-accent-text"], "#ffffff") >= 4.5);
        assert.equal(dark["--text-normal"], dark["--pt-text"], "Discord's own variables follow the same choice");
    });

    it("mixes the accent in, and in the Discord-following look uses Discord's own variables with the palette behind them", () => {
        const fixed = getPinterestFullStyle("violet", "#000000", "dark");
        assert.equal(fixed["--pt-accent"], "#8b5cf6");
        assert.equal(fixed["--pt-bg"], "#13191d");
        assert.equal("--text-normal" in fixed, true);
        const following = getPinterestFullStyle("violet", "#000000", "light", true);
        assert.equal(following["--pt-accent"], "#8b5cf6");
        assert.equal(following["--pt-bg"], "var(--background-base-lower, var(--background-secondary, #f1f5f4))");
        assert.equal("--text-normal" in following, false, "Discord's own variables are not overridden when following it");
        assert.equal(following.colorScheme, "light");
    });
});

describe("Pinterest Tool: settings", () => {
    it("declares the six settings of the original with the same defaults, and they are valid", () => {
        assert.doesNotThrow(() => { validateDefinition(settings.definition); });
        assert.deepEqual(Object.keys(settings.definition), ["colorTheme", "customAccent", "appearance", "randomizeSearch", "effectsStep", "editBeforeApply"]);
        assert.equal(settings.store.colorTheme, "pinterest");
        assert.equal(settings.store.customAccent, "#f59e0b");
        assert.equal(settings.store.appearance, "AUTO");
        assert.equal(settings.store.randomizeSearch, false);
        assert.equal(settings.store.effectsStep, true);
        assert.equal(settings.store.editBeforeApply, true);
    });

    it("offers every theme the colour code knows, plus Custom, and no cookie setting", () => {
        const options = settings.definition.colorTheme.options.map(option => option.value);
        assert.deepEqual(options, [...PINTEREST_THEMES.map(t => t.value), "custom"]);
        assert.equal("pinterestCookie" in settings.definition, false, "the cookie is a secret, not a setting");
    });

    it("accepts only values that fit", () => {
        assert.equal(checkValue(settings.definition.colorTheme, "violet"), null);
        assert.notEqual(checkValue(settings.definition.colorTheme, "pink"), null);
        assert.equal(checkValue(settings.definition.appearance, "DARK"), null);
        assert.notEqual(checkValue(settings.definition.appearance, "dark"), null);
        assert.equal(checkValue(settings.definition.customAccent, "#112233"), null);
        assert.notEqual(checkValue(settings.definition.customAccent, "#11223344"), null);
        assert.notEqual(checkValue(settings.definition.randomizeSearch, "yes"), null);
    });
});
