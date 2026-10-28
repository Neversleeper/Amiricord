/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window that opens from the gear (a plugin with settings) or the "i" (a plugin without) of a card in the Plugins tab: the plugin's name,
// description and marks, its authors and its settings, laid out like TestCord's (the owner's reference). A setting is changed through the engine
// (`ctx.plugins.setSetting`), which checks it against the plugin's own declaration; a setting the manifest lists as risky asks first, and Reset
// asks too. The settings of a plugin that is off cannot be read (its code is not loaded), and the window says so. The window is drawn with the
// engine's modal pieces and the pure texts of `pluginWindowModel.ts`. Design: docs/analysis-48-plugin-settings-gear.md.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCard } from "../../api/pluginCards";
import type { PluginSettingsAnswer, PluginSettingsComponent, SettingInfo } from "../../api/pluginSettings";
import type { JsonValue } from "../../shared/settings";
import { type AuthorInfo, isDiscordId } from "./authorModel";
import { cardBadges } from "./pluginsModel";
import {
    boxText, checkNumber, checkText, emptyText, RESET_QUESTION, RESTART_NOTE, RESTART_TAG, RISKY_QUESTION, RISKY_TAG, settingTitle
} from "./pluginWindowModel";

type Part = (props: { children?: unknown; size?: string; onClose?(): void; onClick?(): void; label?: string; }) => unknown;

/** The pieces of a window the engine offers (`ctx.components`). */
export interface WindowParts {
    ModalRoot: Part;
    ModalHeader: Part;
    ModalContent: Part;
    ModalFooter: Part;
    ModalCloseButton: Part;
}

export interface PluginWindowDeps {
    card(id: string): PluginCard | undefined;
    settingsOf(id: string): PluginSettingsAnswer;
    setSetting(id: string, key: string, value: JsonValue): string | null;
    resetSettings(id: string): string | null;
    /** The component a running plugin draws below its declared settings, if it gave one. */
    componentOf?(id: string): PluginSettingsComponent | undefined;
    /** The error boundary, so a component that throws shows a short message and the rest of the window keeps working. */
    guard?: (props: { label: string; children?: unknown; }) => unknown;
    /** The Discord name and picture of an author who has a Discord id in the manifest, or null when they cannot be found. */
    lookupAuthor?(id: string): Promise<AuthorInfo | null>;
    parts: WindowParts;
}

interface Asked {
    key: string;
    value: JsonValue;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
    const { [key]: _gone, ...rest } = record;
    return rest;
}

export const RESET_DONE_TEXT = "The settings are back to their defaults.";
export const GONE_TEXT = "This plugin is no longer available.";

