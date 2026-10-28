# Analysis 15: NoTrack (piece P3 of design 05)

Written 2026-10-25 before any code. Sources: `testcord\src\plugins\_core\noTrack.ts` (read in full, 197 lines), `the owner's other project\analysis\senales-cliente.md` section 2 (the same plugin as the
owner's fork has it), `design-05-privacy-engine.md` sections 5 and 6, and what the self-test measured on the owner's Canary (build 650200). Read only; nothing was run.
Everything below is described in our own words; the plugin is written from scratch.

## 1. What TestCord's NoTrack does (four jobs)
1. **Analytics (`science`).** A patch on the module that handles analytics actions replaces the function that builds the "analytics tracking store" with a function that returns an
   **empty store**: it ignores the queue and its "send now" method throws a fake error shaped like Discord's own. Result: Discord never builds or sends usage events.
   The setting `disableAnalytics` (default on) controls it, and the plugin declares it needs a **restart** (patches only work while Discord loads its modules).
2. **Metrics.** A patch on the module that mentions `METRICS_V2` stops the timer that sends metrics and makes every `increment` and `distribution` method return at once.
3. **Crash reports (Sentry).** Sentry is started from **another Webpack instance**. The plugin catches the moment that instance defines its `d` helper, checks with a **synchronous request** that
   it is Sentry's bundle, and throws on purpose to abort it, then removes `window.DiscordSentry`.
4. **The mod flag.** A patch makes Discord's detector function return `false` at once (measured today as **not needed**, see section 3).
Plus a handler for Discord's own `TRACK` event that tells TestCord's counter "one analytics event dropped" (so the big numbers in its tab count internal events, as analysis 12 explained).

## 2. What we found about those four for Amiricord
| Job | Needed? | Where to do it in Amiricord |
|---|---|---|
| Analytics | **Yes.** Today Discord still builds and sends them. | NoTrack patch (inside Discord), plus the network rule of P4 as a second layer |
| Metrics | **Yes.** | NoTrack patch (inside Discord), plus the network rule of P4 |
| Crash reports (Sentry) | **Yes**, but not by patches: that Webpack instance is **not** wrapped by our hook, and the way TestCord aborts it uses a synchronous request and a thrown error. | **Network layer first** (P4 cancels `sentry.io`); a clean way to hook that instance is looked for later as an improvement, not a requirement |
| Mod flag | **No.** The self-test measured `false` in the properties, the first gateway message and (P2) the header without any patch. | Not patched. The self-test stays as the watchdog; if a Discord update makes it fail, the patch is added then |

## 3. The one thing that cannot be copied: the search texts
A patch needs a piece of text that **identifies the right Discord module in the current build** and a pattern for what to replace. TestCord's texts (`AnalyticsActionHandlers.handle`,
`.METRICS_V2`) are hints, not answers: Discord changes its code often (the owner's Canary went through builds 650101, 650170, 650180, 650188, 650200 in a day). So the patch texts are
**discovered on the current Discord**, as was done for the settings tree.

### Discovery step (development mode, read only, nothing private)
The engine already has a dev-mode search of the module texts in memory (`module-search`, used for the settings tree). It is extended with the hints below and writes, for each hint,
**which modules contain it and a few characters around it** (redacted like everything else). No message, name, token or setting value is read.
Hints (taken from the three TestCord patches and the owner's other project's notes): `AnalyticsActionHandlers`, `analyticsTrackingStoreMaker`, `.METRICS_V2`, `_intervalId=`, `requestDrain`, `submitEventsImmediately`,
`has_client_mods`, `getSuperPropertiesBase64`.
Procedure for the owner (needs his OK at that moment): create the empty file `%APPDATA%\Amiricord\dev.flag`, start Canary from his shortcut, use Discord for a minute (open Settings once, so lazy modules load),
and copy `%APPDATA%\Amiricord\probe\module-search.json` into the project folder; then delete `dev.flag`. From that file the patch texts are written and checked.

## 4. Design of the plugin
- **Plugin `NoTrack`**: origin `amiricord`, **core** (cannot be turned off, runs even in safe mode), starts at the earliest stage (`init`), permissions none, risk low, authors szlcx404 and Neversleeper,
  credits: none (ideas acknowledged in the docs and a comment, as with Settings).
- **Setting `disableAnalytics`** (default on, needs a restart, as in TestCord) in the Privacy tab later; the master switch "Block Discord telemetry" of design 05 is this one plus the network shields.
- **Patches** (texts from the discovery): analytics store replaced by an empty one with the same shape; metrics timer and methods made inert. Each is **required**, so a Discord update that breaks one shows up in the health report at once as a patch failure of `NoTrack`.
- **Counters** named honestly: **"stopped inside Discord"** counts what the empty store swallows (events it was asked to take), kept in memory in the page and readable by core plugins through `ctx.engine` (for the tab of P7). Never added to the network counters of P4.
- **If a patch does not apply** (Discord changed): the plugin starts anyway, the failure is reported, and the network rules of P4 still cancel the requests. That is the point of two layers.
- **Tests without Discord:** the replacement function (same shape as the original, ignores the queue, counts, never throws), the metrics stand-ins, the counter, the settings; patches applied to small fake modules with the real compiler. **Real check in Canary:** patches report `applied` in the health report, the counter grows while Discord is used, and the self-test still passes.

## 5. Risks and unknowns
- The patch texts do not exist yet (section 3); until the discovery is done nothing can be written or tested against the real build.
- The module that handles analytics may load **late** (after Settings opens or after login). The patches use `lazy` where needed, and the counter says "not applied yet" until they do.
- Turning analytics off may make some Discord features that rely on usage reports (badge progress, some quest progress) stop updating. The tab says so in plain words.
- Terms of service: as for the whole project, modifying the client is against Discord's terms (analysis 02, rule 4).

## 6. Order of work for P3
1. This note, approved by the owners.
2. **Discovery** (section 3): extend the dev search with the hints; the owner runs it once.
3. Write the plugin, the empty store, the counter and their tests; own commit after the owner's OK.
4. Real check in Canary (the three points of section 4).

## 7. Discovery result (2026-10-25, owner's Canary, Discord build 650200)
Read from `probe\module-search-notrack.json` (about 20 KB; checked first for e-mails, long ids, tokens and user names: none). Module ids change with every build, so patches identify modules by **text**, never by id.

**Analytics.** One module builds the tracking store: it calls `analyticsTrackingStoreMaker` (exported by the module that defines the handlers) with a configuration object whose `actionHandler` maps Discord's events
(`CONNECTION_OPEN`, `CURRENT_USER_UPDATE`, `FINGERPRINT`, `TRACK`, `SET_ANALYTICS_TOKEN`...) to `AnalyticsActionHandlers.handle...` functions, and whose `TRACKING_URL` is the science address. It is the only
module that contains the text `AnalyticsActionHandlers.handle`; the module that defines the handlers exports the name but has no `.handle` after it. The store class that the maker returns has `submitEventsImmediately` and `requestDrain`.
Design: **do not replace the store**; wrap the maker. The patch changes only the callee `(0,X.analyticsTrackingStoreMaker)` into `$self.quietAnalytics((0,X.analyticsTrackingStoreMaker))`. `quietAnalytics` returns a function that
calls the original maker with the same configuration except `actionHandler`: every handler becomes "do nothing, report no change" and `TRACK` first adds one to the counter "stopped inside Discord". Discord still gets a store of the
shape it expects (no need to find Flux's base class), its queue never fills, so nothing is flushed.
**Another path seen:** a small module sends a batch with a `keepalive` request that carries the token, the properties header and the fingerprint (the "send now" path). With an empty queue it has nothing to send; the network rule of P4 is the safety net.

**Metrics.** One small module (about 1.9 KB) holds a single object whose constructor starts `setInterval(() => this._flush(), 120000)` and whose methods `increment(name, flush)` and `distribution(name, value, flush)` push into an array and call `_flush`, which posts to the metrics address
(`METRICS_V2`). It is the only module with that text. Design (same idea as TestCord's NoTrack, derived from this code): (1) change `this._intervalId=setInterval(` into `this._intervalId=void 0&&setInterval(` so the timer never starts; (2) make `increment` and `distribution` return at once
(after counting), so nothing piles up in memory. The patch texts are written from the code above.

**Crash reports (Sentry).** Discord's own wrapper module calls `window.DiscordSentry?.method(...)` everywhere with optional chaining, so if `window.DiscordSentry` stays undefined every call becomes a harmless no-op. Design: at the earliest stage define
`window.DiscordSentry` with an **ignoring setter** (assignments are dropped, reads give undefined), so Sentry's own bundle cannot publish its object to Discord's code. Sentry's own network sending is cancelled by the rule of P4 (`sentry.io`). Not verified: whether Sentry's bundle starts its own global error hooks before it assigns the object.

**Mod flag.** Found in the gateway module (`has_client_mods` appears in a metric tag and a socket-reset event) and in the properties builder. Not patched (measured false three ways).

**What this changes in the plan.** No Flux base class is needed; one patch for analytics, one with two replacements for metrics, one global definition for Sentry. Each patch is `required`, so a Discord update that moves the text shows as a failure of `NoTrack` in the health report at once.
