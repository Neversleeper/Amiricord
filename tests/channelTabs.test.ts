/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import channelTabs from "../src/equicordplugins/ChannelTabs/index";
import { matchesKeybind, numberKey } from "../src/equicordplugins/ChannelTabs/keybinds";
import { cleanSaved, specialPageForPath, type Tab, type TabOptions, TabsModel } from "../src/equicordplugins/ChannelTabs/model";
import { expandIdentifiers } from "../src/webpack/compileModule";

const DEFAULTS: TabOptions = {
    maxOpenTabs: 0, oneTabPerServer: false, switchToExistingTab: false, createNewTabIfNotExists: false,
    enableRapidNavigation: false, rapidNavigationThreshold: 3, openNewTabsInCompactMode: false
};

function make(options: Partial<TabOptions> = {}, now = { value: 1_000_000 }) {
    const visited: Tab[] = [];
    const model = new TabsModel(() => ({ ...DEFAULTS, ...options }), tab => { visited.push({ ...tab }); }, () => now.value);
    model.start(undefined, { guildId: "g1", channelId: "c1" });
    return { model, visited, now };
}

const channels = (model: TabsModel) => model.openTabs.map(tab => tab.channelId);
const key = (name: string, flags: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; }> = {}) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...flags });

describe("TabsModel", () => {
    it("starts with one tab on the page the person is on", () => {
        const { model } = make();
        assert.equal(model.openTabs.length, 1);
        assert.deepEqual([model.openTabs[0].guildId, model.openTabs[0].channelId], ["g1", "c1"]);
        assert.equal(model.selectedTab()?.id, model.openTabs[0].id);
    });

    it("opens a tab, selects it and asks the page to go there", () => {
        const { model, visited } = make();
        model.create({ guildId: "g1", channelId: "c2" }, true);
        assert.equal(model.openTabs.length, 2);
        assert.equal(model.selectedTab()?.channelId, "c2");
        assert.deepEqual(visited.map(tab => tab.channelId), ["c2"]);
    });

    it("keeps the selected tab when a tab is opened in the background", () => {
        const { model, visited } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        assert.equal(model.selectedTab()?.channelId, "c1");
        assert.equal(visited.length, 0);
    });

    it("never closes the last tab", () => {
        const { model } = make();
        model.close(model.openTabs[0].id);
        assert.equal(model.openTabs.length, 1);
    });

    it("goes back to the tab used before when the selected one is closed", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, true);
        model.create({ guildId: "g1", channelId: "c3" }, true);
        model.select(model.openTabs[0].id);
        model.select(model.openTabs[2].id);
        model.close(model.openTabs[2].id);
        assert.equal(model.selectedTab()?.channelId, "c1");
    });

    it("goes to the tab on the right when there is no earlier tab", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        model.create({ guildId: "g1", channelId: "c3" }, false);
        model.close(model.openTabs[0].id);
        assert.equal(model.selectedTab()?.channelId, "c2");
    });

    it("closes the others, and the ones on one side", () => {
        const { model } = make();
        for (const id of ["c2", "c3", "c4"]) model.create({ guildId: "g1", channelId: id }, false);
        model.closeToTheRight(model.openTabs[1].id);
        assert.deepEqual(channels(model), ["c1", "c2"]);
        model.closeToTheLeft(model.openTabs[1].id);
        assert.deepEqual(channels(model), ["c2"]);
        assert.equal(model.selectedTab()?.channelId, "c2");
        model.create({ guildId: "g1", channelId: "c5" }, false);
        model.closeOthers(model.openTabs[1].id);
        assert.deepEqual(channels(model), ["c5"]);
        assert.equal(model.selectedTab()?.channelId, "c5");
    });

    it("brings back the closed tabs, last first", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        model.create({ guildId: "g1", channelId: "c3" }, false);
        model.close(model.openTabs[2].id);
        model.close(model.openTabs[1].id);
        assert.equal(model.hasClosedTabs, true);
        model.reopenClosed();
        assert.equal(model.selectedTab()?.channelId, "c2");
        model.reopenClosed();
        assert.deepEqual(channels(model), ["c1", "c2", "c3"]);
        assert.equal(model.hasClosedTabs, false);
    });

    it("moves a tab and ignores positions outside the list", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        model.create({ guildId: "g1", channelId: "c3" }, false);
        model.move(0, 2);
        assert.deepEqual(channels(model), ["c2", "c3", "c1"]);
        model.move(0, 9);
        model.move(-1, 0);
        assert.deepEqual(channels(model), ["c2", "c3", "c1"]);
    });

    it("cycles forward and backward around the ends", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        model.cycle(-1);
        assert.equal(model.selectedTab()?.channelId, "c2");
        model.cycle(1);
        assert.equal(model.selectedTab()?.channelId, "c1");
    });

    it("selects by position for the number keys", () => {
        const { model } = make();
        model.create({ guildId: "g1", channelId: "c2" }, false);
        assert.equal(model.selectPosition(1), true);
        assert.equal(model.selectedTab()?.channelId, "c2");
        assert.equal(model.selectPosition(5), false);
    });

    it("toggles the compact mode of one tab", () => {
        const { model } = make();
        model.toggleCompact(model.openTabs[0].id);
        assert.equal(model.openTabs[0].compact, true);
        model.toggleCompact(model.openTabs[0].id);
        assert.equal(model.openTabs[0].compact, false);
    });

    describe("settings", () => {
        it("at the largest number of tabs, a new tab takes the place of the selected one", () => {
            const { model } = make({ maxOpenTabs: 2 });
            model.create({ guildId: "g1", channelId: "c2" }, false);
            model.create({ guildId: "g1", channelId: "c3" }, true);
            assert.deepEqual(channels(model), ["c3", "c2"]);
        });

        it("\"Open in new tab\" ignores the largest number of tabs", () => {
            const { model } = make({ maxOpenTabs: 1 });
            model.create({ guildId: "g1", channelId: "c2" }, true, undefined, true);
            assert.equal(model.openTabs.length, 2);
        });

        it("one tab per server changes the tab of that server", () => {
            const { model } = make({ oneTabPerServer: true });
            model.create({ guildId: "g1", channelId: "c9" }, true);
            assert.equal(model.openTabs.length, 1);
            assert.equal(model.openTabs[0].channelId, "c9");
            model.create({ guildId: "@me", channelId: "d1" }, false);
            model.create({ guildId: "@me", channelId: "d2" }, false);
            assert.equal(model.openTabs.length, 3);
        });
    });

    describe("when the person goes to a channel by themselves", () => {
        it("changes the selected tab by default, and never navigates", () => {
            const { model, visited } = make();
            model.channelChanged({ guildId: "g1", channelId: "c2" });
            assert.deepEqual(channels(model), ["c2"]);
            assert.equal(visited.length, 0);
        });

        it("does nothing for the channel the selected tab already shows", () => {
            const { model } = make();
            const before = model.version;
            model.channelChanged({ guildId: "g1", channelId: "c1" });
            assert.equal(model.version, before);
        });

        it("switches to a tab that already shows the channel, when asked to", () => {
            const { model } = make({ switchToExistingTab: true });
            model.create({ guildId: "g1", channelId: "c2" }, false);
            model.channelChanged({ guildId: "g1", channelId: "c2" });
            assert.equal(model.selectedTab()?.channelId, "c2");
            assert.equal(model.openTabs.length, 2);
        });

        it("opens a tab for a channel that has none, when asked to", () => {
            const { model } = make({ createNewTabIfNotExists: true });
            model.channelChanged({ guildId: "g1", channelId: "c2" });
            assert.deepEqual(channels(model), ["c1", "c2"]);
            assert.equal(model.selectedTab()?.channelId, "c2");
        });

        it("quick moves change the tab instead of opening more", () => {
            const { model, now } = make({ createNewTabIfNotExists: true, enableRapidNavigation: true });
            model.channelChanged({ guildId: "g1", channelId: "c2" });
            now.value += 1000;
            model.channelChanged({ guildId: "g1", channelId: "c3" });
            assert.deepEqual(channels(model), ["c1", "c3"]);
            now.value += 10_000;
            model.channelChanged({ guildId: "g1", channelId: "c4" });
            assert.deepEqual(channels(model), ["c1", "c3", "c4"]);
        });

        it("treats a missing server as direct messages", () => {
            const { model } = make({ switchToExistingTab: true });
            model.create({ guildId: "@me", channelId: "d1" }, false);
            model.channelChanged({ guildId: "", channelId: "d1" });
            assert.equal(model.selectedTab()?.channelId, "d1");
        });
    });

    describe("bookmarks", () => {
        it("adds a bookmark once, moves it, renames it and removes it", () => {
            const { model } = make();
            model.addBookmark({ guildId: "g1", channelId: "c1" }, "one");
            model.addBookmark({ guildId: "g1", channelId: "c1" }, "again");
            model.addBookmark({ guildId: "g1", channelId: "c2" }, "two");
            assert.deepEqual(model.bookmarks.map(mark => mark.name), ["one", "two"]);
            assert.equal(model.isBookmarked({ guildId: "g1", channelId: "c2" }), true);
            model.moveBookmark(0, 1);
            assert.deepEqual(model.bookmarks.map(mark => mark.name), ["two", "one"]);
            model.renameBookmark(0, "second");
            model.removeBookmark(1);
            assert.deepEqual(model.bookmarks.map(mark => mark.name), ["second"]);
        });
    });

    describe("saving", () => {
        it("gives back what it was given, with the same tab selected", () => {
            const { model } = make();
            model.create({ guildId: "g1", channelId: "c2" }, true);
            model.addBookmark({ guildId: "g1", channelId: "c9" }, "nine");
            const saved = cleanSaved(JSON.parse(JSON.stringify(model.snapshot())));
            assert.ok(saved);
            const other = make();
            other.model.start(saved, { guildId: "x", channelId: "y" });
            assert.deepEqual(channels(other.model), ["c1", "c2"]);
            assert.equal(other.model.selectedTab()?.channelId, "c2");
            assert.deepEqual(other.model.bookmarks.map(mark => mark.name), ["nine"]);
        });

        it("tells listeners about changes until they stop listening", () => {
            const { model } = make();
            let calls = 0;
            const stop = model.subscribe(() => { calls++; });
            model.create({ guildId: "g1", channelId: "c2" }, false);
            stop();
            model.create({ guildId: "g1", channelId: "c3" }, false);
            assert.equal(calls, 1);
        });
    });
});

