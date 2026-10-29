/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin ValidUser (authors Ven and Dolfies) as found in TestCord's copy of Vencord's plugins. The two patches are the original's.
// What it does: a mention of a person Discord has not loaded shows as "@unknown-user"; hovering it asks Discord for that person (through Discord's own REST object, so the
// request goes to Discord like any other) and the mention turns into a normal one. Differences: Discord's `Constants.UserFlags` and `Endpoints` are not used (the flag
// numbers and the path `/users/<id>` are written here), the wait queue is a simple one-at-a-time list with a 300 ms pause, and a failed request is dropped (a rate limit
// is retried after the time Discord gives). NOT checked on a live page: the first anchor on the current build, and the fake profile badges.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

interface ProfileBadge { id: string; description: string; icon: string; link?: string; }

// Discord's public user flag bits, and the badge each one shows.
const FLAG_BADGES: Array<[number, ProfileBadge]> = [
    [1 << 22, { id: "active_developer", description: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9", link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447" }],
    [1 << 3, { id: "bug_hunter_level_1", description: "Discord Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" }],
    [1 << 14, { id: "bug_hunter_level_2", description: "Discord Bug Hunter", icon: "848f79194d4be5ff5f81505cbd0ce1e6", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" }],
    [1 << 18, { id: "certified_moderator", description: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b", link: "https://discord.com/safety" }],
    [1 << 0, { id: "staff", description: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d", link: "https://discord.com/company" }],
    [1 << 2, { id: "hypesquad", description: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264", link: "https://discord.com/hypesquad" }],
    [1 << 6, { id: "hypesquad_house_1", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02", link: "https://discord.com/settings/hypesquad-online" }],
    [1 << 7, { id: "hypesquad_house_2", description: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618", link: "https://discord.com/settings/hypesquad-online" }],
    [1 << 8, { id: "hypesquad_house_3", description: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e", link: "https://discord.com/settings/hypesquad-online" }],
    [1 << 1, { id: "partner", description: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e", link: "https://discord.com/partners" }],
    [1 << 9, { id: "early_supporter", description: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358", link: "https://discord.com/settings/premium" }],
    [1 << 17, { id: "verified_developer", description: "Early Verified Bot Developer", icon: "6df5892e0f35b051f8b61eace34f4967" }]
];
const PREMIUM_BADGE: ProfileBadge = { id: "premium", description: "Subscriber", icon: "2ba85e8026a8614b640c2837bcdfe21b", link: "https://discord.com/settings/premium" };

let context: EnginePluginContext | undefined;
let users: Lazy;
let profiles: Lazy;
let dispatcher: Lazy;
let rest: Lazy;

const fetching = new Set<string>();
const waiting: Array<() => Promise<void>> = [];
let working = false;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Runs the jobs one at a time with a short pause between them, so a long chat does not make a burst of requests. */
async function drain(): Promise<void> {
    if (working) return;
    working = true;
    try {
        for (let job = waiting.shift(); job; job = waiting.shift()) {
            try {
                await job();
            } catch {
                // a failed job is dropped
            }
            await sleep(300);
        }
    } finally {
        working = false;
    }
}

async function loadUser(id: string): Promise<void> {
    if (users?.get()?.getUser?.(id)) return;
    const response = await rest?.get()?.get?.({ url: `/users/${id}` });
    const user = response?.body;
    if (!user) throw new Error("no user came back");
    dispatcher?.get()?.dispatch({ type: "USER_UPDATE", user });
    // Makes Discord create the (empty) profile so there is one to fill in.
    dispatcher?.get()?.dispatch({ type: "USER_PROFILE_FETCH_FAILURE", userId: id });

    const known = users?.get()?.getUser?.(id);
    const flags = Number(known?.publicFlags ?? user.public_flags ?? 0);
    const badges = FLAG_BADGES.filter(([bit]) => (flags & bit) !== 0).map(([, badge]) => badge);
    if (user.premium_type || (!user.bot && (user.banner || (typeof user.avatar === "string" && user.avatar.startsWith("a_"))))) badges.push(PREMIUM_BADGE);
    const profile = profiles?.get()?.getUserProfile?.(id);
    if (profile) {
        profile.accentColor = user.accent_color;
        profile.badges = badges;
        profile.banner = user.banner;
        profile.premiumType = user.premium_type;
    }
}

function MentionWrapper({ data, UserMention, RoleMention, parse, props }: any): unknown {
    const react = currentReact() as any;
    const [userId, setUserId] = react.useState(data.userId) as [string | undefined, (id: string) => void];

    // A person Discord has loaded comes with their id; one it has not loaded has none.
    if (userId) {
        return react.createElement(UserMention, { className: "mention", userId, channelId: data.channelId, inlinePreview: props.noStyleAndInteraction, props, key: props.key });
    }

    const children = parse(data.content, props);
    const onMouseEnter = () => {
        const mention = children?.[0]?.props?.children;
        if (typeof mention !== "string") return;
        const id = mention.match(/<@!?(\d+)>/)?.[1];
        if (!id || fetching.has(id)) return;
        if (users?.get()?.getUser?.(id)) { setUserId(id); return; }
        const request = () => {
            fetching.add(id);
            waiting.unshift(async () => {
                try {
                    await loadUser(id);
                    setUserId(id);
                } catch (error: any) {
                    // Discord says how long to wait when it is asking for less.
                    if (error?.status === 429) {
                        const seconds = Number(error?.body?.retry_after);
                        waiting.unshift(() => sleep((Number.isFinite(seconds) ? seconds : 1) * 1000).then(request));
                    }
                } finally {
                    fetching.delete(id);
                }
            });
            void drain();
        };
        request();
    };
    return react.createElement(RoleMention, { ...data, props, inlinePreview: props.formatInline }, react.createElement("span", { onMouseEnter }, children));
}

const plugin: PluginCode & { renderMention(RoleMention: unknown, UserMention: unknown, data: any, parse: unknown, props: any): unknown; } = {
    patches: [
        {
            find: 'className:"mention"',
            lazy: true,
            replacements: [{
                // mention = { react(data, parse, props) { if (data.userId == null) return RoleMention() else return UserMention()
                match: /react(?=\(\i,\i,\i\).{0,100}return null==.{0,70}\?\(0,\i\.jsx\)\((\i\.\i),.+?jsx\)\((\i\.\i),\{className:"mention")/,
                replace: "react:(...args)=>$self.renderMention($1,$2,...args),originalReact"
            }]
        },
        {
            find: "unknownUserMentionPlaceholder:",
            lazy: true,
            required: false,
            replacements: [{ match: /unknownUserMentionPlaceholder:/, replace: "$&false&&" }]
        }
    ],

    start(ctx) {
        context = ctx;
        users = ctx.common.UserStore;
        profiles = ctx.finders.byStore("UserProfileStore");
        dispatcher = ctx.common.FluxDispatcher;
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
    },

    stop() {
        context = users = profiles = dispatcher = rest = undefined;
        waiting.length = 0;
        fetching.clear();
    },

    renderMention(RoleMention, UserMention, data, parse, props) {
        const react = currentReact() as any;
        try {
            return react.createElement(MentionWrapper, { key: `mention${data.userId}`, RoleMention, UserMention, data, parse, props });
        } catch (error) {
            context?.reportError("ValidUser", error);
            return null;
        }
    }
};

export default plugin;
