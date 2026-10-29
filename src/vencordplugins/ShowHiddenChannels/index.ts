/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and channels have no types */

// Adapted for Amiricord (2026) from the plugin ShowHiddenChannels (authors BigDuck, AverageReactEnjoyer, D3SOX, Ven, Nuckyz, Nickyux and Rini, with Oggetto's changes) as found
// in TestCord's copy of the plugin. It shows the channels you cannot see, with a lock or an eye, and opens a page that says what Discord tells about the channel instead of
// its messages. The patches are the original's (the text predicates are the settings, read when the plugin is loaded, so changing them needs a restart as before; the
// replacements that were functions are written as replacement strings). Checked on build 653945 with the module search: the patches on the channel list (render levels),
// voice channel clicks, the channel icon, the message loader, the keyboard jump, the allowed users overflow, the channel search, mentions and the channel store match
// once; the ones on the channel header, the unreads box, the role list, the voice and stage screens and the muted style are in code Discord loads later and are NOT known
// to match, so every patch is lazy and optional: one that does not match only takes away its part, it does not stop the others. Differences:
//  - the page for a hidden channel is drawn with plain React elements; it lists the facts Discord gives (topic, last message, pin, slow mode, voice settings, forum
//    defaults, tags, allowed users and roles, with the same JSON export), but not Discord's emoji picture or tag chips (the names are shown as text), the logo is a drawn
//    lock, and the "permission details" button needs a plugin Amiricord does not have;
//  - the lock icon on the right and the eye icon have the browser's own tooltip (`title`);
//  - the list of allowed users and roles is Discord's own component (`ChannelBeginHeader`), found through the patch on the role window; without it the list is not shown;
//  - the channel permission checks write the bits as numbers, and the original's call into Vencord's global is replaced by `canConnect`.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

type Lazy = { get(): any; } | undefined;

const isSet = (value: unknown): boolean => value !== undefined && value !== null;

const LOCK_ICON = 0;
const LOCK_ICON_RIGHT = 1;
const EYE_ICON_RIGHT = 2;
const STYLE_CLASSIC = 0;
const STYLE_MUTED = 1;
const STYLE_UNREAD = 2;
const STYLE_MUTED_UNREAD = 3;

const VIEW_CHANNEL = BigInt(1) << BigInt(10);
const CONNECT = BigInt(1) << BigInt(20);
const DISCORD_EPOCH = BigInt(1420070400000);

const settings = definePluginSettings({
    channelStyle: {
        type: "select",
        default: STYLE_CLASSIC,
        description: "The style used to display hidden channels.",
        restartNeeded: true,
        options: [
            { label: "Classic", value: STYLE_CLASSIC },
            { label: "Muted", value: STYLE_MUTED },
            { label: "Show Unreads", value: STYLE_UNREAD },
            { label: "Muted and Show Unreads", value: STYLE_MUTED_UNREAD }
        ]
    },
    showMode: {
        type: "select",
        default: LOCK_ICON,
        description: "The mode used to display hidden channels.",
        restartNeeded: true,
        options: [
            { label: "Lock Icon replacing channel icon", value: LOCK_ICON },
            { label: "Eye icon on the right", value: EYE_ICON_RIGHT },
            { label: "Lock icon on the right", value: LOCK_ICON_RIGHT }
        ]
    },
    defaultAllowedUsersAndRolesDropdownState: { type: "boolean", default: true, description: "Whether the allowed users and roles dropdown on hidden channels should be open by default" }
} as const);

const CSS = `
.ac-shc-container { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 0.65em; margin: 0.5em 0; min-height: 100%; color: var(--text-default); }
.ac-shc-logo { width: 8em; height: 8em; color: var(--text-muted); }
.ac-shc-heading-container { display: flex; flex-direction: row; align-items: center; gap: 0.5em; font-size: 24px; font-weight: 700; }
.ac-shc-topic-container { color: var(--text-default); background: var(--background-base-lower); border-radius: 5px; padding: 10px; max-width: 70vw; white-space: pre-wrap; }
.ac-shc-tags-container { display: flex; flex-direction: column; background: var(--background-base-lower); border-radius: 5px; padding: 0.75em; gap: 0.75em; max-width: 70vw; }
.ac-shc-tags { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.35em; }
.ac-shc-tag { padding: 2px 8px; border-radius: 8px; background: var(--background-base-lowest); }
.ac-shc-allowed-users-and-roles-container { display: flex; flex-direction: column; align-items: center; background: var(--background-base-lower); border-radius: 5px; padding: 0.75em; max-width: 70vw; }
.ac-shc-allowed-users-and-roles-container-title { display: flex; flex-direction: row; align-items: center; gap: 0.5em; font-size: 16px; font-weight: 700; }
.ac-shc-button { all: unset; cursor: pointer; display: flex; align-items: center; color: var(--text-default); }
.ac-shc-allowed-users-and-roles-container > [class*="members"] { margin-left: 12px; flex-wrap: wrap; justify-content: center; }
.ac-shc-hidden-channel-icon { cursor: not-allowed; margin-left: 6px; z-index: 0; }
.ac-shc-channel-list-icon { fill: var(--channel-icon); }
`;

