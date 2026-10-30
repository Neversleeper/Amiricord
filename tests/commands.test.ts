/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCommands, type CommandDefinition, createCommandHub, MAX_COMMANDS_PER_PLUGIN } from "../src/api/commands";

const quiet = () => undefined;
const definition = (name: string, extra: Partial<CommandDefinition> = {}): CommandDefinition => ({ name, description: `the ${name} command`, execute: () => undefined, ...extra });

describe("slash commands from plugins", () => {
    it("adds the commands after Discord's own, in the shape Discord's built-in commands have, without changing Discord's list", () => {
        const hub = createCommandHub();
        assert.equal(hub.add("P", definition("savegifs", { options: [{ name: "count", description: "how many", type: "integer", required: true }] }), quiet), true);
        const base = [{ id: "-1", name: "shrug" }];
        const list = hub.withCommands(base) as Array<Record<string, unknown>>;
        assert.deepEqual(base, [{ id: "-1", name: "shrug" }]);
        assert.equal(list.length, 2);
        const added = list[1];
        assert.equal(added.name, "savegifs");
        assert.equal(added.untranslatedName, "savegifs");
        assert.equal(added.displayName, "savegifs");
        assert.equal(added.applicationId, "-1");
        assert.equal(added.type, 1);
        assert.equal(added.inputType, 0);
        assert.equal(added.plugin, "P");
        assert.match(String(added.id), /^-\d+$/);
        assert.deepEqual(added.options, [{ name: "count", displayName: "count", description: "how many", displayDescription: "how many", type: 4, required: true }]);
    });

    it("gives every command its own id and leaves Discord's list alone when there is nothing to add", () => {
        const hub = createCommandHub();
        const base = [{ name: "shrug" }];
        assert.equal(hub.withCommands(base), base);
        hub.add("P", definition("one"), quiet);
        hub.add("P", definition("two"), quiet);
        const ids = (hub.withCommands(base) as Array<{ id?: string; }>).slice(1).map(command => command.id);
        assert.equal(new Set(ids).size, 2);
        assert.equal(hub.withCommands("not a list"), "not a list");
    });

    it("refuses a bad name or description, a name that is taken (by a plugin) and too many commands", () => {
        const hub = createCommandHub();
        assert.equal(hub.add("P", definition("Bad Name"), quiet), false);
        assert.equal(hub.add("P", definition("two  spaces"), quiet), false);
        assert.equal(hub.add("P", definition(" lead"), quiet), false);
        assert.equal(hub.add("P", definition("a".repeat(33)), quiet), false);
        assert.equal(hub.add("P", definition("create friend invite"), quiet), true);
        hub.removeAll("P");
        assert.equal(hub.add("P", { ...definition("ok"), description: "" }, quiet), false);
        assert.equal(hub.add("P", { ...definition("ok"), execute: undefined as never }, quiet), false);
        assert.equal(hub.add("P", definition("same"), quiet), true);
        assert.equal(hub.add("Q", definition("same"), quiet), false);
        for (let i = 0; i < MAX_COMMANDS_PER_PLUGIN - 1; i++) assert.equal(hub.add("P", definition(`c${i}`), quiet), true);
        assert.equal(hub.add("P", definition("one-too-many"), quiet), false);
    });

    it("does not add a command that Discord's list already has", () => {
        const hub = createCommandHub();
        hub.add("P", definition("tts"), quiet);
        assert.equal((hub.withCommands([{ name: "tts" }]) as unknown[]).length, 1);
    });

    it("reports a command that throws or is rejected and sends nothing; a result is passed on", async () => {
        const hub = createCommandHub();
        const errors: unknown[] = [];
        hub.add("P", definition("boom", { execute: () => { throw new Error("sync"); } }), error => errors.push(error));
        hub.add("P", definition("later", { execute: () => Promise.reject(new Error("async")) }), error => errors.push(error));
        hub.add("P", definition("say", { execute: args => ({ content: String(args[0]?.value) }) }), quiet);
        const [boom, later, say] = (hub.withCommands([]) as Array<{ execute(args: unknown[], context: unknown): unknown; }>);
        assert.equal(boom.execute([], {}), undefined);
        assert.equal(await later.execute([], {}), undefined);
        assert.deepEqual(say.execute([{ name: "m", value: "hi" }], {}), { content: "hi" });
        assert.deepEqual(errors.map(error => (error as Error).message), ["sync", "async"]);
    });

    it("takes a plugin's commands back when it stops", () => {
        const hub = createCommandHub();
        let dispose = () => undefined as void;
        const reported: string[] = [];
        const plugin = buildCommands(hub, "P", callback => { dispose = callback; }, source => reported.push(source));
        assert.equal(plugin.add(definition("one")), true);
        assert.equal((hub.withCommands([]) as unknown[]).length, 1);
        dispose();
        const base: unknown[] = [];
        assert.equal(hub.withCommands(base), base);
    });

    it("gives Discord the option types for a user, a channel and a role", () => {
        const hub = createCommandHub();
        assert.equal(hub.add("P", definition("who", { options: [{ name: "u", description: "a user", type: "user" }, { name: "c", description: "a channel", type: "channel" }, { name: "r", description: "a role", type: "role" }] }), quiet), true);
        const added = (hub.withCommands([]) as Array<{ options: Array<{ type: number; }>; }>)[0];
        assert.deepEqual(added.options.map(option => option.type), [6, 7, 8]);
    });
});
