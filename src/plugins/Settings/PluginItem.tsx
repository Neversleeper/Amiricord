/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One plugin as a card in the Plugins tab, laid out like TestCord's: the name with the gear (or the "i") and the switch on top, the description,
// a line only when something needs saying (a problem, a restart that is waiting, the answer of the switch, a question), and a footer with where
// the plugin comes from on the left and its marks and first tags on the right. The version and the authors are in the window of the plugin.
// The switch of a core plugin is locked and says why. Turning on an experimental or a legacy plugin asks first.
// The card only draws and reports clicks; what happens is decided in `PluginsTab.tsx` and the words come from `pluginsModel.ts`.

import type { PluginCard } from "../../api/pluginCards";
import { GearIcon, InfoIcon } from "./icon";
import { cardFooter, cardStatus, compatibilityNote, isOn, type Outcome, warningText } from "./pluginsModel";

export const CORE_LOCK_TEXT = "Core plugins keep Amiricord working and are always on";

/** A question the card is asking before it turns a plugin on. */
export interface Question {
    kind: "experimental" | "legacy";
}

export interface PluginItemProps {
    card: PluginCard;
    /** The last answer of the switch for this plugin, if any. */
    note?: Outcome;
    /** A switch is on its way: the card does not take another click until it ends. */
    pending?: boolean;
    question?: Question;
    onSwitch(card: PluginCard): void;
    onConfirm(card: PluginCard): void;
    onCancel(card: PluginCard): void;
    /** The gear (the plugin has settings) or the "i" (it has none) was pressed: open the window of the plugin. */
    onDetails(card: PluginCard): void;
}

/** A gear when the plugin has settings, an "i" when it has none. Both open the same window. */
function DetailsButton({ card, onDetails }: Pick<PluginItemProps, "card" | "onDetails">) {
    const label = card.hasSettings ? `${card.name}: open its settings` : `${card.name}: open its details`;
    return (
        <button type="button" className="amiricord-plugin-details" aria-label={label} title={card.hasSettings ? "Settings" : "Details"} onClick={() => onDetails(card)}>
            {card.hasSettings ? <GearIcon /> : <InfoIcon />}
        </button>
    );
}

function Switch({ card, pending, onSwitch }: Pick<PluginItemProps, "card" | "pending" | "onSwitch">) {
    const locked = card.core;
    const on = isOn(card);
    const blocked = locked || pending === true;
    const label = locked ? `${card.name}: ${CORE_LOCK_TEXT}` : `${card.name}: ${on ? "turn off" : "turn on"}`;
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on ? "true" : "false"}
            aria-disabled={blocked ? "true" : "false"}
            aria-label={label}
            title={locked ? CORE_LOCK_TEXT : undefined}
            className={`amiricord-switch amiricord-plugin-switch${locked ? " amiricord-plugin-switch-locked" : ""}`}
            onClick={() => { if (!blocked) onSwitch(card); }}
        >
            <span className="amiricord-knob" />
        </button>
    );
}

export function PluginItem({ card, note, pending, question, onSwitch, onConfirm, onCancel, onDetails }: PluginItemProps) {
    const status = cardStatus(card);
    const problem = card.state.error !== null || card.state.skipped !== undefined;
    const compat = compatibilityNote(card);
    const footer = cardFooter(card);
    const extra = status !== null || compat !== undefined || note !== undefined || question !== undefined;
    return (
        <div className={`amiricord-card amiricord-plugin${isOn(card) ? "" : " amiricord-plugin-off"}`} data-plugin={card.id}>
            <div className="amiricord-plugin-head">
                <div className="amiricord-plugin-name">{card.name}</div>
                <div className="amiricord-plugin-controls">
                    <DetailsButton card={card} onDetails={onDetails} />
                    <Switch card={card} pending={pending} onSwitch={onSwitch} />
                </div>
            </div>
            <p className="amiricord-plugin-desc">{card.description || "This plugin has no description."}</p>
            {extra && (
                <div className="amiricord-plugin-extra">
                    {status !== null && <div className={`amiricord-plugin-status${problem ? " amiricord-plugin-status-problem" : ""}`}>{status}</div>}
                    {compat && <div className="amiricord-plugin-compat">{compat}</div>}
                    {note && <div className={`amiricord-plugin-note amiricord-plugin-note-${note.tone}`} role="status">{note.text}</div>}
                    {question && (
                        <div className="amiricord-confirm amiricord-plugin-question">
                            <div>{warningText(card, question.kind)}</div>
                            <div className="amiricord-confirm-buttons">
                                <button type="button" className="amiricord-button" onClick={() => onConfirm(card)}>Turn on anyway</button>
                                <button type="button" className="amiricord-action" onClick={() => onCancel(card)}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            <div className="amiricord-plugin-footer">
                <span className="amiricord-plugin-source">{footer.source}</span>
                <div className="amiricord-plugin-tags">
                    {footer.marks.map((badge, index) => <span key={`${index}:${badge.text}`} className={`amiricord-plugin-badge amiricord-plugin-badge-${badge.tone}`}>{badge.text}</span>)}
                    {footer.tags.map(tag => <span key={tag} className="amiricord-plugin-tag">{tag}</span>)}
                    {footer.moreTags.length > 0 && <span className="amiricord-plugin-tag" title={footer.moreTags.join(", ")}>+{footer.moreTags.length}</span>}
                </div>
            </div>
        </div>
    );
}
