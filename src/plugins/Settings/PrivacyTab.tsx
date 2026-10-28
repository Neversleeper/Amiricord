/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Privacy & Security tab (P7a to show, P7b to change). Order and wording: docs/analysis-22-privacy-security-tab-build.md sections 2 and 10 (answer first, then the switches,
// Secure Connect, who the client talks to, counters, the owner's host rules). The page never decides a change: it asks the main process, which asks the person (a window the
// page cannot answer) when the change would weaken protection, and says in a sentence what happened. The look is the one of the main tab (same classes).

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCard } from "../../api/pluginCards";
import type { EngineStatus } from "../../renderer/engine";
import type { BlockLog } from "../../shared/blocks";
import { DEFAULT_PROVIDER, type PrivacyAnswer, type PrivacyDnsMode, type ProviderTestAnswer } from "../../shared/privacy";
import type { PrivacyChange, PrivacyChangeResult } from "../../shared/privacyChange";
import { dnsRowText, RESTART_TEXT, selfTestText, SOON_TEXT } from "./MainTab";
import { ageText, blockItems, filterBlocks, pageOfBlocks } from "./recentBlocks";

export interface PrivacyTabDeps {
    status(): EngineStatus;
    cards(): PluginCard[];
    /** The snapshot from the main process; null when it did not answer. */
    read(): Promise<PrivacyAnswer | null>;
    /** "Test now" for one provider by id. */
    test(id: string): Promise<ProviderTestAnswer | null>;
    /** One change. The main process decides and may ask the person; null when it did not answer. */
    change(change: PrivacyChange): Promise<PrivacyChangeResult | null>;
    /** The recent blocks, grouped; null when the main process did not answer. */
    blocks(): Promise<BlockLog | null>;
    /** Restart Discord now. The tab asks the person first. */
    restart(): void;
    /** Milliseconds of this page's clock, for the lines that were stopped inside Discord. */
    now?(): number;
    /** The two telemetry switches (NoTrack's settings) as this page's copy holds them: what the part inside Discord follows until the next start. */
    telemetry(): { usage: boolean; crash: boolean; };
    /** How often the snapshot is asked again while the tab is open. */
    refreshMs?: number;
}

export const REFRESH_MS = 2000;

export interface Verdict {
    level: "good" | "warn" | "bad";
    /** The word of the badge. */
    title: string;
    detail: string;
}

/** The answer first. Encrypted DNS is shown on its own and is not part of this verdict: it is off unless the owner chose it. */
export function verdictOf(selfTests: ReadonlyArray<{ status: "pass" | "fail" | "not-seen"; }>, telemetry: { usage: boolean; crash: boolean; }, paused = false): Verdict {
    if (selfTests.some(test => test.status === "fail")) return { level: "bad", title: "Check needed", detail: "Discord was told this client has mods. The Privacy check below says which test failed." };
    if (paused) return { level: "warn", title: "Paused", detail: "The network shields and your blocked sites are resting for a few minutes. Crash reports, the token guard and encrypted DNS stay as they are." };
    if (!telemetry.usage || !telemetry.crash) return { level: "warn", title: "Partial", detail: "Telemetry blocking is switched off, at least in part." };
    return { level: "good", title: "Active", detail: "Telemetry is blocked and the account token is kept for Discord and for plugins that declared it." };
}

/** "about 6 min left" for the pause banner; never less than one minute while a pause runs. */
export function pauseLeftText(remainingMs: number): string {
    return `about ${Math.max(1, Math.ceil(remainingMs / 60000))} min left`;
}

export const onOff = (value: boolean): string => (value ? "On" : "Off");

/** One line for a provider test: only what is true. */
export function testText(answer: ProviderTestAnswer | null | "running"): string {
    if (answer === "running") return "Testing...";
    if (answer === null) return "The test could not run";
    return answer.ok ? `Answered in ${answer.ms ?? 0} ms` : `Did not pass: ${answer.reason}`;
}

const MODE_WORDS: Record<PrivacyDnsMode, string> = { off: "Off", automatic: "Automatic (falls back to the system's DNS)", strict: "Strict (never falls back)" };

function Tag({ children, soon }: { children?: unknown; soon?: boolean; }) {
    return <span className={`amiricord-tag${soon ? " amiricord-tag-soon" : ""}`}>{children}</span>;
}

