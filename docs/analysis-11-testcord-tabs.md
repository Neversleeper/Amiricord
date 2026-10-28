# Analysis 11: TestCord's tabs, one by one

Started 2026-10-25 at the owner's request ("read in depth Privacy & Security, Themes, Updater, Changelog, Stats, Plugin Health, Presets,
Backup & Restore and Patch Helper, one by one, noting everything"). Read only, from the local copy of TestCord
(`C:\Users\<user>\Desktop\testcord`). Nothing was run, installed or fetched. Everything below is described, never copied; Amiricord's
versions are written from scratch with different code. Each section ends with "For Amiricord" (proposals, not decisions: the owner decides).

Sections are added as each tab is finished: 0 React Developer Tools (correction of analysis 10), 1 Privacy & Security, then Themes, Updater,
Changelog, Stats, Plugin Health, Presets, Backup & Restore, Patch Helper. Anything not read is listed at the end of its section.

## 0. React Developer Tools (and a correction to analysis 10)

**Correction.** Analysis 10 and the chat said the extension is downloaded at every start. That was wrong. `src/main/utils/extensions.ts`
downloads it **only when it is not in the cache folder** (`ExtensionCache\<id>` inside the data folder) and then loads it from the cache
on each start while the switch is on.

How it works:
1. If `ExtensionCache\<id>` exists, it is used as it is. No version check, no update.
2. Otherwise it downloads the `.crx` from Google's extension update service (`clients2.google.com/service/update2/crx`, with the id and the
   Chromium version of the running Electron), with a User-Agent that names Equicord.
3. It converts the `.crx` to a zip and unzips it by hand with checks against path traversal (names with `\0`, `..` escapes), skipping the
   `_metadata` folder that Chrome reserves; on any failure it deletes the half-written folder.
4. It loads the folder as an extension in the **default session**, so the extension is active in every Discord window.
5. Only the id `fmkadmapgofadopljbjfkapdkoienihi` (React Developer Tools) is installed this way.

Observations:
- The `.crx` signature is not checked. The only protection is the HTTPS connection to Google and the path checks.
- The extension runs inside Discord's own pages with its permissions (it reads the React tree, which holds message content on screen).
- The cache never refreshes, so it can become old.

For Amiricord (written from scratch, better):
- Off by default, in a "Developer" group, with text that says it downloads once and from where.
- Offer two sources: the same download (shown to the owner before it happens) or a folder the owner points to (no network at all).
- Verify the `.crx3` signature and show the extension's id and version; keep the version in a small manifest file so "update" is explicit.
- Load it only when the owner turns it on in that session, and unload it when turned off.
- Only for the developer who writes plugins; it is how to find which Discord component to patch.

## 1. Privacy & Security

The biggest tab: `PrivacySecurityPanel.tsx` (1726 lines) with its CSS (1476 lines) and, in the main process, `main/privacy/trafficGuard.ts`
(846 lines), `dnsResolver.ts` (651), `ipc.ts` (109; 16 channels). The page is only a view; the work is done in the main process on
Electron's `session.defaultSession.webRequest`, so it sees every request of every window.

### 1.1 Traffic Guard (what it does)

It hooks `onBeforeRequest` and `onBeforeSendHeaders` and, per request, can cancel, rewrite or strip it, and writes a log entry.

Covered surfaces (each one has its own on/off "shield", all on by default):
- **Science analytics, metrics, Sentry** (the blocked patterns are `/api/v*/science`, `/api/v*/track`, `/api/v*/metrics` and `sentry.io`),
  plus "experimental" ones: tracing, RTC diagnostics, remote logging (each classified in the log by category).
- **Token guard:** removes the `Authorization` header when a request goes to a host that is not Discord's, unless the host is on a list of
  exempt services (music, lyrics, GitHub and some AI APIs) or the owner set a rule for it.
- **Webhook guard:** watches requests to `/api/webhooks/`.
- **Remote code guard:** cancels requests for code files (`.js`, `.mjs`, `.cjs`, `.wasm`, `.ts`) from hosts that are not Discord's, and a
  keyword list ("stealer", "keylogger", "grabber", "token-grab", "exfil", "backdoor", "trojan", "discordrat"...) turns a match into a hard block plus
  an alert. The short keyword `rat` is in that list, which will also match harmless words inside a URL (false positives).
- **Fetch/XHR/beacon** coverage flag.
- **Link tracker guard:** for main-frame navigations to third-party hosts it removes known tracking parameters (an allowlist of parameter names,
  with exceptions for hosts where a parameter is needed) by redirecting to the cleaned URL.

Rules and logs:
- Per-host rules, `allow` or `block`, set by the owner; first-party hosts are Discord's six domains.
- Two logs with a size limit chosen by the owner (250 to 10,000): blocked events and allowed events (method, resource type, route group).
- Security alerts (keyword hits) that the owner acknowledges.
- Counters (total blocked, headers stripped, tracking, network, tokens, webhooks, remote code, link trackers).
- Export of the full log as JSON or CSV; a detail view per blocked request (full URL); click-to-copy URL.
- "Outbound routes": the allowed requests grouped by destination group so the owner can see who the client talks to.

### 1.2 Encrypted DNS (what it does)

- A table of about 22 providers (Cloudflare normal, malware and family; Mullvad adblock, base, extended, family, all; Quad9 and Quad9 ECS; AdGuard
  default, family, unfiltered; Google; Control D unfiltered and malware; OpenDNS Home and FamilyShield), each with a DNS-over-HTTPS address, a fallback
  IP and a DNS-over-TLS name; the owner can add a custom endpoint (name, DoH URL, fallback).
