# Analysis 18: the Plugins tab

Status: **draft for the owner's approval. No code is written.** Author: Neversleeper's session, 2026-10-25.
Sources read: `docs/design-03-settings.md`, `docs/design-01-manifest-permissions.md` (section 10), `docs/ui-reference.md` (section 3), `docs/collaboration.md`, `src/api/pluginCards.ts`, `src/api/pluginSwitch.ts`, and TestCord's own Plugins tab (a public read-only reference, commit `af92dba`: `src/components/settings/tabs/plugins/index.tsx` all 670 lines, `PluginCard.tsx` lines 1-404).
Marked **[not verified]** where this note could not see the thing itself.

## 1. What this note is for
The data and the switch for the tab already exist. This note decides what the tab shows, what it takes from TestCord as an idea (no code is copied: the owners write their own), what it leaves out, and how the work is cut into pieces that can each be tested and committed on their own.

## 2. What the engine already gives the tab
- `ctx.plugins.cards()`: one plain-data card per plugin. Fields the tab can use today: `id`, `name`, `version`, `description`, `origin`, `license`, `authors`, `credits`, `tags`, `dependencies`, `core`, `experimental`, `legacy`, `replacedBy`, `restartToToggle`, `risk` (`level`, `label` for the highest level, `reasons`), `hosts`, `telemetryHosts`, `compatibility` (`ok`, `discord-too-old`, `discord-too-new`, `unknown`) and a `state` block (`chosen`, `wanted`, `running`, `lifecycle`, `error`, `reason`, `neededBy`, `skipped`, `restartNeeded`).
- `ctx.plugins.toggle(id, enabled)` answers `applied`, `restart-needed`, `unchanged`, `refused` (with a reason) or `failed` (with an error). It already refuses to turn a core plugin off, refuses to turn off a plugin a running plugin needs, and starts what a plugin needs first.
- `ctx.plugins.restart()`: relaunches Discord (the main process answers only trusted pages).
- Only core plugins get these (`ctx.plugins` is core-only), and the Settings plugin is core, so the tab can use them.
- **Not in the card:** stability (flaky / unstable). It comes from the health store and the Plugin Health tab is a later piece, so the stability badge is **out of version 1**. Whether the page can read it from the cards today was not checked [not verified].

## 3. What TestCord's tab does (read in code)
- **Header card** with two states: "Plugin Management" (help text and a "Disable All Plugins" button) and "Restart required" with a "Restart" button. The restart button calls `location.reload()`, a page reload and not a relaunch.
- **Two count cards** (stock plugins and user plugins, enabled out of total).
- **Search** over name, name without spaces, the capital letters of the name (acronym), description and `searchTerms`. Special prefixes (`tcp:`, `vcp:`, `eqp:`, `plg:`...) restrict the folder.
- **Filter by type** (one drop-down with 14 entries: all, favorites, enabled, disabled, three origins, "modified", new, user plugins, API plugins, BetterDiscord, experimental, legacy), **filter by tags** (multi) and **filter by author** (with a GitHub link).
- **Order:** by name, favorites first. Favorites are a per-plugin `isFavorite` setting.
- **Sections:** the normal list, then a separate "Required Plugins" section for plugins that are required or that a running plugin needs, with a tooltip "required by".
- **Loading:** cards appear 36 at a time, loaded when a marker at the bottom scrolls into view.
- **"New" plugins:** a baseline of known plugins is stored; plugins added since the last launch get a mark and a filter.
- **Card:** name (it can split CamelCase into words, controlled by a setting), description, switch, an info button that becomes a cog when the plugin has settings, a footer with the origin (icon and text), a warning badge for experimental and legacy plugins, a stability badge for flaky and unstable ones, and up to two tags with a "+N" tooltip.
- **Switch behaviour:** turning on an experimental or legacy plugin asks for confirmation first; turning on starts the needed plugins first; a plugin with patches only records the choice and adds the plugin to a list that, when the tab closes, asks for a restart; a failed start or stop goes back to the previous choice and shows a toast.
- **Not read** [not verified]: the info modal (`PluginModal.tsx`, 473 lines), the contributor window, the count cards' code, `UIElements`, `AddonCard`, the CSS, and how "Disable All" decides what to do in every case (its code in `index.tsx` was read: it records plugins with patches as needing a restart and stops the others on the spot).

