# Analysis 50: four engine APIs for plugins (DevTools, context menus, sounds, in-page notifications)

Owner's request (2026-10-27, pasted): a plugin being brought in needs four things the engine does not offer. Small APIs, in `ctx` (or in the native host
where it belongs), **without touching the existing ones or changing how current plugins work**. For each: the exact name, the permission if one is needed,
how to test it in a real Discord, and the exact changes in `plugin.json`. It touches the engine, native code and permissions.

Read for this note: `src/shared/manifest.ts` (`Permissions`, `ENGINE_APIS`, risk), `scripts/build/manifest/validate.ts` (`permissions.system`),
`scripts/build/manifest/scanSource.ts` (how capabilities are detected), `src/main/nativeHost.ts` (`NativeHostApi`: `fetch`, `secret`), `src/main/electronGlue.ts`
(the `IPC.native` handler), `src/renderer/engine.ts` (what `ctx` has: `modals`, `components`, `native`, `secrets`, `storage`, `common`). Not read: Discord's own
code for menus and sounds (no run on the owner's Discord yet), so everything about Discord's internals below is marked.

## Findings that shape the design
1. `ENGINE_APIS` is empty: a plugin does not declare the engine APIs it uses, so **no `dependencies` change is needed** for any of the four.
2. A native function gets `host` with `fetch` and `secret` only. The IPC handler (`answerNativeCall`) is not given the window that made the call
   (`event.sender`), so DevTools needs that added to the handler, in `electronGlue.ts` (Electron stays out of `nativeHost.ts`).
3. Like `host.fetch`, the permission check rests on the plugin's name in the message, which is a claim, not a proof (all plugins share one page). Said in the
   analysis of the bridge (29); it is the same honest limit here.
4. Discord keeps its own developer tools switched off unless `DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING` is true in its settings file
   (found when Ctrl+Shift+I did nothing). Amiricord does not touch that file. Electron's `openDevTools()` may be accepted and then closed again by Discord.
5. Adding `devtools` to the permissions must not change the permission hash of every plugin: `canonicalPermissions` writes it **only when it is true**.

## 1. DevTools (native host)
- **Names:** `host.canOpenDevTools(): Promise<boolean>` and `host.openDevTools(): Promise<boolean>`, available to the plugin's native functions **only when the
  manifest declares the permission**; without it the two properties do not exist on `host`.
- **Permission:** `permissions.system.devtools: boolean` (default false), next to `spawn`, `clipboard`, `openExternal`. Risk: medium ("Opens Discord's developer
  tools"). The build refuses code that mentions the two functions without it (new scan rule `S-DEVTOOLS`) and warns when it is declared but unused.
- **How:** `answerNativeCall` receives the sender of the IPC message; `electronGlue` gives it a small object over that `webContents`. `canOpenDevTools` is
  true when the window exists and is not destroyed; `openDevTools` opens them for **that window only** and answers whether they were open right after.
- **Honest limit:** see finding 4. `openDevTools` answering true means they were open at that moment.
- **Test in a real Discord:** a plugin with the permission calls it from a button; without the permission the call throws "not a function"; with the permission
  and Discord's flag off, the tools may close at once (expected).

## 2. Context menus
**2a. Our own menu: `ctx.contextMenu.open(event, items)` and `ctx.contextMenu.close()`.** No permission (it only draws in the page).
- `items` is a list of entries: an item `{ id, label, action(), disabled?, danger?, checked? }`, a separator `{ separator: true }`, or a group
  `{ group: string, items: [...] }` (a small heading and its items). `event` gives the position (`clientX`, `clientY`); the menu stays inside the window.
- Drawn by the engine with plain DOM (no Discord component needed), with Discord's CSS variables so it follows the theme. It closes on a click outside, on Escape,
  after an item runs, when another menu opens, and when the plugin stops. Arrow keys and Enter work. Text is always set as text, never as HTML.
- **2b. Our menu on a kind of element: `ctx.contextMenu.onElement(selector, build)`.** `build(event, element)` returns the items (or an empty list to leave
  Discord's own menu alone). On a right click on a matching element the engine opens our menu and stops Discord's. Returns a function that stops it. This works
  on any build because it needs no Discord module. It is **not** an entry inside Discord's own menu.
- **2c. Entries inside Discord's own menu (not promised):** it needs Discord's menu components, which no finder finds on build 650389. It needs a **discovery run**
  first (the development flag module search, as in analysis 35) to see how the menu is built there. Until then 2b is the way.
- **Test:** open a menu from a button; click outside; Escape; right click on the element of 2b; stop the plugin and see the menu go away.

## 3. Discord's sounds by name: `ctx.sounds.play(name, volume)` and `ctx.sounds.list(): string[]` (needs discovery first)
- On build 650389 the owner's plugin found `createSound` and `playSound` only inside the soundboard component, and no general module of sound names. I have
  **not seen Discord's code**, so I cannot say yet where the names and files are kept. Without that, any code here would be a guess.
- **First step (a probe, dev mode only):** the module search also looks for the sound names (`discodo`, `message1`, `bop_message1`) and for `.mp3` file names in
  Discord's code in memory, and writes the result into the probe folder (redacted like the others). From it the right module is chosen and checked.
- **Then the API:** `list()` gives the names found; `play(name, volume)` plays one with the volume between 0 and 1 (clamped); an unknown name answers false and
  never throws. If Discord's sound files cannot be reached, the answer is `false` and the plugin keeps its own tones.
- **Test:** the probe's file; then `list()` shows the names and `play("discodo", 0.5)` sounds like Discord's.

### 3b. What the probe showed, and what P5 is built on (2026-10-28)
Seen in `module-search-sounds.json` from the owner's Stable (app-1.0.9265): (a) one Webpack context module maps `"./<name>.mp3"` to the module of each sound file (about a hundred names: `discodo`, `message1`, `deafen`, `call_ringing`, ...); (b) each file module is only `e.exports = n.p + "<hash>.mp3"`, the address of the file; (c) another module maps each sound pack to its file names; (d) Discord calls `createSound(name, soundpack)` and `playSound(name)`, but only fragments of those were seen.
**Design chosen: do not use `createSound`/`playSound`.** Their parameters and return values are not verified. The layer (`src/api/sounds.ts`) uses only what was seen: it finds the context module by the text `"./discodo.mp3"` in module sources (never by an id, which changes every build), runs only those modules, checks that the result is a function with `keys()`, and builds a plain `Audio` from the file address.
- `list()`: the names from `keys()`, only keys of the form `./<letters, digits, _ or ->.mp3`, sorted; `[]` when the context cannot be reached.
- `play(name, volume)`: only a name that is one of `list()`; the address must be `/...` (not `//...`) or `https://...` and end in `.mp3`, so no `javascript:`, `data:` or other-host shortcut; volume clamped to 0..1 (default 1); at most 8 sounds at once per plugin (the oldest is stopped); the browser may refuse to start a sound before the user interacted with the page (then nothing is heard, no error); `stopAll()` and the plugin's stop pause what it started. Answers `false` instead of throwing.
- No permission: nothing leaves the machine and nothing is read.
- Not verified: that the audio plays in the real page (the page's content security policy and autoplay rules); that the context module is found by the marker on other Discord builds; the sound packs are not used (only the plain names).

## 4. Notifications inside Discord: `ctx.notifications.show(options)`
- `show({ title, body, icon?, onClick?, dismissOnClick?, timeoutMs? })` returns `{ close() }`. `ctx.notifications.closeAll()` closes this plugin's cards.
  No permission (it draws in the page). It does not use the browser's `Notification`.
- A card in a corner of the window, built with plain DOM like the menu. Default time on screen: 6 seconds (`timeoutMs`, 0 = until closed; at most 60 s).
  `dismissOnClick` closes it when pressed; `onClick` runs first. At most 5 cards at once per plugin (the oldest goes first); text is cut at 120 characters for
  the title and 400 for the body; `icon` is accepted only as an `https:` or `data:` image address (anything else is ignored). Closed when the plugin stops.
- Not included: a log of past notifications (a later idea of the owner's: the notification system).
- **Test:** call it from a button; wait for it to go away; press it; call it 7 times and see only the last 5.

## Changes in `plugin.json`
- **Only DevTools needs a change.** The plugin must have a main-process entry and declare the permission, and list the native functions it exports:
  ```json
  "entry": { "renderer": "index.tsx", "main": "native.ts" },
  "permissions": {
      "system": { "devtools": true },
      "native": { "functions": ["<each function native.ts exports, for example openDevTools>"] }
  }
  ```
  Because of finding 2 of analysis 48 (and the fix of 2026-10-27), a plugin with `entry.main` needs a restart to be switched on or off.
- Menus, sounds and notifications: **no change** (no permission, no dependency).

## Order proposed
P1 notifications (4) · P2 context menu and `onElement` (2a, 2b) · P3 DevTools (1) · P4 sound probe (3, discovery only) · P5 sounds API (3) · P6 menu discovery (2c).
Shared files: `src/renderer/engine.ts`, `src/api`, `src/shared/manifest.ts`, `scripts/build` (said in the commit messages).

## Not verified
Everything about Discord's own menus and sounds; that Electron's DevTools stay open in Discord's window (finding 4); the look of the menu and the card in the owner's
theme; that the right click can be stopped before Discord's own handler runs (2b depends on the order of the listeners; to be tested on a real Discord).

## Questions
1. Is the order right, or is something needed earlier?
2. `system.devtools` (my suggestion, next to the other system permissions) or a new `window.devtools` group as in the request?
3. For 2b: is an own menu on the element (instead of Discord's) acceptable until the discovery of 2c is done?
