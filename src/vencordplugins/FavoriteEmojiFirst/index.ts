/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores, emoji results and menu elements have no types */

// Adapted for Amiricord (2026) from the plugin FavoriteEmojiFirst (authors Aria, Ven and justjxke) as found in TestCord's copy of the plugin (Vencord's one only sorts; this copy
// also has emoji aliases). It puts your favourite emoji first in the emoji autocomplete, and lets you give an emoji a short name (an alias) that the autocomplete finds and that
// is turned into the emoji when you send a message. The sorting, the alias search and the patches are the original's; the patch on `renderResults({results:` matches once on build
// 653945, the three on `numEmojiResults:` are in code Discord loads later and are NOT known to match (the sort without the alias search still works). Differences:
//  - the aliases are kept in the plugin's own storage instead of Vencord's DataStore;
//  - the alias list and "Delete all aliases" are not settings components: they are a window opened by the command /emoji-aliases (rename, remove, delete all; the delete asks first);
//  - the "Set alias" / "Edit alias" entry is added to the right click menus `expression-picker`, `message`, `message-actions` and `textarea-context` (NOT checked), but not to
//    every menu of Discord as the original did;
//  - aliases are turned into emoji by a patch on Discord's `sendMessage` (matches once on build 653945) instead of the message-send event;
//  - the pictures in the alias list are Discord's own emoji pictures for custom emoji and the emoji character itself for the others (the original loaded Twemoji pictures from
//    another server);
//  - the windows are plain React elements (no Discord text input).
// NOT tried in a real Discord.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const isSet = (value: unknown): boolean => value !== undefined && value !== null;
type EmojiKind = "custom" | "unicode";

interface StoredEmojiRef { kind: EmojiKind; id?: string; name: string; surrogates?: string; animated?: boolean; }
type AliasMap = Record<string, StoredEmojiRef>;

interface EmojiResult {
    id?: string;
    name?: string;
    uniqueName?: string;
    surrogates?: string;
    type?: string;
    originalName?: string;
    guildId?: string;
    index?: number;
    useSpriteSheet?: boolean;
    names?: string[];
    emojiObject?: { id?: string; name?: string; surrogates?: string; guildId?: string; animated?: boolean; };
}

interface EmojiAutocompleteState {
    query?: {
        type?: string;
        query?: string;
        text?: string;
        queryText?: string;
        results?: { emojis?: EmojiResult[] & { sliceTo?: number; }; };
    };
}

interface MenuArgs {
    favoriteableId?: string;
    favoriteableName?: string;
    favoriteableType?: string;
    itemHref?: string;
    itemSrc?: string;
    itemTextContent?: string;
    message?: { content?: string; };
    target?: any;
    rawTarget?: Node;
    props?: MenuArgs;
    dataset?: Record<string, string | undefined>;
}

const STORAGE_KEY = "emoji-aliases";
const ALIAS_PATTERN = /^[a-z0-9_]{2,32}$/;
const MENU_ITEM_ID = "ac-emoji-alias-set";

const CSS = `
.ac-emoji-alias-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px; border-radius: 8px; background: var(--background-secondary); color: var(--text-default); }
.ac-emoji-alias-row-editing { display: flex; align-items: center; gap: 8px; }
.ac-emoji-alias-row-editing input, .ac-emoji-alias-input { padding: 6px; border-radius: 4px; border: none; background: var(--input-background, #1e1f22); color: var(--text-default, #dbdee1); }
.ac-emoji-alias-row-error, .ac-emoji-alias-error { color: var(--text-feedback-critical, #f23f43); }
.ac-emoji-alias-row-button { display: flex; align-items: center; gap: 8px; }
.ac-emoji-alias-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.ac-emoji-alias-window button { padding: 6px 12px; border: none; border-radius: 4px; background: var(--brand-500, #5865f2); color: #fff; cursor: pointer; }
.ac-emoji-alias-window button:disabled { opacity: 0.5; cursor: default; }
.ac-emoji-alias-window button.danger { background: var(--status-danger, #da373c); }
`;

let context: EnginePluginContext | undefined;
let styled = false;
let aliasMap: AliasMap = {};
let emojiStore: Lazy;
let queryService: Lazy;
const unicodeSurrogateCache = new Map<string, string | null>();
const aliasResultCache = new Map<string, EmojiResult | null>();

function normalizeAlias(input: string): string {
    return typeof input === "string" ? input.trim().replace(/^:+|:+$/g, "").toLowerCase() : "";
}

const normalizeEmojiName = (input: string): string => input.trim().replace(/^:+|:+$/g, "");
const normalizeEmojiNameForCompare = (input: string | undefined): string => normalizeEmojiName(input ?? "").toLowerCase();