const LOCK_PATH = "M17 11V7C17 4.243 14.756 2 12 2C9.242 2 7 4.243 7 7V11C5.897 11 5 11.896 5 13V20C5 21.103 5.897 22 7 22H17C18.103 22 19 21.103 19 20V13C19 11.896 18.103 11 17 11ZM12 18C11.172 18 10.5 17.328 10.5 16.5C10.5 15.672 11.172 15 12 15C12.828 15 13.5 15.672 13.5 16.5C13.5 17.328 12.828 18 12 18ZM15 11H9V7C9 5.346 10.346 4 12 4C13.654 4 15 5.346 15 7V11Z";
const EYE_PATH = "m19.8 22.6-4.2-4.15q-.875.275-1.762.413Q12.95 19 12 19q-3.775 0-6.725-2.087Q2.325 14.825 1 11.5q.525-1.325 1.325-2.463Q3.125 7.9 4.15 7L1.4 4.2l1.4-1.4 18.4 18.4ZM12 16q.275 0 .512-.025.238-.025.513-.1l-5.4-5.4q-.075.275-.1.513-.025.237-.025.512 0 1.875 1.312 3.188Q10.125 16 12 16Zm7.3.45-3.175-3.15q.175-.425.275-.862.1-.438.1-.938 0-1.875-1.312-3.188Q13.875 7 12 7q-.5 0-.938.1-.437.1-.862.3L7.65 4.85q1.025-.425 2.1-.638Q10.825 4 12 4q3.775 0 6.725 2.087Q21.675 8.175 23 11.5q-.575 1.475-1.512 2.738Q20.55 15.5 19.3 16.45Zm-4.625-4.6-3-3q.7-.125 1.288.112.587.238 1.012.688.425.45.613 1.038.187.587.087 1.162Z";
const DOWNLOAD_PATH = "M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-3.99a1 1 0 0 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z";
const CHEVRON_PATH = "M16.59 8.59003L12 13.17L7.41 8.59003L6 10L12 16L18 10L16.59 8.59003Z";

const CHANNEL_TYPE_NAMES: Record<number, string> = { 0: "text", 5: "announcement", 15: "forum", 2: "voice", 13: "stage" };
const SORT_ORDERS: Record<number, string> = { 0: "Latest activity", 1: "Creation date" };
const FORUM_LAYOUTS: Record<number, string> = { 0: "Not set", 1: "List view", 2: "Gallery view" };
const VIDEO_QUALITIES: Record<number, string> = { 1: "Automatic", 2: "720p" };

let context: EnginePluginContext | undefined;
let styled = false;
let channels: Lazy;
let permissions: Lazy;
let guilds: Lazy;
let members: Lazy;
let users: Lazy;
let roles: Lazy;
let dispatcher: Lazy;
let ChannelBeginHeader: any;

function ensureStyle(): void {
    if (styled || !context) return;
    styled = true;
    context.addStyle(CSS, "show-hidden-channels");
}

function isUncategorized(item: { channel: any; comparator: number; }): boolean {
    return item.channel.id === "null" && item.channel.name === "Uncategorized" && item.comparator === -1;
}

