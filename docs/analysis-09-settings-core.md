# Analysis 09: TestCord's Settings core plugin and its settings storage

Reference only, in our own words, nothing copied. Source: `src/plugins/_core/settings.tsx` (889 lines, read from line 1 to 140 and 617 to the end,
plus a `grep` of the rest), `src/api/Settings.ts` (459 lines, only the main exports looked at) and `src/main/settings.ts` (84 lines, grep).
Read on 2026-10-24 in the local copy. The tab contents are described in `docs/ui-reference.md`; this file is about the mechanism.
Rule 3 (analysis before porting): the plugin is `required: true`, authors Ven and Megu (Vencord origin), no network calls, no `native.ts`.

## 1. What the plugin does
1. **Adds a section to Discord's settings sidebar.** Discord's settings are built from a tree of layout nodes (types such as SECTION,
   SIDEBAR_ITEM, PANEL, CATEGORY, CUSTOM). One patch finds the call `X.buildLayout().map` and replaces `X.buildLayout()` with a call
   to the plugin, which gets the original list, adds its own section and returns it. Only the root builder (key `$Root`) is touched, and a
   marker key (`testcord_section`) stops it being added twice.
2. **Each tab is one sidebar item** with a panel, a category and one CUSTOM node that holds a React component. The numbers of the layout types are
   read at run time with `waitFor(["SECTION","SIDEBAR_ITEM","PANEL","CUSTOM"])`; a built-in table is the fallback. (So the values are looked up,
   not hardcoded: a good habit we keep.)
3. **Position** of the section inside Discord's list is a setting (top, above or below Nitro, above or below Activity, bottom), by anchoring on the
   keys `user_section`, `billing_section`, `games_and_apps_section`, `utility_section`; if the anchor is missing it falls back to index 2.
4. **Editor mode:** which tabs are visible, their order and pinned ones are saved as lists of keys. Reading is a pure function (no writes), and "new"
   tabs are told apart from hidden ones with a second list of known keys (a careful detail: otherwise the editor and the sidebar disagree).
5. **Version rows:** a second patch (`#{intl::COPY_VERSION}`) adds lines to the version box at the bottom of Discord's settings (TestCord, Electron,
   Chromium) and, optionally, appends them to what is copied when the box is clicked. A third patch swaps Discord's icon for its own in one place.
6. **Twelve tabs**, one component each: main, privacy and security, plugins, themes, updater, changelog, stats, health, presets, cloud, backup and
   restore, patch helper (the last two only outside the standalone build).

## 2. How settings are stored
- The **main process owns one file**, `settings.json`, in the data folder. The page reads it **synchronously** at start (`GET_SETTINGS`), keeps a
  proxy over the plain object, and on every change sends the **whole object** back (`SET_SETTINGS`), which the main process writes with
  `writeFileSync`.
- A second file holds native-side settings and a third one the presets, so presets survive a rebuild.
- Plugin settings live under `plugins.<name>` in the same object. `definePluginSettings` builds typed settings with defaults, and the page-side
  `useSettings` hook re-renders React components when a path changes. A plugin is on or off through `plugins.<name>.enabled`.
- Weak points to avoid: the write is not atomic (a crash mid-write can truncate the file), the whole object is sent on every change, and nothing
  limits what a page script may write.

## 3. Findings (what matters for us)
| # | Finding | Consequence for Amiricord |
|---|---|---|
| 1 | The entry point is one patch on `.buildLayout().map`. | Our first real patch is small; its text must be checked against the real web client (not done yet, see design 03 s6). |
| 2 | Layout node types are discovered with a finder, with a fallback table. | Same, using our own finders. |
| 3 | The patch text uses `#{intl::KEY}` markers that the engine turns into Discord's hashed translation keys. | Our compiler has no such markers yet. The first patch does not need them; the version-rows patch does, so it waits. |
| 4 | Each tab is a React component using TestCord's wrappers of Discord's component library (`@webpack/common`). | We need a small set of our own common finders (React) and our own light components; see design 03 q3. |
| 5 | Settings are a plain JSON file owned by the main process, read synchronously at boot. | Same idea fits our boot flow (choices are needed before patches are registered), with atomic writes and checked writes. |
| 6 | Enabled state is stored per plugin in the same file. | Matches our `choices` input to the enabled-set function; today the page passes an empty object. |
| 7 | The section's position and the tab order are user settings. | Later (editor mode). |
| 8 | The plugin reads `VencordNative.native.getVersions()` and a git hash for the version rows. | We have neither; versions come from `process.versions` in the preload and from our own `package.json`. |