function getAliasValidationError(input: string): string | null {
    const normalized = normalizeAlias(input);
    if (!normalized.length) return "Alias is required.";
    if (!ALIAS_PATTERN.test(normalized)) return "Alias must be 2-32 characters and only use lowercase letters, numbers, or underscores.";
    return null;
}

function isStoredEmojiRef(value: unknown): value is StoredEmojiRef {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<StoredEmojiRef>;
    if (candidate.kind !== "custom" && candidate.kind !== "unicode") return false;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) return false;
    if (candidate.kind === "custom" && (!candidate.id || typeof candidate.id !== "string")) return false;
    if (isSet(candidate.id) && typeof candidate.id !== "string") return false;
    if (isSet(candidate.surrogates) && typeof candidate.surrogates !== "string") return false;
    if (isSet(candidate.animated) && typeof candidate.animated !== "boolean") return false;
    return true;
}

function extractUnicodeEmoji(text: string | undefined | null): string | null {
    if (!text) return null;
    return text.match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u)?.[0] ?? null;
}

const getUnicodeSurrogate = (ref: StoredEmojiRef): string | undefined => ref.surrogates ?? extractUnicodeEmoji(ref.name) ?? undefined;

function resolveUnicodeSurrogateByName(name: string): string | undefined {
    const normalizedName = normalizeEmojiName(name);
    if (!normalizedName.length) return undefined;
    const cached = unicodeSurrogateCache.get(normalizedName);
    if (cached !== undefined) return cached ?? undefined;

    for (const query of [normalizedName, `:${normalizedName}:`]) {
        const unlocked = queryService?.get()?.queryEmojiResults?.({ query, channel: undefined, intention: undefined, maxCount: 100 })?.emojis?.unlocked as EmojiResult[] | undefined;
        if (!unlocked?.length) continue;
        for (const result of unlocked) {
            const surrogate = result.surrogates ?? result.emojiObject?.surrogates;
            if (!surrogate) continue;
            if (normalizeEmojiNameForCompare(result.uniqueName ?? result.name ?? result.originalName ?? "") === normalizedName.toLowerCase()) {
                unicodeSurrogateCache.set(normalizedName, surrogate);
                return surrogate;
            }
        }
    }
    unicodeSurrogateCache.set(normalizedName, null);
    return undefined;
}

function parseAliasMap(value: unknown): AliasMap {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) return {};
    const parsed: AliasMap = {};
    for (const [alias, ref] of Object.entries(value)) {
        if (!ALIAS_PATTERN.test(alias) || !isStoredEmojiRef(ref)) continue;
        parsed[alias] = ref.kind === "unicode"
            ? { ...ref, name: normalizeEmojiName(ref.name), surrogates: getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) }
            : ref;
    }
    return parsed;
}

async function loadAliases(): Promise<void> {
    try {
        aliasMap = parseAliasMap(await context?.storage.get(STORAGE_KEY));
    } catch (error) {
        aliasMap = {};
        context?.reportError("FavoriteEmojiFirst", error);
    }
    unicodeSurrogateCache.clear();
    aliasResultCache.clear();
}

async function persistAliases(next: AliasMap): Promise<void> {
    aliasMap = next;
    await context?.storage.set(STORAGE_KEY, next as never);
    aliasResultCache.clear();
}

function emojiIdentityFromRef(ref: StoredEmojiRef): string {
    if (ref.kind === "custom" && ref.id) return `custom:${ref.id}`;
    const surrogate = getUnicodeSurrogate(ref)?.trim();
    return surrogate ? `unicode:${surrogate}` : `unicode-name:${ref.name.toLowerCase()}`;
}

function emojiIdentityFromResult(emoji: EmojiResult): string {
    const customId = emoji.id ?? emoji.emojiObject?.id;
    if (customId) return `custom:${customId}`;
    const surrogate = (emoji.surrogates ?? emoji.emojiObject?.surrogates)?.trim();
    if (surrogate) return `unicode:${surrogate}`;
    return `unicode-name:${(emoji.uniqueName ?? emoji.name ?? emoji.emojiObject?.name ?? "").toLowerCase()}`;
}

const isSameEmoji = (left: StoredEmojiRef, right: StoredEmojiRef): boolean => emojiIdentityFromRef(left) === emojiIdentityFromRef(right);

function getEmojiDisplayName(ref: StoredEmojiRef): string {
    return ref.kind === "custom" ? `:${ref.name}:` : getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) ?? `:${normalizeEmojiName(ref.name)}:`;
}

function isGifUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.pathname.endsWith(".gif") || parsed.searchParams.get("animated") === "true";
    } catch {
        return false;
    }
}

function isDirectUnicodeTarget(target: HTMLElement): string | null {
    const text = target.textContent?.trim();
    const unicode = extractUnicodeEmoji(text);
    if (!text || !unicode) return null;
    return text.replace(unicode, "").trim().length ? null : unicode;
}

function getUnicodeFromNodeTarget(target: Node | null | undefined): string | null {
    if (!target) return null;
    if (target.nodeType === Node.TEXT_NODE) {
        const text = target.textContent?.trim();
        const unicode = extractUnicodeEmoji(text);
        if (!text || !unicode) return null;
        return text.replace(unicode, "").trim().length ? null : unicode;
    }
    if (!(target instanceof HTMLElement)) return null;
    const roleImg = target.closest("[role='img']") as HTMLElement | null;
    const roleUnicode = extractUnicodeEmoji(roleImg?.getAttribute("aria-label") ?? roleImg?.textContent);
    return roleUnicode ?? isDirectUnicodeTarget(target);
}

function toEmojiRefFromExpressionTarget(target: { dataset?: Record<string, string | undefined>; firstChild?: any; } | undefined): StoredEmojiRef | null {
    const dataset = target?.dataset;
    if (!dataset || dataset.type !== "emoji" || !dataset.name) return null;
    const baseName = dataset.name.replace(/~\d+$/, "");
    if (dataset.id) return { kind: "custom", id: dataset.id, name: baseName, animated: !!target?.firstChild?.src && isGifUrl(target.firstChild.src) };
    return { kind: "unicode", name: baseName, surrogates: dataset.surrogates };
}

function toEmojiRefFromElementTarget(target: unknown): StoredEmojiRef | null {
    const html = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    if (!html) return null;

    const emojiElement = html.closest("[data-type='emoji']") as HTMLElement | null;
    if (emojiElement) {
        const fromDataset = toEmojiRefFromExpressionTarget({
            dataset: { id: emojiElement.dataset.id, name: emojiElement.dataset.name, surrogates: emojiElement.dataset.surrogates, type: emojiElement.dataset.type },
            firstChild: emojiElement.firstChild
        });
        if (fromDataset) return fromDataset;
    }

    const image = html.closest("img") as HTMLImageElement | null;
    const source = image?.src;
    if (!source) {
        const unicode = getUnicodeFromNodeTarget(html) ?? extractUnicodeEmoji(image?.alt);
        return unicode ? { kind: "unicode", name: unicode, surrogates: unicode } : null;
    }
    const id = source.match(/\/emojis\/(\d+)\.(?:png|gif|webp|jpe?g)/)?.[1];
    if (!id) return null;
    const fromStore = emojiStore?.get()?.getCustomEmojiById?.(id);
    return { kind: "custom", id, name: fromStore?.name ?? image?.alt?.replace(/^:|:$/g, "") ?? "emoji", animated: !!fromStore?.animated || isGifUrl(source) };
}

