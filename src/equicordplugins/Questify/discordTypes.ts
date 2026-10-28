/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export enum QuestTaskType {
    STREAM_ON_DESKTOP = "STREAM_ON_DESKTOP",
    PLAY_ON_DESKTOP = "PLAY_ON_DESKTOP",
    // No aparece en los scripts iniciales del build 647615; valor tomado de Equicord, sin verificar.
    PLAY_ON_DESKTOP_V2 = "PLAY_ON_DESKTOP_V2",
    PLAY_ON_XBOX = "PLAY_ON_XBOX",
    PLAY_ON_PLAYSTATION = "PLAY_ON_PLAYSTATION",
    WATCH_VIDEO = "WATCH_VIDEO",
    WATCH_VIDEO_ON_MOBILE = "WATCH_VIDEO_ON_MOBILE",
    PLAY_ACTIVITY = "PLAY_ACTIVITY",
    ACHIEVEMENT_IN_GAME = "ACHIEVEMENT_IN_GAME",
    ACHIEVEMENT_IN_ACTIVITY = "ACHIEVEMENT_IN_ACTIVITY"
}

export enum QuestRewardType {
    REWARD_CODE = 1,
    IN_GAME = 2,
    COLLECTIBLE = 3,
    VIRTUAL_CURRENCY = 4,
    FRACTIONAL_PREMIUM = 5
}

export enum QuestTargetedContent {
    QUEST_HOME_DESKTOP = "quest_home_desktop"
}

export type QuestProgressMap = Partial<Record<QuestTaskType, { value: number; }>>;

export interface QuestUserStatus {
    questId: string;
    enrolledAt?: string | null;
    completedAt?: string | null;
    claimedAt?: string | null;
    progress?: QuestProgressMap | null;
}

export interface QuestTaskWatchVideo {
    type: QuestTaskType;
    target: number;
    applications?: { id: string; }[];
}

export type QuestTaskWatchVideoOnMobile = QuestTaskWatchVideo;

export interface QuestRewardConfig {
    type: QuestRewardType;
}

export interface Quest {
    id: string;
    config: {
        startsAt: string;
        expiresAt: string;
        messages: { questName: string; };
        ctaConfig?: unknown;
        rewardsConfig: { rewards: QuestRewardConfig[]; };
        taskConfigV2: { tasks: Partial<Record<QuestTaskType, QuestTaskWatchVideo>>; };
    };
    userStatus: QuestUserStatus | null;
}
