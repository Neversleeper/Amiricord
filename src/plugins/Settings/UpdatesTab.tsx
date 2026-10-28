/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Updates tab: "Check for updates", the short news of each newer version, "Update now", and the restart that puts the new version to use. The steps are
// in `updatesModel.ts`; the work is the main process's. The one thing this tab sends over the network, through the main process and only when the person presses
// a button, is a request to the project's GitHub releases (docs/decisions.md, 2026-10-28).

import { currentReact } from "../../api/jsxRuntime";
import type { NewsEntry } from "../../shared/updates";
import { RESTART_QUESTION } from "./PluginsTab";
import { createUpdatesModel, type UpdatesDeps, type UpdatesState } from "./updatesModel";

export interface UpdatesTabDeps extends UpdatesDeps {
    /** The patch notes of the versions already installed, newest first. They come inside the program, so they show without any network. */
    history: NewsEntry[];
    /** Restart Discord now. Only called after the person confirmed. */
    restart(): void;
}

function News({ entries }: { entries: NewsEntry[]; }) {
    return (
        <div className="amiricord-updates-news">
            {entries.map(entry => (
                <div key={entry.version} className="amiricord-card amiricord-updates-entry">
                    <div className="amiricord-updates-entry-head">
                        <span className="amiricord-updates-entry-version">{entry.version}</span>
                        {entry.date !== "" && <span className="amiricord-hint">{entry.date}</span>}
                    </div>
                    <div className="amiricord-updates-entry-title">{entry.title}</div>
                    {entry.notes.length > 0 && <ul className="amiricord-updates-entry-notes">{entry.notes.map(note => <li key={note}>{note}</li>)}</ul>}
                </div>
            ))}
        </div>
    );
}

export function makeUpdatesTab(deps: UpdatesTabDeps): () => unknown {
    // One model for the life of the tab's window, so a check in progress is not lost when Discord draws the page again.
    const model = createUpdatesModel(deps);
    return function UpdatesTab() {
        const react = currentReact();
        const state: UpdatesState = react.useSyncExternalStore(model.subscribe, model.getState);
        const [asking, setAsking] = react.useState(false);
        const restartNeeded = state.phase === "installed";
        return (
            <div className="amiricord-tab">
                <div className={`amiricord-card amiricord-plugins-info${restartNeeded ? " amiricord-plugins-restart" : ""}`}>
                    <div className="amiricord-plugins-info-text">
                        <div className="amiricord-plugins-info-title">{restartNeeded ? "Restart required" : "Updates"}</div>
                        <p>{state.message}</p>
                        <p className="amiricord-hint">You have version {state.current}.</p>
                    </div>
                    {restartNeeded && !asking && <button type="button" className="amiricord-button" onClick={() => setAsking(true)}>Restart Discord</button>}
                    {!restartNeeded && state.canInstall && <button type="button" className="amiricord-button" onClick={() => { void model.install(); }}>Update now</button>}
                    {!restartNeeded && !state.canInstall && (
                        <button type="button" className="amiricord-button" disabled={!state.canCheck} onClick={() => { void model.check(); }}>
                            {state.phase === "checking" ? "Checking..." : "Check for updates"}
                        </button>
                    )}
                </div>
                {restartNeeded && asking && (
                    <div className="amiricord-confirm amiricord-plugins-restart-question">
                        <div>{RESTART_QUESTION}</div>
                        <div className="amiricord-confirm-buttons">
                            <button type="button" className="amiricord-button" onClick={() => { setAsking(false); deps.restart(); }}>Restart now</button>
                            <button type="button" className="amiricord-button amiricord-button-quiet" onClick={() => setAsking(false)}>Not now</button>
                        </div>
                    </div>
                )}
                {state.phase === "available" && state.news.length > 0 && (
                    <>
                        <div className="amiricord-heading">What is new</div>
                        <News entries={state.news} />
                    </>
                )}
                {state.phase === "available" && state.news.length === 0 && <p className="amiricord-hint">This version came without a description.</p>}
                {deps.history.length > 0 && (
                    <>
                        <div className="amiricord-heading">Patch notes</div>
                        <News entries={deps.history} />
                    </>
                )}
            </div>
        );
    };
}
