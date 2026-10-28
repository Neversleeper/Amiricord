# Design 02: the engine core (boot, patcher, finders, plugin lifecycle, health)

**Status: approved by the owner on 2026-10-24, including decisions Q1 to Q8 as recommended in section 15. Implementation follows the build order in section 11.**
Builds on design 01 (manifest and permissions) and analyses 01 to 05. Every point below says which finding it answers.

## 1. Goals
1. Discord keeps working when a plugin or a Discord update breaks something: the damage is small, visible and recoverable.
2. Safe mode and quarantine are decided **before** any patch is registered (answers analysis 04 C8, C10).
3. Every failure is recorded **with the plugin that caused it** and behaves the same in development and production (C1, C2).
4. The heart of the engine (the patch compiler) is a pure function that can be tested **offline**, without Discord.
5. No plugin names inside the engine (C5); no settings written behind the user's back (C6).

## 2. The processes and what each one does
```
installer (stage 4)  ->  stub in Discord's resources  ->  MAIN patcher  ->  preload  ->  RENDERER entry
                                                              |                              |
                                                       boot state file                 patch engine, finders,
                                                       safe mode, quarantine,          plugin lifecycle, health events
                                                       health file, host update hook
```
- **Main patcher (`src/main`).** Runs first. Reads the boot state from a small file, starts the host update hook, adds our preload to
  Discord's windows, hands the boot state to the page, then lets Discord start. It owns the files in the data folder
  (`%APPDATA%/Amiricord`). It changes as little of Discord's window setup as possible (see section 9).
