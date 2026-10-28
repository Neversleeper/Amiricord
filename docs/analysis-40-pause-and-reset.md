# Analysis 40: pausing protection for ten minutes, and resetting to the defaults (Privacy & Security tab)

Written on 2026-10-26 for the owners' approval. No code yet. The number is 40 on purpose: Neversleeper's unpushed work already uses analysis numbers 18 and 22 to 35 (his 22, 23 and 24 will move to 36 to 38 because ours were pushed first), so 40 cannot collide with either side.
Everything here is written from scratch. TestCord has neither a pause nor a reset in its tab; `analysis-12` section 4.2 proposed "Pause protection for 10 minutes" because many "it stopped working" reports come from filters, and the owner asked for both ("Pausing protection for ten minutes and resetting to the defaults come later" is what the tab says today).

## 1. What each one is for

- **Pause:** find out whether a filter is what broke something. The person pauses, tries the thing, and sees at once whether it works. It ends **by itself after ten minutes**, whatever else happens.
- **Reset to defaults:** go back to how Amiricord comes out of the box, after trying things.

## 2. What pausing can and cannot stop (checked in the code)

| Layer | Where it decides | Can it be paused live? |
|---|---|---|
| Network shields (usage reports, metrics, crash reports, telemetry host) | main process, `firewall.ts`, asks `enabled(switch)` on every request | **yes**: one more condition in that function |
| The owner's blocked sites | main process, `hostMatcher` in `electronGlue.ts` | **yes**: the matcher answers "no rule" while paused |
| Token guard | main process | **no, never**: it stays on (design 05: the token is never sent to a stranger, not even for ten minutes) |
| NoTrack, usage events inside Discord | page: `quietAnalytics` asks `enabled()` on each event (`settings.store.disableAnalytics`) | **yes**, if `enabled()` also asks the engine whether protection is paused (a time kept in the page) |
| NoTrack, metrics counter | page: `stopMetric()` asks the same setting on each call, but the **timer** that sends them is decided once at start | **partly**: counting resumes, but the timer was never started, so nothing is sent. Needs a restart to change |
| NoTrack, crash reports | page: the Sentry object is kept out at start | **no**: a restart is needed |
| Encrypted DNS | resolver set at start | **no**: not touched by pause |

So a pause **lets through**: Discord's usage reports and what the network shields cancel, and the owner's blocked sites. It does **not** let through crash reports, the metrics timer, the token, and it does not change DNS. The tab says exactly this, in one line, before the person confirms.

**Why the page part matters.** NoTrack's own description says that features relying on those reports, such as badge progress, may stop updating while it is on. If a pause only freed the network, those features would stay broken and the pause would not answer the question it exists for.

## 3. How a pause works

- **Asked by the page, decided by the main process.** A new change `pause` in `privacy-change` (no value: the duration is fixed at ten minutes in the main process, the page cannot choose another) and `resume` (no value). **Pausing weakens protection, so the main process asks first** in the same native window as every weakening change ("Pause protection for ten minutes?" with the list of what it lets through). **Resuming only strengthens, so it asks nothing.** A second pause while one is running is refused with a sentence.
- **State in the main process only**, in memory: the end time, one timer (`unref`, so it never keeps Discord open). When it fires, or on resume, the shields and the matcher go back to normal. **A restart of Discord ends any pause** (nothing is written to disk).
- **The snapshot** carries `pause: null` or `pause: { remainingMs }` (a remaining time, not a clock time, so the page and the main process clocks never matter).
- **The page part.** The engine keeps `pausedUntil` (page clock) and sets it **only from an answer of the main process** (the snapshot), never from page code. NoTrack's two runtime checks (`quietAnalytics`'s `enabled` and `stopMetric`) also ask `ctx.privacy.paused()`. Only core plugins get `ctx.privacy`, so no other plugin can read or set it. If the tab is closed, the time still runs out by the clock; a resume made from the tab is read at the next snapshot (the tab is open when it is pressed, so this is immediate).
- **Counters and the list.** While paused nothing is cancelled, so nothing is counted or listed for the network; what NoTrack lets through is not counted as "stopped". Nothing is hidden: the tab shows a yellow **"Paused, about N min left"** banner with a **Resume now** button, the Privacy Protection badge says **Paused**, and the boot trace gets a line when a pause starts and ends.
- **What stays on, said in the banner:** the token guard, crash reports, and DNS.

## 4. How a reset works

**Reset to defaults** asks first, always (it changes several things at once), in the native window, listing what it will do:
1. Telemetry switches: **usage reports and metrics: on; crash reports: on** (the values are removed from `settings.json`, so the plugin's defaults apply). A restart finishes it, as the tab already says for those switches.
2. **Encrypted DNS: off, provider: none chosen** (`dns.json` saved as off with no provider; the default provider is proposed again). Strict ends with it.
3. **An active pause ends.**
4. **Your blocked sites are kept.** They are the owner's own choices and some are hard to remember; deleting them would be the one thing a reset must never do by surprise. A separate, later action ("Remove all my blocked sites") would ask for its own confirmation.

What a reset does not touch: other plugins' settings, the list of tabs, the exports folder, `firewall.json.before-tab`, anything about the engine outside this tab.

If a restart is needed afterwards the existing yellow relaunch notice appears.

## 5. Safety

- Both are **new kinds of change** through the confirmed channel: only trusted Discord pages, rebuilt field by field (no fields at all for `pause`, `resume` and `reset`), one change at a time, the question is a window the page cannot answer.
- A page or plugin **cannot pause protection silently**: without the person pressing the button in the native window, nothing happens.
- Pause is **bounded**: fixed length, one at a time, ends on its own, ends on restart, never touches the token guard.
- Reset's file writes use the same temporary-file-and-rename writer; if saving `dns.json` fails nothing is half done: the sentence says what was not done.
- **Said openly:** a pause also pauses the owner's blocked sites. If the owner blocked something to stay safe from it, it is reachable for ten minutes. The confirmation says so.

## 6. Tests and checks

Pure code with fakes: the pause state (start, resume, expiry by the timer, refusal of a second pause, no timer left behind, the remaining time), the shields and the matcher while paused (a request that would be cancelled goes through, a counter does not move, the token guard still strips), the changer (`pause` asks and only goes on if agreed; `resume` asks nothing; reset asks, lists its steps, does each, reports a failed step, keeps the rules), the parsers, the snapshot (`pause` null or remaining time, never negative), the engine (`paused()` only from an answer, expires by the clock, a copy), NoTrack (usage events pass and are not counted while paused; the metrics timer decision is unchanged), the tab (button, banner, countdown words, badge, Resume now, Reset with its note). Mutation check as always. **Not verifiable without the owner's Stable:** the native windows, a feature that was broken by the filters coming back during a pause (badge progress, for example), and the end of a real ten-minute pause.

## 7. Not in this step

A pause of other lengths, a schedule, pausing only one shield, "Remove all my blocked sites", a reset of other plugins, presets (Recommended, Maximum, Off).

## 8. Questions for the owners (my proposal first)

1. Does a pause also free the owner's **blocked sites**? (proposed: yes, said in the question window; otherwise the most likely cause of a break would stay on during the test)
2. Fixed ten minutes, no choice? (proposed: yes)
3. Reset keeps your blocked sites? (proposed: yes, and a separate action later removes them)
4. Reset always asks, pause asks, resume does not? (proposed: yes)
5. The tab shows "Paused" in the badge and a banner with Resume now? (proposed: yes)
6. Analysis number 40 so it cannot collide with Neversleeper's? (proposed: yes)