describe("cleanSaved", () => {
    it("drops what has the wrong shape and what is too long", () => {
        const saved = cleanSaved({
            openTabs: [{ guildId: "g", channelId: "c", compact: true }, { guildId: 3, channelId: "c" }, null, { guildId: "g", channelId: "x".repeat(65) }, "text"],
            openTabIndex: 1.5,
            bookmarks: [{ guildId: "g", channelId: "c", name: "ok" }, { guildId: "g" }, { guildId: "g", channelId: "c", name: 5 }]
        });
        assert.ok(saved);
        assert.equal(saved.openTabs.length, 1);
        assert.equal(saved.openTabs[0].compact, true);
        assert.equal(saved.openTabIndex, 0);
        assert.deepEqual(saved.bookmarks.map(mark => mark.name), ["ok", ""]);
    });

    it("accepts nothing that is not an object", () => {
        for (const value of [undefined, null, "x", 3, true]) assert.equal(cleanSaved(value), undefined);
    });

    it("keeps at most 100 tabs", () => {
        const openTabs = Array.from({ length: 150 }, (_, index) => ({ guildId: "g", channelId: `c${index}` }));
        assert.equal(cleanSaved({ openTabs })?.openTabs.length, 100);
    });
});

describe("specialPageForPath", () => {
    it("tells the pages that have no channel", () => {
        assert.equal(specialPageForPath("/channels/@me"), "__friends__");
        assert.equal(specialPageForPath("/channels/@me/activity"), "__activity__");
        assert.equal(specialPageForPath("/quest-home"), "__quests__");
        assert.equal(specialPageForPath("/message-requests"), "__message-requests__");
        assert.equal(specialPageForPath("/shop"), "__shop__");
        assert.equal(specialPageForPath("/channels/123/456"), undefined);
    });
});

