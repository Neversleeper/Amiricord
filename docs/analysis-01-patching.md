# Analysis 01: how TestCord patches Discord, where it is fragile

Reference only. Written in our own words from reading TestCord at commit `af92dbaec`
(`src/webpack/patchWebpack.ts`, `src/main/patcher.ts`, `src/api/PatchVersioning.ts`,
`src/utils/patches.ts`). Nothing here is copied code.

**Not read yet:** `src/webpack/webpack.ts` (926 lines), `src/api/PluginHealth.ts` (940 lines),
`src/api/PluginManager.ts` (697 lines), `src/main/hostUpdateHook.ts` (only the header).
Findings below come from reading, not from running anything.

## 1. How it works

**Main process (`patcher.ts`)**
1. Discord's `app.asar` is renamed to `_app.asar`; a stub loads the mod first.
2. The mod points Electron's app path back at `_app.asar`, so Discord starts normally afterwards.
3. It swaps Electron's `BrowserWindow` for a subclass that replaces the preload script,
   turns the sandbox off, disables background throttling and forces DevTools on.
4. It hooks session creation so that several parties can register web-request listeners
   without overwriting each other (Electron keeps only one).
5. It re-patches after Discord installs a new host version.

**Renderer (`patchWebpack.ts`)**
1. A setter is installed on `Function.prototype.m`. Webpack assigns `m` (the module factory
   table) when it starts, so this is how the mod sees every Webpack instance.
2. Heuristics decide whether an instance is Discord's main bundle (see weak points).
3. Every module factory is wrapped in a `Proxy`. Patching is eager (when defined) or lazy (when first run).
4. Patching a factory means: take its source text, run each plugin's regex replacement
   over it in order, then `eval` the result once to get the new function.
5. Listeners are notified when a module loads, and plugins can wait for a module by filter.

**Failure handling already present (worth keeping the idea of)**
- A replacement that does nothing is logged and recorded per plugin.
- A "group" of replacements is all-or-nothing.
- A single `eval` per module instead of one per replacement.
- If the final code does not parse, replacements are replayed one at a time to find the
  offender, and only the offenders are dropped.
- Patches can be limited to a range of Discord build numbers.
- A hash of the original module source is stored per patch to warn when Discord changed it.

## 2. Weak points found

| # | Where | Problem | Effect when Discord changes |
|---|---|---|---|
| 1 | `patchWebpack.ts` setter on `m` | Main-bundle detection is a pile of string heuristics: stack text contains `http`, a regex on the stack, `exports:{}` in the function source, file names `sentry`/`libdiscore`/`fast-connect`, `bundlePath === "/assets/"`, a regex on `this.u`. | A small change in bundle naming or layout can make the mod patch the wrong instance or none. |
| 2 | `getBuildNumber` | Tries a hardcoded module id first, then searches for a Discord error string. On failure returns `-1`, which silently turns off build-number gating. | Version-gated patches apply (or not) without anyone noticing. |
| 3 | `runFactoryWithWrap` | If the patched factory throws, the original factory is run again. | The first run may already have had side effects, so a module can execute twice. |
| 4 | `patchFactory` | Patches are regex replacements on minified source, evaluated with `eval`. | Needs `unsafe-eval` in the CSP; every patched module is compiled again; any renamed variable breaks matches. |
| 5 | `patchFactory` | `patches.splice(i--, 1)` removes patches from the shared list as a side effect, both for build-range mismatches and after the first match when `all` is not set. | Hidden mutable state; a second copy of a module in another bundle is not patched. |
| 6 | `patchFactory` | A hardcoded exception: errors from the plugin named `ContextMenuAPI` containing `arguments` are suppressed (marked FIXME). | Real failures of that plugin are hidden by name. |
| 7 | `patchFactory` | A global regex rewrite `return(false|true|null|undefined)` on the whole module after patching. | A workaround that touches code no plugin asked to change. |
| 8 | Conflict detection | Two plugins patching the same module is only logged, and only in dev builds. | Conflicts are invisible to normal users. |
| 9 | `PatchVersioning` | `loaded` is set to true before the stored data has arrived. Patches applied during that window skip the comparison and then overwrite the saved hash. | Early patches never raise a "Discord changed" warning (probable bug, not run). |
| 10 | `PatchVersioning` | The key includes the module id, which can change between Discord builds; the hash covers the whole module, so any unrelated change counts. | Either no warning at all (id moved) or noisy false warnings. Flushes after a 10 s timer, so closing sooner loses the data. |
| 11 | `patcher.ts` | Sandbox is turned off for every window with a preload script and a title, not only where needed. DevTools and Discord's "dangerous" flags are forced on. | Larger attack surface than the mod needs. |
| 12 | `patcher.ts` | Depends on the exact asar layout (`_app.asar` as sibling of the stub), `require.main.filename` rewriting, and replacing the cached `electron` export. | A change in how Discord starts breaks everything at once, with no diagnostic. |
| 13 | `persistAfterDiscordUpdates` | Wraps `EventEmitter.prototype.emit` globally to watch for one event name. | Every event emitted in the main process pays the proxy cost. |
| 14 | Production builds | Patched source and "patched by" data are only kept in dev builds. | Hard to diagnose a user's broken patch from a normal install. |

## 3. Design ideas for Amiricord (proposals, not decisions)

- **Identify modules by content, not id.** Each patch declares an anchor string or fingerprint;
  ids are only a cache.
- **Main-bundle detection with several independent signals**, each logged, plus a startup
  self-test that says which signal matched. If none match, say so loudly instead of guessing.
- **Required vs optional patches** in the manifest. A failed required patch puts that plugin
  in quarantine (safe mode) and saves the reason; optional ones only warn.
- **Never run a module twice.** If a patched factory fails before side effects can be known,
  fail that plugin's patch at build/parse time (before execution), not by re-running.
- **Parse-check once per module, bisect only on failure** (keep this idea; it is good).
- **No plugin names in engine code.** Exceptions belong in that plugin's manifest.
- **Patch list is immutable;** per-session state (applied, skipped, why) lives in a separate record.
- **Conflict report always on,** shown in the health panel, not only in dev logs.
- **Version detection that does not rely on one error string;** and if unknown, say "unknown"
  in the report instead of silently disabling gating.
- **Change detection on the matched region only** (a window around the anchor), keyed by
  anchor rather than module id, saved immediately when a change is found.
- **Health report kept in production** (compact: plugin, patch, outcome, hash), because it is
  what lets a user report "Discord updated and X broke".
- **Narrow the main-process changes:** only what is needed, per window, with a documented reason
  for each switched-off protection.
- **Measure cost:** time spent in patching per plugin, shown in the report.

## 4. Open questions for the next reads

1. How `webpack.ts` finds modules (`find*` helpers, caching, lazy proxies) and what it costs.
2. What `PluginHealth` stores and how the user sees it.
3. How `PluginManager` orders plugin start, handles dependencies and removes patches.
4. How `hostUpdateHook` re-patches after a host update, and its failure modes.