## 4. What looks weak in TestCord (opinion from reading the code, not run)
- The origin icons and the BetterDiscord logo are **loaded from other servers** (equicord.org and a GitHub image proxy). That breaks Amiricord's rule that the tabs make no network request by themselves. Ours are bundled locally.
- The restart is a page reload; ours is `ctx.plugins.restart()`, which relaunches Discord.
- The jump-to-plugin helper looks up the search box with `document.querySelector` and scrolls the page by hand. We should not use raw DOM from a plugin.
- In the required-plugins pass it reads `settings.plugins[d].enabled` for every dependent `d`; if a dependent has no settings entry yet this could throw [not verified at run time, only seen in the code].
- The "disable all" button writes settings directly for each plugin. Ours must go through `toggle`, one plugin at a time, so every rule (core locked, needed-by) stays in one place.
- The author filter keeps its own table of authors and GitHub names built inside the tab; ours already has `authors` in each card.
- The tab file is 670 lines plus the card (405) because everything is in one component. Ours is split into a pure model and small components (see section 6).

## 5. What the Amiricord tab shows in version 1
1. **Header card:** "Plugins" with a one-line help text. When any card has `state.restartNeeded`, it turns into "Restart required" with a **Restart Discord** button (`ctx.plugins.restart()`), asking first, like the main tab's Relaunch.
2. **Counts:** total, enabled and "need a restart", from the cards.
3. **Search box** over name, id, description, authors and tags. No special prefixes in v1.
4. **Filters:** state (all, on, off, needs restart, with errors), origin (from `origin`), risk (any, medium and higher, high), and tag. One row, one control each. Author filter later.
5. **List:** cards sorted by name. No favorites and no "new" in v1 (they need new saved data; see section 8).
6. **Card:** name, version, short description, origin badge (local icon), authors, risk mark (the label of the highest level is shown as given by `risk.label`), a "restart needed" note when it applies, the switch, and a small line with the reason it runs (core, chosen, default, needed by...). Core plugins show the switch **locked** with the reason. A plugin that could not run shows `state.skipped` and `state.error` in plain words. A plugin whose `compatibility` is `discord-too-old` or `discord-too-new` shows a note.
7. **Switch:** calls `toggle` and shows the answer in words (`restart-needed` raises the header card; `refused` and `failed` show the reason next to the card; the switch goes back to what the card says). Turning on an experimental or legacy plugin asks first, with the replacement named when `replacedBy` is set.
8. **Empty states:** "No plugin matches" with the filters that cause it and a "clear filters" button; a different text when there are no plugins at all.
9. Every part of the tab sits in the error boundary that the Settings plugin already gives each tab.

Left out of version 1 on purpose: "Disable All" (decision in section 8), the info modal with all permissions and credits (piece 4, later), the contributor window, favorites, "new", stability badge, batch loading (with so few plugins it is not needed; to be revisited when there are hundreds), CamelCase splitting.