## 4. Not read
The 12 tab components in full (see `ui-reference.md` for how they were covered), `api/Settings.ts` beyond its exports, the CSS, and
`@webpack/common`. No Discord module text has been looked at yet: Discord's web client is not on disk (the app loads it from the network),
so the real patch strings still have to be verified against a copy of its public script files.

## 5. Check against the real web client (2026-10-24)
With the owner's permission I fetched the public script files of `canary.discord.com/app` (352 files) and `discord.com/app` (353 files), 33.2 MB in total, no
login and no cookies, into the session's scratch folder (outside the project, not committed). Both branches are almost the same build (643 of about 670 files are
identical; the main bundle is `web.<hash>.js`, 12.3 MB, with a different hash in each). Searches on the raw text:
| Text TestCord's Settings plugin looks for | Canary | Stable |
|---|---|---|
| `.buildLayout().map`, `buildLayout`, `$Root`, `legacySearchKey`, `StronglyDiscouragedCustomComponent` | 0 | 0 |
| the layout node types enum (`ROOT=0, SECTION=1, SIDEBAR_ITEM=2, PANEL=3 ... CUSTOM=19`) | found, in module 963935 of the main bundle | found (same) |
| the table of settings keys (`user_section`, `billing_section`, `games_and_apps_section`, `utility_section`, `*_sidebar_item`...) | found once, as a list of constants | found once |
**Reading:** the settings tree still exists and uses the same node types (so the finder TestCord uses for the numbers still works), but the entry point TestCord
patches is **gone in this build**. Nodes now carry a `layout` array and a `parent`, and a directory object (`accessibleDirectory`, with `getPanelOrThrow`) walks them.
The constants table is not referenced by name anywhere else, so the root list is built some other way that has not been found yet. **TestCord's Settings patch
cannot be used as it is**; the new hook point has to be found first. Not read: the 1.25 MB chunk (`855669` in Canary, `935637` in Stable), the most likely home of the
tree definitions.

## 6. Where the tree is built: not in the files the page lists (2026-10-24, second pass)
- In the main bundle the node types enum (module 963935) is imported by one other module only: the navigation controller (`accessibleDirectory`, `navigate`,
  `getNextCategoryKey`...), which walks nodes through `layout`, `parent` and `type`. The table of keys is used only by a URL parser that maps settings routes
  to panel keys (for example the route for Data and Privacy to `DATA_AND_PRIVACY_PANEL`). Nothing in the 352 listed files builds nodes (`useTitle` appears once,
  inside a type guard). The owner's own screenshot shows the new tree live in Canary, so its definitions are loaded from somewhere else.
- The main bundle's loader contains the chunk map for lazily loaded files: 270 explicit entries (the ones tried answer 200) plus about 5 600 table entries
  (the ones sampled answer 404, so the table is mostly stale). None of the 270 is among the 352 files the page lists. **The settings definitions are most likely
  in those 270 lazy chunks.** Next step, if the owner agrees: download those 270 files of Canary (estimated 10 to 25 MB; sizes were not returned by the server) and search them.
- Not yet checked: whether the same holds for Stable (same method). A probe inside the live engine on Canary remains the fallback to see the real tree.

