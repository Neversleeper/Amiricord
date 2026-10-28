# Analysis 22: building the Privacy & Security tab (P7)

Written on 2026-10-26 for the owners' approval. No code yet. This note turns `analysis-12` (what TestCord's tab does and the order we proposed) and
`design-05` section 9 and 10 into a build plan, now that the engine pieces under it exist (P1 to P6). Everything is written from scratch;
TestCord is only a reference for what a person wants to see.

## 1. What the engine can already tell the tab (facts, checked in the code)

| Tab needs | Source today | State |
|---|---|---|
| Self-test result (`has_client_mods`) | `status.selfTests` (page) | ready |
| Stopped inside Discord (per kind) | `status.stopped` (NoTrack counters, page) | ready |
| Cancelled on the network (per kind, incl. `host-rules`, `token-stripped`) | `status.network`, from the read-only `firewall` channel | ready, but **one render late** (the status shows the previous answer) |
| Encrypted DNS line | `status.dns` (text from `dnsText`) | ready as a sentence only; no provider list, no mode, no latency |
| Host rules list | `firewall.json` in main (`parseRuleFile`) | **main only**; the page cannot read it |
| Telemetry switches | NoTrack settings `disableAnalytics`, `disableCrashReports` (default true, restart needed) | change goes through the generic `settingsChange` channel |
| Token guard facts | counter `token-stripped`; allowed hosts are worked out in main from enabled plugin manifests | the list of hosts is **not** sent to the page |
| Activity log (recent events) | none | does not exist (only counters; by design no query, header, body or id is kept) |
| Per-plugin view | none | unsolved (a request cannot be traced to the plugin that made it) |

Two facts matter for the design:
1. `settingsChange` is accepted from any trusted Discord page and applied on the page's word. Today that includes the two NoTrack switches. Design 05
   section 10 says a change that **weakens** protection must be confirmed by the main process. This is not done yet; it is part of P7.
2. Only a few channels exist (`bootInfo`, `health`, `settingsChange`, `restart`, `openDataFolder`, `firewall`, plus dev ones). Everything the tab
   shows beyond counters needs a new read channel; everything it changes beyond settings needs a new change channel.

## 2. The tab, section by section (what each shows and where it gets it)

Order (analysis 12 section 5), plain words, one sentence on every switch about what happens if it is off, the "Restart" tag where a restart is needed:

1. **Summary card.** One line: "Protected / Partly protected / Check needed" with three numbers: stopped inside Discord, cancelled on the network,
   encrypted DNS on/off, plus the self-test result. The verdict is computed on the page from facts it already has (self-test, the two master
   switches, token guard on, DNS line). Never claims "all traffic is private"; DNS counts only as one part and is worded as "configured".
2. **Telemetry.** Master switch "Block Discord telemetry" = the two NoTrack settings (the same as the main tab, one place of truth, shown in both).
   Under it, one row per kind with its counters: usage reports, metrics, crash reports; experimental ones (tracing, call diagnostics, remote logs)
   only if the owners keep them (decision 3).
3. **Your account.** Token guard row (always on, explained: "your login key is only sent to Discord and to plugins that declared it"), with the
   `token-stripped` counter. Link-parameter stripper and remote-code alerts are NOT part of P7a (they are separate shields, each with its own table
   and analysis later); the rows appear when they exist.
4. **Who the client talks to.** Discord, then the hosts of enabled plugins from their manifests (read from the registry the page already has),
   with the count of rules in force. Honest limit: no per-plugin request counts (unsolved), so the table says "declared", not "seen".
5. **Host rules** (list, add, remove): moved out of "Advanced" because this is what a person actually edits.
6. **Encrypted DNS card.** Mode (Off / Automatic / Strict), provider list (the four in `providers.ts` plus the custom field later), status line,
   **Test now** (verify only, applies nothing), and the sentence that explains the limits (hides lookups, not the connected address). Collapsed
   when off.
7. **Activity** (collapsed): needs a log that does not exist. Left to P7c.
8. **Advanced:** log size (with the log), "Pause protection 10 minutes", reset to defaults (each with confirmation).

## 3. New channels (all follow design 05 section 10)

Every channel: only trusted Discord senders, checked again in main; content rebuilt field by field; size limits; no path, URL or function from the page.

| Channel | Direction | Carries | Notes |
|---|---|---|---|
| `privacy` (read) | page asks, main answers | one snapshot: network counters, DNS state (mode, provider id, status, ms, reason), host rules (host, subdomains flag, reason, id, count), DNS provider list (id, name, note) | replaces `firewall`; same read-only rule; at most one answer per second |
| `privacy-change` | page asks, main decides | one of: add rule, remove rule, set DNS mode/provider, test provider | the page sends **ids and short names**, never an address; main looks the provider address up in its own table |
| `privacy-push` | main tells page | "something changed" (counters or state), the page then asks | fixes the one-render-late problem and the polling; first version can still be a throttled ask (see 5) |

**Confirmation by main.** Any change that weakens protection (remove a block rule, switch off the DNS or lower it from Strict to Automatic, switch off
telemetry blocking, pause protection, reset) is shown to the person in a **native window opened by the main process** (`dialog.showMessageBox`) with
the name of the change and what it lets through; nothing is applied until the button is pressed. A change that only strengthens (add a block rule, turn
a switch on, Test now) needs no window. This also closes the point of analysis 12 section 3.2.1: code in the page, including any plugin, cannot weaken
protection on its own word. For the two NoTrack settings this means `settingsChange` must refuse them from the generic route and the tab must use
`privacy-change` (to be checked in P7a: how `changeSetting` treats those two keys today is **not verified**).

**Plugins and these channels.** A plugin shares the page, so the page cannot keep it away from the bridge; that is why main confirms. Counters can only
be changed by the code that decides (design 05 section 10), never through a channel. No channel exists to write a counter.