- **Mechanism:** Electron's own `app.configureHostResolver({ secureDnsMode: "automatic", secureDnsServers: [doh] })` (so Chromium's built-in
  secure DNS does the work). Before applying, it verifies the provider with a DoH query for `discord.com` and a TLS connection check, with a
  2 second timeout; if the Electron build lacks that function it reports an error. Turning it off restores the built-in resolver.
- Extras: a small DNS cache (256 entries, 15 minutes), latency pings to every provider, a diagnostic that tests DoH, DoT or auto, a "Rewrite
  Fetch URLs" experimental switch that rewrites page `fetch` URLs to resolved IPs (the tab itself says it can break HTTPS), and a status
  block (engine, encrypted DNS status, endpoint, cache, native calls).
- Settings live in `privacy.json` in the settings folder, plus the plugin settings of `NoTrack` and `CustomDNS`.

### 1.3 Other things found

- **Badge Spoofer** (`/api/v9/science?source=badge_spoofer`): `postScienceEvents(payload, token, cookie, superProps)` sends analytics events to
  Discord's own science endpoint **with the owner's token, cookie and super-properties**, to fake progress for badges. The tab even says, on the
  analytics switch, "disable this if you want badges to track your progress". This is a forging of Discord telemetry with the account's token; it is a
  terms-of-service risk and it is the reason the guard must let that route through. Whether Amiricord ever offers it is the OWNER's decision, later (his risk, as a plugin he chooses to allow, with its permission declared in its manifest); it is not part of the engine now.
- The tab's token guard exempts third-party hosts by name (music, AI and code hosting APIs). A fixed exemption list is a weak point: a plugin that
  sends the token to an exempt host is not stopped.
- It names ReviewDB (`manti.vendicated.dev`) as untrusted because it receives the Discord token (its own comment).

### 1.4 What is good, what is weak

Good: one place that shows who the client talks to, with logs and export; DNS verified before it is applied; the idea of per-surface shields;
allowlist (not blocklist) for parameter stripping; the owner can add rules.
Weak: filtering by substring and keywords gives false positives and is easy to avoid; the token guard depends on a fixed host list; everything
is decided in one 846-line class; hard to test; the UI file is 1700 lines of custom controls instead of Discord's own components.

### 1.5 For Amiricord

Already decided earlier: NoTrack as a core plugin, firewall and CSP builder from the plugin manifests (the build already writes the hosts each
plugin declares), encrypted DNS as an engine feature (Quad9, Mullvad Base, Custom; off by default), no Badge Spoofer.
Proposed from this reading:
- The Privacy & Security tab is built **from the manifest data** we already have: for each plugin, the hosts it declared and the permissions;
  the firewall allows exactly those and Discord's, and the log shows what was blocked and why. That is stronger than keywords because it is
  declared, not guessed.
- Token protection by construction: only requests from the page's own code or from Discord's modules carry the token; a plugin that did not
  declare `permissions.token` has no way to send it, and the guard drops the header for non-first-party hosts without an exemption list.
- Logs bounded and private (kept in memory, export only when the owner asks, never contain tokens, bodies or query values: host, path shape and
  category only).
- DNS: same mechanism (`configureHostResolver`) with verification before applying and a clear status; providers as data; one custom endpoint; no
  experimental URL rewriting.
- Do it in small pieces, each with analysis, tests without Electron for the decisions, and a Canary check: engine (rules and logs), then DNS, then the tab.

Not read: the 1100 lines of the panel's render code in detail (layout only skimmed), `privacy.json` schema, the `NoTrack` and `CustomDNS` plugins
(analysis pending), how the experiments list is defined beyond the titles.

## 2. Themes

Folder `components/settings/tabs/themes` (index, ThemeCard, OnlineThemes, ThemeMarketplace 736 lines, SnippetMarketplace 668 lines, MarketplaceData,
MarketplaceOverrides, MarketplaceCustom, CodeViewerModal, QuickActions), the page-side engine `api/Themes.ts` (298 lines) and the main-process part
`main/themes/index.ts` (87 lines; it carries the Apache 2.0 licence file and a header that credits BetterDiscord and Vencord contributors, so that
header parser is **adapted code**, not original to TestCord).

### 2.1 What the tab shows

- Title "Theme Management", text about adding local `.css` files or loading themes from URLs; themes with a cog wheel have their own settings.
- **Quick actions:** upload a local theme file, open the themes folder, edit QuickCSS, reload local themes.
- **Online themes:** a switch to enable them, an input for a URL (`https://example.com/theme.css`, validated by fetching it), a link suggesting
  BetterDiscord's theme site. Turning online themes off clears the list of enabled links.
- **Installed themes:** a search box, a filter (Show All, Online, Local, Enabled, Disabled), and a card per theme with a switch, the author,
  the description, a delete button, a view-code button (a modal that shows the CSS), and a cog for themes that declare settings.
- **Activation mode** per theme: always, only in the light theme, or only in the dark theme (the link is saved with an `@light` / `@dark` prefix).
- **Theme marketplace** (from `themes.equicord.org/api/themes`): a catalogue with thumbnails, a lightbox preview, install and update, a version of the
  theme with the owner's own CSS **overrides** stored per item (`MarketplaceOverride_<id>` in the page's DataStore, appended after the theme so it
  wins), and a **snippet marketplace** (small CSS pieces from the same catalogue) with the same install flow.
- If themes are not supported (the web build) the tab says so.

### 2.2 How themes are applied

