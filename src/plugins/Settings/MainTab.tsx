/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main tab of the Amiricord section, laid out like TestCord's main tab (the owner's reference): a top card, Quick Actions, Client Settings
// (switches, a drop-down, the notification buttons) and, ours, the engine status. Everything in the middle comes from lists (`mainItems.ts`):
// a feature that gets built later turns its own entry from "coming soon" into a working one and this page does not change.
// An entry marked `soon` is drawn dimmed, says so, and does nothing: no button here pretends to work.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCard } from "../../api/pluginCards";
import type { EngineStatus } from "../../renderer/engine";
import { InfoIcon, WarningIcon } from "./icon";
import type { ButtonGroupItem, ChoiceItem, QuickActionItem, SettingItem } from "./mainItems";

export interface MainTabDeps {
    status(): EngineStatus;
    /** Turn safe mode off and restart Discord (the next start is a normal one). */
    leaveSafeMode(): void;
    cards(): PluginCard[];
    /** The tiles of Quick Actions, in order. */
    quickActions: QuickActionItem[];
    /** The switches of Client Settings. */
    settings: SettingItem[];
    /** The drop-downs that follow the switches. */
    choices: ChoiceItem[];
    /** The groups of buttons at the end of the settings. */
    buttonGroups: ButtonGroupItem[];
    /** The logo as a data URL. If it fails to load, a letter is drawn instead. */
    logo: string;
    /** A wide picture drawn faintly behind the logo of the banner. Optional. */
    banner?: string;
    /** The "Settings tabs" card with Editor Mode, drawn at the top. */
    editor: () => unknown;
}

export const SOON_TEXT = "Coming soon";
export const RESTART_TEXT = "Restart";

function Logo({ src }: { src: string; }) {
    const [failed, setFailed] = currentReact().useState(false);
    if (failed || !src) return <div className="amiricord-logo-fallback" aria-hidden="true">A</div>;
    return <img className="amiricord-logo" src={src} alt="Amiricord" onError={() => setFailed(true)} />;
}

/** The way out of safe mode. Restarting loses a call or a draft, so the first click only opens the question. */
function LeaveSafeMode({ leave }: { leave: () => void; }) {
    const [asking, setAsking] = currentReact().useState(false);
    if (!asking) return <button type="button" className="amiricord-button" onClick={() => setAsking(true)}>Leave safe mode</button>;
    return (
        <div className="amiricord-confirm">
            <div>Discord restarts now and the plugins start again. A call or an unsent message is lost.</div>
            <div className="amiricord-confirm-buttons">
                <button type="button" className="amiricord-button" onClick={leave}>Leave and restart</button>
                <button type="button" className="amiricord-button" onClick={() => setAsking(false)}>Cancel</button>
            </div>
        </div>
    );
}

/** `soon` tags stay hidden until the row is hovered or clicked, so the page looks like a finished one. */
function Tag({ children, soon }: { children?: unknown; soon?: boolean; }) {
    return <span className={`amiricord-tag${soon ? " amiricord-tag-soon" : ""}`}>{children}</span>;
}

/** An action that loses something (calls, drafts) asks first: the first click only opens the question. */
function ConfirmTile({ item }: { item: QuickActionItem; }) {
    const [asking, setAsking] = currentReact().useState(false);
    const Icon = item.Icon;
    if (!asking) return <button type="button" className="amiricord-action" onClick={() => setAsking(true)}><Icon />{item.title}</button>;
    return (
        <div className="amiricord-confirm">
            <div>{item.confirm?.text}</div>
            <div className="amiricord-confirm-buttons">
                <button type="button" className="amiricord-button" onClick={item.run}>{item.confirm?.button}</button>
                <button type="button" className="amiricord-action" onClick={() => setAsking(false)}>Cancel</button>
            </div>
        </div>
    );
}

