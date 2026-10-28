# Analysis 04: TestCord's core (module finding, plugin lifecycle, health, host updates, debug tools)

Reference only, in our own words. Read in TestCord commit `af92dbaec`: `src/webpack/webpack.ts` (all),
`src/api/PluginManager.ts` (all), `src/main/hostUpdateHook.ts` (all), `src/api/PluginHealth.ts` (lines 19-318 and 365-940),
`src/debug/Tracer.ts`, `reporterData.ts`, `runReporter.ts` (all), `src/debug/loadLazyChunks.ts` (outline only),
`src/Vencord.ts` (call order only). Builds on analysis 01 (patching) and 02 (privacy).

**Not read:** `PluginHealth.ts` lines 319-364, the body of `loadLazyChunks.ts`, `PluginProfiler.ts`, `NetworkMonitor.ts`,
`Settings.ts`, `Commands`/`ContextMenu` APIs, and how the renderer starts (`Vencord.ts` beyond the call order).
Findings come from reading, not from running anything. Where I infer, it says so.

## 1. Finding Discord's modules (`webpack.ts`)

**What it is.** Discord's page keeps all its code as numbered modules in a cache. A plugin needs references to some of them
(a store, a component, a helper). The finders search that cache with a **filter function**.

| Finder | Matches by |
|---|---|
| `byProps("a", "b")` | the module exports properties with those names |
| `byCode("text")` | a function's source text contains those strings or regexes |
| `byStoreName` / `findStore` | a Flux store's display name (also looks inside Discord's `libdiscore` exports) |
| `componentByCode` | like `byCode`, but also unwraps React `memo` and `forwardRef` |
| `byClassNames` | exports string values that look like those CSS class names |
| `mapMangledModule(code, mappers)` | finds one module by code, then names each of its exports with a filter (for modules whose export names are scrambled) |
| `extractAndLoadChunks` | reads a module's source with a regex to learn which lazy chunks to load, loads them, then requires the entry module |
| `waitFor(filter, cb)` | calls back when a matching module is registered later |
| `search`, `extract` | developer tools: search factory sources; copy one module's source into its own file for reading |

Almost every finder has a **lazy** twin (`...Lazy`) that returns a proxy and only searches on first use.

**Observations**
- Each find walks the **whole module cache**, and for each module also its nested exports. The only optimisation is a memo of
  `Function.prototype.toString` per function (`WeakMap`), which the code comment says cut a lookup from ~14 ms.
  No cache survives a restart.
- Some modules are blacklisted from search by making their properties non-enumerable: `window`, `document`, typed arrays,
  Discord's i18n proxy, and any object that answers to a made-up property name (a trick to detect "proxy that returns anything").
- A miss is handled by `handleModuleNotFound`: for `findByProps`, `findComponent*`, `findExportedComponent` and `findCssClasses`
  it only logs at **debug** level and returns nothing (comment: they "spam the console" on Canary). Other misses log an error and
  **throw only in development builds**.
- Test switches live inside production functions (`IS_ANTI_CRASH_TEST` makes `find`, `findBulk`, `mapMangledModule`, `waitFor`,
  `extractAndLoadChunks` return early).
- With `IS_REPORTER`, every lazy find also records its arguments and a stack trace (capped at 1000 entries) for the reporter.

## 2. Plugin lifecycle (`PluginManager.ts`)

**How plugins are known.** A build-time registry (`~plugins`) of plugin objects. `isPluginEnabled(name)` answers from a memo
cache that is cleared when settings or health state change. A plugin is enabled if it is `required`; or not (safe mode,
quarantine); or marked as a dependency; else by the user's setting, looked up by id, old name and aliases.

**Start.** `startAllPlugins(stage)` runs three times (`Init`, `WebpackReady`, `DOMContentLoaded`); each plugin declares its stage.
- It first awaits the safe-mode flag and the quarantine list.
- Plugins start in **time slices**: after about 12 ms it yields to the event loop so Discord can paint.
- An optional **deferred start** (setting read from the `TestcordHelper` plugin) delays plugins that have no patches, flux
  handlers or `start()` until the browser is idle (3 s timeout).
