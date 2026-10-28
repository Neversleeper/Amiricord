# Analysis 48: the settings gear on plugin cards

Owner's request (2026-10-27): look at the plugin engine and add the settings that would show behind the gear icon of a plugin.
This is piece 4e of analysis 18 ("Plugin settings editor and Reset"), which said it needed its own analysis first.

Sources read: `src/api/pluginSettings.ts` (all), `src/api/settingsClient.ts` (all), `src/shared/settings.ts` (limits, `applyChange`),
`src/api/pluginCards.ts` (all), `src/plugins/Settings/PluginItem.tsx` (all), `src/renderer/engine.ts` (lines 280-320, 485-520 and the lines
that bind settings), `scripts/build/generate.ts` (how plugin code is required), `scripts/build/manifest/validate.ts` (`riskySettings`, `secrets`),
TestCord's `PluginModal.tsx` (lines 56-315 of it) and `PluginCard.tsx` (the cog button, line 393). Not read: the TestCord components that draw
each setting type (`OptionComponentMap`), `isSettingHidden`, the warning modal of its Reset, and `PluginModalButtons`.

## 1. What exists today
- Plugins declare settings in code with `definePluginSettings({...})`. Four types only: `boolean`, `number` (min, max, integer), `string` (maxLength) and
  `select` (options), each with a `description` and an optional `restartNeeded`. Reading gives the saved value if it fits the type, else the default.
- Saved values live in the page's `SettingsClient` and in the main process (checked again there). Core plugins get it as `ctx.settingsAdmin`.
- Plugins using `definePluginSettings` today: `NoTrack`, `Settings` (the `tabLayout` text), `QuietHours`, `UniversalVolume`, `WebRTCLeakPrevent`,
  `MessageNitroBadge`, `PinterestTool` (and one folder that is not committed).
- The Plugins tab card (`PluginItem.tsx`) has the name, version, authors, description, badges, status and the switch. **It has no gear and no way to
  open settings.** The card data (`PluginCard`) does not say whether a plugin has settings; it carries only `riskySettings`, a list of names.

## 2. Findings (what makes this more than a button)
1. **The definition is in the plugin's code, and the code of a plugin that is off is never loaded.** `scripts/build/generate.ts` makes each plugin a
   lazy `require`, and the engine calls `loadPlugin(id)` only for plugins that run (or that are being switched on). So for an off plugin the page does
   not know which settings exist, their types or their defaults. Loading its code just to read them would run code of a plugin the owner switched off,
   which the project rules say must not happen.
2. **The build already finds out similar facts from the source** (`hasPatches` decides what "restart to toggle" means). The same scan can tell whether
   the source calls `definePluginSettings`, so the card can say `hasSettings` without running anything. That is a fact about the source, not the definition.
3. **`plugin-reset` is not a "reset settings" button.** `applyChange` deletes the whole entry of the plugin, including the owner's on/off choice
   (`enabled`). A Reset in the gear must remove only the saved values (one `plugin-setting` change per declared key, with no value), never `plugin-reset`.
4. **Values need no second check for shape, but they do for meaning.** The main process checks only that a value is JSON and small. A number outside
   min/max or a select value outside its options is stopped by the plugin's own definition when it is written through `settings.store` (`checkValue`),
   and by nothing when written through `SettingsClient.setValue` directly. The editor must write through the definition's own check, not around it.
5. **Secrets and risky settings.** Secrets are a separate channel (`ctx.secrets`), not settings, so they never reach this editor. `riskySettings` names
   settings that are risky to change: the editor should mark them and ask before changing them (the manifest field already exists; today nothing uses it).
6. **Restart.** A setting with `restartNeeded` must say so, and the page already has a restart notice and the `restart()` of `ctx.plugins`.
7. **TestCord's way** (read): the cog opens a modal with the plugin's info and a list of its settings, each drawn by a component for its type;
   `OptionType.CUSTOM` settings are skipped; a Reset button asks first; a `restartNeeded` setting triggers a restart prompt. In TestCord every plugin's
   code is loaded even when off, so its definitions are always there; ours cannot do that (finding 1).

