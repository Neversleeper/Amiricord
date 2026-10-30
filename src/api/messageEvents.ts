/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lets a plugin change the text of a message just before Discord sends it: `ctx.messageEvents.onBeforeSend((content, channel) => newContent)`. The core plugin UiApi
// patches the place in the message box's code where the typed text is turned into the message to send (checked live on Discord build 655747, module 688606: the line
// `let E=X.parse(channel,text)`), and gives the text to the handlers one after the other, in the order the plugins started. A handler that returns a different text
// changes the message; one that returns nothing leaves it; one that throws is reported against its plugin and skipped, so a broken plugin never stops a message. A
// handler cannot cancel the message and does not see edits, files or stickers. Written from scratch after reading how Vencord's MessageEvents work (not copied).

export interface OutgoingChannel { id: string; guild_id?: string; type?: number; }

/** Return the new text, or nothing to leave the message as it is. An empty text is ignored (Discord would send nothing). */
export type BeforeSend = (content: string, channel: OutgoingChannel) => string | undefined | void;

export interface PluginMessageEvents {
    /** Runs `handler` on every message the person sends from the message box, until the plugin stops. */
    onBeforeSend(handler: BeforeSend): void;
}

interface Entry { plugin: string; handler: BeforeSend; onError: (error: unknown) => void; }

export interface MessageEventHub {
    add(plugin: string, handler: BeforeSend, onError: (error: unknown) => void): boolean;
    removeAll(plugin: string): void;
    /** The text after every handler has had its turn. Never throws. */
    transform(content: string, channel: OutgoingChannel): string;
}

export function createMessageEventHub(): MessageEventHub {
    let entries: Entry[] = [];
    return {
        add(plugin, handler, onError) {
            if (typeof handler !== "function") return false;
            entries = [...entries, { plugin, handler, onError }];
            return true;
        },
        removeAll(plugin) {
            entries = entries.filter(entry => entry.plugin !== plugin);
        },
        transform(content, channel) {
            let text = typeof content === "string" ? content : "";
            for (const entry of entries) {
                try {
                    const answer = entry.handler(text, channel);
                    if (typeof answer === "string" && answer.length > 0) text = answer;
                } catch (error) {
                    entry.onError(error);
                }
            }
            return typeof content === "string" ? text : content;
        }
    };
}

/** The hub the core plugin UiApi and the engine share. */
export const messageEventHub: MessageEventHub = createMessageEventHub();

export function buildMessageEvents(hub: MessageEventHub, plugin: string, onDispose: (callback: () => void) => void, onError: (source: string, error: unknown) => void): PluginMessageEvents {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        onBeforeSend(handler) {
            hub.add(plugin, handler, error => { onError("message before send", error); });
        }
    };
}