export function makePluginWindow(deps: PluginWindowDeps) {
    /** One author: the name in the manifest and, when there is a Discord id and Discord knows the person, their picture and name as Discord shows them now. */
    function Author({ name, discordId }: { name: string; discordId?: string; }) {
        const react = currentReact();
        const [info, setInfo] = react.useState<AuthorInfo | null>(null);
        react.useEffect(() => {
            let alive = true;
            if (discordId && isDiscordId(discordId) && deps.lookupAuthor) {
                deps.lookupAuthor(discordId).then(found => { if (alive) setInfo(found); }, () => undefined);
            }
            return () => { alive = false; };
        }, [discordId]);
        return (
            <span className="amiricord-pwin-author">
                {info?.avatarUrl && <img className="amiricord-pwin-avatar" src={info.avatarUrl} alt="" />}
                <span>{name}</span>
                {info && <span className="amiricord-hint">{info.displayName === name ? `@${info.username}` : `${info.displayName} (@${info.username})`}</span>}
            </span>
        );
    }

    return function PluginWindow({ id, onClose }: { id: string; onClose(): void; }) {
        const react = currentReact();
        const [drafts, setDrafts] = react.useState<Record<string, string>>({});
        const [errors, setErrors] = react.useState<Record<string, string>>({});
        const [asking, setAsking] = react.useState<Asked | null>(null);
        const [restartKeys, setRestartKeys] = react.useState<Record<string, boolean>>({});
        const [askingReset, setAskingReset] = react.useState(false);
        const [resetNote, setResetNote] = react.useState<string | null>(null);
        // Changes after each write, so the window reads the settings again.
        const [, setTick] = react.useState(0);

        const { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } = deps.parts;
        const card = deps.card(id);
        const answer = deps.settingsOf(id);
        const Custom = deps.componentOf?.(id);
        const Guard = deps.guard;
        // A plugin that draws its own settings is not "without settings" even if it declares none.
        const empty = Custom ? null : emptyText(answer);
        const list: SettingInfo[] = answer.state === "ready" ? answer.settings : [];

        const fail = (key: string, error: string) => setErrors(previous => ({ ...previous, [key]: error }));

        const send = (info: SettingInfo, value: JsonValue) => {
            const error = deps.setSetting(id, info.key, value);
            if (error !== null) {
                fail(info.key, error);
            } else {
                setErrors(previous => without(previous, info.key));
                setDrafts(previous => without(previous, info.key));
                if (info.restartNeeded) setRestartKeys(previous => ({ ...previous, [info.key]: true }));
            }
            setResetNote(null);
            setTick(n => n + 1);
        };

        // A setting the manifest lists as risky asks first; the others are written at once.
        const apply = (info: SettingInfo, value: JsonValue) => {
            if (info.risky) { setAsking({ key: info.key, value }); return; }
            send(info, value);
        };

        // A number or a text is written when the person leaves the box or presses Enter, never while typing.
        const commitBox = (info: SettingInfo) => {
            const text = drafts[info.key];
            if (text === undefined) return;
            if (info.type === "number") {
                const check = checkNumber(text, info);
                if (!check.ok) { fail(info.key, check.error); return; }
                if (check.value === info.value) { setDrafts(previous => without(previous, info.key)); setErrors(previous => without(previous, info.key)); return; }
                apply(info, check.value);
                return;
            }
            const problem = checkText(text, info);
            if (problem !== null) { fail(info.key, problem); return; }
            if (text === info.value) { setDrafts(previous => without(previous, info.key)); setErrors(previous => without(previous, info.key)); return; }
            apply(info, text);
        };

        const reset = () => {
            const error = deps.resetSettings(id);
            setAskingReset(false);
            setDrafts({});
            setErrors({});
            setAsking(null);
            setResetNote(error ?? RESET_DONE_TEXT);
            setTick(n => n + 1);
        };

        const control = (info: SettingInfo) => {
            const label = settingTitle(info.key);
            if (info.type === "boolean") {
                return (
                    <button
                        type="button"
                        role="switch"
                        aria-checked={info.value === true ? "true" : "false"}
                        aria-label={label}
                        className="amiricord-switch amiricord-pwin-switch"
                        onClick={() => apply(info, info.value !== true)}
                    >
                        <span className="amiricord-knob" />
                    </button>
                );
            }
            if (info.type === "select") {
                return (
                    <select
                        className="amiricord-plugins-select amiricord-pwin-control"
                        aria-label={label}
                        value={String(info.value)}
                        onChange={(event: { target: { value: string; }; }) => {
                            const chosen = info.options?.find(option => String(option.value) === event.target.value);
                            if (chosen) apply(info, chosen.value);
                        }}
                    >
                        {(info.options ?? []).map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                    </select>
                );
            }
            return (
                <input
                    type="text"
                    inputMode={info.type === "number" ? "decimal" : "text"}
                    className="amiricord-plugins-input amiricord-pwin-control"
                    aria-label={label}
                    value={boxText(info, drafts[info.key])}
                    onChange={(event: { target: { value: string; }; }) => setDrafts(previous => ({ ...previous, [info.key]: event.target.value }))}
                    onBlur={() => commitBox(info)}
                    onKeyDown={(event: { key: string; }) => { if (event.key === "Enter") commitBox(info); }}
                />
            );
        };

        const row = (info: SettingInfo) => (
            <div key={info.key} className="amiricord-pwin-row">
                <div className="amiricord-pwin-row-main">
                    <div className="amiricord-pwin-row-text">
                        <div className="amiricord-pwin-row-title">
                            {settingTitle(info.key)}
                            {info.restartNeeded && <span className="amiricord-tag">{RESTART_TAG}</span>}
                            {info.risky && <span className="amiricord-tag amiricord-pwin-risky">{RISKY_TAG}</span>}
                        </div>
                        <div className="amiricord-pwin-row-desc">{info.description}</div>
                    </div>
                    {control(info)}
                </div>
                {asking?.key === info.key && (
                    <div className="amiricord-confirm amiricord-pwin-confirm">
                        <div>{RISKY_QUESTION}</div>
                        <div className="amiricord-confirm-buttons">
                            <button type="button" className="amiricord-button" onClick={() => { send(info, asking.value); setAsking(null); }}>Change anyway</button>
                            <button type="button" className="amiricord-action" onClick={() => { setAsking(null); setDrafts(previous => without(previous, info.key)); }}>Cancel</button>
                        </div>
                    </div>
                )}
                {errors[info.key] !== undefined && <div className="amiricord-pwin-error" role="alert">{errors[info.key]}</div>}
                {restartKeys[info.key] === true && <div className="amiricord-pwin-note">{RESTART_NOTE}</div>}
            </div>
        );

        if (!card) {
            return (
                <ModalRoot size="medium" label="Plugin" onClose={onClose}>
                    <ModalHeader><div className="amiricord-pwin-title">Plugin</div><ModalCloseButton onClick={onClose} /></ModalHeader>
                    <ModalContent><p className="amiricord-hint">{GONE_TEXT}</p></ModalContent>
                </ModalRoot>
            );
        }

        const authors = card.authors;
        return (
            <ModalRoot size="medium" label={card.name} onClose={onClose}>
                <ModalHeader>
                    <div className="amiricord-pwin-title">{card.name}<span className="amiricord-plugin-version">v{card.version}</span></div>
                    <ModalCloseButton onClick={onClose} />
                </ModalHeader>
                <ModalContent>
                    <p className="amiricord-pwin-desc">{card.description || "This plugin has no description."}</p>
                    <div className="amiricord-plugin-badges">
                        {cardBadges(card).map((badge, index) => <span key={`${index}:${badge.text}`} className={`amiricord-plugin-badge amiricord-plugin-badge-${badge.tone}`}>{badge.text}</span>)}
                    </div>

                    <section className="amiricord-pwin-section">
                        <div className="amiricord-pwin-heading">Authors</div>
                        <div className="amiricord-pwin-authors">
                            {authors.length > 0
                                ? authors.map(author => <Author key={author.name} name={author.name} discordId={author.discordId} />)
                                : <span className="amiricord-hint">No authors listed.</span>}
                        </div>
                    </section>

                    <section className="amiricord-pwin-section">
                        <div className="amiricord-pwin-heading">Settings</div>
                        {empty !== null ? <p className="amiricord-hint amiricord-pwin-empty">{empty}</p> : list.map(row)}
                        {Custom && (
                            <div className="amiricord-pwin-custom">
                                {Guard ? <Guard label={`The settings of ${card.name}`}><Custom onClose={onClose} /></Guard> : <Custom onClose={onClose} />}
                            </div>
                        )}
                        {resetNote !== null && <div className="amiricord-pwin-note" role="status">{resetNote}</div>}
                    </section>
                </ModalContent>
                <ModalFooter>
                    {list.length > 0 && !askingReset && <button type="button" className="amiricord-action amiricord-pwin-reset" onClick={() => setAskingReset(true)}>Reset</button>}
                    {askingReset && (
                        <div className="amiricord-confirm amiricord-pwin-confirm">
                            <div>{RESET_QUESTION}</div>
                            <div className="amiricord-confirm-buttons">
                                <button type="button" className="amiricord-button" onClick={reset}>Reset</button>
                                <button type="button" className="amiricord-action" onClick={() => setAskingReset(false)}>Cancel</button>
                            </div>
                        </div>
                    )}
                    <button type="button" className="amiricord-button" onClick={onClose}>Close</button>
                </ModalFooter>
            </ModalRoot>
        );
    };
}