## 3. Proposal, in pieces
| Piece | What | Touches shared files? |
|---|---|---|
| **S1** | **The build says `hasSettings`.** The source scan looks for a `definePluginSettings(` call; the registry and `PluginCard` get `hasSettings: boolean`. | Yes: `scripts/build/manifest/scanSource.ts`, `src/shared/manifest.ts`, `src/api/pluginCards.ts` |
| **S2** | **A core-only read of a running plugin's settings:** `ctx.plugins.settingsOf(id)` gives the declared settings (key, type, description, default, limits, `restartNeeded`, whether it is in `riskySettings`) and the current values, as plain data, only for plugins whose code is attached. Plus `setSetting(id, key, value)` (checked by the definition) and `resetSettings(id)` (values only). | Yes: `src/renderer/engine.ts`, `src/api/pluginSettings.ts` (expose the definition as plain data) |
| **S3** | **The gear and the panel in the card.** A gear button on cards with `hasSettings`; it opens the editor with a switch for `boolean`, a number box for `number`, a text box for `string`, a drop-down for `select`; "Reset to defaults" asks first; a restart notice for `restartNeeded`; a warning before changing a risky setting. For a plugin that is off the gear says "Turn it on to change its settings". | Only the Plugins tab files (`PluginItem.tsx`, `PluginsTab.tsx`, `pluginsModel.ts`, styles, an icon) |

## 4. Not verified
- That `scanSource` can find a `definePluginSettings(` call reliably (a plugin could call it through another name or file). To check by reading
  `scanSource.ts` and trying it on the seven plugins above.
- Whether a setting can be changed live for a running plugin (the plugin reads `settings.store` on each use, as NoTrack does, or only once at start).
  Each plugin's own code decides; the editor can only report `restartNeeded` as declared.
- Whether a gear panel drawn inside the card (inline) or a Discord modal is better. The modal helpers exist (`ctx.modals`, analyses 27, 32, 35) but
  none has been seen working in Discord by the owner; inline needs nothing from Discord.

## 6. Decision of the owner (2026-10-27) and what his screenshots show
The owner chose the **window (modal) like TestCord's**, and sent four screenshots of it (TestCord's Plugins tab and three plugin windows).
- **Card:** a gear when the plugin has settings, an "i" when it has none; the button sits next to the switch and opens the same window either way.
- **Window:** close button; plugin name; description; tags; a section **Authors** (a chip with avatar and name per author); a section **Settings**
  (one boxed row per setting: title, description, the control on the right; a switch for yes/no; or the line "There are no settings for this plugin.");
  a footer: **Reset** (left) and **Report Issue**, a star (favourite), a website icon and a GitHub icon (right). A long list scrolls inside while the
  header stays in place. A setting that needs a restart says so in its description text.
- **The plugins in the screenshots are switched OFF and their settings are still shown.** So the owner expects settings to be visible for off plugins.
  That collides with finding 1 (the definition of an off plugin cannot be read without loading its code).

**Way out proposed (needs the owner's OK):** a plugin that wants its settings visible while off keeps the declaration in its own file,
`settings.ts` (the convention `PinterestTool` already follows), containing only `definePluginSettings(...)` and no side effects. The build checks that
this file imports nothing except the settings API, and the engine may load only that file to read the definitions of an off plugin. Nothing of the
plugin itself runs. A plugin without that file keeps its settings inside `index`, and its gear says "Turn it on to see its settings". This replaces
the "gear asks to turn the plugin on" answer of question 2 for plugins that follow the convention. Not verified: that all seven plugins that use
settings today can be split this way without changing what they do.

**The window itself** would use the modal pieces of analyses 27, 32 and 35 (opener, closer, components). None of them has been seen working in the
owner's Discord yet; that is the first thing to check, before anything is drawn in it. Authors' avatars need Discord's user data (TestCord loads each
author through Discord's user store): not analysed; a first version can show the name only. The star (favourites) needs the saved list of analysis 18.
"Report Issue", the website and GitHub icons need a link per plugin that the manifest does not have today (TestCord has them per plugin).

## 5. Questions for the owners
1. Inline panel in the card (safer, nothing from Discord) or a modal like TestCord's?
2. For a plugin that is off: gear visible but asking to turn the plugin on first (proposed), or hidden until it is on?
3. S1 and S2 touch files shared with Neversleeper's area (`engine.ts`, `src/api`, the build scan). They must be told to her before they are joined
   (`docs/collaboration.md`). Is the owner telling her, or should the commit message and the log say it?