- **Preload (`src/preload`).** A thin bridge: exposes only the functions the renderer needs (read boot state, send health events,
  call a plugin's native functions through the isolated channels from design 01).
- **Renderer entry (`src/renderer`).** Installs the webpack hook before Discord's code runs, builds the enabled set, registers
  patches, then starts plugins in stages.

## 3. Boot state and safe mode (main process)
A small JSON file `state.json` in the data folder, read **synchronously** by the main process at startup:
```
{ "safeMode": false, "quarantine": ["PluginId"], "bootAttempts": 0, "lastBootAt": 0, "installedBuild": null }
```
- **Crash-loop counter.** At each start `bootAttempts` goes up by one and the file is written. When the renderer reports a clean boot
  (all stages finished, plus a short delay with no fatal error) the counter returns to 0. If it reaches the limit, safe mode turns on by itself
  and the user is told why.
- **Safe mode** = only **core** plugins run (see Q4). Core plugins are `core: true` in the manifest (NoTrack, Settings).
- **Quarantine** = a plugin that never starts **and whose patches are never registered**. The list is applied before registering patches.
- The renderer asks the main process for this state with one synchronous call at the very start, so the decision is made before
  the first patch is compiled.
- File writes use a temporary file and a rename, so a crash cannot leave a half written file. If the file is unreadable, the engine
  starts with defaults and says so in the health report.

## 4. Deciding which plugins run (renderer, pure code)
Input: the registry (`dist/registry.json`), the user's saved choices, the boot state. Output: the set to run, in `startOrder`.
- explicit choices plus their **dependency closure**, computed and never written back into the user's settings (answers C6);
- remove quarantined plugins; in safe mode keep only `core: true`;
- a dependency that is a plugin in quarantine makes its dependants not start, and the health report says why;
- engine APIs named in `ENGINE_APIS` are provided by the engine, not enabled as plugins;
- result is a plain list; the function has no side effects, so it is unit tested.

## 5. The patch engine (renderer)
**Patch definition (our own shape).**
```
{ find: "anchor text",                       // required: a fixed string that identifies the module
  replacements: [{ match, replace }],        // regex or string; `\i` for minified identifiers; #{intl::KEY} markers
  group: false,                              // all replacements of the patch apply, or none
  required: true,                            // default true; false = a miss only warns
  discord: { minBuild, maxBuild } }          // optional
```
A patch with no fixed text in `find` is rejected at build time (idea from TestCord's `lint:patches`).

**Pipeline per module (a pure function `compileModule(source, patches) -> { code, outcomes }`).**
1. Select the patches whose `find` text occurs in the module source.
2. Apply each replacement in order; record per replacement: applied, no effect, or error.
3. If a group fails, undo the whole group.
4. Check the final code **once** that it parses. If not, replay the replacements one by one to find the offender, drop only that one.
5. Return the new code and the list of outcomes, each tagged with plugin id and module id.
Evaluating the code into a function is a separate, small step. A patched factory is **never run twice**: if it fails, the failure is
recorded and the original is used only if the factory did not start (answers analysis 01 #3).

**Outcomes feed health.** `required` patch that misses or errors: the plugin is flagged and, after the next boot, quarantined.
`required: false`: warning only. A "Discord changed this module" signal (hash of the matched region, keyed by `find`, not by module id)
is a separate notice and does not by itself make a plugin flaky (analysis 01 #9, #10).

**Finding Discord's main webpack.** Several independent signals, each logged; a startup self-test reports which matched, and says
so loudly if none did (analysis 01 #1). The Discord build number is read from one place, and if it cannot be read the report says
"unknown", never silently `-1` (analysis 01 #2).

**`eval` and the CSP.** Compiling patched modules needs dynamic code, so the page's CSP must allow it. That is why design 01 lists
`code.dynamic` for plugins but not for the engine itself; the engine's own use is documented in `eslint.config.mjs` exceptions and in the
privacy report.

## 6. Finders (renderer)
- Each plugin receives its **own** finder object (`ctx.find`), so every miss is recorded in health under that plugin's id (answers C1).
- Same behavior in development and production. Strictness (throw on a miss) is a switch used only by tests and the reporter tools (C2).
- First set of finders, only what the first plugins need: by exported property names, by code text, by store name, by component code,
  and "wait until a module appears". More are added with the plugin that needs them.
- **Result cache per Discord build** in the data folder: finder signature -> module id + a short fingerprint of the module. On use, the
  fingerprint is verified; if it does not match, the engine scans and updates the cache (answers C4). The cache is advice, never trust.
- Lazy by default: a finder runs on first use, not at plugin load.

## 7. Plugin lifecycle (renderer)
- Stages like TestCord (`Init`, `WebpackReady`, `DOMContentLoaded`), declared by the plugin; started in `startOrder`, in time slices of
  about 12 ms so Discord can paint.
- `start(ctx)` receives a context. Everything a plugin registers through `ctx` (styles, listeners, commands, context menu items, buttons)
  adds an undo to a **disposables list**. If `start` or any registration fails, all disposables run and the plugin is marked failed, never
  half started (answers C7). `stop` is the same list run in reverse.
- Flux handlers are wrapped once with error capture, attributed to the plugin, and never wrapped twice.
- Deferral and time slicing come from the manifest (`deferrable`), not from another plugin's setting (C5).
- Patches are applied only when Discord loads a module, so a plugin with patches needs a restart to enable or disable
  (`requiresRestart: "auto"` as in design 01).

## 8. Health (main process owns the file)
- The renderer sends events (patch outcomes, runtime errors, start failures, finder misses) over the bridge; the main process keeps them
  in memory and writes `health.json` after a short delay and on exit, with the same temporary file and rename.
- Contents as in analysis 04 s4 (failure kinds, per plugin caps, last 10 sessions, stability badge by design 01 s10), plus the boot
  state and the host update status.
- Errors outside our wrappers are attributed through the plugin id in each compiled plugin's `sourceURL` (works for every origin folder, C11).
- A report that is **always available**, in production too: per plugin the declared permissions, the observed failures, and a one line
  summary for support ("Discord build N, 3 patches ok, 1 missing").
- Nothing is sent anywhere. "Report a problem" copies a redacted text to the clipboard.

## 9. Main process changes to Discord's window
Design rule: change only what the mod needs, and document why.
- **Preload:** add ours alongside Discord's. Preferred method: Electron's session preload list, so Discord's own preload is left alone.
  If that is not possible, wrap it like TestCord does.
- **Sandbox, DevTools, throttling:** not changed by default. Whether our preload works with Discord's current window settings must be
  tested in Canary; each change that turns out to be needed is added with its reason (Q5).
- **Host update hook:** keep the idea (re-patch the new `app-X.Y.Z` after Discord's updater finishes), verify at startup which of Discord's
  updater hooks attached, report it, and keep `pnpm repair` as the fallback (C13).

## 10. How the pieces are named and reached
- One global entry for code that patched Discord modules must call back into the mod. Its name comes from `PROJECT_NAME`, it is defined
  non-enumerable and it exposes only a function to look up a plugin by id. No object tree of plugin names (C12).
- No settings are written by the engine as a side effect. No project-named flags on Discord's objects.

## 11. Build order (each step with tests, none needs Discord until step 7)
1. **Boot state**: read, write atomically, crash-loop counter, safe mode decision. Pure, tested with temporary folders.
2. **Enabled set and dependency closure** from the registry. Pure.
3. **`compileModule`**, the patch compiler, with the whole pipeline of section 5. Pure, tested with small fake module sources:
   group undo, no effect, bad regex, syntax break and recovery, overlapping patches, intl markers.
4. **Plugin lifecycle** with disposables and failure rollback. Pure with fakes.
5. **Health store** in the main process (file writing, caps, history, stability). Tested with temporary folders.
6. **Webpack hook and finders**, tested in Node against a fake `webpackRequire`.
7. **Main patcher, preload, renderer entry and the first `pnpm build`** (esbuild bundles for each process into `dist`). First time something
   can run in Discord Canary, together with stage 4 (installer).
After step 7: `tools/dump` and `tools/patch-test` to check every patch and finder against a Discord dump offline.

## 12. Manifest fields this design needs (not in design 01 yet)
- `startAt`: `"init"`, `"webpackReady"` or `"domReady"`, default `"webpackReady"` (section 7).
- `deferrable`: boolean, default `false`; only plugins without patches, flux handlers or a required early start may be true (section 7).
- Patch definitions stay in the plugin's code, as in design 01, but follow the shape in section 5 (`find`, `replacements`, `group`, `required`, `discord`).
`startAt` and `deferrable` were added to `src/shared/manifest.ts`, the validator and its tests with build step 4 (a deferrable plugin cannot start at `init` or be `core`).

## 13. Alerts when something breaks (answers the owners' question about a WebSocket)
TestCord alerts its maintainers through a server (a daily CI job posts a report to a Discord webhook); the mod on a user's PC never
contacts them (analysis 06 s2). Amiricord has no server and, by design 01 and the privacy rules, makes no traffic of its own. Options, in order:
1. **In the app (default, always on):** a notice in Discord's own notice area and a badge on the Plugin Health tab when a patch fails, a plugin
   is quarantined, or the host update hook did not attach. Plain text, with the plugin id and what to do.
2. **Desktop notification on the same PC** (a setting, off by default).
3. **Manual sharing between the two owners:** "copy health summary" puts a redacted text on the clipboard to paste in a private chat.
4. **Optional, later, only if the owners ask:** a plugin that posts a one line status to a Discord webhook the owners create themselves. It is
   High risk by design 01 (sends data out; declares `discord.com`; the webhook URL is a secret), off by default.
A WebSocket from the mod to the other owner's PC is not proposed: it needs a server or an open port, which conflicts with the privacy rules.

## 14. Lessons from real fixes (analysis 06) for writing patches
Patch guidelines to apply from the first plugin: anchor `find` on fixed text, preferably an intl marker; use `\i` and bounded neighbourhood
matches; small `replace`; never match a whole function body; count patches per plugin in its analysis. A later patch lint can check them.

## 15. Decisions (all approved as recommended, 2026-10-24)
| # | Question | Recommendation |
|---|---|---|
| Q1 | How many failed boots in a row turn safe mode on by themselves? | 3 |
| Q2 | Auto-quarantine a plugin after how many start failures in 24 h? | 3 (same as TestCord) |
| Q3 | Does quarantine also keep the plugin's patches out? | Yes, always |
| Q4 | Which plugins stay on in safe mode? | Only `core: true`: NoTrack and Settings (so the user can leave safe mode) |
| Q5 | DevTools and window settings: keep Discord's defaults and add changes only if Canary shows they are needed? | Yes, but offer a "Enable DevTools" setting for the owners |
| Q6 | The one global entry takes the name `Amiricord` (from `PROJECT_NAME`)? | Yes |
| Q7 | Should the startup self-check ever block Discord from starting? | No, report only |
| Q8 | Alerts when something breaks: in-app notice and health badge always, desktop notification optional, manual summary to share; no WebSocket or server (section 13)? | Yes |
