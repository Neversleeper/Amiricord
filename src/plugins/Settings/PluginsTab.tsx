/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Plugins tab, laid out like TestCord's (the owner's reference): a card that says "Plugin Management" or, when something waits for a
// restart, "Restart required"; two count cards; a search box with filters; a grid of plugin cards; and, apart, the core plugins that cannot
// be turned off. The data and the switch come from the engine (`ctx.plugins`); what to show is decided in `pluginsModel.ts` and each card is
// drawn by `PluginItem.tsx`. Nothing here talks to the network. Design: docs/analysis-18-plugins-tab.md.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCard } from "../../api/pluginCards";
import type { ToggleResult } from "../../api/pluginSwitch";
import { PluginItem, type Question } from "./PluginItem";
import {
    applyFilter, countCards, DEFAULT_FILTER, emptyText, filterOptions, isFilterActive, isOn, originLabel, type Outcome, outcomeOf,
    type PluginsFilter, RISK_FILTERS, type RiskFilter, STATE_FILTERS, type StateFilter, waitingForRestart, warningBeforeEnabling
} from "./pluginsModel";
import { NO_WINDOW_TEXT } from "./pluginWindowModel";

export interface PluginsTabDeps {
    /** The cards of every plugin, with their state right now. */
    cards(): PluginCard[];
    /** Turn a plugin on or off. Never throws. */
    toggle(id: string, enabled: boolean): Promise<ToggleResult>;
    /** Restart Discord now. Only called after the person confirmed. */
    restart(): void;
    /** Open the window of a plugin (its settings, authors and description). False when it could not be opened. */
    openDetails(card: PluginCard): boolean;
}

export const RESTART_QUESTION = "Restarting closes any call and loses messages you have not sent.";

