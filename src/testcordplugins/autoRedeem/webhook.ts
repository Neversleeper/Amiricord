/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * The embeds are still built here, in the page. Sending goes through `ctx.native` (`sendWebhook` in native.ts), and the webhook address is the
 * plugin's `webhookUrl` secret, which only the main process can read: the page never holds it.
 */

import { nativeOf } from "../../api/native";
import type { EnginePluginContext } from "../../renderer/engine";
import type { ClaimInfo, VoidSolverTaskResult, WebhookEmbed, WebhookField, WebhookPayload, WebhookResult } from "./types";

const SUCCESS_COLOR = 0x57f287;
const FAILURE_COLOR = 0xed4245;
const TEST_COLOR = 0x5865f2;
const WEBHOOK_NAME = "AutoRedeem";

function createPayload(embeds: WebhookEmbed[]): WebhookPayload {
    return {
        username: WEBHOOK_NAME,
        embeds,
        allowed_mentions: {
            parse: []
        }
    };
}

function escapeMarkdown(value: string) {
    return value.replace(/([\\`*_{}[\]()#+.!|>~-])/g, "\\$1");
}

function buildUserProfileUrl(userId?: string) {
    return userId ? `https://discord.com/users/${userId}` : null;
}

function linkedValue(label: string | undefined, userId?: string, fallback = "Unknown") {
    if (!label) return escapeMarkdown(fallback);
    const profileUrl = buildUserProfileUrl(userId);
    return profileUrl ? `[${escapeMarkdown(label)}](${profileUrl})` : escapeMarkdown(label);
}

function buildMessageUrl(info: ClaimInfo) {
    if (!info.channelId || !info.messageId) return null;
    return `https://discord.com/channels/${info.guildId ?? "@me"}/${info.channelId}/${info.messageId}`;
}

function buildGiftTypeField(giftType: string | null): WebhookField | null {
    if (!giftType) return null;
    return { name: "Gift type:", value: escapeMarkdown(giftType), inline: true };
}

function buildDetectionField(info: ClaimInfo): WebhookField {
    const source = info.source === "nighty" ? "Nighty alt detector" : "Current Discord client";
    return {
        name: "Detected account:",
        value: `${linkedValue(info.detectedAccount, info.detectedAccountId, "Unknown account")}\n${source}`,
        inline: true
    };
}

function buildServerField(info: ClaimInfo): WebhookField {
    return {
        name: "Server:",
        value: escapeMarkdown(info.guildName ?? info.guildId ?? (info.source === "discord" ? "Direct message" : "Unknown server")),
        inline: true
    };
}

function buildChannelField(info: ClaimInfo): WebhookField {
    const channel = info.channelName
        ? info.channelName.startsWith("#") ? info.channelName : `#${info.channelName}`
        : info.channelId ?? "Unknown channel";

    return { name: "Channel:", value: escapeMarkdown(channel), inline: true };
}

function buildMessageField(info: ClaimInfo): WebhookField {
    const messageUrl = buildMessageUrl(info);
    return {
        name: "Jump to message:",
        value: messageUrl ? `[Open original message](${messageUrl})` : "Unavailable for Nighty alt detections.",
        inline: false
    };
}

function buildClaimLinkField(info: ClaimInfo): WebhookField {
    return {
        name: "Claim link:",
        value: `[Open gift](https://discord.gift/${info.code})`,
        inline: false
    };
}

function formatTaskTimestamp(value: string | undefined) {
    if (!value) return "Unknown";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:F>` : escapeMarkdown(value);
}

function buildVoidSolverFields(task: VoidSolverTaskResult | undefined): WebhookField[] {
    if (!task) return [];

    return [
        {
            name: "VoidSolver task:",
            value: `${escapeMarkdown(task.taskId)}${task.externalTaskId ? `\nExternal: ${escapeMarkdown(task.externalTaskId)}` : ""}`,
            inline: false
        },
        {
            name: "Task status:",
            value: `${escapeMarkdown(task.status)}\nToken received: ${task.status === "success" ? "Yes" : "No"}`,
            inline: true
        },
        {
            name: "Solve time:",
            value: task.solveTime === undefined ? "Unknown" : `${task.solveTime.toFixed(2)} seconds`,
            inline: true
        },
        {
            name: "Solved site:",
            value: escapeMarkdown(task.site ?? "Unknown"),
            inline: true
        },
        {
            name: "Task timeline:",
            value: `Created: ${formatTaskTimestamp(task.createdAt)}\nUpdated: ${formatTaskTimestamp(task.updatedAt)}`,
            inline: false
        }
    ];
}

function buildFields(info: ClaimInfo, giftType: string | null, error: string | undefined, task: VoidSolverTaskResult | undefined) {
    return [
        buildGiftTypeField(giftType),
        buildDetectionField(info),
        buildServerField(info),
        buildChannelField(info),
        { name: "Sender:", value: linkedValue(info.authorName ?? info.authorId, info.authorId, "Unknown sender"), inline: false } satisfies WebhookField,
        error ? { name: "Error:", value: escapeMarkdown(error), inline: false } satisfies WebhookField : null,
        buildMessageField(info),
        buildClaimLinkField(info),
        ...buildVoidSolverFields(task)
    ].filter((field): field is WebhookField => field !== null && field !== undefined);
}

function buildEmbed(result: WebhookResult, info: ClaimInfo, giftType: string | null, error: string | undefined, task: VoidSolverTaskResult | undefined): WebhookEmbed {
    const claimed = result === "claimed";
    return {
        title: claimed ? "Redeemed a gift! 🎉" : "Redeem failed ❌",
        color: claimed ? SUCCESS_COLOR : FAILURE_COLOR,
        fields: buildFields(info, giftType, error, task),
        timestamp: new Date().toISOString(),
        author: info.authorName ? { name: info.authorName, icon_url: info.authorAvatarUrl } : undefined,
        footer: { text: WEBHOOK_NAME }
    };
}

function parseWebhookError(data: string, status: number) {
    if (!data) return `Webhook request failed with status ${status}.`;

    try {
        const body = JSON.parse(data) as { message?: string; errors?: unknown; };
        const detail = [body.message, body.errors ? JSON.stringify(body.errors) : null].filter(Boolean).join(" ");
        return detail
            ? `Webhook request failed with status ${status}: ${detail}`
            : `Webhook request failed with status ${status}.`;
    } catch {
        return `Webhook request failed with status ${status}: ${data}`;
    }
}

export interface Webhook {
    /** Post the result of one redeem attempt to the saved webhook. Rejects with the reason when it could not be sent. */
    sendClaimWebhook(result: WebhookResult, info: ClaimInfo, giftType: string | null, error?: string, task?: VoidSolverTaskResult): Promise<void>;
    /** Post a test message to the saved webhook. */
    sendTestWebhook(): Promise<void>;
}

/** The webhook sender of one plugin run. `ctx.native` calls the plugin's own main-process functions (native.ts). */
export function createWebhook(ctx: Pick<EnginePluginContext, "native">): Webhook {
    const native = nativeOf<typeof import("./native")>(ctx.native);

    async function postWebhook(payload: WebhookPayload) {
        const { status, data } = await native.sendWebhook(JSON.stringify(payload));

        if (status < 200 || status >= 300) {
            throw new Error(parseWebhookError(data, status));
        }
    }

    async function sendClaimWebhook(
        result: WebhookResult,
        info: ClaimInfo,
        giftType: string | null,
        error?: string,
        task?: VoidSolverTaskResult
    ) {
        await postWebhook(createPayload([buildEmbed(result, info, giftType, error, task)]));
    }

    async function sendTestWebhook() {
        await postWebhook(createPayload([{
            title: "AutoRedeem Webhook Test",
            color: TEST_COLOR,
            description: "Your AutoRedeem webhook is configured correctly.",
            timestamp: new Date().toISOString(),
            footer: { text: WEBHOOK_NAME }
        }]));
    }

    return { sendClaimWebhook, sendTestWebhook };
}
