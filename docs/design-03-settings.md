# Design 03: the Settings core plugin and what the engine needs first

Status: proposal, to be approved by the owners. Based on `docs/analysis-09-settings-core.md`, `docs/ui-reference.md` and design 01 and 02.

## 1. Goal
Make Amiricord visible and controllable from Discord's own settings: a section in the settings sidebar where the owner sees the engine's status,
the list of plugins with their risk, permissions and stability, and turns plugins on or off. Nothing here talks to the network.

## 2. Scope of version 1 (small on purpose)
| Tab | What it shows | Source of data |
|---|---|---|
| **Amiricord** (main) | Engine status (version, Discord build, safe mode, quarantined plugins), what a restart does, a "Restart Discord" button, short help | `bootInfo`, health report |
| **Plugins** | One card per plugin: name, description, origin badge, risk mark ("High risk" when computed), stability badge, hosts it may call, switch; search box; filter by origin and by on/off | registry (manifests), health report, saved choices |
Later, one tab at a time and each with its own analysis: Plugin Health (data already exists), Privacy and Security (after the firewall), Themes and
QuickCSS, Presets, Backup and Restore, Stats. Dropped for good: updater, changelog, cloud (see `ui-reference.md`).
The plugin is `core: true` (it also runs in safe mode, so the owner can always reach the switches), `startAt: webpackReady`, permissions none,
authors szlcx404 and Neversleeper, credits: Vencord/TestCord for the idea of the layout patch (design idea only, no code copied).

## 3. How it hooks into Discord
- **One patch** on the module that contains `.buildLayout().map` (text to be confirmed on the real client, see section 6): replace the root layout
  builder's `buildLayout()` with `$self.buildLayout(builder)`. Our function takes the original list, adds our section once (marker key
  `amiricord_section`), and returns it. Only the root builder is touched.
- **Layout node types** (SECTION, SIDEBAR_ITEM, PANEL, CATEGORY, CUSTOM) are looked up with a finder at run time, with a fallback table and a health
  "finder miss" if the lookup fails. If anything about the layout is not as expected, the plugin returns Discord's list unchanged (Discord's settings must
  never break because of us).