interface AskedQuestion extends Question {
    id: string;
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string; }>; onChange(value: string): void; }) {
    return (
        <select className="amiricord-plugins-select" aria-label={label} value={value} onChange={(event: { target: { value: string; }; }) => onChange(event.target.value)}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
}

function Stat({ title, value, hint, ratio }: { title: string; value: string; hint: string; ratio?: number; }) {
    return (
        <div className="amiricord-card amiricord-plugins-stat">
            <div className="amiricord-plugins-stat-title">{title}</div>
            <div className="amiricord-plugins-stat-value">{value}</div>
            <div className="amiricord-plugins-stat-hint">{hint}</div>
            {ratio !== undefined && (
                <div className="amiricord-plugins-bar" aria-hidden="true">
                    <div className="amiricord-plugins-bar-fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }} />
                </div>
            )}
        </div>
    );
}

export function makePluginsTab(deps: PluginsTabDeps): () => unknown {
    return function PluginsTab() {
        const react = currentReact();
        const [filter, setFilter] = react.useState<PluginsFilter>(DEFAULT_FILTER);
        const [notes, setNotes] = react.useState<Record<string, Outcome>>({});
        const [pending, setPending] = react.useState<Record<string, boolean>>({});
        const [question, setQuestion] = react.useState<AskedQuestion | null>(null);
        const [askingRestart, setAskingRestart] = react.useState(false);
        // Changes when a switch ends, so the page reads the cards again.
        const [, setRefresh] = react.useState(0);

        const cards = deps.cards();
        const counts = countCards(cards);
        const waiting = waitingForRestart(cards);
        const lists = applyFilter(cards, filter);
        const options = filterOptions(cards);

        const run = (card: PluginCard, enabled: boolean) => {
            setQuestion(null);
            // While it works the card says so: a plugin that waits for something in Discord can take up to a minute, and its switch stays blocked until then.
            setNotes(previous => ({ ...previous, [card.id]: { text: enabled ? `Starting ${card.name}... if it has to wait for something in Discord this can take up to a minute.` : `Turning ${card.name} off...`, tone: "info" } }));
            setPending(previous => ({ ...previous, [card.id]: true }));
            deps.toggle(card.id, enabled)
                .then(result => outcomeOf(result, card, enabled))
                .catch((error: unknown): Outcome => ({ text: `Not changed: ${error instanceof Error ? error.message : String(error)}`, tone: "bad" }))
                .then(outcome => {
                    setNotes(previous => ({ ...previous, [card.id]: outcome }));
                    setPending(previous => { const { [card.id]: _done, ...rest } = previous; return rest; });
                    setRefresh(n => n + 1);
                });
        };

        const onSwitch = (card: PluginCard) => {
            if (card.core) return;
            const enabled = !isOn(card);
            const kind = enabled ? warningBeforeEnabling(card) : undefined;
            if (kind) { setQuestion({ id: card.id, kind }); return; }
            run(card, enabled);
        };

        const onDetails = (card: PluginCard) => {
            let opened = false;
            try {
                opened = deps.openDetails(card);
            } catch {
                opened = false;
            }
            if (!opened) setNotes(previous => ({ ...previous, [card.id]: { text: NO_WINDOW_TEXT, tone: "bad" } }));
        };

        const draw = (card: PluginCard) => (
            <PluginItem
                key={card.id}
                card={card}
                note={notes[card.id]}
                pending={pending[card.id] === true}
                question={question?.id === card.id ? question : undefined}
                onSwitch={onSwitch}
                onConfirm={target => run(target, true)}
                onCancel={() => setQuestion(null)}
                onDetails={onDetails}
            />
        );

        const restartNeeded = waiting.length > 0;
        const shown = lists.plugins.length;
        const empty = emptyText(counts, shown, filter);
        const update = (patch: Partial<PluginsFilter>) => setFilter(previous => ({ ...previous, ...patch }));
        // The quick filters under the search box: the same "state" filter as the dropdown, with how many plugins each one shows. The last two appear only when there is something to show.
        const quick: Array<{ value: StateFilter; label: string; count: number; }> = [
            { value: "all", label: "All", count: counts.plugins },
            { value: "on", label: "On", count: counts.pluginsOn },
            { value: "off", label: "Off", count: counts.plugins - counts.pluginsOn },
            ...(waiting.length > 0 ? [{ value: "restart" as const, label: "Needs a restart", count: waiting.length }] : []),
            ...(counts.problems > 0 ? [{ value: "problems" as const, label: "Problems", count: counts.problems }] : [])
        ];

        return (
            <div className="amiricord-tab">
                <div className={`amiricord-card amiricord-plugins-info${restartNeeded ? " amiricord-plugins-restart" : ""}`}>
                    <div className="amiricord-plugins-info-text">
                        <div className="amiricord-plugins-info-title">{restartNeeded ? "Restart required" : "Plugin Management"}</div>
                        <p>{restartNeeded ? `Restart Discord to apply the changes to ${waiting.join(", ")}.` : "Search, filter, and turn plugins on or off from one place."}</p>
                    </div>
                    {restartNeeded && !askingRestart && (
                        <button type="button" className="amiricord-button" onClick={() => setAskingRestart(true)}>Restart Discord</button>
                    )}
                </div>
                {restartNeeded && askingRestart && (
                    <div className="amiricord-confirm amiricord-plugins-restart-question">
                        <div>{RESTART_QUESTION}</div>
                        <div className="amiricord-confirm-buttons">
                            <button type="button" className="amiricord-button" onClick={() => deps.restart()}>Restart now</button>
                            <button type="button" className="amiricord-action" onClick={() => setAskingRestart(false)}>Cancel</button>
                        </div>
                    </div>
                )}

                <div className="amiricord-plugins-stats">
                    <Stat title="Plugins" value={counts.plugins === 0 ? "None yet" : `${counts.pluginsOn} of ${counts.plugins} on`} hint="Plugins you can turn on and off" ratio={counts.plugins === 0 ? 0 : counts.pluginsOn / counts.plugins} />
                    <Stat title="Core plugins" value={String(counts.core)} hint="Always on, they keep Amiricord working" />
                </div>

                <div className="amiricord-plugins-toolbar">
                    <input
                        type="text"
                        className="amiricord-plugins-input"
                        aria-label="Search for a plugin"
                        placeholder="Search for a plugin..."
                        value={filter.search}
                        onChange={(event: { target: { value: string; }; }) => update({ search: event.target.value })}
                    />
                    <div className="amiricord-plugins-chips" role="group" aria-label="Quick filter">
                        {quick.map(chip => (
                            <button
                                key={chip.value}
                                type="button"
                                className={`amiricord-plugins-chip${filter.state === chip.value ? " amiricord-plugins-chip-on" : ""}`}
                                aria-pressed={filter.state === chip.value ? "true" : "false"}
                                onClick={() => update({ state: chip.value })}
                            >
                                {chip.label}<span className="amiricord-plugins-chip-count">{chip.count}</span>
                            </button>
                        ))}
                    </div>
                    <div className="amiricord-plugins-filters">
                        <Choice label="Filter by state" value={filter.state} options={STATE_FILTERS} onChange={value => update({ state: value as StateFilter })} />
                        <Choice
                            label="Filter by origin"
                            value={filter.origin}
                            options={[{ value: "", label: "All origins" }, ...options.origins.map(origin => ({ value: origin, label: originLabel(origin) }))]}
                            onChange={value => update({ origin: value })}
                        />
                        <Choice label="Filter by risk" value={filter.risk} options={RISK_FILTERS} onChange={value => update({ risk: value as RiskFilter })} />
                        <Choice
                            label="Filter by tag"
                            value={filter.tag}
                            options={[{ value: "", label: "All tags" }, ...options.tags.map(tag => ({ value: tag, label: tag }))]}
                            onChange={value => update({ tag: value })}
                        />
                        <Choice
                            label="Filter by author"
                            value={filter.author}
                            options={[{ value: "", label: "All authors" }, ...options.authors.map(author => ({ value: author, label: author }))]}
                            onChange={value => update({ author: value })}
                        />
                    </div>
                </div>
                {isFilterActive(filter) && <button type="button" className="amiricord-action amiricord-plugins-clear" onClick={() => setFilter(DEFAULT_FILTER)}>Clear filters</button>}

                <div className="amiricord-heading">Plugins<span className="amiricord-heading-count">{shown}</span></div>
                {shown > 0
                    ? <div className="amiricord-plugins-grid">{lists.plugins.map(draw)}</div>
                    : <p className="amiricord-hint amiricord-plugins-empty">{empty}</p>}

                <hr className="amiricord-divider" />
                <div className="amiricord-heading">Core plugins</div>
                <p className="amiricord-hint">These keep Amiricord working and cannot be turned off.</p>
                {lists.core.length > 0
                    ? <div className="amiricord-plugins-grid">{lists.core.map(draw)}</div>
                    : <p className="amiricord-hint amiricord-plugins-empty">{isFilterActive(filter) ? "No core plugin matches the search and the filters." : "No core plugins."}</p>}
            </div>
        );
    };
}
