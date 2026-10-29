/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Updates tab: "Check for updates", the short news of each newer version, "Update now", and the restart that puts the new version to use. The steps are
// in `updatesModel.ts`; the work is the main process's. The one thing this tab sends over the network, through the main process and only when the person presses
// a button, is a request to the project's GitHub releases (docs/decisions.md, 2026-10-28).

import { currentReact } from "../../api/jsxRuntime";
import { OWNERS } from "../../shared/project";
import type { NewsEntry } from "../../shared/updates";
import type { AuthorInfo } from "./authorModel";
import { DiscordMarkIcon, GitHubIcon } from "./icon";
import { RESTART_QUESTION } from "./PluginsTab";
import { createUpdatesModel, type UpdatesDeps, type UpdatesState } from "./updatesModel";

export interface UpdatesTabDeps extends UpdatesDeps {
    /** The patch notes of the versions already installed, newest first. They come inside the program, so they show without any network. */
    history: NewsEntry[];
    /** Restart Discord now. Only called after the person confirmed. */
    restart(): void;
    /** The name and picture Discord shows for a person (the same lookup the plugin window uses). Without it only the GitHub name is drawn. */
    lookupAuthor?(id: string): Promise<AuthorInfo | null>;
}

/** "Published by": the GitHub mark and name (a link to the profile) and, for an owner of the project, the picture and name Discord shows for them. */
function Publisher({ name, lookupAuthor }: { name: string; lookupAuthor?: UpdatesTabDeps["lookupAuthor"]; }) {
    const react = currentReact();
    const owner = OWNERS.find(candidate => candidate.github.toLowerCase() === name.toLowerCase());
    const [info, setInfo] = react.useState<AuthorInfo | null>(null);
    react.useEffect(() => {
        let alive = true;
        if (owner && lookupAuthor) lookupAuthor(owner.discordId).then(found => { if (alive) setInfo(found); }, () => undefined);
        return () => { alive = false; };
    }, [owner?.discordId]);
    return (
        <div className="amiricord-updates-publisher">
            <span className="amiricord-hint">Published by</span>
            {info?.avatarUrl && <img className="amiricord-updates-avatar" src={info.avatarUrl} alt="" />}
            <a className="amiricord-updates-chip" href={`https://github.com/${name}`} target="_blank" rel="noreferrer noopener" title="Open the GitHub profile">
                <GitHubIcon />
                <span>{name}</span>
            </a>
            {info && (
                <span className="amiricord-updates-chip" title="Discord name">
                    <DiscordMarkIcon />
                    <span>{info.displayName}</span>
                </span>
            )}
        </div>
    );
}

function News({ entries, lookupAuthor }: { entries: NewsEntry[]; lookupAuthor?: UpdatesTabDeps["lookupAuthor"]; }) {
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
                    {entry.author && <Publisher name={entry.author} lookupAuthor={lookupAuthor} />}
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
                        <News entries={state.news} lookupAuthor={deps.lookupAuthor} />
                    </>
                )}
                {state.phase === "available" && state.news.length === 0 && <p className="amiricord-hint">This version came without a description.</p>}
                {deps.history.length > 0 && (
                    <>
                        <div className="amiricord-heading">Patch notes</div>
                        <News entries={deps.history} lookupAuthor={deps.lookupAuthor} />
                    </>
                )}
            </div>
        );
    };
}