- Two `<style>` elements in the page: `vencord-custom-css` (QuickCSS) and `vencord-themes`. QuickCSS is watched by the main process and pushed to
  the page; "Enable custom CSS" only disables or enables that element.
- Local theme files: the main process lists the `themes` folder and reads each file; the page turns each into a `Blob` URL and writes
  `@import url("blob:...")` into `vencord-themes`. Online themes are written as `@import url("<link>")` directly, so **the page contacts that
  host** each time it loads (and whatever that CSS itself imports or loads: fonts, images).
- Theme identity: a stable id from an `@id` line in the header comment, otherwise the file name; old file-name entries are migrated to ids on start.
- Header comment fields parsed: `@name`, `@author`, `@description`, `@version`, `@license`, `@source`, `@website`, `@invite`, `@id`.
- `getThemeSystemValues` gives themes the operating system's accent colour (`os-accent-color`) as a value they can use.
- A missing file is reported instead of producing a dead `@import`.

### 2.3 Observations

- Themes are third-party CSS loaded from the internet at every start when linked. A malicious or compromised host can change the look of Discord at
  any time and can load further resources; CSS can also make requests (images, fonts) that identify the user's IP to the host.
- Marketplace thumbnails are loaded from the catalogue's server; the catalogue is a single remote service run by another project.
- Overrides and enabled lists live in the DataStore and in `settings.json`; the marketplace id is parsed out of the link.
- The upload accepts any file the owner picks; there is no size limit visible in the part read (not verified in the main handler).

### 2.4 For Amiricord

- Themes are plain CSS, so they go through the same path as plugin styles: a manager that adds and removes `<style>` elements, with the same
  checks (size limit, no `@import` of network by default).
- **Local themes first** (a themes folder, a header parser written from scratch with the same field names for compatibility, an id, activation
  mode light/dark/always, a view-code button, a theme-settings modal for themes that declare variables).
- **Online themes** as an explicit opt-in: the owner types a URL, Amiricord shows the host that will be contacted, and can **download the CSS once
  and store it locally** (a copy the owner can read and that does not change behind their back), with an "update" button. That is safer than a live
  `@import`. If the owner wants a live link anyway, it is allowed with a warning and the host appears in the Privacy tab.
- **Marketplace:** not in the first versions. It would depend on another project's server. If wanted later, it needs its own analysis (what the
  catalogue sends and receives, and whether to host our own list).
- The adapted header parser means that **if we port that code we must credit BetterDiscord and Vencord contributors and keep Apache 2.0**; writing
  our own parser from the header format description avoids this, and the field names are plain format facts.
- Reuse for QuickCSS: QuickCSS is a theme file with special id, same pipeline.

Not read: the 700-line marketplace render code in detail, `CodeViewerModal` internals, the main-process upload and delete handlers' validation, what the
catalogue API returns (only the URL and the fields the UI uses).

## 3. Updater

Files: tab `components/settings/tabs/updater/` (index 160 lines, Components 311, runWithDispatch 67), main process `main/updater/` (index 22, common 71,
http 89, git 295), the start-up and periodic check in `Vencord.ts`, and the host-side `hostUpdateHook.ts` and `persistAfterDiscordUpdates.ts`
(named only; **not read**).

### 3.1 What the tab shows

- A header about the host app and notices when the host (Equibop or Vesktop) is outdated, with a button that opens the host updater.
- **Update preferences:** "Automatically update" (downloads and installs in the background without asking; a restart is then needed) and "Get notified
  when an automatic update completes".
- **Branch:** `main` (stable), `dev` (experimental) and `dev2` ("most experimental, can brick the updater"), chosen by the owner.
- **Repository:** the GitHub repository updates come from, with the current commit hash as a link.
- **Updates:** a list of the commits that the update would bring (hash, author, first line of the message), a check button and an update button, with
  states for "up to date", "diverged" and errors (`runWithDispatch` wraps each action to show progress and errors).

### 3.2 Two ways of updating (chosen at build time)

1. **Standalone (the release build):** `main/updater/http.ts` asks the GitHub API for the latest release of the repository, compares the commit hash
   written in the release name with the build's own hash, and, if different, remembers the download address of the asset `desktop.asar`. Applying the
   update downloads that file and **writes it over the running file** (`writeFileSync(__dirname, data)` with the unpacked `fs`). I saw **no hash or
   signature check** of the downloaded file in this code; the only protection is HTTPS and GitHub's account control.
2. **Developer build (git):** `main/updater/git.ts` runs the `git` program (`fetch origin <branch> --prune`, `checkout -B <branch> origin/<branch>`,
   and for a forced update `checkout -f` plus `reset --hard origin/<branch>`) and then runs `node` with the build script to rebuild. It serializes git
   commands (to avoid `index.lock` clashes) and refuses to destroy local commits unless forced. Needs git and the source tree on the machine.
3. If the updater is disabled at build time, every update channel answers "up to date" and the tab is not registered.

### 3.3 When it runs

At start (`checkForUpdates`), and **every 30 minutes** while auto update is on. If auto update is on it applies the update by itself and, if the
notification switch is on, tells the owner once per session; otherwise it shows a notification that an update exists (once per session).

### 3.4 Observations

- A silent self-update that replaces the code that runs inside Discord with a file from the network is the highest-trust thing in the whole project:
  whoever controls the release (or the account) controls every user's Discord client. No hash is pinned; no signature is checked in the part read.
