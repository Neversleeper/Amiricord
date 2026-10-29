/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultButtonGroups, defaultChoices, defaultQuickActions, defaultSettings } from "../src/plugins/Settings/mainItems";
import { MATERIALS } from "../src/shared/windowChoices";

describe("the lists of the main tab", () => {
    it("have the six tiles in order, every one with an action; only the relaunch asks first", () => {
        const calls: string[] = [];
        const items = defaultQuickActions({
            openDataFolder: () => { calls.push("folder"); }, openNotificationLog: () => { calls.push("log"); }, openNotificationOptions: () => { calls.push("options"); }, openCssEditor: () => { calls.push("css"); }, openHealthReport: () => { calls.push("health"); }, openSourceCode: () => { calls.push("source"); }, restart: () => { calls.push("restart"); }
        });
        assert.deepEqual(items.map(item => item.id), ["notification-log", "quick-css", "relaunch", "data-folder", "health-report", "source-code"]);
        assert.deepEqual(items.filter(item => item.run).map(item => item.id), ["notification-log", "quick-css", "relaunch", "data-folder", "health-report", "source-code"]);
        assert.deepEqual(items.filter(item => item.soon).map(item => item.id), []);
        assert.ok(items.every(item => !(item.soon && item.run)), "an entry is either soon or working, never both");
        assert.deepEqual(items.filter(item => item.confirm).map(item => item.id), ["relaunch"]);
        for (const id of ["relaunch", "data-folder", "health-report", "source-code", "quick-css", "notification-log"]) items.find(item => item.id === id)!.run!();
        assert.deepEqual(calls, ["restart", "folder", "health", "source", "css", "log"]);
    });

    it("have seven switches that wait for their feature, with the five window options marked as needing a restart; none is about privacy, which has its own tab", () => {
        const settings = defaultSettings();
        assert.equal(settings.length, 7);
        assert.ok(!settings.some(item => /telemetry|analytics|tracking/i.test(item.id + item.title)));
        assert.ok(settings.every(item => item.soon === true));
        assert.deepEqual(settings.filter(item => item.restart).map(item => item.id), ["native-title-bar", "transparent", "no-min-size", "ctrl-q", "react-devtools"]);
        assert.deepEqual(settings.filter(item => item.warning).map(item => item.id), ["transparent"]);
    });

    it("turn a switch into a working one only when its feature gives it a way to be read and changed, and only that switch", () => {
        const log: string[] = [];
        const live = { get: () => true, set: (on: boolean) => { log.push(String(on)); }, subscribe: () => () => undefined };
        const settings = defaultSettings({ "custom-css": live, "no-such-switch": live });
        assert.equal(settings.length, 7, "an id that is not in the list adds nothing");
        const custom = settings.find(item => item.id === "custom-css")!;
        assert.equal(custom.soon, undefined);
        assert.equal(custom.live, live);
        assert.ok(settings.filter(item => item.id !== "custom-css").every(item => item.soon === true && item.live === undefined));
        assert.ok(defaultSettings().every(item => item.soon === true && item.live === undefined), "without anything given, every switch waits");
    });

    it("turn the background effect drop-down into a working one only when its feature gives it a way to be read and changed, and only that one", () => {
        const live = { get: () => 1, set: () => undefined, subscribe: () => () => undefined };
        const [material] = defaultChoices({ "background-material": live, "no-such-choice": live });
        assert.equal(defaultChoices({ "no-such-choice": live }).length, 1, "an id that is not in the list adds nothing");
        assert.equal(material.soon, undefined);
        assert.equal(material.live, live);
        const [waiting] = defaultChoices();
        assert.equal(waiting.soon, true, "without anything given, it waits");
        assert.equal(waiting.live, undefined);
    });

    it("list the background effects in the order the main process knows them, so the position picked is the effect asked for", () => {
        const [material] = defaultChoices();
        assert.deepEqual(material.choices.map(label => label.split(" ")[0].toLowerCase()), [...MATERIALS]);
    });

    it("keep every id unique inside its list, and every entry with a title and a text", () => {
        const none = { openNotificationLog: () => undefined, openNotificationOptions: () => undefined };
        const lists = [defaultQuickActions({ ...none, openDataFolder: () => undefined, openCssEditor: () => undefined, openHealthReport: () => undefined, openSourceCode: () => undefined, restart: () => undefined }), defaultSettings(), defaultChoices(), defaultButtonGroups(none)];
        for (const list of lists) {
            assert.equal(new Set(list.map(item => item.id)).size, list.length);
            for (const item of list) assert.ok(item.title.length > 0);
        }
        for (const item of [...defaultSettings(), ...defaultChoices(), ...defaultButtonGroups(none)]) assert.ok(item.description.length > 20, item.id);
    });

    it("have the Windows background material choices, None first, and the Notifications group with two buttons that work", () => {
        const [material] = defaultChoices();
        assert.equal(material.choices[0], "None");
        assert.equal(material.choices.length, 4);
        assert.equal(material.restart, true);
        const calls: string[] = [];
        const [group] = defaultButtonGroups({ openNotificationLog: () => { calls.push("log"); }, openNotificationOptions: () => { calls.push("options"); } });
        assert.deepEqual(group.buttons.map(button => button.title), ["Notification options", "Open the log"]);
        assert.ok(group.buttons.every(button => !button.soon && button.run));
        for (const button of group.buttons) button.run!();
        assert.deepEqual(calls, ["options", "log"]);
    });
});
