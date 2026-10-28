# Analysis 10: TestCord's main settings tab, window options, notifications, QuickCSS, and Cloud

Read on 2026-10-24 from the local copy of TestCord (`C:\Users\<user>\Desktop\testcord`, read only). Nothing was run, nothing was
installed, no network was used. The owner asked for a deep look at "those settings" and at what Cloud does. All code below is
described, never copied; Amiricord's version is written from scratch.

Files read: `src/components/settings/tabs/vencord/index.tsx` (main tab), `.../NotificationSettings.tsx`, `.../WindowsMaterialSettings.tsx`,
`src/main/patcher.ts`, `src/main/index.ts`, `src/main/ipcMain.ts` (QuickCSS part), `src/main/monacoWin.html` (head only),
`src/main/settings.ts`, `src/api/Notifications/*` (call sites), `src/plugins/_core/settings.tsx` (tab list),
`src/components/settings/tabs/sync/CloudTab.tsx`, `src/api/SettingsSync/cloudSetup.tsx`, `src/api/SettingsSync/cloudSync.ts`,
`src/Vencord.ts` (start-up sync), `src/api/Settings.ts` (defaults).

**Not read** (so nothing is claimed about them): the server side of Cloud (the owner of the server decides what it keeps),
`TestcordTabsEditor`, the macOS vibrancy settings, how `useTestcordIcon` swaps the logo, `trayMenu.ts`, `privacy/*` (left out by decision),
`offline.ts` of the sync API, the Updater, Stats, Health, Presets, Changelog and Privacy & Security tabs (later, one by one).

## 1. The tabs TestCord adds to Discord's settings

One section with an editor to reorder, pin and hide its tabs: main tab (with the tabs editor on top), Privacy & Security, Plugins,
Themes, Updater (only if the updater is not disabled), Changelog, Stats, Plugin Health, Presets, Cloud, Backup & Restore, Patch Helper
(not in the standalone build), plus tabs that other plugins register.

## 2. The main tab

Top to bottom: special cards (donations, support, contributions), **Quick Actions**, **Client Settings** (a hint that the section's
position is a setting of the Settings plugin, then the switches, then the macOS or Windows material settings, then Notifications).

### 2.1 Quick Actions (six buttons)

| Button | What it does |
|---|---|
| Notification Log | Opens a modal with the history of TestCord notifications |
| Edit QuickCSS | Opens the QuickCSS editor (see 5) |
| Relaunch Discord | Relaunches the app (hidden on the web build) |
| Open Settings Folder | Opens the settings folder in the file explorer |
| View Source Code | Opens the GitHub page of the project in the browser |
| Discord Server | Opens the project's Discord invite |

### 2.2 The switches

Each one writes a boolean into TestCord's settings file. Those with "restart" open a prompt to relaunch.

| Setting key | Title | Restart | Applied by |
|---|---|---|---|
| `useTestcordIcon` | Use TestCord icon | no | page (swaps the logo) |
| `useQuickCss` | Enable custom CSS | no | page (injects or removes the QuickCSS) |
| `mainWindowFrameless` | Disable the main window frame | yes | main process, when the window is created |
| `frameless` | Disable all window frames | yes | main process, when each window is created |
| `nativeTitleBar` (Windows) | Use Windows' own title bar | yes | main process, when the window is created |
| `transparent` | Window transparency (warning: window stops being resizable, no edge snapping on Windows) | yes | main process, when the window is created |
| `disableMinSize` | Disable the minimum window size | yes | main process, when the window is created and later |
| `winCtrlQ` (Windows) | Ctrl+Q closes Discord | yes | main process, at start (menu) |
| `enableReactDevtools` | React Developer Tools | yes | main process, at start (see 6) |

Windows material (Mica, Tabbed, Acrylic, None) and macOS vibrancy are drop-downs applied the same way (restart).

## 3. How the window options are applied (main process)

`src/main/patcher.ts` replaces Electron's `BrowserWindow` export with a subclass. When Discord creates a window the subclass edits the
constructor options before calling the real constructor, and only for windows that have a preload and a title:

- frame: `frame = false` for the main window or all windows; on Windows with the native title bar option, the `frame` option is removed so the
  OS frame returns.
- `minWidth = minHeight = 0` for the minimum size option (and some more code after creation).
- `transparent = true` and a transparent background colour; on macOS `vibrancy`; on Windows `backgroundMaterial`.
- Always, whatever the switches say: the page's preload is replaced by TestCord's (the original is passed along in an environment
  variable), `sandbox = false`, `backgroundThrottling = false` ("work around Discord unloading in the background"), `devTools = true`.
- Ctrl+Q: wraps `Menu.buildFromTemplate`; when the template starts with the File menu it adds a hidden "Quit" item with the accelerator
  `Control+Q` that works while hidden.
- The settings are read synchronously from the settings file when the main process starts (`RendererSettings.store`), so no window exists
  before they are known. That is why every one of them needs a restart.

What this means for Amiricord (decision proposed, not yet taken):

1. The engine needs a main-process piece that edits the options of a window before it is created. Nothing in the engine does this today:
   it only registers the preload on the default session, which was verified on Canary.
2. Do it with fewer side effects: only Discord's own windows, only the options the owner turned on, never `sandbox`, `devTools` or
   `backgroundThrottling` unless a feature asks for them, and if our code throws, create the window with the original options.
3. The decision logic must be a pure function (settings and window options in, options out), tested without Electron, like `relaunch.ts`.
4. Engine settings need their own section in `settings.json` (today the schema has only `plugins`), read at start by the main process
   before the first window. That is a schema change (version 1 to 2 or an added optional section) to be designed with its own tests.
5. These options are engine features, not plugins: plugins live in the page and cannot reach window creation.

Order inside this group, easiest first: Ctrl+Q, minimum size, native title bar (Windows), frame options, then transparency and the
Windows material (both depend on the theme and have the resizing side effect). macOS vibrancy stays out until macOS is supported.

## 4. Notifications and the notification log

TestCord has its own notification system (small pop-ups drawn inside the page) and can use the operating system's notifications instead.