function duration(amount: number, unit: "seconds" | "minutes"): string {
    let seconds = unit === "minutes" ? amount * 60 : amount;
    const parts: string[] = [];
    for (const [name, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
        const count = Math.floor(seconds / size);
        if (count > 0) parts.push(`${count}${name}`);
        seconds -= count * size;
    }
    return parts.join(" ") || "0s";
}

const timeOf = (snowflake: string): string => new Date(Number((BigInt(snowflake) >> BigInt(22)) + DISCORD_EPOCH)).toLocaleString();

/** The allowed users and roles of a hidden channel as a JSON file. */
function downloadChannelAccessExport(channel: any): void {
    const guild = guilds?.get()?.getGuild?.(channel.guild_id);
    if (!guild) {
        context?.toasts.show("Failed to export channel access: missing guild data.", "failure");
        return;
    }
    const overwrites: any[] = Object.values(channel.permissionOverwrites ?? {});
    const allowedUsers = new Set<string>();
    const allowedRoles = new Set<string>();
    for (const overwrite of overwrites) {
        if ((BigInt(overwrite.allow) & VIEW_CHANNEL) !== VIEW_CHANNEL) continue;
        if (overwrite.type === 1) allowedUsers.add(overwrite.id);
        else if (overwrite.type === 0 && overwrite.id !== guild.id) allowedRoles.add(overwrite.id);
    }
    const everyone: Array<{ member: any; user: any; }> = [];
    for (const id of members?.get()?.getMemberIds?.(guild.id) ?? []) {
        const member = members?.get()?.getMember?.(guild.id, id);
        const user = users?.get()?.getUser?.(id);
        if (member && user) everyone.push({ member, user });
    }
    const person = (user: any, member?: any) => ({
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        displayName: user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username,
        nickname: member?.nick ?? null,
        bot: user.bot ?? false
    });
    const direct = [...allowedUsers].map(id => {
        const user = users?.get()?.getUser?.(id);
        return user ? person(user, members?.get()?.getMember?.(guild.id, id)) : null;
    }).filter(Boolean) as Array<ReturnType<typeof person>>;
    const rolesOut = [...allowedRoles].map(id => {
        const role = roles?.get()?.getRole?.(guild.id, id);
        if (!role) return null;
        return {
            id: role.id, name: role.name, color: role.color, colorString: role.colorString ?? null, position: role.position,
            members: everyone.filter(({ member }) => member.roles.includes(id)).map(({ member, user }) => person(user, member))
        };
    }).filter(Boolean) as Array<{ members: Array<ReturnType<typeof person>>; }>;
    const effective = new Map<string, ReturnType<typeof person>>();
    for (const entry of direct) effective.set(entry.id, entry);
    for (const role of rolesOut) for (const entry of role.members) effective.set(entry.id, entry);

    const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        guild: { id: guild.id, name: guild.name },
        channel: { id: channel.id, name: channel.name, type: channel.type },
        allowedUsers: [...effective.values()],
        directAllowedUsers: direct,
        allowedRoles: rolesOut
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    const safeName = (channel.name || channel.id).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || channel.id;
    link.href = url;
    link.download = `hidden-channel-access-${safeName}-${channel.id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Let go of the file only after the download has had time to start.
    setTimeout(() => { URL.revokeObjectURL(url); }, 10000);
    context?.toasts.show("Exported hidden channel access to JSON.", "success");
}

function LockScreen({ channel }: { channel: any; }): unknown {
    ensureStyle();
    const react = currentReact() as any;
    const h = react.createElement;
    const [open, setOpen] = react.useState(settings.store.defaultAllowedUsersAndRolesDropdownState) as [boolean, (value: boolean) => void];

    react.useEffect(() => {
        // Asks Discord for the owner and the people named in the channel's permissions, so their names can be shown.
        const missing = new Set<string>();
        const owner = guilds?.get()?.getGuild?.(channel.guild_id)?.ownerId;
        if (owner && !members?.get()?.getMember?.(channel.guild_id, owner)) missing.add(owner);
        for (const overwrite of Object.values<any>(channel.permissionOverwrites ?? {})) {
            if (overwrite.type === 1 && !members?.get()?.getMember?.(channel.guild_id, overwrite.id)) missing.add(overwrite.id);
        }
        if (missing.size > 0) dispatcher?.get()?.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [channel.guild_id], userIds: [...missing] });
    }, [channel.id]);

    const voice = channel.type === 2 || channel.type === 13;
    const forum = channel.type === 15;
    const line = (text: string) => h("div", { key: text }, text);
    const hidden = !permissions?.get()?.can?.(VIEW_CHANNEL, channel);
    const topic: string = channel.topic ?? "";
    const lines: unknown[] = [];
    if (!voice) lines.push(line(`You can not see the ${forum ? "posts" : "messages"} of this channel.${forum && topic ? " However you may see its guidelines:" : ""}`));
    if (forum && topic) lines.push(h("div", { className: "ac-shc-topic-container", key: "topic" }, topic));
    if (channel.lastMessageId) lines.push(line(`Last ${forum ? "post" : "message"} created: ${timeOf(channel.lastMessageId)}`));
    if (channel.lastPinTimestamp) lines.push(line(`Last message pin: ${new Date(channel.lastPinTimestamp).toLocaleString()}`));
    if ((channel.rateLimitPerUser ?? 0) > 0) lines.push(line(`Slowmode: ${duration(channel.rateLimitPerUser, "seconds")}`));
    if ((channel.defaultThreadRateLimitPerUser ?? 0) > 0) lines.push(line(`Default thread slowmode: ${duration(channel.defaultThreadRateLimitPerUser, "seconds")}`));
    if (voice && isSet(channel.bitrate)) lines.push(line(`Bitrate: ${channel.bitrate} bits`));
    if (channel.rtcRegion !== undefined) lines.push(line(`Region: ${channel.rtcRegion ?? "Automatic"}`));
    if (voice) lines.push(line(`Video quality mode: ${VIDEO_QUALITIES[channel.videoQualityMode ?? 1]}`));
    if ((channel.defaultAutoArchiveDuration ?? 0) > 0) lines.push(line(`Default inactivity duration before archiving ${forum ? "posts" : "threads"}: ${duration(channel.defaultAutoArchiveDuration, "minutes")}`));
    if (isSet(channel.defaultForumLayout)) lines.push(line(`Default layout: ${FORUM_LAYOUTS[channel.defaultForumLayout]}`));
    if (isSet(channel.defaultSortOrder)) lines.push(line(`Default sort order: ${SORT_ORDERS[channel.defaultSortOrder]}`));
    if (isSet(channel.defaultReactionEmoji)) lines.push(line(`Default reaction emoji: ${channel.defaultReactionEmoji.emojiName ?? "a custom emoji"}`));
    if (channel.hasFlag?.(1 << 4)) lines.push(line("Posts on this forum require a tag to be set."));
    if (channel.availableTags?.length > 0) {
        lines.push(h("div", { className: "ac-shc-tags-container", key: "tags" },
            h("strong", null, "Available tags:"),
            h("div", { className: "ac-shc-tags" }, channel.availableTags.map((tag: any) => h("span", { className: "ac-shc-tag", key: tag.id }, `${tag.emojiName ?? ""} ${tag.name}`.trim())))));
    }

    const icon = (path: string, extra?: Record<string, unknown>) => h("svg", { width: 24, height: 24, viewBox: "0 0 24 24", ...extra }, h("path", { fill: "currentColor", d: path }));
    return h("div", { className: "ac-shc-container" },
        h("svg", { className: "ac-shc-logo", viewBox: "0 0 24 24" }, h("path", { fill: "currentColor", d: LOCK_PATH })),
        h("div", { className: "ac-shc-heading-container" },
            `This is a ${hidden ? "hidden" : "locked"} ${CHANNEL_TYPE_NAMES[channel.type] ?? ""} channel`,
            channel.isNSFW?.() ? h("span", { title: "NSFW" }, icon("M.7 43.05 24 2.85l23.3 40.2Zm23.55-6.25q.75 0 1.275-.525.525-.525.525-1.275 0-.75-.525-1.3t-1.275-.55q-.8 0-1.325.55-.525.55-.525 1.3t.55 1.275q.55.525 1.3.525Zm-1.85-6.1h3.65V19.4H22.4Z", { viewBox: "0 0 48 48", width: 32, height: 32 })) : null),
        ...lines,
        h("div", { className: "ac-shc-allowed-users-and-roles-container" },
            h("div", { className: "ac-shc-allowed-users-and-roles-container-title" },
                h("button", { className: "ac-shc-button", type: "button", title: "Export Allowed Users and Roles as JSON", onClick: () => downloadChannelAccessExport(channel) }, icon(DOWNLOAD_PATH)),
                "Allowed users and roles:",
                h("button", {
                    className: "ac-shc-button", type: "button", title: open ? "Hide Allowed Users and Roles" : "View Allowed Users and Roles",
                    onClick: () => { settings.store.defaultAllowedUsersAndRolesDropdownState = !open; setOpen(!open); }
                }, icon(CHEVRON_PATH, { transform: open ? "scale(1 -1)" : "scale(1 1)" }))),
            open && ChannelBeginHeader ? h(ChannelBeginHeader, { channel }) : null));
}

const plugin: PluginCode & {
    ChannelBeginHeader: unknown;
    swapViewChannelWithConnectPermission(merged: bigint, channel: any): bigint;
    canConnect(channel: any): boolean;
    isHiddenChannel(channel: any, checkConnect?: boolean): boolean;
    resolveGuildChannels(channelMap: Record<string | number, unknown>, shouldIncludeHidden: boolean): unknown;
    makeAllowedRolesReduce(guildId: string): unknown[];
    HiddenChannelLockScreen(channel: any): unknown;
    LockIcon(): unknown;
    EyeRightIcon(): unknown;
    LockRightIcon(): unknown;
} = {
    settings,

    get patches(): PatchDefinition[] {
        const lazy = { lazy: true, required: false } as const;
        const hide = "!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)";
        const patches: PatchDefinition[] = [
            {
                // RenderLevel defines if a channel is hidden, collapsed in category, visible, etc.
                find: "\"placeholder-channel-id\"", ...lazy,
                replacements: [
                    { match: /if\(!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL.+?{if\(this\.id===\i\).+?threadIds:\[\]}}/, replace: "" },
                    { match: /(?<=&&)(?=!\i\.\i\.hasUnread\(this\.record\.id\))/, replace: "$self.isHiddenChannel(this.record)||" },
                    { match: /(this\.record\)\?{renderLevel:(.+?),threadIds.+?renderLevel:).+?(?=,threadIds)/g, replace: "$1$2" },
                    { match: /(getRenderLevel\(\i\){.+?return)!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,this\.record\)\|\|/, replace: "$1 " }
                ]
            },
            {
                find: "VoiceChannel, transitionTo: Channel does not have a guildId", ...lazy,
                replacements: [
                    // No question about leaving the call you are in when you click a hidden voice channel.
                    { match: /(?<=getIgnoredUsersForVoiceChannel\((\i)\.id\)[^;]{0,300}?;return\()/, replace: "!$self.isHiddenChannel($1)&&" },
                    // Discord must not try to connect to a hidden voice channel.
                    { match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/, replace: "||$self.isHiddenChannel($1)" },
                    { match: /!__OVERLAY__&&\((?<=selectVoiceChannel\((\i)\.id\).+?)/, replace: "$&$self.isHiddenChannel($1,true)||" }
                ]
            },
            { find: ".AUDIENCE),{isSubscriptionGated", ...lazy, replacements: [{ match: /(\i)\.isRoleSubscriptionTemplatePreviewChannel\(\)/, replace: "$&||$self.isHiddenChannel($1)" }] },
            {
                find: "tutorialId:\"instant-invite\"", ...lazy,
                replacements: ["renderEditButton", "renderInviteButton"].map(name => ({ match: new RegExp(`(?<=${name}\\(\\){)`, "g"), replace: "if($self.isHiddenChannel(this?.props?.channel))return null;" }))
            },
            { find: "VoiceChannel.renderPopout: There must always be something to render", all: true, ...lazy, replacements: [{ match: /(?<=renderOpenChatButton(?:",|=)\(\)=>{)/, replace: "if($self.isHiddenChannel(this?.props?.channel))return null;" }] }
        ];
        if (settings.store.showMode === LOCK_ICON) {
            // 'IzZTIe' is the hash of the key CHANNEL_TOOLTIP_DIRECTORY.
            patches.push({ find: ".t.IzZTIe", ...lazy, replacements: [{ match: /(?<=(\i)\.isNSFW\(\);)switch\(\i\.type\).{0,15}\.GUILD_ANNOUNCEMENT/, replace: "if($self.isHiddenChannel($1))return $self.LockIcon;$&" }] });
        } else {
            patches.push({
                find: "UNREAD_IMPORTANT:", ...lazy,
                replacements: [{ match: /\.Children\.count.+?:null(?<=,channel:(\i).+?)/, replace: `$&,$self.isHiddenChannel($1)?$self.${settings.store.showMode === EYE_ICON_RIGHT ? "EyeRightIcon" : "LockRightIcon"}():null` }]
            });
        }
        if (settings.store.channelStyle === STYLE_MUTED || settings.store.channelStyle === STYLE_MUTED_UNREAD) {
            patches.push({
                find: "UNREAD_IMPORTANT:", ...lazy,
                replacements: [
                    { match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,muted:(\i).+?;)/, replace: "$&$2=$self.isHiddenChannel($1)?true:$2;" },
                    { match: /(?<=\?\i\.\i:\i\.\i,)(.{0,150}?)if\((\i)(?:\)return |\?)(\i\.MUTED)/, replace: "$2?$3:\"\",$1if($2)return \"\"" }
                ]
            });
        }
        if (settings.store.channelStyle !== STYLE_UNREAD && settings.store.channelStyle !== STYLE_MUTED_UNREAD) {
            patches.push({
                find: "UNREAD_IMPORTANT:", ...lazy,
                replacements: [
                    { match: /(?<=\.LOCKED;if\()(?<={channel:(\i).+?)/, replace: "!$self.isHiddenChannel($1)&&" },
                    { match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,.+?unread:(\i).+?)/, replace: "$&$2=$self.isHiddenChannel($1)?false:$2;" }
                ]
            });
        }
        patches.push(
            // The unreads boxes must not count hidden channels.
            { find: "\"ChannelListUnreadsStore\"", ...lazy, replacements: [{ match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/, replace: "&&!$self.isHiddenChannel($1)" }] },
            { find: "renderBottomUnread(){", ...lazy, replacements: [{ match: /(?<=!0\))(?=&&\(0,\i\.\i\)\((\i\.record)\))/, replace: "&&!$self.isHiddenChannel($1)" }] },
            { find: "GUILD_EVENT)}),[", ...lazy, replacements: [{ match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/, replace: "&&!$self.isHiddenChannel($1)" }] },
            {
                // Only the header and the buttons that work for a hidden channel.
                find: "Missing channel in Channel.renderHeaderToolbar", ...lazy,
                replacements: [
                    { match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_TEXT:(?=.+?(\i\.push.{0,50}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/, replace: "$&if(!$3&&$self.isHiddenChannel($2)){$1;break;}" },
                    { match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_MEDIA:(?=.+?(\i\.push.{0,40}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/, replace: "$&if(!$3&&$self.isHiddenChannel($2)){$1;break;}" },
                    { match: /renderMobileToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_DIRECTORY:(?<=let{channel:(\i).+?)/, replace: "$&if($self.isHiddenChannel($1))break;" },
                    { match: /(?<=renderHeaderBar(?:",|=)\(\)=>{.+?hideSearch:(\i)\.isDirectory\(\))/, replace: "||$self.isHiddenChannel($1)" },
                    { match: /(?<=renderSidebar\(\){)/, replace: "if($self.isHiddenChannel(this?.props?.channel))return null;" },
                    { match: /(?<=renderChat\(\){)/, replace: "if($self.isHiddenChannel(this?.props?.channel))return $self.HiddenChannelLockScreen(this?.props?.channel);" }
                ]
            },
            // Do not try to load the messages of a hidden channel.
            { find: "\"MessageManager\"", ...lazy, replacements: [{ match: /forceFetch:\i,isPreload:.+?}=\i;(?=.+?getChannel\((\i)\))/, replace: "$&if($self.isHiddenChannel({channelId:$1}))return;" }] },
            // The keyboard shortcuts must not jump to hidden channels.
            { find: "\"alt+shift+down\"", ...lazy, replacements: [{ match: /(?<=getChannel\(\i\);return null!=(\i))(?=.{0,200}?>0\)&&\(0,\i\.\i\)\(\i\))/, replace: "&&!$self.isHiddenChannel($1)" }] },
            { find: ".APPLICATION_STORE&&null!=", ...lazy, replacements: [{ match: /getState\(\)\.channelId.+?(?=\.map\(\i=>\i\.id)/, replace: "$&.filter(e=>!$self.isHiddenChannel(e))" }] },
            {
                // 'rt0ERW' is the hash of the key ROLE_REQUIRED_SINGLE_USER_MESSAGE.
                find: ".t.rt0ERW", ...lazy,
                replacements: [
                    // The role check uses CONNECT when the channel is locked.
                    { match: /(forceRoles:.+?)(\i\.\i\(\i\.\i\.ADMINISTRATOR,\i\.\i\.VIEW_CHANNEL\))(?<=context:(\i)}.+?)/, replace: "$1$self.swapViewChannelWithConnectPermission($2,$3)" },
                    { match: /permissionOverwrites\[.+?\i=(?<=context:(\i)}.+?)(?=(.+?)VIEW_CHANNEL)/, replace: "$&!$self.canConnect($1)?$2CONNECT):" },
                    // The @everyone role counts in the list of allowed roles of a hidden channel.
                    { match: /getSortedRoles.+?\.filter\(\i=>(?=!)/, replace: "$&$self.isHiddenChannel(arguments[0]?.channel)?true:" },
                    { match: /forceRoles:.+?.value\(\)(?<=channel:(\i).+?)/, replace: "$&.reduce(...$self.makeAllowedRolesReduce($1.guild_id))" },
                    // The header returns only the allowed users and roles for a hidden or locked channel.
                    { match: /return\(0,\i\.jsxs?\)\(\i\.\i,{channelId:(\i)\.id,children:\[(?=.{0,1000}?(\(0,\i\.jsxs?\)\("div",{className:\i\.\i,children:\[.{0,100}\i\.length>0.+?\]}\)),)/, replace: "if($self.isHiddenChannel($1,true)){return$2;}$&" },
                    { match: /maxUsers:\d+?,users:\i(?<=channel:(\i).+?)/, replace: "$&,shcChannel:$1" },
                    { match: /1!==\i\.length(?=\|\|)/, replace: "true" }
                ]
            },
            {
                find: "=\"interactive-text-default\",overflowCountClassName:", ...lazy,
                replacements: [
                    { match: /let{users:\i,maxUsers:\i,/, replace: "let{shcChannel}=arguments[0];$&" },
                    { match: /\i>0(?=&&!\i&&!\i)/, replace: "($self.isHiddenChannel(typeof shcChannel!==\"undefined\"?shcChannel:void 0,true)?true:$&)" },
                    { match: /(?<=`\+\$\{)\i(?=\})/, replace: "$self.isHiddenChannel(typeof shcChannel!==\"undefined\"?shcChannel:void 0,true)&&($&-1)<=0?\"\":$&" }
                ]
            },
            // 'JjdizN' is the hash of the key CHANNEL_CALL_CURRENT_SPEAKER.
            { find: ".t.JjdizN", ...lazy, replacements: [{ match: /(?<=&&)\i\.push\(.{0,120}"chat-spacer"/, replace: "(arguments[0]?.inCall||!$self.isHiddenChannel(arguments[0]?.channel,true))&&$&" }] },
            {
                // 'AlJyI+' is the hash of the key EMBEDDED_ACTIVITIES_DEVELOPER_ACTIVITY_SHELF_FETCH_ERROR.
                find: ".t[\"AlJyI+\"]", ...lazy,
                replacements: [
                    { match: /renderContent\(\i\){.+?this\.renderVoiceChannelEffects.+?children:/, replace: `$&${hide}?$self.HiddenChannelLockScreen(this?.props?.channel):` },
                    { match: /renderContent\(\i\){.+?disableGradients:/, replace: `$&${hide}||` },
                    { match: /(?:{|,)render(?!Header|ExternalHeader).{0,30}?:/g, replace: `$&${hide}?()=>null:` },
                    { match: /(?=\i\|\|\i!==\i\.\i\.FULL_SCREEN.{0,100}?this\._callContainerRef)/, replace: `$&${hide}?"":` }
                ]
            },
            {
                find: "audience-header-", ...lazy,
                replacements: [
                    { match: /screenMessage:(\i)\?.+?children:(?=!\1)(?<=let \i,{channel:(\i).+?)/, replace: "$&$self.isHiddenChannel($2)?$self.HiddenChannelLockScreen($2):" },
                    { match: /render(?:BottomLeft|BottomCenter|BottomRight|ChatToasts):\(\)=>(?<=let \i,{channel:(\i).+?)/g, replace: "$&$self.isHiddenChannel($1)?null:" },
                    { match: /"124px".+?disableGradients:(?<=let \i,{channel:(\i).+?)/, replace: "$&$self.isHiddenChannel($1)||" },
                    { match: /"124px".+?style:(?<=let \i,{channel:(\i).+?)/, replace: "$&$self.isHiddenChannel($1)?void 0:" },
                    { match: /\(0,\i\.jsx\)\(\i\.\i\.Divider.{0,500}?}\)]}\)/, replace: "$self.isHiddenChannel(arguments[0]?.channel)?null:($&)" },
                    { match: /(?<=numRequestToSpeak:\i\}\)\}\):null,!\i&&)\(0,\i\.jsxs?\).{0,280}?iconClassName:/, replace: "!$self.isHiddenChannel(arguments[0]?.channel,true)&&$&" }
                ]
            },
            {
                // The channel list of the chat bar contains hidden channels.
                find: ",queryStaticRouteChannels(", ...lazy,
                replacements: [
                    { match: /(?<=queryChannels\(\i\){.+?getChannels\(\i)(?=\))/, replace: ",true" },
                    { match: /(?<=queryChannels\(\i\){.+?\)\((\i)\.type\))(?=&&!\i\.\i\.can\()/, replace: "&&!$self.isHiddenChannel($1)" }
                ]
            },
            // Mentions of hidden channels work.
            { find: "\"^/guild-stages/(\\\\d+)(?:/)?(\\\\d+)?\"", ...lazy, replacements: [{ match: /\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,\i\)/, replace: "true" }] },
            // A click on the mention of a voice channel shows the page of the channel instead of trying to join it.
            { find: "getConfig({location:\"channel_mention\"})", ...lazy, replacements: [{ match: /(?<=getChannel\(\i\);if\(null!=(\i)).{0,200}?return void (?=\i\.default\.selectVoiceChannel)/, replace: "$&!$self.isHiddenChannel($1)&&" }] },
            {
                find: "\"GuildChannelStore\"", ...lazy,
                replacements: [
                    // The channel store contains the hidden channels, and hands them out only when asked.
                    { match: /isChannelGated\(.+?\)(?=&&)/, replace: "$&&&false" },
                    { match: /(?<=getChannels\(\i)(\){.*?)return (.+?)}/, replace: ",shouldIncludeHidden$1return $self.resolveGuildChannels($2,shouldIncludeHidden??arguments[0]===\"@favorites\");}" }
                ]
            },
            { find: "GuildTooltip - ", ...lazy, replacements: [{ match: /(?<=getChannels\(\i)(?=\))/, replace: ",true" }] },
            {
                // Without the page for a hidden channel, the allowed users and roles list has nothing to show.
                find: ".t.rt0ERW", ...lazy,
                replacements: [{ match: /(?=function (\i)\(\i\){let{channel:.{0,200}?getSortedRoles\()/, replace: "$self.ChannelBeginHeader=$1;" }]
            },
            // Discord's switch that hides private channels from the client for good.
            { find: "2026-02-private-channel-hiding", ...lazy, replacements: [{ match: /(?<=enableObfuscation|enableIntegrityCheck):!0/g, replace: ":false" }] }
        );
        return patches;
    },

    start(ctx) {
        context = ctx;
        channels = ctx.common.ChannelStore;
        permissions = ctx.common.PermissionStore;
        guilds = ctx.common.GuildStore;
        members = ctx.common.GuildMemberStore;
        users = ctx.common.UserStore;
        dispatcher = ctx.common.FluxDispatcher;
        roles = ctx.finders.byStore("GuildRoleStore");
    },

    stop() {
        context = channels = permissions = guilds = members = users = roles = dispatcher = undefined;
        styled = false;
    },

    set ChannelBeginHeader(value: unknown) {
        ChannelBeginHeader = value;
    },

    swapViewChannelWithConnectPermission(merged, channel) {
        if (!permissions?.get()?.can?.(CONNECT, channel)) {
            merged &= ~VIEW_CHANNEL;
            merged |= CONNECT;
        }
        return merged;
    },

    canConnect(channel) {
        return permissions?.get()?.can?.(CONNECT, channel) === true;
    },

    isHiddenChannel(channel, checkConnect = false) {
        try {
            if (!isSet(channel) || (Object.hasOwn(channel, "channelId") && !isSet(channel.channelId))) return false;
            if (isSet(channel.channelId)) channel = channels?.get()?.getChannel?.(channel.channelId);
            if (!isSet(channel) || channel.isDM?.() || channel.isGroupDM?.() || channel.isMultiUserDM?.()) return false;
            if (["browse", "customize", "guide"].includes(channel.id)) return false;
            const store = permissions?.get();
            if (!store) return false;
            return !store.can(VIEW_CHANNEL, channel) || (checkConnect && !store.can(CONNECT, channel));
        } catch (error) {
            context?.reportError("ShowHiddenChannels", error);
            return false;
        }
    },

    resolveGuildChannels(channelMap, shouldIncludeHidden) {
        if (shouldIncludeHidden) return channelMap;
        const result: Record<string | number, unknown> = {};
        for (const [key, maybeChannels] of Object.entries(channelMap)) {
            if (!Array.isArray(maybeChannels)) {
                result[key] = maybeChannels;
                continue;
            }
            const list = (result[key] ??= []) as unknown[];
            for (const item of maybeChannels as Array<{ channel: any; comparator: number; }>) {
                if (isUncategorized(item) || item.channel.id === null || !this.isHiddenChannel(item.channel)) list.push(item);
            }
        }
        return result;
    },

    makeAllowedRolesReduce(guildId) {
        return [
            (previous: any[], _: unknown, index: number, original: any[]) => {
                if (index !== 0) return previous;
                const everyone = original.find(role => role.id === guildId);
                return everyone ? [everyone] : original;
            },
            [] as unknown[]
        ];
    },

    HiddenChannelLockScreen: channel => (currentReact() as any).createElement(LockScreen, { channel }),

    LockIcon() {
        ensureStyle();
        return (currentReact() as any).createElement("svg", { className: "ac-shc-channel-list-icon", height: 18, width: 20, viewBox: "0 0 24 24", "aria-hidden": true, role: "img" },
            (currentReact() as any).createElement("path", { fillRule: "evenodd", d: LOCK_PATH }));
    },

    EyeRightIcon() {
        ensureStyle();
        const react = currentReact() as any;
        return react.createElement("svg", { className: "ac-shc-channel-list-icon ac-shc-hidden-channel-icon", width: 24, height: 24, viewBox: "0 0 24 24", role: "img" },
            react.createElement("title", null, "Hidden Channel"), react.createElement("path", { fillRule: "evenodd", d: EYE_PATH }));
    },

    LockRightIcon() {
        ensureStyle();
        const react = currentReact() as any;
        return react.createElement("svg", { className: "ac-shc-channel-list-icon ac-shc-hidden-channel-icon", width: 24, height: 24, viewBox: "0 0 24 24", role: "img" },
            react.createElement("title", null, "Hidden Channel"), react.createElement("path", { fill: "currentColor", fillRule: "evenodd", d: LOCK_PATH }));
    }
};

export default plugin;