## 7. Third pass: the 270 lazy chunks and the user agent (2026-10-24, owner authorized the download)
- The 270 lazy chunks of Canary were downloaded: **0.2 MB in total** (they are tiny stubs). None contains `buildLayout`, `useTitle`, `$Root`, the keys or the node type
  names. So the definitions are not there.
- The page served with Discord's desktop user agent (`discord/1.0.1281 ... Electron/44.9.3`) lists the same 352 files and the same `web.9367fa8089348041.js`.
- The keys table is used to **open** panels: for example `openUserSettings(X.NITRO_PANEL)` in the Nitro upsell code, and the route parser. The code that **defines** the
  nodes with those keys was not found by name in any downloaded file. It is built in a way the text search does not catch (generated, or driven by data).
- TestCord's copy here is dated 2026-10-19 and its Settings plugin last changed on 2026-10-16 (only a flag removed). Its hook text is absent from today's client, so either
  Discord changed in the last days or TestCord's Settings is broken for the newest client. Not verifiable without running TestCord, which we do not do.
- **Conclusion:** static reading has reached its limit. The reliable next step is a **probe inside the live engine on Canary**: when the owner opens Settings, read the real
  tree through the node type enum (finder) and the navigation controller (`accessibleDirectory`), and write only structure (types, keys, which component renders what)
  to a file in `%APPDATA%\Amiricord`. No chat, message or account data is read.

