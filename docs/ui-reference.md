# UI reference: TestCord settings, tab by tab

Reference only, in our own words. Layout and behavior learned from TestCord (commit `af92dbaec`),
`src/components/settings/**` and the plugins behind two sidebar entries. No code or styles copied.
The owner supplied two screenshots (sidebar and main screen); this file comes from reading the code.

**How it was read:** read in full: `tabs/stats`, `tabs/updater`, `tabs/sync/*`, `tabs/vencord/index.tsx`,
`PrivacySecurityPanel.tsx` lines 1-900. For the rest (second half of the privacy panel, plugins, themes,
presets, health, changelog, patch helper) I extracted visible texts, state and network calls, not every JSX line.
Styles (CSS, ~5 000 lines) were **not** read: look and feel comes from the owner's screenshots.
`AutoRedeem` and the token plugins were scanned for network and token handling only.

## 0. General shell

- Entries appear in Discord's own settings sidebar under a heading ("TestCord Settings"), with an icon each.
- The first entry (main screen) is locked. **Editor Mode** (toggle on the main screen) lets the user drag to
  reorder, hide, and pin entries. Where the whole section sits inside Discord's settings is configurable
  (top, above/below Billing, above/below Games & Apps, bottom).
- Every tab is wrapped in an error boundary: a broken tab shows a message instead of crashing settings.
- Look: native Discord components (cards, switches, selects, modals, headings), dark theme variables.
- Recurring patterns: search box + filters, cards with a switch, click-to-copy values, modal for details,
  "restart required" prompts, warning/danger notices, toasts for results.

## 1. Main screen ("Testcord")
| Section | What it has |
|---|---|
| Header card | Title, **Editor Mode** toggle |
| Project cards | Donations, Support the Project, Contributions (branding, donate/invite buttons) |
| Quick Actions | Notification Log, Edit QuickCSS, Relaunch Discord, Open Settings Folder, View Source Code, Discord Server |
| Client Settings | Use custom icon; Enable Custom CSS; frameless main window; frameless all windows; native Windows title bar; window transparency; no minimum size; Ctrl+Q to quit; React DevTools. Most need a restart. |
| Notification Settings | Native vs in-app notifications; position (bottom-right/top-right); "you missed" popup on refocus |
| Platform extras | Windows material, macOS vibrancy |
**Amiricord:** keep Quick Actions, Client Settings, notifications, Editor Mode. Drop donation/contribution cards and
project links. React DevTools = developer option, off, declares `clients2.google.com`.

## 2. Privacy & Security
**Sections:** counters (total blocked, headers stripped, tracking, network, tokens, webhooks, remote code, link trackers);
master "Privacy Protection" switch (their NoTrack); **Covered Surfaces** (8 core shields on by default: science/analytics,
metrics, Sentry, token guard, webhook guard, remote-code guard, fetch/XHR/beacon, link-tracker stripper; 3 experimental
off: tracing, RTC diagnostics, remote logs); **Outbound Surfaces** (route groups with counts: Discord API, media, resolver,
AI providers, optional plugin services, Badge Spoofer shown as "Permitted"); **Recent Blocks** (search, 4 per page, grouped by
domain+action, detail modal with copyable fields, host reputation tag, export JSON/CSV, buffer 250 to 10 000);
**Allowed Outbound inspector** (modal, search, filter by route); **host rules** (allow/block per host);
**security alerts** (dismiss all); **Secure Connect** (encrypted DNS switch, provider select with 18 entries, test DoH/DoT/Auto,
stop, diagnostic console of 100 lines, LRU cache stats 256 entries/15 min with clear, "rewrite fetch URLs to resolved IPs",
native call counter).
**Observations (verified in the code read):**
- Polls the main process every **2 s** over IPC while open.
- DNS switch state starts as `true` in the UI.
- "Rewrite fetch URLs" is labeled experimental and can break HTTPS.
- Host reputation labels are hardcoded (first-party, trusted CDN, third party; one entry warns a host "receives your token").
- Logs keep full URLs including query strings; exports write them to a file.
**Amiricord:** keep the structure (counters, shields, recent blocks, allowed inspector, host rules, reputation, export).
Changes: push updates by events instead of polling; redact query strings in logs and exports by default; show
per-plugin allowed hosts from manifests; DNS section off by default with Quad9 and Mullvad Base suggested; no URL
rewriting; no plugin-specific route rows.

## 3. Plugins
Header "Plugin Management" with stat cards (total, enabled, user plugins). Search; filters by type (all, enabled, disabled,
new, favorites, experimental, legacy, API, user, plus per source: Vencord, Equicord, TestCord, TestCord-modified, BetterDiscord),
by author and by tags. Each plugin is a card (switch, source badge, info button, settings cog). Info modal: description, authors
(contributor modal), source and website links, "required by" list, reset-to-defaults with confirmation, pre-filled GitHub
issue button. Restart-required plugins are listed with a "restart now?" prompt.
**Network on open:** source badge icons loaded from `equicord.org`, a `camo.githubusercontent.com` image, and an SVG from `discord.com`.
**Amiricord:** keep. Filters by origin come from `plugin.json` (`amiricord`, `vencord`, `equicord`, `testcord`). Bundle all icons
locally. Add a permissions/hosts line to each card and info modal.