function Row({ name, children }: { name: string; children?: unknown; }) {
    return (
        <div className="amiricord-row">
            <div className="amiricord-row-name">{name}</div>
            <div className="amiricord-row-value">{children}</div>
        </div>
    );
}

/** A small status word. A dot that pulses means something is running or the numbers are live ("Active", "Live"); an "Off" badge stays still on purpose. The pulse stops for people who asked their system for less motion. */
function Badge({ level, children }: { level: "good" | "warn" | "bad" | "off" | "live"; children?: unknown; }) {
    return <span className={`amiricord-badge amiricord-badge-${level}`}><span className="amiricord-badge-dot" aria-hidden="true" />{children}</span>;
}

function Card({ title, badge, children }: { title: string; badge?: unknown; children?: unknown; }) {
    return (
        <section className="amiricord-pcard">
            <div className="amiricord-pcard-head">
                <h3 className="amiricord-pcard-title">{title}</h3>
                {badge}
            </div>
            {children}
        </section>
    );
}

/** A switch with its words. Without `onToggle` it only shows the state (the token guard is always on); with it a click or the Enter and Space keys ask for the change. */
function SwitchLine({ title, description, on, restart, onToggle, note, compact }: { title: string; description: string; on: boolean; restart?: boolean; onToggle?: () => void; note?: string; compact?: boolean; }) {
    const key = (event: { key?: string; preventDefault?(): void; }) => {
        if (onToggle && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault?.();
            onToggle();
        }
    };
    return (
        <div className={`amiricord-pswitch${compact ? " amiricord-pswitch-compact" : ""}`}>
            <div className="amiricord-switch-text">
                <div className="amiricord-switch-title">
                    {title}
                    {restart && <Tag>{RESTART_TEXT}</Tag>}
                </div>
                {description !== "" && <div className="amiricord-switch-desc">{description}</div>}
                {note && <div className="amiricord-note">{note}</div>}
            </div>
            <div
                role="switch" aria-checked={on ? "true" : "false"} aria-disabled={onToggle ? "false" : "true"} aria-label={title} tabIndex={onToggle ? 0 : -1}
                className={`amiricord-switch${onToggle ? " amiricord-switch-live" : ""}`} onClick={onToggle} onKeyDown={key}
            ><span className="amiricord-knob" /></div>
        </div>
    );
}

function Tile({ number, label, color }: { number: number; label: string; color: string; }) {
    return (
        <div className="amiricord-tile" style={{ borderTopColor: color }}>
            <div className="amiricord-tile-number">{number}</div>
            <div className="amiricord-tile-label">{label}</div>
        </div>
    );
}

function Chip({ on, children }: { on: boolean; children?: unknown; }) {
    return <span className={`amiricord-pchip${on ? " amiricord-pchip-on" : ""}`}>{children}</span>;
}

