/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { FluxStore } from "./amiricord/discordTypes";
import { findStoreLazy } from "./amiricord/webpack";
import type { Quest } from "./discordTypes";

export const QuestStore = findStoreLazy("QuestStore") as unknown as FluxStore & {
    readonly quests: Map<string, Quest>;
    readonly excludedQuests: Map<string, Quest>;
    readonly claimedQuests: Map<string, Quest>;
    getQuest(questId: string): Quest | undefined;
};