- After the main pass it tells PluginHealth which plugins were enabled this session.

**What `startPlugin` registers.** About 22 kinds of hook, each with its own add/remove function: commands, context menus,
managed styles, profile badges, message send/edit/click listeners, chat bar buttons, member list decorators, message
accessories/decorations/popover buttons, nickname icons, header bar and user area buttons, audio processors, profile
collections and sections. It also wraps every flux handler with error capture and the profiler.

**Dependencies.** Before anything starts, `initPluginManager` marks dependencies as enabled and **deduces "API plugins" from
which fields a plugin uses** (a plugin with `commands` pulls in `CommandsAPI`, with `renderMessageDecoration` pulls in
`MessageDecorationsAPI`, and so on). Marking means **writing `enabled = true` into the user's settings**. A comment (FIXME)
says nested dependencies are only handled one level deep. An unresolved dependency throws in development and only warns in production.

**Patches.** At `initPluginManager`, every enabled plugin's patches are canonicalised (`\i`, `#{intl::KEY}`, `$self`) and
pushed to the patch list. `$self` becomes the text `Vencord.Plugins.plugins["Name"]`, so patched Discord code calls back into the
plugin through **a global object path**.

**Stop.** Reverses the registrations and removes the plugin's *pending* patches. Patches already applied stay in the modules,
which is why plugins with patches are marked "restart required" (`pluginRequiresRestart`).

## 3. Re-patching after a Discord update (`hostUpdateHook.ts`)

How the mod survives Discord replacing its own folder with a new `app-X.Y.Z`:
1. It replaces `Module.prototype.require` and waits for Discord to load `discord_desktop_core`.
2. It wraps that module's `startup(opts)` to capture Discord's **updater object** (`opts.updater.getUpdater()`, or wraps
   `tryInitUpdater` if it does not exist yet), then restores `require`.
3. On the updater's `host-updated` event, and after `startCurrentVersion` / `startCurrentVersionSync`, it works out the new
   version folder (`committedHostVersion` or `queryCurrentVersionsSync().current_host`, falling back on Windows to looking at
   sibling folders) and applies the patch to that folder's `resources` (`patchResourcesDir`: rename `app.asar` to `_app.asar`
   and write a stub).
4. Applying is idempotent (it checks for `_app.asar`). A second hook, `persistAfterDiscordUpdates.ts` (analysis 01), wraps
   `EventEmitter.prototype.emit` for the same event.
5. It marks Discord's objects with flags named after Equicord (`__equicordStartupWrapped`, `__equicordTryInitWrapped`).

It depends on Discord's **private** updater API names and event names. If any of them changes, the hook does nothing and the only
sign is a console error.

## 4. Health, safe mode and quarantine (`PluginHealth.ts`)

- Records per plugin: patch failures (6 kinds: `noModule`, `noEffect`, `errored`, `undoingGroup`, `conflict`, `codeChanged`),
  runtime errors, hook evidence, resource deltas and callback percentiles. Capped at 50 entries per plugin, duplicates collapsed.
- **Session history:** the last 10 sessions are saved; a session is "broken" for a plugin if it had a patch failure, a runtime
  error or (optionally) a source change. Badges: `unknown` below 3 sessions seen, `stable` with none broken, `flaky` under 40 %,
  `unstable` from 40 %.
- **Safe mode:** one flag that disables every non-required plugin.
- **Quarantine:** a list of plugins that never start. A plugin whose `start()` failed (recorded as a crash) three times in 24 hours
  is quarantined automatically. A log of the last 50 crashes and the last 50 enable/disable changes is kept.