- The branches `dev` and `dev2` ship unreviewed code to anyone who selects them.
- Every update check contacts GitHub's API (so GitHub sees the IP and the user agent) at start and every 30 minutes.
- Overwriting the running archive can fail halfway (power loss) and leave a broken file; I saw no atomic write or backup in this path.
- Re-patching after Discord updates the host is done by separate files (`hostUpdateHook`, `persistAfterDiscordUpdates`), which touch the installation
  itself; they are the counterpart of what our installer handles with its states (desynced, foreign loader) and would need their own analysis.

### 3.5 For Amiricord

Already decided: updater and GitHub repository postponed until the engine works; analysis of the updater later; commits are local only.
Proposed from this reading, for when that time comes:
- **No silent self-update.** Check, show what changes, and ask. Applying must be an explicit click, with the changelog on screen.
- Every release file has a **SHA-256 published separately and a signature** (a key pair owned by the two owners), and the updater verifies both before
  touching anything; refuse otherwise.
- **Atomic and reversible:** write the new files next to the old ones, verify, switch with a rename, and keep the previous version for one-click
  rollback (the installer already works this way for the Discord files: verified backups, a journal, undo).
- A single channel (stable) in the first release; any test channel is opt-in with a clear warning.
- Checks are **opt-in or at most manual + once a day**, with the destination host shown in the Privacy tab; no polling every 30 minutes.
- Update from a local file too (for offline machines) with the same verification.
- Re-patching after a Discord update is a separate feature of the installer side (detect "desynced" at start and offer repair), analysed separately.

Not read: `Components.tsx` and `runWithDispatch.tsx` (UI helpers), the rest of `git.ts` (lines of progress handling), `hostUpdateHook.ts`,
`persistAfterDiscordUpdates.ts`, the build step that writes the `~git-hash` and `~git-remote` values.

## 4. Changelog

Files: `tabs/changelog/` (index 671 lines, `changelogManager.ts` 518, `NewPluginsSection.tsx` 283, styles). It stores everything in the page's
DataStore, under keys named `TestcordChangelog_*` (with old `EquicordChangelog_*` keys migrated).

### 4.1 What the tab shows

- **Fetch Changes:** a button that asks GitHub what changed since the last version the owner saw; buttons to clear the whole history or one entry.
- **Repository:** the GitHub repository the changes come from.
- **Recent Changes:** the list of commits since the last seen hash (hash, author, first line of the message), grouped by **update session**; each
  session is a collapsible entry that remembers when it happened.
- **New plugins** (since the last time the tab was opened): a section listing plugins that did not exist before, and **updated plugins**.
- **New settings:** for each plugin, settings that did not exist before, shown as a mark ("New setting in <plugin>") next to the plugin.

### 4.2 How it works

- On start it records the set of plugins and, per plugin, the set of setting names (`KNOWN_PLUGINS`, `KNOWN_SETTINGS`); on the next version it compares
  with those sets to find what is new. The last seen commit hash is stored too.
- The list of commits comes from GitHub's compare API (`api.github.com/repos/<repo>/compare/<old>...<new>`), a network call every time the owner presses
  the fetch button (and when an update session is saved).
- Sessions are saved with a limit on history size and can be removed one by one.

### 4.3 Observations

- The history lives in the page's DataStore, which Cloud would upload (analysis 10), together with everything else.
- The commit list is whatever the maintainers wrote in commit messages (raw first lines), not a written changelog.
- "New plugins" and "new settings" are computed locally from names; that part needs no network and is the most useful for the owner.

### 4.4 For Amiricord

- **Written changelog shipped inside each release** (a file in the update, shown in the tab), not fetched live from GitHub's commit API: no network at
  all to read it, and the text is meant for people. For the update flow, "what changes" is part of the package that is verified.
- Keep the useful local parts: *new plugins* and *new settings* since the last time seen, computed from our registry (we already have each plugin's
  version, settings keys and `replacedBy`). These can mark new items on the Plugins tab.
- History kept in our own small file (bounded, can be cleared), not in a general store; exportable with Backup & Restore.
- Needs the updater (later) for the "session" idea; before that, the tab can show the changelog of the installed version only.

Not read: the render code of the session list in detail, `NewPluginsSection` internals, exact fields of GitHub's response used.

## 5. Stats

One file, `tabs/stats/index.tsx` (about 250 lines) and its CSS. **Everything is computed locally** from the list of plugins the client already has, and it
updates live as plugins are switched. No network, nothing stored.

### 5.1 What the tab shows

- **Four big numbers:** plugins enabled, plugins available, categories in use, active patches.
- **Cards** with rows (a row that has a copyable value copies it on click and shows a toast):
  - *Overview:* enabled, disabled, total, how many need a restart to toggle, how many "Nightcord" plugins are enabled.
  - *By category (enabled):* tag name and count, sorted.
  - *By source:* TestCord-exclusive, Equicord, Vencord, user plugins (only when there are some), each as `enabled / total`.
  - *Capabilities (enabled plugins):* how many use patches, commands, context menus, Flux events, profile badges, chat bar buttons, message hooks, settings.
  - *Top authors:* the ten authors with most enabled plugins.
  - *Build:* version, commit (link to GitHub), repository (link), build date, whether standalone.
- A footnote: counts exclude API and required plugins; the breakdowns count only the plugins currently enabled.

### 5.2 Observations

- Cheap and useful as a quick overview; the "capabilities" card is a rough version of what our manifest already says in detail (permissions and risk).
- "Require restart" is decided there with `requiresRestart || patches` (the same idea we built in piece F1, but computed in the page at run time; we compute
  it at build time from the code).
- The links to GitHub go out to the browser only when clicked.

### 5.3 For Amiricord

