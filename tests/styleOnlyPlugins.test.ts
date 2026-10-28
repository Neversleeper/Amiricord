/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Wave 1 of the plugins adapted from TestCord's `testcordplugins`: the ones that are only a style sheet (plus GlassPanels, which builds its
// selectors from Discord's class names). What is checked: the style is added once on start with text Amiricord's style rules accept, the
// plugin does nothing else, and GlassPanels never writes a class name it did not check.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { refuseCss } from "../src/api/styles";
import type { EnginePluginContext } from "../src/renderer/engine";
import compactCompose, { CSS as compactComposeCss } from "../src/testcordplugins/CompactCompose/index";
import crtEffect, { CSS as crtEffectCss } from "../src/testcordplugins/CRTEffect/index";
import glassPanels, { buildCss, selectorOf } from "../src/testcordplugins/GlassPanels/index";
import gridFloor, { CSS as gridFloorCss } from "../src/testcordplugins/GridFloor/index";
import neonGlow, { CSS as neonGlowCss } from "../src/testcordplugins/NeonGlow/index";
import pastelMentions, { CSS as pastelMentionsCss } from "../src/testcordplugins/PastelMentions/index";
import readableSpoilers, { CSS as readableSpoilersCss } from "../src/testcordplugins/ReadableSpoilers/index";
import starfield, { CSS as starfieldCss } from "../src/testcordplugins/Starfield/index";
import sunsetChat, { CSS as sunsetChatCss } from "../src/testcordplugins/SunsetChat/index";
import vaporScrollbar, { CSS as vaporScrollbarCss } from "../src/testcordplugins/VaporScrollbar/index";

const styleOnly = [
    { id: "CompactCompose", plugin: compactCompose, css: compactComposeCss, mustHave: "channelTextArea" },
    { id: "CRTEffect", plugin: crtEffect, css: crtEffectCss, mustHave: "repeating-linear-gradient" },
    { id: "GridFloor", plugin: gridFloor, css: gridFloorCss, mustHave: "mc-grid" },
    { id: "NeonGlow", plugin: neonGlow, css: neonGlowCss, mustHave: "text-shadow" },
    { id: "PastelMentions", plugin: pastelMentions, css: pastelMentionsCss, mustHave: ".mention" },
    { id: "ReadableSpoilers", plugin: readableSpoilers, css: readableSpoilersCss, mustHave: "spoilerContent" },
    { id: "Starfield", plugin: starfield, css: starfieldCss, mustHave: "mc-twinkle" },
    { id: "SunsetChat", plugin: sunsetChat, css: sunsetChatCss, mustHave: "messagesWrapper" },
    { id: "VaporScrollbar", plugin: vaporScrollbar, css: vaporScrollbarCss, mustHave: "::-webkit-scrollbar-thumb" }
];

function fakeContext(answer?: unknown) {
    const added: Array<{ css: string; name?: string; }> = [];
    const asked: string[][] = [];
    const ctx = {
        addStyle: (css: string, name?: string) => { added.push({ css, name }); return { update: () => undefined, remove: () => undefined }; },
        finders: { byProps: (...props: string[]) => { asked.push(props); return { ready: () => Promise.resolve(answer) }; } }
    } as unknown as EnginePluginContext;
    return { ctx, added, asked };
}

describe("style-only plugins adapted from TestCord", () => {
    for (const { id, plugin, css, mustHave } of styleOnly) {
        describe(id, () => {
            it("adds its style sheet once on start and asks Discord for nothing", async () => {
                const { ctx, added, asked } = fakeContext();
                await plugin.start!(ctx);
                assert.equal(added.length, 1);
                assert.equal(added[0].css, css);
                assert.deepEqual(asked, []);
            });

            it("has a style sheet that Amiricord's style rules accept and that is not empty", () => {
                assert.equal(refuseCss(css), undefined);
                assert.ok(css.includes(mustHave), `expected the style to contain ${mustHave}`);
                assert.ok(css.trim().length > 40);
            });

            it("has no stop of its own, because the engine removes what a plugin added", () => {
                assert.equal(plugin.stop, undefined);
            });

            it("keeps the author's credit in its manifest", () => {
                const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "src", "testcordplugins", id, "plugin.json"), "utf8"));
                assert.equal(manifest.id, id);
                assert.equal(manifest.enabledByDefault, false);
                assert.deepEqual(manifest.permissions, {});
                assert.equal(manifest.authors[0].name, "Sharp");
                assert.match(manifest.credits[0].name, /Sharp/);
                assert.equal(manifest.license, "GPL-3.0-or-later");
            });
        });
    }
});

describe("GlassPanels", () => {
    it("turns Discord's class names into selectors", () => {
        assert.equal(selectorOf("sidebar_abc12"), ".sidebar_abc12");
        assert.equal(selectorOf(" a-1  b_2 "), ".a-1.b_2");
    });

    it("refuses a class value that is not plain class names", () => {
        for (const bad of ["", "   ", "a{color:red}", "a, b", "a>b", "a.b", "a\b", "a;b", 5, null, undefined, {}]) {
            assert.equal(selectorOf(bad), undefined, JSON.stringify(bad));
        }
    });

    it("builds one rule with the three selectors, and keeps only the usable ones", () => {
        const all = buildCss({ sidebar: "s1", membersWrap: "mw1 mw2", members: "m1" })!;
        assert.match(all, /^\.s1, \.mw1\.mw2, \.m1 \{/);
        assert.match(all, /background-color: rgba\(25, 0, 51, 0\.45\) !important;/);
        assert.match(all, /^\s+backdrop-filter: blur\(10px\) saturate\(1\.3\);$/m);
        assert.match(all, /^\s+-webkit-backdrop-filter: blur\(10px\) saturate\(1\.3\);$/m);
        assert.equal(refuseCss(all), undefined);
        const some = buildCss({ sidebar: "s1", membersWrap: "bad{}", members: 3 })!;
        assert.match(some, /^\.s1 \{/);
        assert.equal(buildCss({ sidebar: "x y{", members: undefined }), undefined);
        assert.equal(buildCss({}), undefined);
    });

    it("asks for the three names, waits for Discord and adds the style once", async () => {
        const { ctx, added, asked } = fakeContext({ sidebar: "s1", membersWrap: "mw1", members: "m1" });
        await glassPanels.start!(ctx);
        assert.deepEqual(asked, [["sidebar", "membersWrap", "members"]]);
        assert.equal(added.length, 1);
        assert.match(added[0].css, /^\.s1, \.mw1, \.m1 \{/);
    });

    it("fails the start, and adds nothing, when Discord gives no usable name", async () => {
        const { ctx, added } = fakeContext({ sidebar: 1, membersWrap: "a b{", members: null });
        await assert.rejects(Promise.resolve(glassPanels.start!(ctx)), /class names/);
        assert.equal(added.length, 0);
    });
});