## 4. Themes
Sections: Theme Management; Installed (local) themes with activation mode (always, dark only, light only, disabled), copy/open/delete;
**Online Themes** (add a theme by URL, master toggle); **Theme Marketplace** and **Snippet Marketplace** (search, sort by newest,
most liked, most downloaded, name; preview image; download); Quick Actions (Edit QuickCSS, Edit client theme, open folder,
load missing themes); links to BetterDiscord themes.
**Network:** marketplaces use `themes.equicord.org` (third-party API) on open; online themes fetch any URL the user enters.
**Amiricord:** keep local themes, QuickCSS and URL themes (user-provided hosts). Marketplace only as an optional feature with
its host declared, off by default.

## 5. Updater
Auto-update switch, notify-on-complete switch, branch select (main, dev, dev2), repository link, "Updates" list with update/rebuild.
Auto-update downloads and replaces code. **Amiricord: no updater.** A manual "check for new version" that only opens the
release page could come later.

## 6. Changelog
Recent changes between versions (queries `api.github.com` compare), new-plugins section, per-plugin "required by". **Amiricord: drop.**
A local, shipped changelog file could replace it.

## 7. Stats
Hero cards (plugins enabled, available, categories in use, active patches); cards: overview, by category, by source, capabilities
(patches, commands, context menus, flux, badges, chat buttons, message hooks, settings), top authors, build info. All local;
values copy on click. **Amiricord: keep, small.** Replace "by source" with origin from the manifest.

## 8. Plugin Health
The most relevant tab for our goals. Seven sub-views: **Overview, Diagnostics, Impact, Monitor, Startup, Finder, Guide**.
Content: patch failure classes (`noEffect`, `noModule`, `errored`, `undoingGroup`, `codeChanged`, `conflict`) per plugin with the
module and regex involved; runtime errors; quarantined/unstable plugins; crashes in the last 24 h; **safe mode and crash recovery**
(boot flag); session history and uptime; plugin start-up time and share of total; performance diagnostics (composite impact
score, hot surfaces, call counts, max call, spikes, resources such as intervals/listeners/hooks, renderer heap); per-plugin
network activity; module finder (search factory source); "Discord may have updated" banners with an option to ignore source changes;
Report button that opens a pre-filled bug report in the browser (diagnostics are redacted first).
**Amiricord:** keep and make it the home of our patch-health report (analysis 01) and privacy self-test (analysis 02).
The report only opens a local draft or a link the user clicks; nothing is sent automatically. Destination is our own, not theirs.

## 9. Presets
Save the current setup as a named preset with chosen scopes (plugins and their settings, enabled themes, QuickCSS, DataStore data);
apply (optionally restore plugin settings, optionally **force apply** = disable every plugin not in the preset); auto-resnapshot option;
rename, duplicate, delete, reorder; import/export (file, clipboard, JSON); **merge two presets** with an overlap resolver;
info modal; animation toggles. A note in the code says DataStore data "may be large or contain sensitive info".
**Amiricord:** keep. Exclude secrets (tokens, API keys, cookies) from presets and exports by default and say so on screen.

## 10. Cloud
Enable cloud integration (OAuth), backend select (Equicord Cloud, Vencord Cloud, custom URL), settings sync with direction rules,
sync up/down, delete cloud settings / account. Loads logos from `equicord.org`. **Amiricord: drop** (engine rule: no traffic of its own).

## 11. Backup & Restore
Local JSON import/export of: QuickCSS, theme links, plugin settings, DataStore data; per-part buttons; warning that import overwrites;
experimental "large DataStore" switch. Some text still says "Equicord". **Amiricord: keep, local only.**
Note: because the backup includes DataStore data, other plugins' stored secrets can end up in the file (see section 13).

## 12. Patch Helper
Developer tool: fields for find, match and replacement, a box to paste a full JSON patch, a preview of the patched code with a diff,
generated code to copy, and a cheat sheet. **Amiricord: keep for developers, later** (it will help writing our own patches).

## 13. Entries added by plugins
- **AutoRedeem Logs.** The plugin redeems any Discord gift link it sees, can read the newest page of **every readable channel**,
  and can use third-party captcha-solving services (`api.voidsolver.tech`, `api.nocaptchaai.com`, `api.nonecap.com`), optionally with
  a proxy URL containing credentials. It can post each attempt to a webhook URL the user sets. The tab shows its log.
- **Token Login Manager.** Stores account tokens in the plugin DataStore (`tokenLoginManager.data`; I did not verify any encryption),
  shows them masked with a reveal option, and logs in by writing the token into an embedded frame's local storage every 50 ms for ~2.5 s,
  then reloading. Related plugins import tokens from other Discord installs (`tokenImporter` uses the OS secure storage and a PowerShell
  call; `DXTokenImporter` was analysed in the owner's other project's notes).
**Amiricord: out.** They read many channels, send data to third parties, or handle tokens, which conflicts with the privacy rules.
If the owners ever want one, it gets its own analysis first (rule 3) and a declared permission.

## 14. Summary: keep, adapt, drop
| Keep / adapt | Drop |
|---|---|
| Main screen, Privacy & Security, Plugins, Themes (local + URL), Stats, Plugin Health, Presets, Backup & Restore (local), Patch Helper (later) | Updater, Changelog, Cloud, donation/project cards, AutoRedeem, Token Login Manager, token importers |

## 15. Build order for the UI (after the engine)
1. Settings shell with the sidebar section, error boundary per tab, and the Plugins tab.
2. Privacy & Security (needs firewall and privacy report).
3. Plugin Health (needs patch-health data).
4. Main screen, Themes, Presets, Backup, Stats; Patch Helper last.