- Easy and safe to do, from the registry and the cards we already have (piece E): enabled, disabled, by origin, by tag, **by risk level** (low, medium, high),
  how many declare network hosts, how many have patches, how many need a restart, top authors, plus the build card (Amiricord version, Discord build,
  engine state, session errors).
- Add what TestCord cannot: plugins by risk and by declared hosts, health numbers (from the health report), startup time of the engine.
- Nothing is sent anywhere; no repository link until a repository exists.
- Small: do it after the Plugins tab, in one step.

Not read: the CSS and the exact build-date source.

## 6. Plugin Health

The largest tab: `tabs/health/index.tsx` (2830 lines, 147 KB) plus `api/PluginHealth.ts` (940 lines, the data), `api/PluginProfiler.ts`
(889, performance), `api/RuntimeInterposition.ts` and `RuntimeInterpositionCore.ts` (how browser functions are wrapped to attribute work to plugins).
This is the model that our own health design (design 02 section 8) was based on, so most of the data model already exists in Amiricord.

### 6.1 The data (PluginHealth)

- **Patch failures** per plugin with six kinds: `noModule` (no module matched), `noEffect` (matched but nothing changed), `errored` (the replacement threw),
  `undoingGroup` (a group of replacements had to be undone), `conflict` (another plugin changed the same code), `codeChanged` (the module's code is not
  what the patch expected). Each keeps the find string, the replacement, and for some the original and patched source for a diff view.
- **Runtime errors** per plugin, clustered by message (a representative and a count); strings cut to 2000 characters; at most 50 entries per plugin.
- **Session records:** the last 10 sessions; a **stability badge** per plugin: `stable`, `flaky`, `unstable` or `unknown`; needs at least 3 sessions to give
  a badge; "unstable" when it was broken in 40% or more of the sessions. This badge shows on the plugin cards.
- **Safe mode** flag and **quarantine** list (plugins turned off automatically), a **crash log** (recent crashes), a log of **enable/disable changes**
  (who changed what and when, so "changes since your last healthy session" can be shown).
- Everything is stored in the page's DataStore with a debounced write (5 s); the module works with empty history if the store is unavailable.

### 6.2 The tab

- Summary bar (how many plugins, how many broken), an **install health rating**, a filter and search, an "all plugins healthy this session" state.
- A card per plugin with its patch failures and runtime errors (expandable text), the stability badge, a **patch viewer** that shows original against
  patched source for a failed patch, a button to locate the plugin, and a button to dismiss an entry.
- Panels: **Session history**, **Discord may have updated** banner (shown when many patches find no module), **Network activity** (requests made through
  `fetch`, per plugin), **Crash recovery** (safe mode boot flag, recent crashes), **Recent enable/disable changes**, **Changes since your last healthy session**.
- Switches: safe mode boot flag, in-app update notice, show conflicts, ignore source changes in health (and in past history), in-tab update banner.
- **Export report:** a text report of the health state to attach to a bug report, with options to leave out conflicts and source changes.
- **Performance diagnostics (profiler):** a table per plugin with CPU time, calls, maximum single call, slow spikes, async time, live resources (timers,
  listeners, animation frames), heap size and change, an **impact score** (a composite of CPU time, slow spikes and live resources), a "hot surface"
  (which kind of work costs most), signals (noticeable CPU, slow spike, slow calls, active listeners) and an advisory text, over a 60 second window or the
  whole session; ranked "recent lag impact"; a longer explanation of how it is computed at the bottom.

### 6.3 How the profiler works

It installs wrappers around **browser and Discord functions** at run time (`setTimeout`/`setInterval`, `requestAnimationFrame`, `addEventListener`,
`fetch`, `ResizeObserver`, `requestIdleCallback`, Flux `dispatch`/`subscribe`/`unsubscribe`) through an "interposition" layer with priorities, and
attributes each call to the plugin that registered it. Heap size is sampled to estimate extra memory per plugin.

### 6.4 Observations

- Wrapping global functions is invasive: it costs time on every call for everything (not only plugins), can clash with other wrappers and changes
  stack traces; attribution is a guess when code is shared or deferred.
- Heap per plugin is an estimate; the impact score is a made-up composite, useful for ranking, not a measurement.
- The Network activity panel only sees `fetch` made from the page, not every request (the main-process view in the Privacy tab sees more).
- History in the DataStore is again part of what Cloud would upload (analysis 10).
- A very useful idea: "Discord may have updated" (many `noModule` at once means Discord changed, not that every plugin broke).
- Another: "changes since your last healthy session" (what was enabled or changed before the first failing session) narrows down the culprit.

### 6.5 For Amiricord

What is already built or designed: the failure kinds (our patch outcomes carry `required`, status per replacement and error text), per-plugin runtime errors
and start failures, finder misses, the engine writes the health file from the main process (atomic, debounced), safe mode and quarantine with a boot state,
and the list of the last 10 sessions with the stability badge rule. The tab is mostly **presentation** of data the engine already collects.
Proposed for the tab (in order):
1. Summary and per-plugin cards with the stability badge, failures, errors, start failures and finder misses; expandable text; filter and search;
   "Discord may have updated" banner using our build number change plus `noModule` counts.
2. Export report (text) with the same options, and **no personal data** (we already redact long ids, emails and tokens in health events).
3. Safe mode switch and quarantine list with a way to take a plugin out of quarantine.
4. "Changes since the last healthy session" from our settings changes (we know each `plugin-enabled` change).
5. Patch viewer (original against patched) only in dev mode, because it needs module source, which is large.
6. **Profiler without wrapping globals:** our plugins register timers, listeners and Flux handlers through the plugin context, which already collects undo
   functions (design 02). The same context can count them and time the handlers by construction, with no global wrapping. That gives exact attribution and a
   count of live resources per plugin with almost no cost. Heap per plugin is left out (no honest way to measure it).