## 4. Applying changes: honest and simple

- **DNS** is configured at start (P6b). Changing the mode or provider is **saved to `dns.json` and applied at the next start**, with the "Restart"
  tag and a restart button (the existing `restart` channel). Reason: `app.configureHostResolver` at runtime is not verified for turning off, and a
  half-applied change would make the status line lie. **Test now** is immediate: verify only.
- **Strict** needs the typed confirmation of design 05/analysis 21 (the lock-out risk): the native window names the risk and the way back (safe mode,
  edit `dns.json`).
- **Host rules** apply at once (the matcher is rebuilt in main after each change). Limits stay as in P4c (block only, Discord's own hosts refused, up
  to 10 000).
- **NoTrack switches** keep their "Restart" tag (the patches are made when Discord loads).

## 5. The counters that were one render late

`engine.status()` returns what the last answer said and asks again (throttled to 1 s). In a tab that redraws on its own this shows old numbers for a
moment and the first draw shows zeros. Proposal: the tab asks once when it opens and then every 2 seconds **only while it is the open tab** (stops when
it is closed), and redraws when the answer arrives. A real push from main is better but needs a new message from main to the page, which a sandboxed
preload only allows through the bridge; first version = timed ask, push later if the cost is visible (measure first).

## 6. Pieces and order

- **P7a, read-only tab:** `privacy` read channel and its parser (`parsePrivacyAnswer` in `shared`), tab registered as `privacy` in `entries.ts`, Summary,
  Telemetry (view only, with the master switch still through the existing route), Your account (token row), Who the client talks to, Host rules list
  (view), Encrypted DNS card (view and **Test now**), timed refresh while open. Nothing in it can weaken protection.
- **P7b, changes with confirmation:** `privacy-change`, native confirmation window, add/remove rules, DNS mode and provider, move the two NoTrack
  switches to the confirmed route, "Pause protection 10 minutes" and reset.
- **P7c, activity log:** a bounded in-memory log in main (host, path shape, kind, time; no query values unless the person turns it on, decision 4),
  search, export that says what it contains. Its own analysis first.
- **Later:** per-plugin view, link-parameter stripper, remote-code alerts, presets, the filtered DNS providers one by one.

## 7. Look and wording

- Use the common components and Discord's own text sizes; one row component for every line (name left, state right, a sentence below).
- Icons: the owner draws his own; until then the tab uses a plain placeholder and TestCord's tab icon for Privacy (SafetyIcon) is **not** copied.
- Insider words are avoided ("surfaces", "suite", "engine", "native calls"). Counters keep the two names already in the main tab ("Stopped inside
  Discord", "Cancelled on the network") and are never added together.

## 8. Risks and unknowns

- Whether other page code can read the bridge after the engine takes it: open (design 05 section 10); the confirmation window is the defence that
  does not depend on the answer.
- `dialog.showMessageBox` from the main process during Discord's start or while a call is open: it is a normal modal window, but behaviour with
  Discord's own windows is **not verified**; to test on the owner's Stable (not during a call).
- The summary verdict can look reassuring while some paths are not covered (voice lookups, Strict untested on a real Discord). The wording must say
  "configured", not "protected from everything".
- Neversleeper works on the Plugins tab at the same time: both tabs touch `entries.ts` (one line each) and the registry view; agree who edits it first.

## 9. Questions for the owners (my proposal first)

1. Order: P7a (read-only) first, then P7b, then P7c? (proposed: yes)
2. Confirmation by a native window opened by main for every weakening change? (proposed: yes)
3. DNS changes applied at next start, with Restart tag and Test now immediate? (proposed: yes)
4. Keep the three experimental blocks (tracing, call diagnostics, remote logs)? They do not exist in the engine today, so they would be new rules,
   each analysed alone and off by default. (proposed: not in P7)
5. Logs keep query values only if the person asks (default no)? (proposed: yes; decided in P7c)
6. Presets Recommended / Maximum / Off? (proposed: not in P7; later)
7. If the self-test fails: only report, or also offer a fix? (proposed: only report)
8. Refresh: timed ask while the tab is open (proposed) or wait for a real push?

## 10. P7b, first part: what is built and how (added 2026-10-26, after the owner asked for working switches and a selectable Secure Connect)

- **Channel `privacy-change`** (page asks, main decides, answers `applied`, `cancelled` or `refused` with a short sentence). Two kinds of change: a telemetry switch (`disableAnalytics` or `disableCrashReports`, true or false) and the encrypted DNS choice (mode `off`, `automatic` or `strict`, provider id from our table). The page sends ids and booleans only.
- **What asks the person.** Turning a telemetry switch **off**; lowering the DNS mode (Strict to Automatic, anything to Off); entering Strict or changing the provider while in Strict (lock-out risk, analysis 21). Turning a switch on and going from Off to Automatic ask nothing. The question is a native window of the main process with the change in words and what it lets through; the answer decides. Only one question at a time; a second change meanwhile is refused.
- **The generic `settingsChange` route may no longer switch NoTrack's two keys off** (set to `false`); a page, or a plugin sharing the page, cannot weaken protection around the confirmation. Everything else on that route is unchanged. Removing the key or setting `true` is allowed (it only strengthens).
- **When it takes effect.** The network shields follow the saved switches at once (main process). The part inside Discord's page (NoTrack patches) and encrypted DNS take effect at the **next start**; the tab says so and offers a relaunch button that asks first (same text as the main tab). The snapshot says what is saved and what is in force, so the tab can tell "restart pending".
- **Not part of this step:** adding and removing host rules, custom DNS address, Test DoT, any log. Not verified: the native question window on the owner's Stable (to see after install).