- **Global error attribution:** `window` `error` and `unhandledrejection` events are linked to a plugin by matching the stack
  trace against folder names (`testcordplugins`, `equicordplugins`, `userplugins`). A fixed list of noisy errors is ignored
  (`ResizeObserver`, `AbortError`, `Failed to fetch`, a 429, even the message of NoTrack's intentional "Sentry successfully disabled").
  Unattributed errors are throttled to one per 5 s.
- Everything persists in the renderer's IndexedDB (`DataStore`), written 5 s after the last change, plus a best effort write on
  `beforeunload`. The whole object is exposed as `globalThis.__pluginHealth`.

## 5. Debug tools (`src/debug`)

- **`Tracer.ts`:** times named operations. In production builds `traceFunction` is replaced by an identity function, so it
  costs nothing. A trace name used twice at the same time throws (an error in development).
- **`reporterData.ts`:** the structure that holds failed patches and failed finds for the reporter.
- **`runReporter.ts`:** an automatic check to run against a real Discord page: wait until Discord is ready, **load every lazy
  chunk**, **require every module** so every patch gets a chance to apply, then report (a) patches that never found a module,
  (b) patches that took more than 10 ms, and (c) every recorded finder call that now returns nothing, printing it in the same
  syntax a plugin author wrote. It optionally sends results to an editor companion over a WebSocket.
- **`loadLazyChunks.ts`:** finds lazy chunk loads by regex in module sources and loads them all (with a 20 s timeout per
  chunk and a queue); it also checks whether a chunk is a worker asset.

## 6. Findings

| # | Where | Finding | Consequence |
|---|---|---|---|
| C1 | `webpack.ts` `handleModuleNotFound` | In production, a failed `findByProps` / component / CSS find is only a debug log and returns nothing. It is not recorded in PluginHealth. | A plugin can silently half-work after a Discord update, with no badge and no report. |
| C2 | `webpack.ts` | Development throws and production does not, for the same failure. | Tests in development do not exercise the code path users run. |
| C3 | `webpack.ts` | Test switches (`IS_ANTI_CRASH_TEST`) are inside production functions. | Extra branches in hot code and a second behavior hidden in the engine. |
| C4 | `webpack.ts` | Every find scans the whole cache and nested exports; nothing is remembered between sessions. | Cost grows with the number of finds at startup (their own comment gives ~14 ms per lookup before the memo). |
| C5 | `PluginManager.ts` | The engine contains plugin-specific code: a skipped patch for plugins named `Vesktop` and `Equibop`; the deferral setting is read from the `TestcordHelper` plugin's settings. | Engine behavior depends on named plugins. |
| C6 | `PluginManager.ts` | Starting a dependency or an API plugin writes `enabled = true` into the user's settings for good. | Turning a plugin on changes other plugins' saved state; turning it off does not undo it. |
| C7 | `PluginManager.ts` `startPlugin` | After `start()` succeeds it sets `started = true`, then registers commands and hooks. If a command fails to register it returns failure **without undoing** what was already registered. | A plugin can be left half started. |
| C8 | `Vencord.ts` order + `PluginManager.ts` | `initPluginManager()` registers patches (line ~261) **before** `startAllPlugins` loads safe mode and quarantine (line ~326, first thing it awaits). In `Vencord.ts` I found no earlier load. | Very likely: at that moment safe mode is off and quarantine is empty, so a quarantined plugin's **patches are still registered and applied**; only its `start()` is skipped. Inferred from the order, not tested. |
| C9 | `PluginHealth.ts` | Persistence uses optimistic `loaded` flags (`historyLoaded = true` before the data arrives), as in `PatchVersioning` (analysis 01 #9). A flush that runs in that window can write only the current session over the saved history. | Low probability, but real data loss path. Inferred from reading. |
| C10 | `PluginHealth.ts` | Safe mode and quarantine live in the renderer's IndexedDB. | If the page cannot load far enough to read them, the user has no way out; there is no crash-loop detection outside the page. |
| C11 | `PluginHealth.ts` | Error attribution matches three folder names only; Vencord's own `plugins/` folder is not in the list. | Errors from those plugins are unattributed. |
| C12 | several | Global names tied to the project (`window.Vencord`, `__pluginHealth`, flags named `__equicord...` on Discord's objects, `$self` expanding to `Vencord.Plugins...`). | Needed for patched code to call back, but they are fixed, project-named hooks inside Discord's page (see analysis 02 on mod detection). |
| C13 | `hostUpdateHook.ts` | Depends on private updater names; replaces `Module.prototype.require` until it finds its target; failure is only a console error. | Re-patching can stop working after a Discord change, silently. |
| C14 | `Tracer.ts` | Nested or concurrent traces with the same name throw in development. | A debugging aid that can itself crash. |
| C15 | `runReporter.ts` | The reporter needs a running Discord **web** client (the metadata step is `IS_WEB`) and a browser driver. | Not directly usable for a desktop-only mod. |

**Things that are good and worth keeping as ideas**
- A memoised `isPluginEnabled` that is cleared only by the events that can change the answer.
- Time-sliced startup so Discord can paint.
- Wrapping every flux handler with error capture, without stacking wrappers on re-subscribe.
- Trace functions that are compiled out of production.
- A reporter that loads **every** chunk and requires **every** module, so that all patches and finds get tested against one Discord build.
- Idempotent re-patching, and the idea of hooking Discord's own updater events.
- Collapsing duplicate failures in health records and capping their number.

## 7. Design ideas for Amiricord (proposals, not decisions)

1. **Scoped finder API.** Each plugin gets its own finder object bound to its id. Every miss is recorded in health under that plugin
   (no stack-trace guessing) and behaves the same in development and production. Strictness is a test setting, not a build difference.
2. **Resolved-module cache keyed by Discord build.** Remember `finder → module id + a short fingerprint` per build; on the next boot
   verify the fingerprint and fall back to the full scan. Never trust the cache without the check.
3. **Safe mode and quarantine decided before patches are registered.** Keep them in a small file in the data folder, read
   synchronously by the main process at startup, plus a crash-loop counter (several unclean starts in a row enter safe mode on their own).
   The page receives the decision; it does not have to discover it.
4. **Transactional start.** Each plugin gets a disposables list; every registration adds its undo. If anything fails, everything
   registered so far is undone and the plugin is marked failed, not half started.
5. **Computed dependencies.** The registry already contains `dependencies` and `startOrder`. The set of enabled plugins is
   "explicitly enabled plus their dependencies", computed, never written into the user's settings. Engine APIs are named in
   `ENGINE_APIS`.
6. **No plugin names in the engine.** Per-plugin behavior (skip a patch, defer start) goes in that plugin's manifest or
   plugin code.
7. **Defer and slice from the manifest** (a `deferrable` flag), not from another plugin's setting.
8. **Private callback hook for patched code.** Patched modules must call back into our code, so one global entry is needed.
   Make it a single, non-enumerable, named from `PROJECT_NAME`, documented, and tied to the registry; never an object tree of
   plugin names.
9. **Reporter for a desktop mod:** a `tools/` command that loads a Discord dump (planned in the the owner's other project plan), applies every patch and
   runs every finder against it offline, plus a quick in-app self-check at startup ("N required finders resolved, M missing").
10. **Host update hook with a health signal.** Keep the idea; verify at startup which of Discord's updater hooks attached; if none
    did, say so in the health report and rely on `pnpm repair`.
11. **Health storage in the main process or a file,** written with a safe pattern (write a temporary file, then rename), and with
    the loaded flag set only after the data is in memory.
12. **Attribute errors with source names we control:** name each plugin's compiled code with a `sourceURL` that contains its id, then
    match that, for every origin folder.

## 8. Open questions for the owners
- Should quarantine keep a plugin's patches out completely? (Proposal: yes. A quarantined plugin contributes nothing.)
- How many failed starts in a row should enter safe mode on their own? (TestCord quarantines a single plugin after 3 crashes in 24 h.)
- Do we want the in-app self-check to block anything, or only report?