7. Network activity per plugin from the declared hosts and the main-process request log (Privacy tab), not from wrapping `fetch`.

Not read: lines 1200-1700 and 2200-2800 of the tab (state handling, markup and the long help texts), `RuntimeInterpositionCore.ts`, the exact formula of
`calculateImpactScore`, the export report format.

## 7. Presets

Folder `tabs/presets/` (index 19 KB, `presets.ts` 34 KB with all the logic, five modals: Export, Import, Info, Merge, Name, Save, a self-check script
`presets.selfcheck.mjs`, and 32 KB of CSS). A preset is a **named snapshot of your configuration** that you can save, apply, export, import, merge and
reorder. Presets are stored in their own file `presets.json` in the shared settings folder (so they survive across builds), read and written by the main
process through two channels (`GET_PRESETS`, `SET_PRESETS`); BigInt values are turned into strings so the write cannot fail.

### 7.1 What a preset holds

- `name`, `createdAt`, an optional manual `order`.
- **Plugins:** the whole `{ enabled, ...settings }` slice for every plugin (not just on or off).
- Optional scopes the owner ticks when saving: **themes** (the list of enabled theme files, with their CSS embedded so they can be recreated),
  **QuickCSS** (the text), and **DataStore** (key and value entries; the code itself comments "may be large or sensitive").
- Per-preset overrides: restore settings on apply, force apply, "live backup".

### 7.2 What the tab and modals do

- A list of presets with the date, counts, and buttons: **apply**, **save the current state as a new preset or over one**, rename, duplicate, delete,
  drag to reorder, an **info** modal (what the preset contains, compared with the current state), **export** one or all (JSON text), **import** (paste or
  file; a name clash becomes "name (imported)").
- **Merge** two presets with a conflict plan: for each plugin, theme, QuickCSS or DataStore key that differs, the owner picks a side; there is a check
  that detects identical presets.
- Global defaults (apply restores the settings, force apply, hide duplicates) and a set of cosmetic animation switches (row hover, tab underline, badge
  pulse, fade in, buttons, gear, JSON hover) with a master switch.

### 7.3 Applying a preset

- Plugins: always sets each plugin's `enabled`; with *restore settings* or *force apply* it also overwrites the plugin's whole settings; **force apply
  disables every plugin the preset does not mention** (the preset becomes the source of truth, off by default).
- Themes: enables the stored ones; a missing theme file is recreated from the CSS stored in the preset; names without a file are reported.
- QuickCSS and DataStore: **overwritten wholesale**, with no confirmation inside the function.
- Imported presets are cleaned by a `sanitize` function that keeps only known fields with the right types (plugins object, theme names, CSS strings,
  scopes from a fixed list), but the *values* inside plugins settings and DataStore are cloned as they come.

### 7.4 Observations

- A preset is a way to share a setup (export text) — and an import is **code and settings from a stranger written into your client**: it can turn on
  plugins (including risky ones), overwrite plugin settings and QuickCSS, and write DataStore entries. There is no review step that shows risk or hosts.
- Exporting with the DataStore scope can leak private data (tokens a plugin keeps, logs).
- Exports include plugin settings, which may include secrets.
- The merge feature is large (about 130 lines of plan and 13 KB of UI) for something few people would use.

### 7.5 For Amiricord

- The idea is good and fits our model: a **preset = a named set of plugin choices and their settings values**, which our settings store already represents
  (`SettingsData`: per plugin `enabled` and `values`) with its limits and checks.
- Keep it small: save, apply, rename, duplicate, delete, export, import; merge later if asked for.
- **Apply and import must go through the same checks as any setting change** (the settings store's validation: id and key patterns, forbidden keys, depth,
  size). An imported preset first shows a **review screen**: which plugins it turns on, the risk level of each (we have it in the cards), the hosts they
  declare, whether any is unknown to this install; the owner confirms before anything changes.
- **Secrets never go into a preset or an export** unless the owner ticks "include secrets" (the manifest lists which settings are secret).
- Scopes: plugins and QuickCSS/themes (later); **no DataStore scope** (we have no general store to dump; if a plugin keeps data it is not part of presets).
- Force apply stays opt-in and shows how many plugins it will turn off.
- Apply uses our hot toggle where possible (piece F2) and shows a single "restart needed" for those with patches (F1/F3).
- This and Backup & Restore share the same file format and checks; build them together (a backup is a preset of everything).

Not read: the render code of the five modals and of the list (layout only), `presets.selfcheck.mjs`, the merge algorithm line by line.

## 8. Backup & Restore

Files: the tab `tabs/sync/BackupAndRestoreTab.tsx` (about 140 lines of markup) and the logic in `api/SettingsSync/offline.ts` (278 lines). **No network
is used.** This is the local counterpart of Cloud and shares its export code (Cloud calls `exportSettings` too, see analysis 10).

### 8.1 What the tab shows