function Tile({ item }: { item: QuickActionItem; }) {
    const Icon = item.Icon;
    if (item.soon) {
        // Not disabled for the browser (a disabled button shows no tooltip); it only does nothing, and says why.
        return <button type="button" className="amiricord-action amiricord-soon" aria-disabled="true" data-soon={SOON_TEXT}><Icon />{item.title}</button>;
    }
    if (item.confirm) return <ConfirmTile item={item} />;
    return <button type="button" className="amiricord-action" onClick={item.run}><Icon />{item.title}</button>;
}

/** A switch that follows the look of Discord's: a pill with a round knob. A working one follows its feature and can be changed; a soon one is drawn off and cannot. */
function SwitchRow({ item }: { item: SettingItem; }) {
    const react = currentReact();
    const live = item.live;
    const [on, setOn] = react.useState(live ? live.get() : false);
    // Heard from somewhere else (the editor window turns it on), so the page never shows an old answer.
    react.useEffect(() => (live ? live.subscribe(() => setOn(live.get())) : undefined), [live]);
    const toggle = () => {
        if (!live) return;
        const next = !on;
        setOn(next);
        live.set(next);
    };
    const key = (event: { key?: string; preventDefault?(): void; }) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault?.();
            toggle();
        }
    };
    return (
        <div className={`amiricord-switch-row${item.soon ? " amiricord-soon" : ""}`}>
            <div className="amiricord-switch-text">
                <div className="amiricord-switch-title">
                    {item.title}
                    {item.soon && <Tag soon>{SOON_TEXT}</Tag>}
                    {item.restart && <Tag>{RESTART_TEXT}</Tag>}
                </div>
                <div className="amiricord-switch-desc">{item.description}</div>
                {item.warning && <div className="amiricord-warning"><WarningIcon /><span>{item.warning}</span></div>}
            </div>
            <div
                role="switch" aria-checked={live && on ? "true" : "false"} aria-disabled={live ? "false" : "true"} aria-label={item.title}
                tabIndex={live ? 0 : -1} className={`amiricord-switch${live ? " amiricord-switch-live" : ""}`} onClick={live ? toggle : undefined} onKeyDown={live ? key : undefined}
            ><span className="amiricord-knob" /></div>
        </div>
    );
}

