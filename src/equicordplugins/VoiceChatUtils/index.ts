/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceChatUtils (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. Only the harmless part of the original is ported. The original can also disconnect, mute, deafen or move everyone in the call at once (a moderator tool that changes other people's state); that is not ported here. The mention list is written into the message box, not sent, so you decide whether to send it. The people are read from Discord's voice state store.

import { insertIntoChatInput } from "../../api/chatInput";
import { channelIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

/** The mention text for the people in a call: everyone once, without yourself, each followed by a space. */
export function mentionText(userIds: Array<string | undefined>, me: string | undefined): string {
    const unique = [...new Set(userIds.filter((id): id is string => !!id && id !== me))];
    return unique.length === 0 ? "" : `${unique.map(id => `<@${id}>`).join(" ")} `;
}

const plugin: PluginCode = {
    start(ctx) {
        const voice = ctx.common.VoiceStateStore;
        const users = ctx.common.UserStore;
        ctx.menuItems.add("mention-voice-users", click => {
            const channelId = channelIdFromTarget(click.target);
            if (!channelId) return null;
            const states = (voice.get() as unknown as { getVoiceStatesForChannel(id: string): Record<string, { userId?: string; }> | undefined; } | undefined)?.getVoiceStatesForChannel(channelId) ?? {};
            const text = mentionText(Object.values(states).map(state => state.userId), users.get()?.getCurrentUser()?.id);
            if (text === "") return null;
            return {
                label: "Mention all users",
                action: () => { if (!insertIntoChatInput(document, text)) ctx.toasts.show("There is no message box open to write in.", "failure"); }
            };
        });
    }
};

export default plugin;
