/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The single place that holds the project name. Rename here only. */
export const PROJECT_NAME = "Amiricord";

/** Folder name used under %APPDATA% for settings and data. */
export const DATA_DIR_NAME = PROJECT_NAME;

export interface Owner {
    name: string;
    github: string;
    discordId: string;
}

/** The version shown in the settings page. It must equal the `version` of package.json (a test checks it). */
export const PROJECT_VERSION = "0.7.1";

/** The GitHub repository whose releases the updater reads (`owner/name`). It must be public for other people to be able to update. */
export const UPDATE_REPO = "Neversleeper/Amiricord";

/** Plugins whose card is drawn in the Plugins tab only for the owners (by Discord id). They work for everybody; only the card is hidden. The Privacy & Security tab still lists them. */
export const OWNER_ONLY_PLUGINS: readonly string[] = ["Badges", "NoDevtoolsWarning"];

export const OWNERS: readonly Owner[] = [
    {
        name: "szlcx404",
        github: "szlcx404",
        discordId: "1554284154009682032"
    },
    {
        name: "Neversleeper",
        github: "Neversleeper",
        discordId: "1564847328794382408"
    }
];

/** The registry of people who use Amiricord (a Cloudflare Worker, `worker/`): every Amiricord tells it the id of its account once, and reads the list of ids from it. */
export const REGISTRY_HOST = "amiricord-registry.amiricord.workers.dev";
export const REGISTRY_URL = `https://${REGISTRY_HOST}`;
