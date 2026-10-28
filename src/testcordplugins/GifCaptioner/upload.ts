/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// Sends the finished GIF as a message in the conversation that is open: Discord's own uploader sends the file, then Discord's own "send message" posts it, the same
// two steps its attach button takes. NOT verified against a real Discord (the names of its uploader and its send function are found by their code and properties).
// Differences: for a forum channel only the thread named in the address is used (the original also asked Discord's channel store for the last thread opened).

import type { Status } from "./status";

export const WAIT_FOR_MESSAGE_MS = 15_000;

export interface ChannelLike {
    id?: string;
    parent_id?: string | null;
    isForumChannel?(): boolean;
    isThread?(): boolean;
    isForumPost?(): boolean;
}

export interface UploadLike {
    on(event: "complete" | "error", listener: () => void): unknown;
    upload(): void;
}

export interface MessageLike {
    channel_id?: string;
    author?: { id?: string; };
    attachments?: Array<{ filename?: string; size?: number; }>;
}

export interface UploadDeps {
    selectedChannelId(): string | undefined;
    channel(id: string): ChannelLike | undefined;
    /** The path of the page's address, to find the thread of a forum post. */
    pathname(): string;
    currentUserId(): string | undefined;
    /** Discord's uploader for this file and this conversation. */
    makeUpload(file: File, channelId: string): UploadLike;
    /** Discord's "send message" with the uploaded file attached. Gives back whatever Discord gives (a promise, usually). */
    send(channelId: string, upload: UploadLike): unknown;
    onMessageCreate(listener: (data: { message?: MessageLike; }) => void): () => void;
    setTimer(run: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    status: Status;
}

/** The conversation the GIF goes to: the open one, or the thread of the open forum post. Undefined when there is none. */
export function resolveUploadChannelId(deps: Pick<UploadDeps, "selectedChannelId" | "channel" | "pathname">): string | undefined {
    const selected = deps.selectedChannelId();
    if (!selected) return undefined;
    const channel = deps.channel(selected);
    if (!channel || !channel.isForumChannel?.()) return selected;
    const path = deps.pathname();
    const candidates = [path.match(/\/threads\/(\d+)/)?.[1], path.match(/\/channels\/[^/]+\/([^/]+)/)?.[1]];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const thread = deps.channel(candidate);
        if (thread && thread.parent_id === selected && (thread.isThread?.() || thread.isForumPost?.())) return candidate;
    }
    return undefined;
}

export function hasMatchingAttachment(message: MessageLike, file: { name: string; size: number; }): boolean {
    return Array.isArray(message.attachments) && message.attachments.some(attachment => attachment?.filename === file.name || attachment?.size === file.size);
}

export function uploadFile(deps: UploadDeps, file: File): void {
    const selected = deps.selectedChannelId();
    const channelId = resolveUploadChannelId(deps);
    if (!channelId) {
        const base = selected ? deps.channel(selected) : undefined;
        deps.status.error(base?.isForumChannel?.() ? "Open a forum post to send a message." : "No channel selected.");
        return;
    }

    const upload = deps.makeUpload(file, channelId);
    upload.on("complete", () => {
        let timer: unknown;
        let stop: (() => void) | undefined;
        const cleanup = () => {
            if (timer !== undefined) deps.clearTimer(timer);
            timer = undefined;
            stop?.();
            stop = undefined;
        };
        const me = deps.currentUserId();
        stop = deps.onMessageCreate(({ message }) => {
            if (!message || message.channel_id !== channelId) return;
            if (me && message.author?.id !== me) return;
            if (!hasMatchingAttachment(message, file)) return;
            deps.status.sent();
            cleanup();
        });
        timer = deps.setTimer(cleanup, WAIT_FOR_MESSAGE_MS);

        const result = deps.send(channelId, upload);
        if (result && typeof (result as Promise<unknown>).then === "function") {
            void (result as Promise<unknown>).catch(() => { deps.status.error("Failed to send message."); });
        }
    });
    upload.on("error", () => { deps.status.error("Failed to upload GIF."); });
    deps.status.uploading();
    upload.upload();
}