describe("matchesKeybind", () => {
    it("matches the written shortcut and nothing else", () => {
        assert.equal(matchesKeybind(key("w", { ctrlKey: true }), "CTRL+W"), true);
        assert.equal(matchesKeybind(key("W", { metaKey: true }), "ctrl+w"), true);
        assert.equal(matchesKeybind(key("w"), "CTRL+W"), false);
        assert.equal(matchesKeybind(key("w", { ctrlKey: true, shiftKey: true }), "CTRL+W"), false);
        assert.equal(matchesKeybind(key("Tab", { ctrlKey: true, shiftKey: true }), "CTRL+SHIFT+TAB"), true);
        assert.equal(matchesKeybind(key("Tab", { ctrlKey: true }), "CTRL+SHIFT+TAB"), false);
        assert.equal(matchesKeybind(key(" ", { altKey: true }), "ALT+SPACE"), true);
    });

    it("never matches an empty shortcut or one that has only modifiers", () => {
        assert.equal(matchesKeybind(key(""), ""), false);
        assert.equal(matchesKeybind(key("Control", { ctrlKey: true }), "CTRL"), false);
        assert.equal(matchesKeybind(key("Shift", { shiftKey: true }), "CTRL+SHIFT"), false);
    });
});

describe("numberKey", () => {
    it("reads 1 to 9 with no modifier", () => {
        assert.equal(numberKey(key("3")), 3);
        assert.equal(numberKey(key("0")), 0);
        assert.equal(numberKey(key("a")), 0);
        assert.equal(numberKey(key("3", { ctrlKey: true })), 0);
    });
});