/** The emoji name found in the context of a menu when Discord's own store does not know the emoji. */
function guessCustomName(args: MenuArgs, id: string): string {
    return args.favoriteableName
        ?? args.itemTextContent?.match(/:([a-zA-Z0-9_]+):/)?.[1]
        ?? args.message?.content?.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>`))?.[1]
        ?? "emoji";
}

function toEmojiRefFromHrefContext(args: MenuArgs): StoredEmojiRef | null {
    const source = args.itemHref ?? args.itemSrc;
    if (!source) {
        const unicode = extractUnicodeEmoji(args.itemTextContent);
        return unicode ? { kind: "unicode", name: unicode, surrogates: unicode } : null;
    }
    const id = source.match(/\/emojis\/(\d+)\.(?:png|gif|webp|jpe?g)/)?.[1];
    if (!id) return null;
    const fromStore = emojiStore?.get()?.getCustomEmojiById?.(id);
    if (fromStore) return { kind: "custom", id, name: fromStore.name, animated: !!fromStore.animated || isGifUrl(source) };
    return { kind: "custom", id, name: guessCustomName(args, id), animated: isGifUrl(source) };
}

function toEmojiRefFromFavoriteableContext(args: MenuArgs): StoredEmojiRef | null {
    if (args.favoriteableType !== "emoji") return null;
    if (!args.favoriteableId) {
        const unicode = getUnicodeFromNodeTarget(args.rawTarget) ?? getUnicodeFromNodeTarget(args.target instanceof Node ? args.target : null) ?? extractUnicodeEmoji(args.itemTextContent);
        if (unicode) return { kind: "unicode", name: normalizeEmojiName(args.favoriteableName ?? unicode), surrogates: unicode };
        return args.favoriteableName ? { kind: "unicode", name: normalizeEmojiName(args.favoriteableName) } : null;
    }
    const id = args.favoriteableId;
    const fromStore = emojiStore?.get()?.getCustomEmojiById?.(id);
    const source = args.itemHref ?? args.itemSrc ?? "";
    if (fromStore) return { kind: "custom", id, name: fromStore.name, animated: !!fromStore.animated || isGifUrl(source) };
    return { kind: "custom", id, name: guessCustomName(args, id), animated: isGifUrl(source) };
}

function toEmojiRefFromMessageContext(args: MenuArgs): StoredEmojiRef | null {
    const favoriteable = toEmojiRefFromFavoriteableContext(args);
    if (favoriteable) return favoriteable;
    if (!(args.target instanceof HTMLElement)) return null;
    return toEmojiRefFromElementTarget(args.target) ?? toEmojiRefFromHrefContext(args);
}

function hasExplicitEmojiContext(args: MenuArgs): boolean {
    if (args.favoriteableType === "emoji" || args.favoriteableId) return true;
    if ((args.itemHref ?? args.itemSrc)?.includes("/emojis/")) return true;
    const target = args.target instanceof HTMLElement ? args.target : args.target instanceof Node ? args.target.parentElement : null;
    if (!target) return false;
    if (target.closest("[data-type='emoji']")) return true;
    const roleImg = target.closest("[role='img']") as HTMLElement | null;
    if (roleImg && extractUnicodeEmoji(roleImg.getAttribute("aria-label") ?? roleImg.textContent)) return true;
    const image = target.closest("img") as HTMLImageElement | null;
    return !!(image?.src?.includes("/emojis/") || extractUnicodeEmoji(image?.alt));
}

function normalizeContextKey(value: unknown): string {
    if (!isSet(value)) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value !== "object") return typeof value;
    const record = value as Record<string, unknown>;
    const priority = [record.id, record.channelId, record.guildId, record.type, record.emojiIntention, record.name].filter((candidate): candidate is string | number => typeof candidate === "string" || typeof candidate === "number");
    if (priority.length) return priority.map(String).join(":");
    return Object.keys(record).sort().slice(0, 6).map(key => {
        const candidate = record[key];
        return typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean" ? `${key}:${String(candidate)}` : `${key}:${typeof candidate}`;
    }).join("|");
}

/** The pieces of the right click menu's arguments the alias entry needs, from Discord's menu props. */
function resolveContextProps(props: any): MenuArgs | null {
    if (!props || typeof props !== "object") return null;
    const merged: MenuArgs = {};
    for (const source of [props, props.props] as Array<MenuArgs | undefined>) {
        if (!source) continue;
        for (const key of ["favoriteableId", "favoriteableName", "favoriteableType", "itemHref", "itemSrc", "itemTextContent", "message"] as const) {
            if (source[key]) (merged as any)[key] = source[key];
        }
        if (source.target instanceof HTMLElement) merged.target = source.target;
    }
    const raw = props.target ?? props.rawTarget;
    if (raw instanceof Node) {
        merged.rawTarget = raw;
        if (!merged.target) merged.target = raw instanceof HTMLElement ? raw : raw.parentElement ?? undefined;
    }
    if (!merged.target && !merged.favoriteableId && !merged.itemHref && !merged.itemSrc) return null;
    return merged;
}

const getAliasMapEntries = (): Array<[string, StoredEmojiRef]> => Object.entries(aliasMap).sort(([left], [right]) => left.localeCompare(right));

function getExistingAliasForEmoji(ref: StoredEmojiRef): string {
    for (const [alias, current] of Object.entries(aliasMap)) if (isSameEmoji(current, ref)) return alias;
    return "";
}

async function saveAlias(aliasInput: string, ref: StoredEmojiRef): Promise<{ ok: true; } | { ok: false; error: string; }> {
    const validationError = getAliasValidationError(aliasInput);
    if (validationError) return { ok: false, error: validationError };
    const alias = normalizeAlias(aliasInput);
    const existing = aliasMap[alias];
    if (existing && !isSameEmoji(existing, ref)) return { ok: false, error: "Duplicate alias" };

    const normalizedRef: StoredEmojiRef = ref.kind === "unicode"
        ? { ...ref, name: normalizeEmojiName(ref.name), surrogates: getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) }
        : ref;
    const next = { ...aliasMap };
    for (const [existingAlias, existingRef] of Object.entries(next)) {
        if (existingAlias !== alias && isSameEmoji(existingRef, normalizedRef)) delete next[existingAlias];
    }
    next[alias] = normalizedRef;
    try {
        await persistAliases(next);
        return { ok: true };
    } catch (error) {
        context?.reportError("FavoriteEmojiFirst", error);
        return { ok: false, error: "Failed to save alias." };
    }
}

async function removeAlias(alias: string): Promise<void> {
    if (!(alias in aliasMap)) return;
    const next = { ...aliasMap };
    delete next[alias];
    try {
        await persistAliases(next);
        context?.toasts.show(`Removed alias :${alias}:`, "success");
    } catch (error) {
        context?.reportError("FavoriteEmojiFirst", error);
        context?.toasts.show("Failed to remove alias.", "failure");
    }
}

async function clearAliases(): Promise<void> {
    if (!Object.keys(aliasMap).length) return;
    try {
        await persistAliases({});
        context?.toasts.show("Deleted all emoji aliases.", "success");
    } catch (error) {
        context?.reportError("FavoriteEmojiFirst", error);
        context?.toasts.show("Failed to delete aliases.", "failure");
    }
}

function queryAliasEmojiResult(aliasEmoji: StoredEmojiRef, channel: unknown, intention: unknown): EmojiResult | null {
    const cacheKey = [aliasEmoji.kind, aliasEmoji.id ?? "", normalizeEmojiName(aliasEmoji.name), getUnicodeSurrogate(aliasEmoji) ?? "", normalizeContextKey(channel), normalizeContextKey(intention)].join("|");
    const cached = aliasResultCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const baseQuery = getUnicodeSurrogate(aliasEmoji) ?? resolveUnicodeSurrogateByName(aliasEmoji.name) ?? aliasEmoji.name;
    if (!baseQuery.length) {
        aliasResultCache.set(cacheKey, null);
        return null;
    }
    const candidates = aliasEmoji.kind === "custom"
        ? [aliasEmoji.name, `:${aliasEmoji.name}:`, baseQuery]
        : [getUnicodeSurrogate(aliasEmoji), normalizeEmojiName(aliasEmoji.name), `:${normalizeEmojiName(aliasEmoji.name)}:`, baseQuery].filter((value): value is string => !!value && value.length > 0);

    for (const query of candidates) {
        const unlocked = queryService?.get()?.queryEmojiResults?.({ query, channel, intention, maxCount: 100 })?.emojis?.unlocked as EmojiResult[] | undefined;
        if (!unlocked?.length) continue;
        const resolved = unlocked.find(result => {
            if (aliasEmoji.kind === "custom") return emojiIdentityFromResult(result) === emojiIdentityFromRef(aliasEmoji);
            const refSurrogate = getUnicodeSurrogate(aliasEmoji) ?? resolveUnicodeSurrogateByName(aliasEmoji.name);
            const resultSurrogate = (result.surrogates ?? result.emojiObject?.surrogates)?.trim();
            if (refSurrogate && resultSurrogate) return refSurrogate === resultSurrogate;
            if (result.id ?? result.emojiObject?.id) return false;
            const refName = normalizeEmojiNameForCompare(aliasEmoji.name);
            return !!refName && refName === normalizeEmojiNameForCompare(result.uniqueName ?? result.name ?? result.originalName ?? "");
        }) ?? null;
        if (resolved) {
            aliasResultCache.set(cacheKey, resolved);
            return resolved;
        }
    }
    aliasResultCache.set(cacheKey, null);
    return null;
}

function fallbackAliasEmojiResult(aliasEmoji: StoredEmojiRef, template: EmojiResult | undefined): EmojiResult | null {
    if (aliasEmoji.kind === "unicode" || !aliasEmoji.id) return null;
    const store = emojiStore?.get();
    const emoji = store?.getUsableCustomEmojiById?.(aliasEmoji.id) ?? store?.getCustomEmojiById?.(aliasEmoji.id);
    if (!emoji) return null;
    if (!(template?.emojiObject || "emojiObject" in (template ?? {}))) return { id: emoji.id, name: emoji.name, uniqueName: emoji.name };
    return {
        emojiObject: { id: emoji.id, name: emoji.name, guildId: emoji.guildId, animated: !!emoji.animated },
        id: emoji.id, name: emoji.name, uniqueName: emoji.name, originalName: emoji.name, guildId: emoji.guildId,
        surrogates: template?.surrogates, type: template?.type ?? "EMOJI", index: typeof template?.index === "number" ? template.index : 0,
        useSpriteSheet: template?.useSpriteSheet ?? false, names: [emoji.name]
    };
}

function injectAliasResults(emojis: EmojiResult[], queryText: string, channel: unknown, intention: unknown): EmojiResult[] {
    const query = normalizeAlias(queryText);
    if (!query) return emojis;
    const template = emojis[0];
    const seen = new Set(emojis.map(emojiIdentityFromResult));
    const exact: EmojiResult[] = [];
    const prefix: EmojiResult[] = [];
    for (const [alias, ref] of Object.entries(aliasMap)) {
        if (!alias.startsWith(query)) continue;
        const identity = emojiIdentityFromRef(ref);
        if (seen.has(identity)) continue;
        const fromQuery = queryAliasEmojiResult(ref, channel, intention);
        const resolved = ref.kind === "unicode" ? fromQuery : fromQuery ?? fallbackAliasEmojiResult(ref, template);
        if (!resolved) continue;
        (alias === query ? exact : prefix).push(resolved);
        seen.add(identity);
    }
    return exact.length || prefix.length ? [...exact, ...prefix, ...emojis] : emojis;
}

function getAutocompleteQuery(query: EmojiAutocompleteState["query"]): string {
    if (!query) return "";
    if (typeof query.queryText === "string") return query.queryText;
    if (typeof query.query === "string") return query.query;
    return typeof query.text === "string" ? query.text : "";
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

function openWindow(ctx: EnginePluginContext, title: string, Body: (props: { onClose(): void; }) => unknown): void {
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) {
        ctx.toasts.show("The window could not be opened.", "failure");
        return;
    }
    if (!styled) {
        styled = true;
        ctx.addStyle(CSS, "favorite-emoji-first");
    }
    const h = react.createElement;
    ctx.modals.open(props => h(Root, { size: "small", onClose: props.onClose, label: title }, h(Content, null, h("div", { className: "ac-emoji-alias-window", style: { padding: "16px" } },
        h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: "0 0 8px" } }, title), h(Body, { onClose: props.onClose }))), Close ? h(Close, { onClick: props.onClose }) : null));
}

function openSetAliasWindow(ctx: EnginePluginContext, ref: StoredEmojiRef): void {
    const react = currentReact() as any;
    const h = react.createElement;
    function Body({ onClose }: { onClose(): void; }) {
        const [input, setInput] = react.useState(getExistingAliasForEmoji(ref)) as [string, (value: string) => void];
        const [error, setError] = react.useState(null) as [string | null, (value: string | null) => void];
        const validation = getAliasValidationError(input);
        const normalized = normalizeAlias(input);
        const duplicate = !!normalized && !!aliasMap[normalized] && !isSameEmoji(aliasMap[normalized], ref);
        const shown = duplicate ? "Duplicate alias" : error ?? validation;
        return h("div", null,
            h("p", { style: { color: "var(--text-default, #dbdee1)" } }, `Set an alias for ${getEmojiDisplayName(ref)}`),
            h("input", { className: "ac-emoji-alias-input", value: input, placeholder: "Alias, e.g. \"sob\"", autoFocus: true, onChange: (event: any) => { setInput(event.target.value); setError(null); } }),
            shown ? h("div", { className: "ac-emoji-alias-error", style: { marginTop: "8px" } }, shown) : null,
            h("div", { style: { marginTop: "12px" } }, h("button", {
                type: "button", disabled: !!validation || duplicate,
                onClick: () => {
                    void saveAlias(input, ref).then(result => {
                        if (!result.ok) { setError(result.error); return; }
                        ctx.toasts.show(`Alias set for ${getEmojiDisplayName(ref)}.`, "success");
                        onClose();
                    });
                }
            }, "Save")));
    }
    openWindow(ctx, "Set alias", Body);
}

function EmojiPreview({ emojiRef }: { emojiRef: StoredEmojiRef; }): unknown {
    const h = (currentReact() as any).createElement;
    if (emojiRef.kind === "custom" && emojiRef.id) {
        const host = (window as any).GLOBAL_ENV?.CDN_HOST ?? "cdn.discordapp.com";
        return h("img", { src: `https://${host}/emojis/${emojiRef.id}.${emojiRef.animated ? "gif" : "png"}?size=32`, width: 20, height: 20, alt: emojiRef.name });
    }
    return h("span", null, getEmojiDisplayName(emojiRef));
}

