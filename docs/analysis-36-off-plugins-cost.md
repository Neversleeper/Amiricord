# Analysis 36: a switched-off plugin must cost nothing (RAM, CPU, GPU)

Written 2026-10-25 for Neversleeper. Owner's request: TestCord keeps every plugin loaded even when it shows as off; Amiricord's plugins must not use RAM or GPU when they are off. Status: **analysis only, no code yet.** What is not verified is marked as such.

## 1. What already holds (read in the code, with the tests that say so)
- `startEngine` works out the set of plugins that run (`computeEnabledSet`) and only then loads code, binds settings and registers patches, **for that set only** (`src/renderer/engine.ts`, loop at step 2). A plugin that is off: no `loadPlugin` call, no settings attached, no patches registered, no `start()`, no styles, no finders created by it. A plugin that draws nothing cannot use the GPU.
- Turning a plugin on while Discord runs loads it at that moment (`prepare` in `PluginSwitch`); turning it off stops it and unbinds its settings (`release`).
- szlcx404's log records a test "loads and registers only the plugins that run".
- The main process has no plugin code at all (only the engine), so nothing there can load an off plugin.

## 2. What still costs something (the real gap)
`scripts/build/generate.ts` writes `pluginModules` as one static `import pluginN from "<file>"` line per plugin plus a table `id: () => pluginN`, and the page script is one IIFE bundle. Two consequences, both **by reading the build, not measured**:
1. **The code of every plugin is inside `renderer.js`** and Discord's page parses it at start, whether the plugin is on or off. Cost grows with the size of the code of all plugins (parsing is mostly lazy in V8, so the memory is small, but it is not zero).
2. **Top-level code of every plugin file runs at start.** With static imports, esbuild evaluates each imported module when the bundle starts, even if nobody calls `() => pluginN`. Anything a plugin does outside its `start()` (build its settings definition, create objects, read things) therefore runs for **off plugins too**. This is the same family of problem the owner read about in TestCord.
Today it makes no visible difference: the only two plugins (`NoTrack`, `Settings`) are core and always on. It would start to matter with the first plugin that can be switched off.

## 3. Proposal
Make the code of a plugin **lazy**: the generated table calls `require("<file>")` inside the function (`id: () => require(file).default`) instead of a top-level `import`. esbuild turns each `require` in a bundle into a wrapper that runs the module's top-level code **the first time it is called**. Then:
- an off plugin's top-level code never runs;
- turning it on later runs it at that moment, as the hot toggle already expects;
- the bytes are still in `renderer.js` (a real "download only when needed" split would need chunks, which the single injected IIFE cannot load without a request; not proposed).
Files: `scripts/build/generate.ts` (shared build file: **szlcx404 must be told before it is joined**) and `tests/build.test.ts`.

## 4. How it would be tested (before any claim)
- Text test: the generated source has no top-level `import pluginN` lines and uses a lazy `require` per plugin.
- Real bundle test: bundle a temporary plugin whose top-level code sets a flag; start the engine with it switched off and assert the flag stays unset; turn it on and assert it is set. The existing helper that bundles plugins in tests (`build.ts` line 66) is the likely tool; not read in full yet.
- Mutation check: put back the static import / run the code early; the tests must fail.

## 5. Not verified
- That esbuild's output for `require` inside an IIFE bundle behaves as described in this project's exact esbuild settings (needs the real bundle test above).
- How much memory or start time this saves: nothing is measured; the measuring stage is later in the owners' plan. With two core plugins there is nothing to measure.
- What TestCord really does: the owner read that it keeps off plugins loaded; not checked by me in its code.

## 5b. Status (2026-10-25)
Built after the owner said szlcx404 agreed to add TestCord plugins: `generate.ts` writes a lazy `require` per plugin; tests in `tests/build.test.ts` build a real bundle and show that the file of an off plugin does not run and that of an on plugin does. Uncommitted, and the shared build file still has to be told to szlcx404. The bytes of the plugin stay in `renderer.js`.

## 6. Questions (answered by the build above; kept for the record)
1. Do the lazy `require` in `generate.ts` (small change, shared build file)? szlcx404 must agree before it is joined.
2. Or wait until there is a plugin that can be switched off, so it can also be seen working?