- **Section position:** one fixed place in v1 (right after Discord's own account sections, exact anchor key chosen from the real layout); a setting for
  it comes with editor mode, later.
- Every panel is wrapped in an **error boundary**: a broken tab shows a message, never a blank settings window.

## 4. What the engine must provide first
| # | Piece | Notes |
|---|---|---|
| A | **Settings store.** Main-process `settings.json` (atomic write, schema check, size cap), read synchronously at boot and passed with the boot info, writes by small `set path value` messages from trusted pages. Plugin choices are `plugins.<id>.enabled`; plugin settings are `plugins.<id>.<key>`. | Replaces today's empty `choices`. Secrets never go in this file (design 01 s9). |
| B | **Settings API for plugins.** `definePluginSettings` with typed defaults and a `useSettings` hook for React; values live in the store; changes are validated against the declared type. | Same shape the owners know from TestCord, our own code. |
| C | **Common finders and components.** React (createElement, hooks) and **Discord's own components** (switch, button, text input, select, tooltip, modal...), found with finders as TestCord does, so the tabs look identical to Discord. Each one has a **fallback**: a small component of ours painted with Discord's CSS variables, used when the finder misses (the miss is reported to health). | Q3 below (owner's choice: identical look). The fallback keeps settings usable when Discord renames something. |
| D | **JSX and CSS in the build.** esbuild turns `.tsx` into calls to a small factory that uses the React found at run time; plugins add CSS through `addStyle(id, css)`, removed automatically when the plugin stops. | Needs a check that Discord's CSP allows inline styles (themes already rely on it). |
| E | **Plugin info for the page.** The page script gets, per plugin, name, description, version, origin, tags, authors, credits, risk and the hosts it may call (never anything secret). | Extends the generated registry module. |
| F | **Restart.** A trusted-page message that relaunches Discord (main process `app.relaunch` and `exit`). | One more IPC channel, answered only to trusted senders. |
| G | **Discord build number** detection (today `null`). | Shown in the main tab and kept in health. |
Turning a plugin on or off takes effect **after a restart** (Q2): patches cannot be taken back out of modules that already ran, so a restart is the
only honest way, and the tab says so next to the switch.

## 5. Build order (each item waits for the owners' OK, like every step so far)
1. A settings store (main process) and its page side. 2. B settings API. 3. G build number. 4. C and D (common finders, components, JSX, CSS).
5. E plugin info and F restart. 6. The Settings plugin itself: patch, section, error boundary, main tab. 7. The Plugins tab. 8. First test on Canary
(backup first, same procedure as the installer test).

## 6. Risks and what is not verified
- **TestCord's hook point does not exist in the current client** (analysis 09 s5: `buildLayout` and `$Root` have no match in Canary or Stable; the node types enum is unchanged).
  So the first step of the plugin is a **discovery step**: find where the settings tree root is built now, either by reading the likely chunk (`855669` / `935637`)
  or by a small probe running inside the live engine on Canary. Only then is the patch written. Build order item 6 below depends on it.
- ~~The patch text is a guess from TestCord's version.~~ (old note) **The patch text is a guess from TestCord's version.** Discord's web client is not on disk. To write and check the real patch (and the finder for the
  layout types) I need a copy of its public script files (`dump`). Until then nothing here can be tested against the real settings window.
- Discord changes its settings code often; the plugin must degrade to "no section" and say so in health, never break settings.
- A restart is the only way to apply a change of enabled plugins; that is a design limit, not a bug.

## 7. Decisions for the owners
- **Q1 scope:** v1 = main tab plus Plugins tab, the rest later (recommended).
- **Q2 changes need a restart,** with a "Restart Discord" button (recommended).
- **Q3 look (decided by the owner, 2026-10-24):** the tabs use **Discord's own components** so they look identical to Discord and to TestCord. To contain the
  risk, every component goes through one thin layer (`common`) with a finder and a fallback of our own; a miss shows the fallback and is recorded in health.
- **Q4 storage:** `settings.json` in `%APPDATA%\Amiricord`, owned by the main process, atomic writes, no secrets (recommended).
- **Q5 position:** one fixed place in v1, chosen once the real layout keys are known.
- **Q6 permission to fetch Discord's public script files** (see the next section) so the patch can be written against the real code.

## 8. The fetch (needs the owner's explicit OK)
What: `GET https://canary.discord.com/app` (the public page, no login) and the script files it lists under `/assets/`, plus the style files only if needed.
Where to: a folder in this session's scratchpad, outside the project and never committed. What it does: lets me search the real module text for the
patch and the finders, offline, and later builds the `tools/dump` command of design 02. Sent: nothing about you (no token, no cookies). Size: tens of MB.

## 9. The settings probe (discovery step, dev only)
Why: the real settings tree could not be found by reading Discord's script files (analysis 09 s5 to s7). The probe reads it from the live client on Canary, once.

**What it does** (inside the page, only when dev mode is on):
1. Finds the node types enum with a finder (`ROOT`, `SECTION`, `SIDEBAR_ITEM`, `PANEL`, `CUSTOM`) and records its values.
2. Finds the navigation controller (the object with `navigate`, `init`, `maybeCreatePanelSnapshot`) and wraps its `init` method on the live instance so it notices when Settings opens and gets the
   `accessibleDirectory`. The wrapper only observes and calls the original; it is removed when the probe stops.
3. From the directory, walks up to the root node and down through `layout`, writing for each node only: key, type name, number of children, and which of `useTitle`, `useSubnavLabel`, `render` it has.
   Limits: depth 8, 2 000 nodes.
4. Writes the **source text** of the directory's constructor and of a few key methods (maximum 4 KB each). With that text the module can be found in `web.<hash>.js` and the function that
   builds the tree becomes visible: that is the patch point.
5. Looks at the page's `[data-settings-sidebar-item]` elements and walks the React tree upwards from the first one, writing **component names and function source only** (never props, state or text).
6. Every string goes through the redaction function of the health module before it is written.
**What it never reads:** chats, messages, user names, titles of channels, settings values, tokens, cookies, props or state of any component.

**Engine pieces it needs (small, dev only):**
- `devMode` in the boot info: true when the file `%APPDATA%\Amiricord\dev.flag` exists (the owner creates it, or deletes it to turn the probe off; nothing else turns it on).
- A narrow message `dev-dump(name, text)` from the page to the main process, answered only to trusted pages and only in dev mode: `name` must match `[a-z0-9-]{1,40}`, text at most 1 MB, written atomically to
  `%APPDATA%\Amiricord\probe\<name>.json`.
- The probe code in `src/renderer/probes/` and the engine starts it when `devMode` is true. When the patch is written and checked, the probe is removed from the bundle.

**Build steps:**
P1 dev mode and the dump message (main, preload, bridge, page). P2 the probe, tested against a fake Discord-like controller and a fake DOM. P3 the real test on Canary.

**P3 procedure (needs the owner's explicit OK at that moment):** `pnpm build`; `pnpm installer inject --branch canary --yes --force-close` (backup first, Canary closed and reopened); create `dev.flag`;
the owner opens Settings in Canary and clicks around two or three sections (no need to open anything private); I read `probe\settings.json`, show a summary and check it for personal data before
quoting anything; then the owner deletes `dev.flag` (or I do, with OK) and, if wanted, `pnpm installer uninject --branch canary`.