export function makePrivacyTab(deps: PrivacyTabDeps): () => unknown {
    return function PrivacyTab() {
        const react = currentReact();
        const [answer, setAnswer] = react.useState<PrivacyAnswer | null | undefined>(undefined);
        const [tests, setTests] = react.useState<Record<string, ProviderTestAnswer | null | "running">>({});
        const [notes, setNotes] = react.useState<Record<string, string>>({});
        const [open, setOpen] = react.useState(false);
        const [relaunching, setRelaunching] = react.useState(false);
        const [blocks, setBlocks] = react.useState<BlockLog | null | undefined>(undefined);
        const [query, setQuery] = react.useState("");
        const [page, setPage] = react.useState(0);
        const [ruleHost, setRuleHost] = react.useState("");
        const [ruleReason, setRuleReason] = react.useState("");
        const [ruleBelow, setRuleBelow] = react.useState(true);

        const refresh = () => {
            deps.read().then(next => { setAnswer(next); }, () => { setAnswer(null); });
        };

        // Ask when the tab opens and then every couple of seconds, only while it is open.
        react.useEffect(() => {
            let alive = true;
            // The list of blocks is asked for only when the number in the snapshot says it changed.
            let seen = -1;
            const loadBlocks = (version: number) => {
                seen = version;
                deps.blocks().then(list => {
                    if (!alive) return;
                    if (!list) seen = -1;
                    setBlocks(list);
                }, () => {
                    seen = -1;
                    if (alive) setBlocks(null);
                });
            };
            const load = () => {
                deps.read().then(next => {
                    if (!alive) return;
                    setAnswer(next);
                    if (next && next.logVersion !== seen) loadBlocks(next.logVersion);
                }, () => { if (alive) setAnswer(null); });
            };
            load();
            const timer = setInterval(load, deps.refreshMs ?? REFRESH_MS);
            return () => { alive = false; clearInterval(timer); };
        }, []);

        const runTest = (id: string) => {
            setTests(previous => ({ ...previous, [id]: "running" }));
            deps.test(id).then(
                result => { setTests(previous => ({ ...previous, [id]: result })); },
                () => { setTests(previous => ({ ...previous, [id]: null })); }
            );
        };

        /** Ask for one change, show the sentence the main process answered, and read the snapshot again. */
        const send = (where: string, change: PrivacyChange, applied?: () => void) => {
            setNotes(previous => ({ ...previous, [where]: "Waiting for the answer..." }));
            deps.change(change).then(
                result => {
                    setNotes(previous => ({ ...previous, [where]: result ? result.message : "The main process did not answer." }));
                    if (result?.status === "applied") applied?.();
                    refresh();
                },
                () => { setNotes(previous => ({ ...previous, [where]: "The main process did not answer." })); }
            );
        };

        const status = deps.status();
        const ownCopy = deps.telemetry();
        const telemetry = answer ? answer.telemetry : ownCopy;
        const usagePending = !!answer && answer.telemetry.usage !== ownCopy.usage;
        const crashPending = !!answer && answer.telemetry.crash !== ownCopy.crash;
        const dnsPending = !!answer && answer.dns.pending;
        const restartPending = usagePending || crashPending || dnsPending;
        const pause = answer ? answer.pause : null;
        const verdict = verdictOf(status.selfTests, telemetry, !!pause);
        const counts = answer?.counts ?? status.network;
        const dnsLine = answer ? answer.dns.line : status.dns;
        const dnsOn = answer ? answer.dns.mode !== "off" : false;
        const saved = answer ? answer.dns.saved : null;
        // With nothing saved the tab proposes the default provider; it is only saved when the person turns encrypted DNS on or picks one.
        const chosenId = saved && saved.provider !== "" ? saved.provider : DEFAULT_PROVIDER;
        const chosen = answer ? answer.providers.find(item => item.id === chosenId) : undefined;
        const all = blockItems(blocks ? blocks.groups : [], status.stopped, status.stoppedAt, (deps.now ?? Date.now)());
        const shown = pageOfBlocks(filterBlocks(all, query), page);
        const talkers = deps.cards().filter(card => card.state.running && !card.core && card.hosts.length > 0);
        const setTelemetry = (key: "disableAnalytics" | "disableCrashReports", value: boolean) => () => { send(key, { type: "telemetry", key, value }); };

        return (
            <div className="amiricord-tab">
                <Card title="Privacy Protection" badge={<Badge level={verdict.level}>{verdict.title}</Badge>}>
                    <p className="amiricord-pcard-text">{verdict.detail}</p>
                    {pause && (
                        <div className="amiricord-restart">
                            <div>Paused, {pauseLeftText(pause.remainingMs)}.</div>
                            <button type="button" className="amiricord-button" onClick={() => { send("pause", { type: "resume" }); }}>Resume now</button>
                        </div>
                    )}
                    <div className="amiricord-rows">
                        <Row name="Privacy check">{selfTestText(status.selfTests)}</Row>
                    </div>
                    <SwitchLine
                        title="Block usage reports and metrics" restart={usagePending} on={telemetry.usage} onToggle={setTelemetry("disableAnalytics", !telemetry.usage)} note={notes.disableAnalytics}
                        description="Stops Discord from recording what you do and how the client runs, inside Discord and on the network."
                    />
                    <SwitchLine
                        title="Block crash reports" restart={crashPending} on={telemetry.crash} onToggle={setTelemetry("disableCrashReports", !telemetry.crash)} note={notes.disableCrashReports}
                        description="Stops Discord from sending crash reports to its error service."
                    />
                    <SwitchLine
                        title="Encrypted DNS" restart={dnsPending} on={saved ? saved.mode !== "off" : false} note={notes.dnsSwitch}
                        description="Hides the lookups of site names from your network. It starts in Automatic mode with the provider chosen below."
                        onToggle={answer && saved ? () => { send("dnsSwitch", { type: "dns", mode: saved.mode === "off" ? "automatic" : "off", provider: saved.mode === "off" ? chosenId : saved.provider }); } : undefined}
                    />
                    {answer && (
                        <div className="amiricord-confirm-buttons">
                            {!pause && <button type="button" className="amiricord-action" onClick={() => { send("pause", { type: "pause" }); }}>Pause protection for 10 minutes</button>}
                            <button type="button" className="amiricord-action" onClick={() => { send("pause", { type: "reset-defaults" }); }}>Reset to defaults</button>
                        </div>
                    )}
                    {notes.pause && <div className="amiricord-note">{notes.pause}</div>}
                    {restartPending && (
                        <div className="amiricord-restart">
                            {relaunching ? (
                                <>
                                    <div>Relaunching closes any call and loses messages you have not sent.</div>
                                    <div className="amiricord-confirm-buttons">
                                        <button type="button" className="amiricord-button" onClick={() => { deps.restart(); }}>Relaunch now</button>
                                        <button type="button" className="amiricord-action" onClick={() => setRelaunching(false)}>Cancel</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>A change is saved and finishes when Discord starts again.</div>
                                    <button type="button" className="amiricord-button" onClick={() => setRelaunching(true)}>Relaunch Discord</button>
                                </>
                            )}
                        </div>
                    )}
                </Card>

                <div className="amiricord-grid">
                    <div>
                        <Card title="Secure Connect" badge={<Badge level={dnsOn ? "good" : "off"}>{dnsOn ? "Active" : "Off"}</Badge>}>
                            <p className="amiricord-pcard-text">
                                DNS is how a name such as discord.com becomes an address. Encrypted DNS hides those lookups from your network, but the provider you choose sees them,
                                and the address Discord connects to stays visible.
                            </p>
                            {answer && saved ? (
                                <>
                                    <div className="amiricord-subheading">DNS provider</div>
                                    <div className="amiricord-dropdown">
                                        <button type="button" className="amiricord-select" aria-haspopup="listbox" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>
                                            {chosen ? `${chosen.name}${saved.provider === "" ? " · default" : ""}` : saved.provider === "custom" ? "Your own address" : "Choose a provider"}
                                        </button>
                                        {open && (
                                            <div className="amiricord-options" role="listbox">
                                                {answer.providers.map(item => (
                                                    <button
                                                        key={item.id} type="button" role="option" aria-selected={item.id === chosenId ? "true" : "false"}
                                                        className={`amiricord-option${item.id === chosenId ? " amiricord-option-on" : ""}`}
                                                        onClick={() => { setOpen(false); send("dns", { type: "dns", mode: saved.mode, provider: item.id }); }}
                                                    >{item.name}{item.filters === "malware" && <Tag>Blocks malware sites</Tag>}</button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {chosen && <div className="amiricord-provider-note">{chosen.note}</div>}
                                    <div className="amiricord-rows">
                                        <Row name="Engine">Chromium&rsquo;s own resolver</Row>
                                        <Row name="Encrypted DNS">{dnsRowText(dnsLine)}</Row>
                                        <Row name="Endpoint">{chosen ? chosen.host : "None chosen"}</Row>
                                        <Row name="Mode">{MODE_WORDS[saved.mode]}</Row>
                                    </div>
                                    <SwitchLine
                                        title="Strict mode" restart={dnsPending} on={saved.mode === "strict"} note={notes.dns}
                                        description={saved.mode === "off"
                                            ? "Never falls back to your system's DNS if the provider cannot be reached. Turn Encrypted DNS on first."
                                            : "Never falls back to your system's DNS if the provider cannot be reached. Discord cannot connect while it fails; read the warning before you turn it on."}
                                        onToggle={saved.mode === "off" ? undefined : () => { send("dns", { type: "dns", mode: saved.mode === "strict" ? "automatic" : "strict", provider: chosenId }); }}
                                    />
                                    <div className="amiricord-provider-test-line">
                                        <button type="button" className="amiricord-button" disabled={!chosen || tests[chosenId] === "running"} onClick={() => { if (chosen) runTest(chosen.id); }}>Test now</button>
                                        <button type="button" className="amiricord-button amiricord-button-quiet" onClick={refresh}>Refresh</button>
                                        <span className="amiricord-provider-result">{chosen ? (chosenId in tests ? testText(tests[chosenId]!) : "Test now asks the provider a question; it changes nothing.") : "Choose a provider to test it."}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="amiricord-rows">
                                    <Row name="Encrypted DNS">{dnsRowText(dnsLine)}</Row>
                                </div>
                            )}
                        </Card>

                        <Card title="Who the client talks to">
                            <p className="amiricord-pcard-text">Discord, and the sites your running plugins said they connect to (declared, not counted).</p>
                            <div className="amiricord-rows">
                                <Row name="Discord">discord.com and its own hosts</Row>
                                {talkers.length === 0
                                    ? <Row name="Plugins">None connect elsewhere</Row>
                                    : talkers.map(card => <Row key={card.id} name={card.name}><span className="amiricord-pchips">{card.hosts.map(host => <span key={host.host} className="amiricord-pchip">{host.host}</span>)}</span></Row>)}
                            </div>
                        </Card>
                    </div>
                    <div>
                        <Card title="Protection counters" badge={<Badge level="live">Live, this session</Badge>}>
                            <p className="amiricord-pcard-text">Two separate numbers, never added together: what was stopped before it left Discord&rsquo;s own code, and what was cancelled on the network. The token guard is always on: your login key is only sent to Discord and to plugins that said they need it, and is removed from the request for any other site.</p>
                            <div className="amiricord-subheading">Stopped inside Discord</div>
                            <div className="amiricord-tiles">
                                <Tile number={status.stopped.analytics} label="Usage events" color="#5865f2" />
                                <Tile number={status.stopped.metrics} label="Metrics" color="#3ba55d" />
                                <Tile number={status.stopped["crash-reports"]} label="Crash report hooks" color="#f0b232" />
                            </div>
                            <div className="amiricord-subheading">Cancelled on the network</div>
                            <div className="amiricord-tiles">
                                <Tile number={counts["usage-reports"]} label="Usage reports" color="#5865f2" />
                                <Tile number={counts.metrics} label="Metrics reports" color="#3ba55d" />
                                <Tile number={counts["crash-reports"]} label="Crash reports" color="#f0b232" />
                                <Tile number={counts["telemetry-host"]} label="Telemetry pings" color="#eb459e" />
                                <Tile number={counts["host-rules"]} label="Blocked by your rules" color="#9b59b6" />
                                <Tile number={counts["token-stripped"]} label="Token removed" color="#1abc9c" />
                            </div>
                            <div className="amiricord-subheading">Covered</div>
                            <div className="amiricord-pchips">
                                <Chip on={telemetry.usage}>Usage reports</Chip>
                                <Chip on={telemetry.usage}>Metrics</Chip>
                                <Chip on={telemetry.crash}>Crash reports</Chip>
                                <Chip on={telemetry.usage}>Telemetry host</Chip>
                                <Chip on>Token guard</Chip>
                                <Chip on={answer ? answer.ruleCount > 0 : false}>Your host rules</Chip>
                            </div>
                        </Card>

                        <Card title="Blocked sites">
                            <p className="amiricord-pcard-text">
                                Sites you chose to block, kept in firewall.json. A new block takes effect at once; taking one off asks you first. Discord&rsquo;s own sites cannot be blocked from here.
                            </p>
                            {answer && (
                                <div className="amiricord-rule-form">
                                    <input
                                        className="amiricord-search" type="text" placeholder="Site, for example ads.example.com" aria-label="Site to block" value={ruleHost}
                                        onChange={(event: { target: { value: string; }; }) => { setRuleHost(event.target.value); }}
                                    />
                                    <input
                                        className="amiricord-search" type="text" placeholder="Why (optional)" aria-label="Why (optional)" value={ruleReason}
                                        onChange={(event: { target: { value: string; }; }) => { setRuleReason(event.target.value); }}
                                    />
                                    <button
                                        type="button" className="amiricord-button" disabled={ruleHost.trim() === ""}
                                        onClick={() => { send("rules", { type: "rule-add", host: ruleHost, subdomains: ruleBelow, reason: ruleReason }, () => { setRuleHost(""); setRuleReason(""); }); }}
                                    >Block site</button>
                                    <SwitchLine compact title="Also block everything under it" on={ruleBelow} onToggle={() => { setRuleBelow(!ruleBelow); }} description="" />
                                </div>
                            )}
                            {notes.rules && <div className="amiricord-note">{notes.rules}</div>}
                            <div className="amiricord-rows">
                                {answer === undefined ? <Row name="Rules">Not known yet</Row>
                                    : answer === null ? <Row name="Rules">The main process did not answer</Row>
                                        : answer.rules.length === 0 ? <Row name="Rules">None</Row>
                                            : answer.rules.map(rule => (
                                                <Row key={rule.id} name={rule.subdomains ? `${rule.host} and below` : rule.host}>
                                                    {rule.reason || "No reason written"}
                                                    <button type="button" className="amiricord-button amiricord-button-quiet amiricord-remove" onClick={() => { send("rules", { type: "rule-remove", id: rule.id }); }}>Remove</button>
                                                </Row>
                                            ))}
                                {answer && answer.ruleCount > answer.rules.length && <Row name="More">{answer.ruleCount - answer.rules.length} more rules are not shown</Row>}
                            </div>
                        </Card>
                    </div>
                </div>

                <Card title="Recent blocks" badge={<Badge level="live">Live, this session</Badge>}>
                    <p className="amiricord-pcard-text">
                        What was stopped or taken out since Discord started: only the place, the shape of the path, the kind, how many and how long ago. Never a query, an id or a token. The list is cleared when Discord closes.
                    </p>
                    <div className="amiricord-blocks-tools">
                        <input
                            className="amiricord-search" type="search" placeholder="Search blocks..." aria-label="Search blocks" value={query}
                            onChange={(event: { target: { value: string; }; }) => { setQuery(event.target.value); setPage(0); }}
                        />
                        <button type="button" className="amiricord-button amiricord-button-quiet" onClick={() => { send("export", { type: "export-blocks", format: "json" }); }}>Export JSON</button>
                        <button type="button" className="amiricord-button amiricord-button-quiet" onClick={() => { send("export", { type: "export-blocks", format: "csv" }); }}>Export CSV</button>
                    </div>
                    {notes.export && <div className="amiricord-note">{notes.export}</div>}
                    {shown.items.length === 0 ? (
                        <div className="amiricord-blocks-empty">
                            {all.length > 0 ? "No block matches the search." : blocks === null ? "The main process did not answer." : "Nothing has been blocked in this session yet."}
                        </div>
                    ) : (
                        <div className="amiricord-blocks">
                            {shown.items.map(item => (
                                <div key={item.key} className="amiricord-block">
                                    <div className="amiricord-block-main">
                                        <div className="amiricord-block-title">{item.title}{item.count > 1 && <span className="amiricord-block-count">×{item.count}</span>}</div>
                                        {item.where && <div className="amiricord-block-where">{item.where}</div>}
                                        <div className="amiricord-block-tags">
                                            <span className="amiricord-block-tag">{item.tag}</span>
                                            <span className="amiricord-block-tag amiricord-block-source">{item.source}</span>
                                        </div>
                                    </div>
                                    <div className="amiricord-block-side">
                                        <span className={`amiricord-block-badge amiricord-block-badge-${item.badge.toLowerCase()}`}>{item.badge}</span>
                                        <span className="amiricord-block-age">{ageText(item.agoMs)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="amiricord-pager">
                        <button type="button" className="amiricord-button amiricord-button-quiet" disabled={shown.index === 0} onClick={() => setPage(shown.index - 1)}>Prev</button>
                        <span className="amiricord-pager-text">Page {shown.index + 1} of {shown.pages}</span>
                        <button type="button" className="amiricord-button amiricord-button-quiet" disabled={shown.index >= shown.pages - 1} onClick={() => setPage(shown.index + 1)}>Next</button>
                    </div>
                    <p className="amiricord-pcard-text">Pausing protection for ten minutes and resetting to the defaults come later. <Tag soon>{SOON_TEXT}</Tag></p>
                </Card>
            </div>
        );
    };
}
