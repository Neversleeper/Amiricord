/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Badges on profiles, drawn only for people who run Amiricord. Three kinds, written for Amiricord after reading how TestCord does it (docs/analysis-03-badges.md):
//  - "Amiricord Owner" for the owners (their ids are in `src/shared/project.ts`);
//  - the badges the owners put in `badges/badges.json` of the repository, read through the main process (`native.ts`) at start and every 30 minutes, managed with `pnpm badges`;
//  - "Amiricord User" for everyone who runs Amiricord: each one tells the project's registry (a Cloudflare Worker, `worker/`) the id of its account, and every Amiricord reads the list of ids from it. Until a person is in that list a profile still gets the badge if its pronouns end with Amiricord's invisible mark, which this plugin also writes to your own profile. It is a core plugin with no switch: the owners decided (2026-10-29) that it is how people who use Amiricord are recognised.
// Discord already draws any badge that has an `iconSrc`; the patch below only adds ours to the list a profile gives (`getBadges`, found in build 652418).
// Seen in a real Discord: the owner badge, and that the mark is written and kept. Not seen: the registry (reading it, registering) and the user badge drawn from it,
// and the download from GitHub (the repository is private until it is made public; without the list only the owner badge and the user badge show).

import { nativeOf } from "../../api/native";
import { profileBadges } from "../../api/profileBadges";
import type { PluginCode } from "../../renderer/engine";
import { OWNERS } from "../../shared/project";
import { type BadgeProfile, badgesOf, type ProfileBadge } from "./badgeLogic";
import { type RestLike, syncMarker } from "./marker";
import type * as NativeModule from "./native";
import type { LoadedList } from "./native";

export const REFRESH_MS = 30 * 60 * 1000;
/** How often the list of Amiricord users is read: it is the one that grows with the number of people, so it is read less often than the owners' list. */
export const REGISTRY_REFRESH_MS = 2 * 60 * 60 * 1000;
/** How often the mark is looked at, and the least time between two looks when the window comes to the front. */
export const CHECK_MS = 5 * 60 * 1000;
const FOCUS_GAP_MS = 60 * 1000;
const OWNER_IDS: ReadonlySet<string> = new Set(OWNERS.map(owner => owner.discordId));

let list: LoadedList | null = null;
/** The ids the registry says use Amiricord, or null until it has been read. */
let registered: ReadonlySet<string> | null = null;
let registryTimer: ReturnType<typeof setInterval> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let checkTimer: ReturnType<typeof setInterval> | undefined;
let onFocus: (() => void) | undefined;
/** Changes at every stop, so work that was still waiting knows it must not go on. */
let generation = 0;

const plugin: PluginCode & { badgesOf(profile: BadgeProfile | null | undefined): ProfileBadge[]; } = {
    patches: [
        {
            // The profile object of Discord's client; its `getBadges` is what the profile card and popout list.
            find: "getLegacyUsername(){",
            replacements: [{ match: /getBadges\(\)\{return\[/, replace: "$&...$self.badgesOf(this)," }]
        }
    ],

    /** Called by the patched Discord code for every profile it draws. */
    badgesOf(profile) {
        try {
            const own = badgesOf(profile, { owners: OWNER_IDS, list, registered, showUsers: true });
            // The badges other plugins added (`ctx.profileBadges`).
            const userId = typeof profile?.userId === "string" ? profile.userId : null;
            return userId === null ? own : [...own, ...profileBadges.forUser(userId)];
        } catch {
            return [];
        }
    },

    start(ctx) {
        const mine = ++generation;
        const native = nativeOf<typeof NativeModule>(ctx.native);
        const refresh = async () => {
            try {
                const loaded = await native.loadList();
                if (mine === generation) list = loaded;
            } catch (error) {
                // Without the list the owner and user badges still show. "Not found" is what GitHub says while the repository is private or the list is not published yet.
                if (!(error instanceof Error && error.message.includes("answered 404"))) ctx.reportError("Badges list", error);
            }
        };
        void refresh();
        timer = setInterval(() => { void refresh(); }, REFRESH_MS);

        // Everybody who runs Amiricord: the registry's list, kept with this account added so the person sees their own badge at once.
        let ownId: string | undefined;
        const refreshRegistry = async () => {
            try {
                const ids = await native.loadRegistry();
                if (mine === generation) registered = new Set(ownId ? [...ids, ownId] : ids);
            } catch (error) {
                ctx.reportError("Badges registry", error);
            }
        };
        void refreshRegistry();
        registryTimer = setInterval(() => { void refreshRegistry(); }, REGISTRY_REFRESH_MS);
        let announced = false;

        // The mark must stay: the person may edit or clear their pronouns (in Discord or on another device), so it is looked at again every few minutes and whenever
        // Discord's window comes back to the front, and written back if it is gone. Only a read happens when nothing has to change.
        let checking = false;
        let lastCheck = 0;
        const check = async (retries = 0): Promise<void> => {
            if (checking || mine !== generation) return;
            checking = true;
            lastCheck = Date.now();
            try {
                // Wait for Discord's request client and for the account to be loaded; a missing piece is said, never skipped in silence.
                const rest = await ctx.finders.byProps<RestLike>("get", "post", "put", "patch", "del", "!Request", "!getXHR").ready(30_000);
                const store = await ctx.common.UserStore.ready(30_000);
                const me = store.getCurrentUser();
                if (mine !== generation) return;
                if (!me) {
                    // The account loads a little after start.
                    if (retries < 12) setTimeout(() => { void check(retries + 1); }, 10_000);
                    return;
                }
                ownId = me.id;
                registered = new Set([...(registered ?? []), me.id]);
                // Once per start: tell the registry this account uses Amiricord. A failure is tried again at the next look.
                if (!announced) {
                    try {
                        await native.registerSelf(me.id);
                        announced = true;
                    } catch (error) {
                        ctx.reportError("Badges registry", error);
                    }
                }
                const result = await syncMarker(rest, me.id, true);
                if (result === "lost" || result === "too-long" || result === "no-patch") ctx.reportError("Badges mark", new Error(`the mark could not be kept: ${result}`));
            } catch (error) {
                // Discord's own client rejects with its answer (an object), not an Error; say what it holds.
                const answer = error as { status?: unknown; body?: unknown; } | null;
                ctx.reportError("Badges mark", error instanceof Error || typeof answer !== "object" || answer === null ? error : new Error(`rejected: status ${String(answer.status)} body ${JSON.stringify(answer.body)?.slice(0, 300)}`));
            } finally {
                checking = false;
            }
        };
        checkTimer = setInterval(() => { void check(); }, CHECK_MS);
        onFocus = () => { if (Date.now() - lastCheck > FOCUS_GAP_MS) void check(); };
        window.addEventListener("focus", onFocus);
        // The person's own account may not be loaded yet when the plugin starts, so the first look waits a little.
        setTimeout(() => { void check(); }, 5000);
    },

    stop() {
        generation++;
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
        if (registryTimer !== undefined) clearInterval(registryTimer);
        registryTimer = undefined;
        registered = null;
        if (checkTimer !== undefined) clearInterval(checkTimer);
        checkTimer = undefined;
        if (onFocus) window.removeEventListener("focus", onFocus);
        onFocus = undefined;
        list = null;
    }
};

export default plugin;
