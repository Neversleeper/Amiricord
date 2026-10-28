# Design 01: plugin manifest (`plugin.json`) and permissions

**Status: proposal for the owners' approval. No code written.**
Builds on the owner's earlier the owner's other project plan (`the owner's other project\design\plano-core.md` s6: manifest, tags, risk tag, declared
permissions, quarantine) and on analyses 01 to 03 and `ui-reference.md`.

## 1. Goals
1. The engine knows what a plugin needs **before running its code**: hosts, native code, account writes, tokens.
2. Those declarations feed four things: the **CSP**, the **firewall allow-list**, the **native/IPC isolation**, and the
   **UI** (plugin card, consent prompt, privacy report).
3. Origin, license and credits are explicit and machine-readable (needed because some plugins are adapted from others).
4. A plugin cannot get more than it declared, and a change in permissions after an update is noticed.

## 2. What the manifest is (and is not)
- A static JSON file next to the plugin's code: `src/<origin folder>/<PluginName>/plugin.json`, where the origin folder is `plugins` (ours), `vencordplugins`, `equicordplugins` or `testcordplugins`.
- Static on purpose: the build reads it without executing anything.
- It declares identity and needs. **It does not hold code**: patches, settings schema, commands and UI stay in the plugin's
  TypeScript, as in TestCord's `definePlugin`.
- Fields TestCord keeps only in code (`required`, `hidden`, `enabledByDefault`, `tags`, `dependencies`, `requiresRestart`,
  `authors`) move to the manifest, so they can be read, listed and checked without loading the plugin.

## 3. Schema (version 1)
```jsonc
{
  "schema": 1,
  "id": "PinterestTool",                 // unique across all origins, same as the folder name
  "name": "Pinterest Tool",
  "version": "1.0.0",
  "description": "Search and send Pinterest images.",
  "origin": "amiricord",                 // amiricord | vencord | equicord | testcord (must match the folder the plugin is in)
  "license": "GPL-3.0-or-later",         // SPDX id
  "authors": [ { "name": "szlcx404", "discordId": "1554284154009682032", "role": "author" } ],
  "credits": [ ],                        // original authors when adapted, with their license/url
  "tags": ["chat", "media"],             // closed list, extensible
  "dependencies": ["CommandsAPI"],       // engine APIs or other plugins
  "enabledByDefault": false,
  "experimental": false,                 // unfinished or with side effects: shows an "Experimental" label and a warning on enable
  "legacy": false,                       // old, unmaintained or replaced: shows "Legacy"; "replacedBy" names the successor
  "replacedBy": null,
  "requiresRestart": "auto",             // "auto" = restart needed if the plugin has patches; or true / false to force
  "core": false,                         // true only for engine-core plugins (NoTrack, Settings)
  "discord": { "minBuild": null, "maxBuild": null },   // optional range the patches were written for
  "entry": { "renderer": "index.tsx", "main": "native.ts" },   // "main" present only if it has native code
  "permissions": {
    "network":  [ { "host": "www.pinterest.com", "from": "main", "why": "search and session" },
                  { "host": "i.pinimg.com", "from": "main", "why": "image download" } ],
    "native":   { "functions": ["warmUp", "search", "download"] },
    "account":  { "write": [] },         // e.g. ["profile.pronouns", "quest.progress"]
    "messages": { "read": "visible", "send": false },   // none | visible | all-channels
    "token":    false,                    // true = needs the user's token, always high risk
    "files":    "plugin-data",            // none | plugin-data | user-chosen | paths
    "system":   { "spawn": false, "clipboard": true, "listen": [], "openExternal": true },
    "code":     { "dynamic": false },     // eval / new Function / remote code
    "telemetry": { "send": [] }           // endpoints it posts as telemetry, e.g. Discord science (normally empty)
  },
  "secrets": ["pinterestCookie"],         // setting keys that are secrets: never exported, never in presets or backups
  "riskySettings": []                     // setting keys that are riskier than the rest (e.g. options the plugin itself marks as risky):
                                          // shown with a warning and off until the user confirms
}
```
Rules enforced when the manifest is validated at build time:
- `origin` matches the origin folder the plugin is in; `id` equals the folder name and is unique everywhere.
- `entry.main` exists if `native` has functions, and the reverse.
- Every host is a bare hostname or `*.domain`, no scheme, no path, no `*` alone.
- No unknown fields (typos fail the build instead of silently granting nothing).
- Adapted plugins (`origin` other than `amiricord`) must list the original author(s) and the original license in `credits`.