## 8. Result of the live probe on Canary (2026-10-24, owner authorized, probe P3)
Facts read from the running client (structure and Discord's own code only; the report was scanned for e-mail addresses, long ids, the Windows user name and the account name before it was read: none found).
- **TestCord's hook point exists after all.** My text searches (sections 5 to 7) missed it because the module that builds the tree sits in a **lazy chunk that is not in the page's file list and not in the explicit chunk list**.
  The module (id 419954 in this build, ids change) contains `function r(t){return function t(n){if("buildLayout"in n&&"function"==typeof n.buildLayout){let u=n.buildLayout().map(t),{buildLayout:e,...r}=n,i={...r,layout:u};return u.forEach(t=>t.parent=i),i}return n}(t)}`
  plus the node builders (`o(t)` builds the `$Root` node, then one function per node type: section, sidebar item, panel, split, category, accordion, list, ... custom).
  So `find: ".buildLayout().map"` and a match of `(\i)\.buildLayout\(\)(?=\.map)` hit `n.buildLayout().map(t)` as in TestCord's patch. **The patch text of TestCord is valid for this build.**
- **Real tree at run time** (522 nodes): root `$Root` with seven sections: `profile_section`, `user_section`, `billing_section`, `app_section`, `games_and_apps_section`, `developer_section`, `utility_section`
  (the anchors TestCord uses are all there). 26 sidebar items, 28 panels, 88 categories, 77 custom, 180 toggles... Node types enum: ROOT 0, SECTION 1, SIDEBAR_ITEM 2, PANEL 3, SPLIT 4, CATEGORY 5, ACCORDION 6, LIST 7, RELATED 8, CARD 9, FIELD_SET 10, NESTED_PANEL_NAVIGATOR 11, STATIC 12, BUTTON 13, TOGGLE 14, SLIDER 15, SELECT 16, RADIO 17, NAVIGATOR 18, CUSTOM 19 (a finder on `ROOT`, `SECTION`, `SIDEBAR_ITEM`, `PANEL`, `CUSTOM` finds it).
- **The directory** (the object Settings uses to look nodes up) is a small class with a `map`, `register`, `entry`, `get`, `getPanelOrThrow` and a default panel. The navigation controller holds it as `accessibleDirectory`.
  A node registered there must have a key, a type and (for panels) be reachable through `layout`; adding our section before the directory is built (the patch point above) is therefore enough.
- **The build number** is in the page as `window.GLOBAL_ENV.BUILD_NUMBER` (650101 for the build tested), with `RELEASE_CHANNEL` and `VERSION_HASH`: the source for design 03 piece G.
- **What the probe found out about the engine** (all fixed, with tests): the module cache `wreq.c` exists in Discord but the engine now also records every module it sees run; a finder waiting with `ready()` was
  swallowed by a module that answers any key through a `get` proxy or has a callable `then`; such objects are now never returned. Writing the same file many times in a few milliseconds is avoided
  (each progress step has its own file), and a dump that cannot be written leaves a line in `probe/errors.log`.
- **Stable** was not probed: its page lists the same chunks and the same text hashes for the files seen, but the lazy chunk was not downloaded and the probe was not run there. To do before relying on it: the same probe, or fetching the real lazy chunks.

## 9. Result of the components discovery on Canary (2026-10-24, owner authorized, piece C part 2)
Read from the running client with the components probe (names and code of Discord's own functions only; no text, props or state; scanned for e-mail addresses, long ids, the Windows user name and the account name before reading: none found). Build 650101.
- **React** is found by the finder (`useState` + `useEffect`) and is React 19: 42 keys, `Fragment`, and every hook (`useActionState`, `useOptimistic`, `useEffectEvent`, `useId`, `useSyncExternalStore`, ...).
- **Two generations of components live side by side.** The classes show it: older ones end in `_<hash>` (`button_a22cb0`, `input__75098`); both are in the same page.
  - Button, new "mana" one: `function S({role:"button", variant:"primary", size:"md", text, icon, iconPosition, fullWidth, loading, rounded, type, onClick, ...})`; a thin wrapper `a(e) => jsx(S, {...e})` sits above it.
  - Button, older one: `function I({look:FILLED, color:BRAND, size:MEDIUM, fullWidth, grow, disabled, submitting, type, onClick, ...})` (the voice bar buttons use it).
  - Text: `function _({variant, tag:"div", selectable, className, lineClamp, color, tabularNumbers, ...})` (variants like `"text-sm/medium"`).
  - Heading: `function u({variant, className, ref, ...})` with `h${Math.min(level, 6)}` from a heading level context, plus a context provider that raises the level.
  - Text input: `function L({disabled, editable, inputRef, name, type:"text", placeholder, maxLength, value, defaultValue, error, leading, trailing, validateOn:"change", ...})` wrapped by a field with `label, description, helperText, errorMessage, layout`; a search box `function l({query, onClear, placeholder, size:"md", ...})`.
  - Switch: the 9 `role="switch"` elements on screen were the voice bar buttons (they use the older button with `aria-checked`), so the settings page switch was **not** sampled. To do in part 3: sample it on a page open on a toggle, and the drop-down (none was on screen).
- **CSS variables** (4000 read, the cap): the old names the fallback used are **mostly gone**. Missing: `--background-secondary`, `--background-primary`, `--header-primary`, `--background-modifier-accent`, `--button-secondary-background`, `--brand-experiment`, `--primary-500`, `--input-background`. Present and usable: `--text-default`, `--text-muted`, `--text-link`, `--text-brand`, `--text-feedback-critical/positive/warning`, `--status-danger/positive/warning`, `--background-base-low/lower/lowest`, `--background-surface-high/higher/highest`, `--background-mod-subtle/muted/normal/strong`, `--border-subtle/normal/strong/muted/focus`, `--interactive-background-default/hover/active`, `--interactive-text-default`, `--input-background-default`, `--input-border-default`, `--input-text-default`, `--input-placeholder-text-default`, `--card-background-default`, `--card-border-default`, `--control-*`. Values are references to palette variables (`var(--neutral-79)`), so they follow the theme.
- The redaction turned a long decimal in some values into `<id>` (`0.<id>`): harmless here, noted so nobody reads it as an id.
- **Consequences for part 3**: find the Button, Text and Heading by their code (`componentByCode` on strings such as `"FocusRing was given"` is too shared: use `lineClamp`+`tabularNumbers` for Text, `Math.min(` plus `h${` for Heading, `loadingStartedLabel` for the new Button), keep our own fallback, and update `fallbackStyles.ts` to the names above (with the old names as the second default).