## 6. Pieces
| # | Piece | Files (new, in my area) | Touches shared files? |
|---|---|---|---|
| 1 | **The model:** pure functions that take cards and the filter state and give back counts, the filtered and sorted list, the empty-state reason and the header state. | `src/plugins/Settings/pluginsModel.ts`, `tests/pluginsModel.test.ts` | No |
| 2 | **The card:** one component per card with the switch, the lock, the notes and the answers of `toggle`. | `src/plugins/Settings/PluginCard.tsx` (name to be checked so it does not clash with the engine's `PluginCard` type), tests with the fake React already used in `tests/settingsTabs.test.ts` | Uses `ctx.plugins` and the `common` components only |
| 3 | **The tab:** header card, counts, search, filters, list, empty states, restart button. | `src/plugins/Settings/PluginsTab.tsx`, `src/plugins/Settings/pluginsTabStyles.ts` (or styles added in `styles.ts`) | **Yes, a few lines:** registering the tab in `index.tsx` and `tabLayout.ts`, an icon in `icon.tsx`, CSS if added to `styles.ts`. To be told to szlcx404 first. |
| 4 | **The info window** (all permissions and hosts, risk reasons, credits, settings link). | later | Later |

## 7. What is not verified
- **Stable.** The components of Settings were read from Canary (build 650101 in a test). Nothing in this tab has been seen in Stable. szlcx404's README says the same about the whole engine.
- **Tab behaviour when Settings stays open.** Whether Discord rebuilds the settings tree while the page is open (so a restart notice or counts update live) is open in szlcx404's log for the Editor Mode too. The tab will re-render from `ctx.plugins.cards()` on its own events; whether that is enough was not tested.
- **Only two plugins exist and both are core** (`NoTrack`, `Settings`). The tab would show only locked switches and the filters would have nothing to separate. Unit tests will use fake cards, but a real check of an unlocked switch needs a plugin that can be turned off [see question 2].
- **Whether `ctx.plugins.cards()` updates after a toggle** in the real page (the engine tests say it shows "the state right now and the choice as it is now", but the page was never seen doing it).
- **The list of values of `origin`** and of `Tag` was not read in `src/shared/manifest.ts`; the filters will be built from what the cards really contain, not from a copy of that list.
- **TestCord's files not read** are listed at the end of section 3.

## 8. Questions for the owner
1. **Disable All:** leave it out of v1 (my proposal; with only core plugins it would do nothing), or build it as a loop of `toggle` calls with one confirmation?
2. **A plugin to test with:** do we add a small clearly-named example plugin (off by default, no patches, no permissions) so the switch can be seen working? It is a new plugin, so szlcx404 has to agree too. Without it, only fakes test the switch.
3. **Favorites and "new":** wanted later? They need new saved settings, and the plugin settings have no list type (only boolean, number, string, select), so they would be stored as one JSON text like `tabLayout`.
4. **Risk wording:** use the labels the engine already produces (`risk.label` for the highest level), with no new words of mine.
5. **Stable:** see `docs/decisions.md`; a decision of both owners is pending about testing on Stable.

## 9. Order of work after approval
Piece 1 first (pure and small), then 2, then tell szlcx404 about the shared lines, then 3; a real check in Discord at the end of each piece that changes what is on screen, on the Discord the owners agree on.

## 10. Version 2: what TestCord has that ours does not (read 2026-10-25)
The owner asked for "what TestCord has in its Plugins section, the authors and whatever else is missing, and improve it where possible". Read now, in TestCord `af92dba`, read-only, nothing run or copied: `PluginModal.tsx`, `ContributorModal.tsx`, `PluginStatCards.tsx`, and again `index.tsx` and `PluginCard.tsx`. NOT read: `PluginModal.css`, `ContributorModal.css`, `AddonCard`, `UIElements.tsx`, `jumpToPlugin.ts`, the `components/` folder (setting editors).

### 10.1 What is missing in ours, and how TestCord does it
| TestCord | What ours has today | Proposal |
|---|---|---|
| **Authors.** The plugin window lists the authors with avatars; each opens a contributor window with the avatar, GitHub, website and the list of plugins that person made. It gets users with `UserUtils.getUser(id)` and `fetchUserProfile(id)` (requests to Discord, up to six authors per plugin) and makes a dummy user while loading. | The card says "by <names>". `Author` in the manifest is `{name, discordId?, role?}`; there is no GitHub field. | Authors section in a details panel with name, role and the other plugins by the same person, all from the cards (no request). Avatars and profile only if they are already in Discord's own user cache (not verified that this can be read without a request). A GitHub link needs a new field in `src/shared/manifest.ts` (shared file). |
| **Author filter** (drop-down, plus a link to the author's GitHub). It builds its own table of authors inside the tab. | No author filter. | Filter built from `card.authors`. No new data. |
| **Plugin window** (description, tags, warning banner, settings editor, Reset, Report Issue, Favorite, Website, Source Code). | Nothing opens. Card shows name, badges and status only. | Details panel inside the page (not a Discord modal, so it does not depend on Discord's modal component, which was not checked on Stable) with everything the card already holds: version, license, origin, risk and its reasons, permissions-related hosts and telemetry hosts, credits, dependencies and who needs it, compatibility. |
| **Favorites** (star in the window, favorites first, filter "Show Favorites"). | No. | Needs a saved list: one JSON setting like `tabLayout` (plugin settings have no list type). Touches the Settings plugin settings (shared). |
| **"New" marker** (plugins added since the last start, baseline kept in IndexedDB). | No. | Same kind of saved list. With two plugins nothing is ever new, so low value today. |
| **Disable All Plugins** (confirm "cannot be undone"; it writes settings by hand and, for plugins with patches, asks to reload). | Left out of v1. | Loop of `toggle` calls (so core and "needed by" rules stay in one place), one confirmation, and an Undo bar that remembers what was on (as Editor Mode does). Better than TestCord's, which cannot be undone. |
| **Plugin settings editor and Reset** (boolean, number, select, slider, text components). | None. | Needs reading `SettingsClient` (core-only `ctx.settingsAdmin`) and the setting types (boolean, number, string, select). Not read yet; separate analysis. |
| **Stability badge** ("Flaky/Unstable" from the history of broken sessions). | None. | The engine keeps a health report per plugin, but `PluginCard` does not carry the history. Needs a change in `src/api` (shared). Later, with the Plugin Health tab. |
| **Jump to a plugin** (click on "replaced by X" fills the search and scrolls by searching the page for elements). | Shows "replaced by X" as text. | Click sets the search to that plugin's name. No page scanning. |
| **Report Issue** (opens a GitHub issue pre-filled with a debug report). | None. | Not now. If wanted: copy the report to the clipboard, never open or send anything by itself (privacy rule). |
| Search prefixes (`tcp:`, `vcp:`...), search terms, lazy loading in batches of 36, "Are you looking for" list of excluded plugins. | Search over name, id, description, authors, tags. | Not needed: prefixes belong to TestCord's three plugin sources; batches matter only with hundreds of plugins. |

### 10.2 What looks weak in TestCord here (from reading, not run)
- The author window asks Discord for each author's user and profile every time it opens, so merely looking at a plugin's authors makes requests. Against our rule that the engine and its screens send nothing of their own.
- Source icons on every card come from `equicord.org`, `camo.githubusercontent.com` and `discord.com` (remote images).
- Disable All says "This action cannot be undone".
- The "Enable anyway" confirm calls `doToggle(false)` with a hard-coded value (works only because the confirm is shown when the plugin is off).
- The author drop-down mixes three plugin sources by looking at folder names; ours has `origin` as data.

### 10.3 Proposed pieces
| # | Piece | Shared files? |
|---|---|---|
| 4a | **Author filter** and click on "replaced by" to jump to that plugin. Model and tab only. | No |
| 4b | **Details panel** per plugin with an Authors section (name, role, other plugins by the same author) and the rest of the card data. | No |
| 4c | **Disable All** with one confirmation and an Undo bar. | No |
| 4d | **Favorites and "new"** (saved list as one JSON setting). | Yes: Settings plugin settings (`index.tsx`) |
| 4e | **Plugin settings editor and Reset.** Needs its own analysis first. | Probably (`src/api`) |
| 4f | **Stability badge.** | Yes (`src/api/pluginCards.ts`) |
Recommended order: 4a, 4b, 4c (nothing shared), then the owners decide about 4d to 4f. A GitHub field for authors (manifest change) would be told to szlcx404 before it is made.

### 10.4 Not verified
- That Discord's own user cache can be read without making a request (decides whether avatars are possible).
- How the details panel and the new controls look and behave inside a real Discord; nothing of this tab has been seen there yet.
- TestCord files listed at the top of section 10 that were not read.

### 10.5 Questions for the owner
1. Details panel inside the page (my proposal) or a Discord modal like TestCord's?
2. Avatars of authors: skip them (no request at all), or only when Discord already has them in its cache (if that can be read)?
3. Add a GitHub field for authors in the manifest (shared file, szlcx404 must agree)?
4. Order: 4a, 4b, 4c first, as proposed?