function openManagerWindow(ctx: EnginePluginContext): void {
    const react = currentReact() as any;
    const h = react.createElement;

    function Row({ alias, emojiRef, again }: { alias: string; emojiRef: StoredEmojiRef; again(): void; }) {
        const [editing, setEditing] = react.useState(false) as [boolean, (value: boolean) => void];
        const [draft, setDraft] = react.useState(alias) as [string, (value: string) => void];
        const [error, setError] = react.useState(null) as [string | null, (value: string | null) => void];
        const saveEdit = () => {
            void saveAlias(draft, emojiRef).then(result => {
                if (!result.ok) { setError(result.error); return; }
                setError(null);
                setEditing(false);
                again();
            });
        };
        return h("div", { className: "ac-emoji-alias-row" },
            h("div", { className: "ac-emoji-alias-row-editing" },
                editing
                    ? h("input", {
                        value: draft, autoFocus: true, style: { width: "140px" },
                        onChange: (event: any) => { setDraft(event.target.value); setError(null); },
                        onKeyDown: (event: any) => {
                            if (event.key === "Enter") { event.preventDefault(); saveEdit(); }
                            if (event.key === "Escape") { event.preventDefault(); setDraft(alias); setError(null); setEditing(false); }
                        }
                    })
                    : h("strong", null, `:${alias}:`),
                h("span", null, "→"),
                h(EmojiPreview, { emojiRef }),
                h("span", null, `:${normalizeEmojiName(emojiRef.name)}:`),
                error ? h("span", { className: "ac-emoji-alias-row-error" }, error) : null),
            h("div", { className: "ac-emoji-alias-row-button" },
                h("button", { type: "button", onClick: () => { setDraft(alias); setError(null); setEditing(true); } }, "Edit"),
                h("button", { type: "button", className: "danger", onClick: () => { void removeAlias(alias).then(again); } }, "Remove")));
    }

    function Body() {
        const [, redraw] = react.useState(0) as [number, (value: number) => void];
        const again = () => redraw(Date.now());
        const entries = getAliasMapEntries();
        return h("div", null,
            entries.length
                ? h("div", { className: "ac-emoji-alias-list" }, entries.map(([alias, ref]) => h(Row, { key: alias, alias, emojiRef: ref, again })))
                : h("p", { style: { color: "var(--text-default, #dbdee1)" } }, "No aliases set yet. Right click an emoji and choose Set alias."),
            h("button", {
                type: "button", className: "danger", disabled: !entries.length,
                onClick: () => {
                    if (confirm("This will remove every emoji alias you saved.")) void clearAliases().then(again);
                }
            }, "Delete all aliases"));
    }
    openWindow(ctx, "Emoji aliases", Body);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const GROUP_ANCHORS = ["favorite-emoji", "favourite-emoji", "unfavorite-emoji", "unfavourite-emoji", "copy-link", "copy-text", "copy-message-link"];

/** The array of children of the group that holds one of the anchor entries, or undefined. */
function findGroupChildren(children: any[]): any[] | undefined {
    for (const child of children) {
        const inner = child?.props?.children;
        if (Array.isArray(inner) && inner.some((item: any) => GROUP_ANCHORS.includes(item?.props?.id))) return inner;
    }
    return undefined;
}

function addAliasItem(ctx: EnginePluginContext, children: any[], ref: StoredEmojiRef): void {
    if (children.some(child => child?.props?.id === MENU_ITEM_ID)) return;
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    if (!parts || !react) return;
    const item = react.createElement(parts.MenuItem as never, {
        id: MENU_ITEM_ID, key: MENU_ITEM_ID, label: getExistingAliasForEmoji(ref) ? "Edit alias" : "Set alias", action: () => openSetAliasWindow(ctx, ref)
    });
    const group = findGroupChildren(children);
    if (group) group.push(item);
    else children.push(item);
}

const plugin: PluginCode & {
    injectAliasResults: typeof injectAliasResults;
    sortEmojis(state: EmojiAutocompleteState): void;
    beforeSend(message: { content?: string; } | undefined): void;
} = {
    patches: [
        {
            find: "renderResults({results:",
            lazy: true,
            required: false,
            replacements: [{
                // https://regex101.com/r/N7kpLM/1
                match: /let \i=.{1,100}renderResults\({results:(\i)\.query\.results,/,
                replace: "$self.sortEmojis($1);$&"
            }]
        },
        {
            find: "numEmojiResults:",
            lazy: true,
            required: false,
            replacements: [
                { match: /\{emojis:\{unlocked:(\i)\}\}=.{0,25}\(\{query:(\i),channel:(\i),intention:(\i).{0,30}\}\);/, replace: "$&$1=$self.injectAliasResults($1,$2,$3,$4.emojiIntention);" },
                { match: /(intention:\i\.emojiIntention,maxCount:)\i/, replace: "$1Infinity" },
                { match: /(\i)\.slice\(0,(Math\.max\(\d+?,\i(?:-\i\.length){2}\))\)/, replace: "($1.sliceTo = $2, $1)" }
            ]
        },
        {
            find: "async sendMessage(",
            lazy: true,
            required: false,
            replacements: [{ match: /async sendMessage\((\i),(\i)\)\{/, replace: "$&$self.beforeSend($2);" }]
        }
    ],

    injectAliasResults,

    start(ctx) {
        context = ctx;
        emojiStore = ctx.finders.byStore("EmojiStore");
        queryService = ctx.finders.byProps("queryEmojiResults");
        void loadAliases();

        const added = ctx.commands.add({
            name: "emoji-aliases",
            description: "Manage your emoji aliases.",
            input: "builtin",
            execute: () => { openManagerWindow(ctx); }
        });
        if (!added) throw new Error("the command /emoji-aliases could not be added (the name is taken or the commands API refused it)");

        ctx.contextMenu.addNative("expression-picker", (children, props: any) => {
            const ref = toEmojiRefFromExpressionTarget(props?.target);
            if (ref) addAliasItem(ctx, children, ref);
        });
        for (const navId of ["message", "message-actions", "textarea-context"]) {
            ctx.contextMenu.addNative(navId, (children, props: any) => {
                const merged = resolveContextProps(props);
                if (!merged || !hasExplicitEmojiContext(merged)) return;
                const ref = toEmojiRefFromMessageContext(merged);
                if (ref) addAliasItem(ctx, children, ref);
            });
        }
    },

    stop() {
        context = emojiStore = queryService = undefined;
        styled = false;
        unicodeSurrogateCache.clear();
        aliasResultCache.clear();
    },

    sortEmojis(state) {
        try {
            if (!state.query?.results?.emojis?.length) return;
            const query = normalizeAlias(getAutocompleteQuery(state.query));
            if (!query) return;

            const { channel, intention } = state.query as { channel?: unknown; intention?: unknown; };
            const injected = injectAliasResults(state.query.results.emojis, query, channel, intention);
            const emojiContext = emojiStore?.get()?.getDisambiguatedEmojiContext?.();

            const priorities = new Map<string, number>();
            const refsByIdentity = new Map<string, StoredEmojiRef>();
            for (const [alias, ref] of Object.entries(aliasMap)) {
                if (!alias.startsWith(query)) continue;
                const priority = alias === query ? 2 : 1;
                const identity = emojiIdentityFromRef(ref);
                if (priority > (priorities.get(identity) ?? 0)) {
                    priorities.set(identity, priority);
                    refsByIdentity.set(identity, ref);
                }
            }

            const exact: EmojiResult[] = [];
            const prefix: EmojiResult[] = [];
            const rest: EmojiResult[] = [];
            const seen = new Set<string>();
            const template = injected[0];

            for (const emoji of injected) {
                const identity = emojiIdentityFromResult(emoji);
                if (seen.has(identity)) continue;
                seen.add(identity);
                const priority = priorities.get(identity) ?? 0;
                if (priority === 2 || (priority === 0 && emojiContext?.isFavoriteEmojiWithoutFetchingLatest?.(emoji))) exact.push(emoji);
                else if (priority === 1) prefix.push(emoji);
                else rest.push(emoji);
            }

            for (const [identity, priority] of priorities.entries()) {
                if (seen.has(identity)) continue;
                const ref = refsByIdentity.get(identity);
                if (!ref || ref.kind === "unicode") continue;
                const fallback = fallbackAliasEmojiResult(ref, template);
                if (!fallback) continue;
                seen.add(identity);
                (priority === 2 ? exact : prefix).push(fallback);
            }

            state.query.results.emojis = [...exact, ...prefix, ...rest].slice(0, state.query.results.emojis.sliceTo ?? Infinity) as EmojiResult[] & { sliceTo?: number; };
        } catch (error) {
            context?.reportError("FavoriteEmojiFirst", error);
        }
    },

    beforeSend(message) {
        if (!message?.content || !Object.keys(aliasMap).length) return;
        // Not inside an emoji that is already written out (`<:name:123>`, `<a:name:123>`) and not in the middle of a word or a number (`12:30:45`).
        message.content = message.content.replace(/(?<![<\w]):([a-z0-9_]{2,32}):(?!\d)/gi, (match, aliasName: string) => {
            const ref = aliasMap[aliasName.toLowerCase()];
            if (!ref) return match;
            if (ref.kind === "custom" && ref.id) return `<${ref.animated ? "a" : ""}:${ref.name}:${ref.id}>`;
            return getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) ?? match;
        });
    }
};

export default plugin;