function ChoiceRow({ item }: { item: ChoiceItem; }) {
    const react = currentReact();
    const live = item.live;
    const [picked, setPicked] = react.useState(live ? live.get() : 0);
    // Heard from somewhere else, so the page never shows an old answer.
    react.useEffect(() => (live ? live.subscribe(() => setPicked(live.get())) : undefined), [live]);
    return (
        <div className={`amiricord-choice${item.soon ? " amiricord-soon" : ""}`}>
            <div className="amiricord-switch-title">
                {item.title}
                {item.soon && <Tag soon>{SOON_TEXT}</Tag>}
                {item.restart && <Tag>{RESTART_TEXT}</Tag>}
            </div>
            <div className="amiricord-switch-desc">{item.description}</div>
            {live
                ? (
                    <select
                        className="amiricord-plugins-select" aria-label={item.title} value={String(picked)}
                        onChange={(event: { target: { value: string; }; }) => {
                            const next = Number(event.target.value);
                            if (!Number.isInteger(next) || next < 0 || next >= item.choices.length) return;
                            setPicked(next);
                            live.set(next);
                        }}
                    >
                        {item.choices.map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
                    </select>
                )
                : <div className="amiricord-select" role="combobox" aria-disabled={item.soon ? "true" : "false"} aria-expanded="false" aria-label={item.title}>{item.choices[0]}</div>}
        </div>
    );
}

function ButtonGroup({ item }: { item: ButtonGroupItem; }) {
    return (
        <section className="amiricord-group">
            <div className="amiricord-heading">{item.title}</div>
            <p className="amiricord-hint">{item.description}</p>
            <div className="amiricord-group-buttons">
                {item.buttons.map(button => button.soon
                    ? <button key={button.id} type="button" className="amiricord-button amiricord-soon" aria-disabled="true" data-soon={SOON_TEXT}>{button.title}</button>
                    : <button key={button.id} type="button" className="amiricord-button" onClick={button.run}>{button.title}</button>)}
            </div>
        </section>
    );
}

function Row({ name, children }: { name: string; children?: unknown; }) {
    return (
        <div className="amiricord-row">
            <div className="amiricord-row-name">{name}</div>
            <div className="amiricord-row-value">{children}</div>
        </div>
    );
}

const list = (names: readonly string[]) => names.join(", ");

/** One line for what privacy plugins stopped inside Discord this session, or a plain "nothing yet" when the counters are all zero. */
export function stoppedText(stopped: Readonly<Record<"analytics" | "metrics" | "crash-reports", number>>): string {
    const parts: string[] = [];
    if (stopped.analytics > 0) parts.push(`${stopped.analytics} usage ${stopped.analytics === 1 ? "event" : "events"}`);
    if (stopped.metrics > 0) parts.push(`${stopped.metrics} ${stopped.metrics === 1 ? "metric" : "metrics"}`);
    if (stopped["crash-reports"] > 0) parts.push(`${stopped["crash-reports"]} crash report ${stopped["crash-reports"] === 1 ? "hook" : "hooks"}`);
    return parts.length ? parts.join(", ") : "Nothing yet";
}

/** One line for what the network firewall cancelled this session, or a plain "nothing yet". (NoTrack usually stops these first, so this often stays empty.) */
export function networkText(network: Readonly<Record<"usage-reports" | "metrics" | "crash-reports" | "telemetry-host" | "host-rules", number>>): string {
    const parts: string[] = [];
    const add = (count: number, one: string, many: string) => { if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`); };
    add(network["usage-reports"], "usage report", "usage reports");
    add(network.metrics, "metrics report", "metrics reports");
    add(network["crash-reports"], "crash report", "crash reports");
    add(network["telemetry-host"], "telemetry ping", "telemetry pings");
    if (network["host-rules"] > 0) parts.push(`${network["host-rules"]} blocked by your rules`);
    return parts.length ? parts.join(", ") : "Nothing yet";
}

/** One line for the token guard: how many requests had the account's token removed because their host may not get it. */
export function tokenText(stripped: number): string {
    return stripped > 0 ? `${stripped} ${stripped === 1 ? "request" : "requests"} had the token removed` : "Nothing needed";
}

/** One line for encrypted DNS: what the main process said, or a plain "not known yet" before it has answered. */
export function dnsRowText(line: string): string {
    return line === "" ? "Not known yet" : line;
}

const CHECK_NAMES: Record<string, string> = { "super-properties": "properties", "first-gateway-message": "first message" };
const VERDICT_WORDS = { pass: "passed", fail: "FAILED", "not-seen": "not seen" } as const;

/** One line for the privacy self-test: what each check found. A failure is said loudly; "not seen" is never called a pass. */
export function selfTestText(results: ReadonlyArray<{ name: string; status: "pass" | "fail" | "not-seen"; }>): string {
    if (results.length === 0) return "Running";
    const parts = results.map(r => `${CHECK_NAMES[r.name] ?? r.name} ${VERDICT_WORDS[r.status]}`);
    const failed = results.some(r => r.status === "fail");
    return failed ? `FAILED: Discord was told this client has mods (${parts.join(", ")})` : parts.join(", ");
}

export function makeMainTab(deps: MainTabDeps): () => unknown {
    const Editor = deps.editor;
    return function MainTab() {
        const status = deps.status();
        const cards = deps.cards();
        // The plugin that draws this page is itself a plugin, a core one that is always on; it is counted apart so the owner is not told
        // "1 plugin on" when he has installed none.
        const core = cards.filter(card => card.core);
        const others = cards.filter(card => !card.core);
        const running = others.filter(card => card.state.running).length;
        const waiting = cards.filter(card => card.state.restartNeeded).map(card => card.name);
        const healthy = !status.safeMode && status.problems.length === 0 && status.quarantine.length === 0 && !status.selfTests.some(t => t.status === "fail");

        return (
            <div className="amiricord-tab">
                <Editor />
                {/* The logo over a faint picture, with the state of the engine in the corner. */}
                <div className="amiricord-card amiricord-banner">
                    {deps.banner && <img className="amiricord-banner-art" src={deps.banner} alt="" aria-hidden="true" />}
                    <Logo src={deps.logo} />
                    <div className="amiricord-banner-status">
                        <span className={`amiricord-status-pill ${healthy ? "amiricord-status-pill-good" : "amiricord-status-pill-warn"}`}>
                            {status.safeMode ? "Safe mode" : healthy ? "Engine running" : "Needs attention"}
                        </span>
                        {status.discordBuild !== null && <span className="amiricord-status-pill">Discord build {status.discordBuild}</span>}
                    </div>
                </div>

                <div className="amiricord-heading">Shortcuts</div>
                <p className="amiricord-hint">The things you will reach for most, one click away.</p>
                <div className="amiricord-card amiricord-actions">
                    {deps.quickActions.map(item => <Tile key={item.id} item={item} />)}
                </div>

                <hr className="amiricord-divider" />
                <div className="amiricord-heading">Window and behavior</div>
                <p className="amiricord-hint">Choose how Amiricord changes the look and the behavior of the Discord window.</p>
                <div className="amiricord-notice">
                    <InfoIcon />
                    <span>Options tagged &ldquo;{SOON_TEXT}&rdquo; are not built yet; each one starts working here as soon as it is ready.</span>
                </div>
                {deps.settings.map(item => <SwitchRow key={item.id} item={item} />)}
                {deps.choices.map(item => <ChoiceRow key={item.id} item={item} />)}
                {deps.buttonGroups.map(item => <ButtonGroup key={item.id} item={item} />)}

                <hr className="amiricord-divider" />
                <div className="amiricord-heading">Engine status</div>
                <p className="amiricord-hint">What Amiricord decided when Discord started. Nothing here is sent anywhere.</p>
                <div className="amiricord-rows">
                    <Row name="Version">Amiricord {status.version}</Row>
                    <Row name="Discord build">{status.discordBuild === null ? "Unknown" : String(status.discordBuild)}</Row>
                    <Row name="Plugins">
                        {`${core.length} core ${core.length === 1 ? "plugin" : "plugins"}, ${others.length === 0 ? "no plugins installed yet" : `${running} of ${others.length} plugins on`}`}
                    </Row>
                    <Row name="Safe mode">
                        {status.safeMode
                            ? `On${status.safeModeReason ? `: ${status.safeModeReason}` : ""}${status.enteredSafeMode ? " (entered by itself after failed starts)" : ""}`
                            : "Off"}
                    </Row>
                    {status.safeMode && <div className="amiricord-row-action"><LeaveSafeMode leave={deps.leaveSafeMode} /></div>}
                    <Row name="Privacy check">{selfTestText(status.selfTests)}</Row>
                    <Row name="Stopped inside Discord">{stoppedText(status.stopped)}</Row>
                    <Row name="Cancelled on the network">{networkText(status.network)}</Row>
                    <Row name="Encrypted DNS">{dnsRowText(status.dns)}</Row>
                    <Row name="Token kept safe">{tokenText(status.network["token-stripped"])}</Row>
                    <Row name="Quarantined plugins">{status.quarantine.length ? list(status.quarantine) : "None"}</Row>
                    <Row name="Waiting for a restart">{waiting.length ? list(waiting) : "No plugin"}</Row>
                    <Row name="Developer mode">{status.devMode ? "On" : "Off"}</Row>
                    <Row name="Problems">{status.problems.length ? status.problems.join("; ") : "None"}</Row>
                </div>
            </div>
        );
    };
}