## 4. Risk level (computed, not declared)
The author cannot understate it: the engine computes it from `permissions`.
| Level | When |
|---|---|
| **low** | no network, no native, no account writes, no token, no dynamic code, no listening ports |
| **medium** | declared network hosts and/or native functions, clipboard, open external links |
| **high** | any of: account writes, sends messages, reads all channels, token, user-chosen or arbitrary file access, spawn, listen on a port, dynamic code, telemetry send |
High-risk plugins: off by default; never enabled as a dependency of another plugin; a **confirmation prompt the first time**
listing exactly what was declared; a visible mark on the card and a filter. The owners choose the name of this mark
(the the owner's other project plan left it open; see s9).

## 5. Where each permission is enforced
| Permission | Enforcement point | Strength |
|---|---|---|
| `network` (from `main`) | The engine's main-process request helper rejects hosts the plugin did not declare; the firewall also logs it. | **Strong**: all `native` requests go through our helper |
| `network` (from `renderer`) | CSP is built from the **union** of enabled plugins' hosts; plugins that use the engine's `fetch` wrapper are checked individually. | **Medium**: CSP is per page, not per plugin |
| `native` | IPC channels are namespaced per plugin id; the main process checks the caller. Only declared functions are exposed. | Strong for honest plugins |
| `account.write`, `messages.send` | Engine REST wrapper requires the plugin to declare it and logs each call in the privacy report. | Medium |
| `token` | No engine API returns the token unless declared; the token never crosses IPC. | Medium |
| `files` | Engine file helpers confine access to the plugin's data folder, or open a dialog for user-chosen files. | Strong via helpers |
| `code.dynamic`, `system.listen`, `system.spawn` | **Build-time scan** of the plugin's source for `eval`, `new Function`, `child_process`, `createServer`; any hit not declared fails the build. | Medium (static scan) |
| `secrets` | Excluded from backup, presets and exports; stored encrypted with the OS secure storage. | Strong |

### Honest limit: this is not a sandbox
Plugins run **inside Discord's page**, with the same power as Discord's own code. A deliberately malicious plugin could call
`window.fetch` or `XMLHttpRequest` directly, bypassing our wrappers. What the design really gives:
1. **A closed list of hosts for the whole page** (CSP): even malicious code cannot reach an undeclared host while the CSP holds.
2. **Strong control of everything in the main process** (native code, files, processes), which is where the real damage can happen.
3. **Build-time checks**: all plugins are compiled into `dist`; we do not load plugin code from disk at runtime in version 1.
   That makes the manifest check, the source scan and the permissions report possible before anything runs.
4. **Visibility**: a per-plugin report of what it declared and what the engine saw it do.
It protects against mistakes, overreach and silent changes, not against a determined attacker who is already running code
in the page. The owners should only compile plugins they have read. This must also be said in the docs.

## 6. Consent and change detection
- On first enable of a **high** plugin: modal with the declared permissions in plain language. Choice stored as a hash
  of the `permissions` object plus plugin version.
- If an update changes the `permissions` hash, the plugin is **disabled until re-approved** and the report says what changed.
- Medium plugins show their permissions on the card and in the info modal, with no prompt.
- Quarantine (from analysis 01): repeated patch or runtime failures disable the plugin and record why.

## 7. How the manifest feeds the rest of the engine
```
build:  read all plugin.json -> validate -> scan sources vs permissions -> generate registry (ids, permissions, risk)
start:  registry -> CSP builder, firewall allow-list per plugin, IPC namespaces
UI:     Plugins tab (badges, filters, permissions), Privacy tab (per-plugin hosts), Plugin Health
report: per plugin = declared permissions + observed requests + blocked requests
```

## 8. Examples (illustrative: each plugin's real manifest comes from its own analysis, rule 3)
- **PinterestTool** (`amiricord`): network `www.pinterest.com`, `i.pinimg.com`, `s.pinimg.com` from `main`; native
  search/download; secret `pinterestCookie` (only sent to pinterest.com); no account writes; risk **medium**.
- **NoTrack** (`amiricord`, `core: true`): no network; patches only; risk **low**; cannot be disabled.
- **BadgeAPI/UserMarkers** (`amiricord`): `account.write: ["profile.pronouns"]` for the marker (option C), so risk **high**;
  as an engine feature the owners have pre-approved it, with the first-run notice already decided.

## 9. Decisions
1. **Name of the high-risk mark:** **"High risk"** (owner's choice, 2026-10-24; UI text is English). Kept in one constant so it can be renamed
   (alternatives discussed: "Sensitive", "Elevated", "Restricted"). The level is computed by the engine from the declared permissions
   (s4), never chosen by the plugin; undeclared behavior is caught by the build-time source scan (s5), with its limits stated there.
2. **Permission granularity:** *pending*; recommendation: keep the nine categories in the manifest (cost is only for plugin authors)
   and show plain-language chips in the UI.
3. **Secrets:** **decided 2026-10-24**: only excluded from backups, presets and exports. Not encrypted in version 1
   (so anyone who can read the settings file can read them; revisit later).
4. **No user-plugins folder in version 1:** **decided**. Owners' plugins live in `src/plugins/` and are compiled in.

## 10. Plugin card and marks (UI contract, from the owners' choices)
Marks shown on each plugin card, all derived from the manifest or from health data:
| Mark | Source |
|---|---|
| High-risk mark (name pending) | computed from `permissions` (s4) |
| Experimental | `experimental: true` in the manifest |
| Legacy (with link to the replacement) | `legacy: true`, `replacedBy` |
| Restart required | `requiresRestart`: "auto" means yes when the plugin has patches (patches are applied when Discord loads its modules) |
| Flaky / Unstable | plugin health: broken sessions among the last 10 |
Stability rule, same idea as TestCord's but kept as our own: a session counts as broken if the plugin had a patch failure or
a runtime error. "Unknown" below 3 sessions seen; "Stable" with none broken; "Flaky" when some but under 40 %; "Unstable" at 40 % or more.
**Difference:** a "Discord changed this module" event is shown as its own notice and does not by itself make the plugin flaky.
Card footer: origin icon and name (bundled locally), author names. Clicking an author opens the **contributor window**
(avatar, name, number of plugins, links they published, cards of their plugins). The Plugins tab header card (Plugin Management,
Disable All, restart notice) and the two count cards are part of the Plugins tab only.

## 11. What it takes to build (once approved)
1. JSON schema file and a validator script in `scripts/build/`.
2. The risk calculator and the source scanner.
3. Registry generation into `dist`.
4. Tests: invalid manifests fail, undeclared host fails, risk computed correctly, permission change detected.
No plugin is ported before these exist.