describe("the patches", () => {
    // Text copied from Discord's web build 653945 (the only places the patches look at).
    const appView = "l?.params.guildId===j.ME?void 0:l?.params.guildId,children:(0,b.jsxs)(\"div\",{className:bd.E3,\"data-fullscreen\":c,children:[!c&&(0,b.jsx)(sh,{}),ed.Fr?null:(0,b.jsx)(ui,{}),(0,b.jsxs)(\"div\",{className:bd.Qs,children:[(0,b.jsx)(rN,{})";
    const router = "a=d}function T(e,t,n,i){u.log(`transitionToGuild - Transitioning to ${JSON.stringify({guildId:e,channelId:t,messageId:n})}`),p(c.BVt.CHANNEL(e,t,n),i)}function m(){";

    const apply = (code: string, index: number) => {
        const patch = channelTabs.patches![index];
        const replacement = patch.replacements[0];
        const match = new RegExp(expandIdentifiers((replacement.match as RegExp).source));
        const replace = replacement.replace as string;
        return { count: [...code.matchAll(new RegExp(match.source, "g"))].length, out: code.replace(match, replace.split("$self").join("SELF")) };
    };

    it("puts the tab bar around the element that holds the channel list and the chat, keeping its class", () => {
        const { count, out } = apply(appView, 0);
        assert.equal(count, 1);
        assert.ok(out.includes("(0,b.jsxs)(SELF.render,{currentChannel:l?.params,className:bd.Qs,children:["));
        assert.ok(out.includes("(0,b.jsxs)(\"div\",{className:bd.E3"));
    });

    it("hands the two functions of the router to the plugin before the function that goes to a guild", () => {
        const { count, out } = apply(router, 1);
        assert.equal(count, 1);
        assert.ok(out.includes("}SELF.setRouter(T,p);function T(e,t,n,i){u.log("));
    });

    it("finds nothing when the text is not there", () => {
        assert.equal(apply("function T(e,t,n,i){other()}", 1).count, 0);
        assert.equal(apply("(0,b.jsxs)(\"div\",{className:x.y,children:[", 0).count, 0);
    });
});
