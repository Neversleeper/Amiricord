/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Slash commands from plugins: `ctx.commands.add({ name, description, options, execute })`. Discord keeps its own commands (shrug, tableflip, tts...) in one list;
// the core plugin UiApi patches the function that hands that list out so the commands added here come with it, and the command that Discord runs is a copy of
// the plugin's with `execute` wrapped: a command that throws or is rejected is reported against its plugin and Discord sends nothing. Written from scratch after
// reading how Vencord's CommandsAPI fills in a command (not copied). Not tried in a real Discord. Not covered: sub-commands, autocomplete, commands that need
// a server (the plugin checks that itself), and answering with a message that only the person sees.

export type CommandOptionType = "string" | "integer" | "boolean" | "number";

/** The numbers Discord uses for the option types. */
export const OPTION_TYPES: Readonly<Record<CommandOptionType, number>> = { string: 3, integer: 4, boolean: 5, number: 10 };

/** The command's `inputType`: "builtin" runs without writing anything in the chat box; "text" also takes the text typed as the message. */
export type CommandInput = "builtin" | "text";
const INPUT_TYPES: Readonly<Record<CommandInput, number>> = { builtin: 0, text: 1 };

export interface CommandOption {
    name: string;
    description: string;
    type?: CommandOptionType;
    required?: boolean;
}

/** One typed value of the command, as Discord hands it. */
export interface CommandArgument { name: string; value: unknown; }

export interface CommandDefinition {
    /** Lower case letters, digits, `-` and `_`, 1 to 32 characters. */
    name: string;
    description: string;
    options?: readonly CommandOption[];
    /** Default "builtin". */
    input?: CommandInput;
    /** What to do. Return `{ content }` to send that text as a message, or nothing. */
    execute(args: readonly CommandArgument[], context: unknown): unknown;
}

export interface PluginCommands {
    /** Add a command; it goes away when the plugin stops. Returns false (and adds nothing) for a bad definition, a name that is taken or too many commands. */
    add(command: CommandDefinition): boolean;
}

export const MAX_COMMANDS_PER_PLUGIN = 10;
const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
const FIRST_ID = 100;

/** What Discord's code is given: a plain object in the shape of its own built-in commands. */
export interface DiscordCommand {
    id: string;
    name: string;
    displayName: string;
    untranslatedName: string;
    description: string;
    displayDescription: string;
    untranslatedDescription: string;
    type: number;
    inputType: number;
    applicationId: string;
    options?: Array<{ name: string; displayName: string; description: string; displayDescription: string; type: number; required: boolean; }>;
    plugin: string;
    isAmiricordCommand: true;
    execute(args: readonly CommandArgument[], context: unknown): unknown;
}

export interface CommandHub {
    add(plugin: string, definition: CommandDefinition, onError: (error: unknown) => void): boolean;
    removeAll(plugin: string): void;
    /** `base` (Discord's list) followed by the added commands that no command of the list already uses. `base` itself is not changed. */
    withCommands(base: unknown): unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function createCommandHub(): CommandHub {
    let commands: DiscordCommand[] = [];
    let counter = FIRST_ID;

    return {
        add(plugin, definition, onError) {
            if (!isObject(definition) || typeof definition.name !== "string" || !COMMAND_NAME.test(definition.name)) return false;
            if (typeof definition.description !== "string" || definition.description.length === 0 || typeof definition.execute !== "function") return false;
            if (commands.some(command => command.name === definition.name)) return false;
            if (commands.filter(command => command.plugin === plugin).length >= MAX_COMMANDS_PER_PLUGIN) return false;
            const options = (definition.options ?? []).map(option => ({
                name: option.name,
                displayName: option.name,
                description: option.description,
                displayDescription: option.description,
                type: OPTION_TYPES[option.type ?? "string"] ?? OPTION_TYPES.string,
                required: option.required === true
            }));
            const run = definition.execute;
            commands = [...commands, {
                id: `-${counter++}`,
                name: definition.name,
                displayName: definition.name,
                untranslatedName: definition.name,
                description: definition.description,
                displayDescription: definition.description,
                untranslatedDescription: definition.description,
                type: 1,
                inputType: INPUT_TYPES[definition.input ?? "builtin"] ?? INPUT_TYPES.builtin,
                applicationId: "-1",
                ...(options.length > 0 ? { options } : {}),
                plugin,
                isAmiricordCommand: true,
                execute(args, context) {
                    try {
                        const result = run(args, context);
                        if (result instanceof Promise) return result.then(undefined, error => { onError(error); return undefined; });
                        return result;
                    } catch (error) {
                        onError(error);
                        return undefined;
                    }
                }
            }];
            return true;
        },

        removeAll(plugin) {
            commands = commands.filter(command => command.plugin !== plugin);
        },

        withCommands(base) {
            if (!Array.isArray(base) || commands.length === 0) return base;
            const taken = new Set(base.map(command => (isObject(command) ? command.name : undefined)));
            return [...base, ...commands.filter(command => !taken.has(command.name))];
        }
    };
}

/** The hub the core plugin UiApi and the engine share. */
export const commandHub: CommandHub = createCommandHub();

export function buildCommands(hub: CommandHub, plugin: string, onDispose: (callback: () => void) => void, onError: (source: string, error: unknown) => void): PluginCommands {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(command) {
            return hub.add(plugin, command, error => { onError(`command ${String(command?.name)}`, error); });
        }
    };
}
