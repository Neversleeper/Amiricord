/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WebhookSend (author x2b) as found in TestCord. A smaller version of the original's big window (embeds, mentions, history): this one sends plain text, with an optional display name and picture address. The request goes straight to Discord's webhook address from the page, so the permission lists discord.com. Webhook addresses are secrets: they are typed each time, never stored by the plugin and never shown in notices. The original's history of addresses is not ported.

import type { PluginCode } from "../../renderer/engine";

const HOSTS = ["discord.com", "canary.discord.com", "ptb.discord.com", "discordapp.com"];

/** Whether an address is a Discord webhook address (https, a Discord host, a webhook path). */
export function isWebhookUrl(address: string): boolean {
    try {
        const url = new URL(address);
        return url.protocol === "https:" && HOSTS.includes(url.hostname) && url.pathname.startsWith("/api/webhooks/");
    } catch {
        return false;
    }
}

/** The JSON body of the webhook request. */
export function webhookBody(content: string, username?: string, avatarUrl?: string): Record<string, unknown> {
    const body: Record<string, unknown> = { content, allowed_mentions: { parse: [] } };
    if (username && username.trim() !== "") body.username = username.trim().slice(0, 80);
    if (avatarUrl && /^https:\/\//.test(avatarUrl)) body.avatar_url = avatarUrl;
    return body;
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "webhook",
            description: "Send a message through a webhook address",
            options: [
                { name: "url", description: "The webhook address", required: true },
                { name: "message", description: "What to send", required: true },
                { name: "username", description: "A name to show instead of the webhook's own" },
                { name: "avatar", description: "An https picture address to show instead of the webhook's own" }
            ],
            async execute(args) {
                const value = (name: string) => String(args.find(arg => arg.name === name)?.value ?? "");
                if (!isWebhookUrl(value("url"))) { ctx.toasts.show("That is not a Discord webhook address.", "failure"); return; }
                if (value("message").trim() === "") { ctx.toasts.show("Write a message to send.", "failure"); return; }
                try {
                    const response = await fetch(`${value("url")}?wait=false`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(webhookBody(value("message"), value("username"), value("avatar"))) });
                    ctx.toasts.show(response.ok ? "Sent through the webhook." : `The webhook answered ${response.status}.`, response.ok ? "success" : "failure");
                } catch (error) {
                    ctx.reportError("WebhookSend", error);
                    ctx.toasts.show("Could not reach the webhook.", "failure");
                }
            }
        });
    }
};

export default plugin;