- Text: import and export your settings as a JSON file, to move to another device or recover after a reinstall.
- A **warning** that importing overwrites the current settings (export a backup first).
- A list of what a backup includes: custom QuickCSS, theme links, plugin settings, DataStore data.
- **Import** buttons: all, plugins only, QuickCSS only, DataStore only. **Export** buttons: the same four.
- An **experimental** switch, "Large DataStore Export": forces exporting and importing the DataStore even when it is too large (chunked, but "may still
  fail on extremely large stores").

### 8.2 How it works

- **Export:** builds one JSON text by hand (so large data can be written piece by piece): `{ settings, quickCss, dataStore }` (or just one of them), the
  DataStore read in chunks of up to 200 keys (the chunk shrinks when a read fails, and unreadable or oversized entries are written as a marker object with the
  error and a preview of up to 2000 characters). The file is named `testcord-<type>-backup-<date>.json` and saved with Discord's own save dialog
  (`DiscordNative.fileManager.saveWithDialog`).
- **Import:** opens a file chooser (`.json`), reads the text, `JSON.parse`, then a check `isSafeObject` (meant to refuse dangerous shapes), then by type:
  *all* needs a `settings` key and writes settings, QuickCSS and DataStore; *plugins* writes settings; *css* writes QuickCSS; *datastore* writes the DataStore
  in batches.
- Settings are **merged** into the current ones (`deepMerge(PlainSettings, parsed.settings)`) and the result is written whole to the main process
  (`VencordNative.settings.set`), even though the warning says "overwrite".
- Success or failure is shown as a toast; errors go to the console.

### 8.3 Observations

- No format version and no schema check: any JSON object with a `settings` key is accepted and merged in, including keys that have nothing to do with
  plugins (for example the Cloud section or any other setting).
- No **review** before applying and no **automatic backup of the current state** before an import; a wrong file changes everything at once.
- The settings written include whatever secrets plugins keep in their settings; the export has no option to leave them out.
- DataStore export/import is the risky part: huge, may hold private plugin data, and importing it writes keys the page did not check.
- The merge rather than replace means removed settings stay; the text says the opposite.
- A good detail: chunked reading that survives unreadable entries, and the save dialog from Discord (no extra permission).

### 8.4 For Amiricord (the owner is interested; this is the first one to build after the base)

Design in short, built on what exists (the settings store already has limits, key patterns, forbidden keys, depth and size checks, atomic writes):
- **Format:** one JSON file, with `format: "amiricord-backup"`, a version number, the Amiricord and Discord build numbers, a timestamp, and the content:
  the settings data (`SettingsData` as the store keeps it), optionally QuickCSS and the installed themes (later), and a checksum of the content.
- **Export:** "Export everything" or choose (settings; QuickCSS; themes). A checkbox "include secret settings", **off by default**; secrets listed in the
  manifest are left out unless ticked. Saved with a native save dialog from the main process (no file picker in the page). Optional **password** to encrypt
  the file (a standard authenticated cipher from the platform's crypto, a key derived from the password with a slow function, nothing home-made); later.
- **Import:** pick a file → read in the main process → check format, version, size and every value with the **same validator as the settings store** →
  show a **review screen** (what will change: plugins turned on or off, which have patches (restart), risk level of each, declared hosts, settings values that
  differ; unknown plugins are listed and ignored) → the owner confirms → **an automatic backup of the current state is written first** (into a
  `backups` folder, last N kept) → apply through the normal change path (so the hot toggle and the restart notice work as usual).
- **Replace or merge** is a visible choice, default "replace plugin choices and values, keep what the file does not mention".
- **Undo:** "Restore the state from before the last import" using that automatic backup.
- **No DataStore scope** (we have no general store; plugin data that must be kept is each plugin's own concern and may be offered later per plugin).
- Presets (analysis 11 section 7) use the same file format and the same review screen: a preset is a small backup.
- Tests without Electron for the format, validation, secrets removal and apply plan; a Canary check of the dialogs.

Not read: the helper functions `isSafeObject`, `deepMerge`, `setDataStoreBatched`; the middle part of the export function (lines 120-246) was read for
structure only.

## 9. Patch Helper

Folder `tabs/patchHelper/` (index 6.9 KB, `FullPatchInput`, `ReplacementInput`, `PatchPreview`). A **developer tool for writing patches**; the tab is only
registered in builds that are not standalone (`IS_STANDALONE ? null : ...`), so normal users never see it.

### 9.1 What it does

1. **Full Patch box:** paste a whole patch object (`{ find, replacement: { match, replace } }`) and it fills the three fields.
2. **Find:** a string, or a regular expression written between slashes. After a short delay it searches Discord's modules (`search(find)`): *no match*
   ("perhaps that module is lazy loaded?"), *multiple matches* ("refine your filter"), or exactly one, which becomes the module under test.
3. **Match:** a regular expression with a live syntax check. **Replacement:** a string, or a function written as text, with a help list of the
   placeholders (`$self`, `$&`, group references).
4. **Preview:** applies the replacement to that module's source and shows the **match** (full text and groups) and a **word diff** with 200 characters of
   context on each side, green for added and red for removed; the replacement's error (if any) is shown.
5. **Generated code:** the final patch as source text with *Copy to clipboard* and *Copy as code block* buttons, ready to paste into a plugin.

### 9.2 Observations

- The pasted patch and the replacement function are turned into code with **`eval`** (`(0, eval)(...)`). Acceptable in a developer-only tool of a build that is
  not distributed, but it means "paste a patch from the internet" runs it. Our lint forbids `eval` outside declared exceptions.
- It only checks one replacement (the first of a list) and does not test `find` against the **real running compile path** (flags, groups, the `$self` rewrite,
  the "required" rule, the effect checks), so a patch can preview fine and still fail in the real pipeline.
- It cannot see modules that are not loaded yet (lazy chunks) — exactly the problem we hit with the settings tree (analysis 09).
- It is a small and very useful piece of the workflow: it shortens the cycle of writing a patch from "edit, build, restart Discord, read the health report" to
  "type and see".

### 9.3 For Amiricord

This is what the owner asked for earlier ("patch helper" among the recreated dev tools). Proposed, as a **developer-mode tool** (hidden unless dev mode is on):
- Our own page, written from scratch, **without `eval`**: patches are entered as fields (find, match, replace) and parsed by our own small parser (strings,
  `/regex/flags`, and a replace written in the same restricted form our patches use); no arbitrary code is run from pasted text.
- It uses **the engine's real compile function** (`compileModule` and the same registry rules), so the preview is exactly what the engine would do, including
  the errors it would report (no module, no effect, conflict, changed code).
- Module search over everything the engine has seen run (the recording `WreqView` already keeps sources) **and** over lazy chunks by asking Discord's loader
  to fetch them on request (this was the gap in the first probe); results listed with ids and a few characters of context, not only "one or many".
- The same diff view, and a button that writes the patch into the health report's patch-viewer format; copy as source for a plugin.
- Works with a plugin's own patch list too: "test all patches of this plugin against the loaded modules" and show which ones would match, without restarting.
- Part of the developer group together with the profiler view, the React DevTools option (section 0) and the "run reporter".

Not read: `FullPatchInput`, `ReplacementInput`, `PatchPreview` beyond the parts quoted (the rest is layout), `search` in the webpack module.

## 10. What comes out of the nine tabs

**Build order (decided by the owner on 2026-10-25): the same order as TestCord's sidebar, one tab at a time.** The first version of this section proposed
another order by the assistant's own priorities; the owner did not ask for that, and it is replaced. Each tab: analysis refresh, mockup from the real look,
code, tests, commit (after the owner's OK) and a Canary check.

1. Main tab (in progress: the base of the Settings plugin and this tab).
2. **Privacy & Security.** The biggest one: its engine pieces come first, each with its own analysis, tests and commit: the rules and the log of outbound requests
   built from the plugin manifests (firewall, CSP, NoTrack as a core plugin), then encrypted DNS, then the tab itself.
3. Plugins (cards, filters, switches; the data from pieces E and F).
4. Themes (with QuickCSS).
5. Updater (signed releases, atomic switch, rollback; no silent self-update).
6. Changelog.
7. Stats.
8. Plugin Health.
9. Presets.
10. Cloud: the tab exists in its place with none of TestCord's content (no third-party server, no login with third parties, nothing uploaded); how it will
    really work is decided later.
11. Backup & Restore (the local design of section 8; the owner is interested in this one).
12. Patch Helper and the other developer tools (the React DevTools option, the profiler view).

Left out on purpose: Cloud (analysis 10), the marketplace servers, Badge Spoofer, the donation and contribution cards, links to other projects' servers,
`AutoRedeem Logs` and `Token Login Manager` (two extra tabs from plugins that the owner's screenshot shows; not read yet, both handle sensitive things:
account tokens and automatic code redemption).

What the nine tabs showed in common (design lessons):
- Almost everything is stored in the page's general DataStore (history, presets, changelog, health), which makes Cloud's upload dangerous and Backup
  messy. In Amiricord each feature keeps its own small, bounded, validated file, owned by the main process.
- Several tabs call out to other projects' servers (themes catalogue, logos, cloud, GitHub API, extension store, CDN editor). Amiricord's tabs make **no
  network request by themselves**; anything that needs one asks first and shows the host.
- Several write imported data straight into the client without a review step (presets, backups, cloud). Amiricord imports always go through the settings
  validator and a review screen with risk levels, and make a backup of the current state first.
- The UI files are huge (2830, 1726, 671 lines) because each tab builds its own controls; with the common components layer (piece C) ours stay small.

## 11. The icons of the sidebar entries (added 2026-10-25, owner: "why did you not analyse how TestCord passes the icons?")

Read: `plugins/_core/settings.tsx` (`buildEntry` and the list of entries), `components/TestCordLogo.tsx`, `components/Icons.tsx` (names only),
`plugins/betterSettings/index.tsx` (the table of section icons). The assistant had said the full logo "is too detailed for 20 pixels" without reading
this; that was a guess and it was wrong.

- An entry's icon is a **function that draws the icon** (`icon: () => <Icon width={20} height={20} />`); Discord calls it where it draws the sidebar item.
  It is optional.
- The main entry uses the **full-colour logo** (`TestCordIcon`): one SVG with a 1000 by 1000 view box (an orange circle, two filled shapes and an embedded
  PNG as a data URL), drawn at 20 by 20. So a detailed, coloured logo is fine at that size.
- The other tabs use **one-colour icons** that follow the text colour (shield for Privacy & Security and for Plugin Health, plug for Plugins, paintbrush for
  Themes, download for the Updater, scroll for the Changelog, "i" for Stats, bookmark for Presets, cloud for Cloud, two arrows for Backup & Restore, a
  tool for the Patch Helper). They are components in one file (`Icons.tsx`, about 1300 lines of shapes).
- A second plugin, BetterSettings, keeps a table from each section key to an icon (`profile_section`, `user_section`, `testcord_section`,
  `billing_section`, ...) to draw collapsible sections; that is outside our scope for now.
- A switch, "Use TestCord Icon", replaces the icon of Discord's Home button with the logo at 35 pixels (a patch on Discord's own code).

For Amiricord: the main entry draws the logo from the file the owner supplied (done: an image of 20 by 20 inside the sidebar item); each later tab gets
its own simple one-colour icon drawn by us (no shapes taken from TestCord's file); "Use Amiricord icon" for the Home button is a possible later switch of
the main tab (the owner decides).