- Settings: *use native* (`not-focused` default: desktop notifications only when Discord is not focused; `always`; `never` = TestCord's own),
  *position* (bottom right or top right), *show what you missed when you come back*, *timeout* slider, *log limit* slider (50 by default).
- Native notifications use the page's `Notification` API and ask for permission when needed.
- Every notification is stored (`persistNotification`) up to the log limit and shown in the Notification Log modal.
- Used by few plugins (a handful of call sites), and by the Cloud code and the update checks for their messages.

For Amiricord this is the natural place for the start-up health notice ("a plugin failed to start", "a patch did not match"). It needs its
own analysis and design (where the log is stored: page memory or a file; whether the log is private by default).

## 5. QuickCSS

- Stored as one file in the settings folder; the main process reads it, watches it and sends changes to the page; the page applies it as a
  style element. "Enable custom CSS" only toggles that application.
- "Edit QuickCSS" opens a separate window with the **Monaco editor loaded from `cdn.jsdelivr.net`** (version 0.50.0) each time, so
  opening the editor contacts a third party. The window also has settings that ignore `@import` in its CSS linting.
- There is also a way to open the file in the system's default editor (`shell.openPath`).

For Amiricord: the engine's `addStyle` (piece D) already refuses `@import` and network `url()` for plugins. QuickCSS is the owner's own CSS,
so a decision is needed: allow `@import` and network `url()` there with a clear warning, or not. The editor must not load from a CDN; options:
open the file with the system editor (zero network), or bundle a small editor in the build (size cost). Analyse before building.

## 6. React Developer Tools

At start, if enabled, the main process installs the extension with the Chrome Web Store id `fmkadmapgofadopljbjfkapdkoienihi`. **Correction (2026-10-25): it
downloads only the first time and then loads it from a cache folder; see analysis 11 section 0.** It contacts Google's extension service once. For developers only. Amiricord: leave it out of the first versions; if
added, it must be off by default, say clearly that it downloads, and never run in the background without the owner knowing.

## 7. Cloud

### 7.1 What it is

An optional tab that syncs TestCord's settings between devices and Discord installations through a **remote server**. Three backends are
offered: Equicord Cloud (`https://cloud.equicord.org/`, the default value), Vencord Cloud (`https://api.vencord.dev/`) or any URL the owner types
(self-hosting is possible, the server is open source under a permissive licence according to the tab's own text).

### 7.2 How it logs in

- It asks the backend for its OAuth configuration (`GET /v1/oauth/settings`), then shows Discord's own authorization window with the scope
  `identify` (the server learns the user's Discord id and name).
- The server returns a **secret**; it is stored in the page's own database (IndexedDB, key `Vencord_cloudSecret`) per server and user id.
  Later requests send `Authorization: base64(secret:userId)`.
- Turning the switch off or changing the server removes the stored secret.

### 7.3 What it sends

For the current (v2) protocol, `buildLocalData` assembles three blocks and uploads them (compressed with deflate, **not encrypted by the client**):

1. `settings`: the whole settings object of the client (all plugin settings, including any API keys or tokens a plugin keeps there).
2. `quickCss`: the QuickCSS text, if any.
3. `dataStore`: **every entry of the page's DataStore** (the client's general key-value storage used by plugins; what is inside depends on
   the plugins and may include private content, for example logs some plugins keep). Entries that cannot be read are skipped with a warning.

The older v1 path uploads the exported settings (without the DataStore).

### 7.4 When it runs

- Switch *Enable Cloud Integration* (authorizes) and *Enable Settings Sync*; both off by default.
- Direction per device: both ways, upload only, download only, manual (default value read as `both` when nothing is stored).
- At start, if enabled and not manual: uploads when there are local changes, otherwise downloads and, if something changed, shows a notification
  that offers to relaunch.
- While running: after any settings change, a **debounced upload every 60 seconds** at most.
- Manual buttons: sync to the cloud, sync from the cloud, delete cloud settings, erase all cloud data (`DELETE /v1/`).

### 7.5 Privacy and security assessment

- Everything leaves the machine to a third party chosen by default by the project, with the user's Discord id attached.
- No client-side encryption: the server can read all settings, and with `dataStore` possibly private plugin data.
- Plugin settings can hold secrets; the settings object is uploaded whole.
- Downloaded settings are imported back into the client (settings, QuickCSS, DataStore): a hostile or compromised server can **write settings and
  CSS into the client** (including enabling plugins). That is a supply-chain style risk that a local backup file does not have.
- The tab also loads the Equicord and Vencord logos from `equicord.org` each time it is shown.
- It is opt-in, which is good, but the defaults point to a server of another project, which conflicts with the rule of no calls to
  Vencord, Equicord or TestCord servers.

### 7.6 Decision proposed for Amiricord

- **No Cloud tab as TestCord has it.** No sync server, no OAuth with a third party, no default backend.
- **Backup & Restore is a separate, local feature** (also a TestCord tab): export the settings to a file the owner chooses, import from a file,
  with the same checks the settings store already does (limits, forbidden keys, schema), and an optional password (encryption in the file) later.
  That covers moving between machines without a server.
- If sync between devices is wanted later, a design that uses a folder the owner already syncs (their own cloud drive) needs no Amiricord server
  and no account; it would be analysed on its own.
- Never export secrets by default: settings keys flagged as secrets in the manifest stay out of exports unless the owner ticks a box.

## 8. What Amiricord's main tab will show first, and what waits

First version (everything exists and is tested): status card with the logo, Quick Actions (Relaunch, Open data folder, Health report),
engine settings (start-up health notice, safe mode). The list is built from entries that each feature registers (title, description, state,
restart or not), so adding a feature later adds an entry and does not change the page.

Later, one at a time, each with its own analysis, test on Canary and commit: Ctrl+Q, minimum window size, native title bar, frame options,
QuickCSS and its editor, Block Discord analytics (the NoTrack plugin, a core plugin in TestCord), notifications and their log, transparency and
Windows material, Backup & Restore, then the other tabs.

Left out: Cloud, donation and contribution cards, links to a project server, React Developer Tools (for now), macOS vibrancy (for now).
