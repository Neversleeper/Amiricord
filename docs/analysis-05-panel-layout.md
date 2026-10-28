# Analysis 05: TestCord's panel layout (user area modules, shortcut buttons)

Reference only, in our own words. Read in TestCord commit `af92dbaec`:
`src/testcordplugins/PluginsShortcutButton/index.tsx` (all, 42 lines), `src/api/UserArea.tsx` (first ~80 of 122 lines),
`src/testcordplugins/PanelLayout/` (file list; `index.tsx` header and plugin definition; `native.ts` export list, `loadUserModules`
and the host list; `modules/builtin/index.ts`; `modules/registry.tsx` outline and lines 625-690).

**Not read:** the body of `PanelLayout/index.tsx` (3 659 lines), `UserAreaReorderTab.tsx` (1 577 lines, the position editor),
the music players and lyrics providers, `systemMonitor.tsx`, `clockWidget.tsx`, the marketplace tabs, the rest of `native.ts`.
Sizes and behavior below come from outlines, settings text and the parts listed above.

## 1. What each plugin is

**`PluginsShortcutButton`** (author in the file: `szcx404`, the owner) is 42 lines. It adds one button to the **user area**
(the panel at the bottom left, next to the microphone and headphone buttons). The button shows a plugins icon and, when clicked,
opens the mod's Plugins page inside Discord's settings (`openUserSettings("testcord_plugins_panel")`). It depends on the
`UserAreaAPI` and finds Discord's `openUserSettings` function with a props finder.

**`PanelLayout`** (authors in the file: deracul, Aviv, x2b, sirphantom89) is the plugin that customizes that panel.
Its description: "Customize the layout, style, and visibility of panel and call buttons, and manage user area modules". It opens a
**Panel Layout Editor** with a drag-and-order tab. It is large: about 3 700 lines in `index.tsx` plus about 12 000 in its modules.

## 2. How the user area works (`UserArea` API)

- `addUserAreaButton(id, render, priority)` stores the button in a map; `removeUserAreaButton(id)` removes it.
- Buttons are sorted by `priority` (a number) and rendered where Discord draws its own panel buttons. The sorted list is cached
  and rebuilt only when the number of buttons changes.
- A button is built from Discord's own panel button component (found by code, `tooltipPositionKey`), so it looks native.
- The icon color of these buttons is read from a setting of the `TestcordHelper` plugin (an API depending on a plugin).
- Plugins reach it with a single field in their definition (`userAreaButton: { icon, render, priority }`).

## 3. What `PanelLayout` adds on top

| Piece | What it is |
|---|---|
| **Modules** | Blocks shown in the panel area, each with an order and an on/off switch: Music Controls, Activity Banner, Developer Banner, Voice Connected Area, Discord Native Activity, User Account & Buttons, plus a clock widget and a system monitor. |
| **Reorder editor** | A tab to drag the modules and buttons into the order you want, show or hide each, and edit styling (colors, alpha). |
| **Button detection** | `buttonDetection.ts` finds Discord's own panel buttons (mute, deafen, settings...) so they can be reordered or hidden too. |
| **Marketplace of modules** | A built-in catalog of modules (not downloaded; the list is in the code) with tabs to install or remove them. |
| **Custom modules** | The user can write their own module: pure HTML with placeholders (`{username}`, `{time}`, `{date}`) or **React code**, plus CSS. |
| **Music controls** | Control and lyrics for Spotify, Tidal and Strawberry players, with several lyrics providers. |

## 4. What it can do to your system and network

| Area | Evidence | Meaning |
|---|---|---|
| Native code (`native.ts`, 448 lines) | Exports `saveUserModule`, `deleteUserModule`, `loadUserModules`, `openUserModulesFolder`, `getStrawberryState`, `sendStrawberryCommand`, `fetchSpicyLyrics` | Reads and writes JSON files in a folder; talks to a local music player; fetches lyrics |
| Starting programs | `native.ts` imports `child_process`; runs a PowerShell command to read the Strawberry window title (`Get-Process strawberry`) and `execFile` of a player binary with arguments | It starts programs |
| Files | `fs` and `fs/promises` | Reads and writes under its own folder (the paths seen are built from a user modules directory) |
| Dynamic code | `registry.tsx` line ~652: **`new Function`** runs the user's React module code, with `React`, UI components, `UserStore` and `DataStore` in scope; HTML modules go through `dangerouslySetInnerHTML` | The user can run their own code inside Discord's page. Code is stored as JSON on disk and loaded at start |
| Hosts seen in the plugin | `api.spicylyrics.org`, `lrclib.net`, `spotify-lyrics-api-pi.vercel.app`, `translate.googleapis.com`, `api.spotify.com`, `open.spotify.com`, `i.scdn.co`, `tidal.com`, `cdn.discordapp.com`, plus `localhost` (local player APIs) | Several third-party services; one is a personal-looking Vercel app |

By our own rules this plugin would be **High risk** (spawns programs, dynamic code) and should be split before porting.

## 5. What this means for Amiricord

The idea (a panel you can arrange, with your own shortcut buttons) is good and easy to do **in pieces**:

1. **A small `UserArea` engine API** (like `addUserAreaButton`): a registry of buttons with a priority, rendered in Discord's own panel
   with Discord's own button component. No third-party hosts, no native code. Its icon color must be an engine setting, not another plugin's.
2. **Shortcut buttons as a tiny plugin**, like `PluginsShortcutButton`: one button, one action. The owner's plugin is the model.
   Proposed manifest: low risk, no network, no native, no dynamic code, depends on the user area API.
3. **A layout editor** (order, show/hide, color) as a second plugin that only stores a list of `{id, order, visible}` and asks the
   API to apply it. No code execution.
4. **Generic shortcuts** (idea): a plugin where the user defines buttons from a fixed list of safe actions (open the Plugins page,
   open Privacy, open a settings tab, copy a value, toggle a plugin, run a slash command). Actions are names from a closed list,
   not code.
5. **Left out unless the owners ask:** music players and lyrics (many third-party hosts, spawning programs), custom React modules
   (dynamic code), system monitor (not read; needs its own analysis). Each would be its own plugin with its own manifest and its
   own analysis (rule 3).

## 6. Findings

| # | Finding |
|---|---|
| L1 | One plugin mixes layout (safe), media players (network, spawn) and a code editor (dynamic code). One permission set would cover all three, which is exactly what the manifest design tries to avoid. |
| L2 | `new Function` runs user-written module code in Discord's page, from JSON files on disk. This is the `code.dynamic` permission and would require the "High risk" confirmation. |
| L3 | The user area API takes its icon color from a `TestcordHelper` setting, so the API depends on a plugin. |
| L4 | The built-in "marketplace" is a fixed list in the code. That is fine, but the name suggests downloads; none were seen in the parts read. |
| L5 | A local player is controlled through a PowerShell command that includes a process name; arguments for `execFile` come from the plugin. Not read in full. |

## 7. Open questions
- Should the user area API live in the engine core or be an engine API plugin? (Proposal: engine API, so shortcut plugins stay tiny.)
- Do the owners want the music controls (Spotify, Tidal, Strawberry)? If yes, which player, and do they accept lyrics hosts?
- Should "custom modules with code" exist at all? (Proposal: not in version 1.)
