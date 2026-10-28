# Analysis 29: the bridge for a plugin's main-process part (`ctx.native`)

Written 2026-10-25 for Neversleeper, before any code. Needed first by Pinterest Tool (analysis 28). What is not verified is marked.

## 1. What exists
- `docs/design-01-manifest-permissions.md` already decides the shape: `entry.main` names the plugin's native file; the manifest lists the native functions; network hosts are declared with `from: "main"`; the main process answers only declared functions and rejects hosts the plugin did not declare; IPC channels are named per plugin. Its section 8 even lists PinterestTool as the example. This note only fills in how.
- The build already finds `entry.main` and skips it ("Not bundled yet"). The page talks to the main process through the fixed channels of `src/shared/ipc.ts` (all checked by `isTrustedSender`); there is no channel for plugins.

## 2. Design
1. **One channel for all plugins**, `amiricord:native`, instead of one channel per plugin: the page sends `{ plugin, fn, args }`. The main process checks, in this order: the sender is Discord's page; `plugin` is a plugin that is **enabled in this boot** and has native code; `fn` is in that plugin's declared list; `args` is plain data (strings, numbers, booleans, null, arrays and plain objects, depth and size capped); then calls it. Anything else is refused with a short error, never a crash.
2. **Native code is bundled at build time** into the main-process bundle as lazy `require`s (the same trick as analysis 36): a plugin that is off never runs a line of its native file, and its code is not even loaded.
3. **Network goes through a helper.** The native function gets a first argument `host` with `host.fetch(url, init)`. It refuses any URL whose host is not in the plugin's declared `network` with `from: "main"`, checks **every redirect** hop against the same list, applies a timeout, and counts the request in the firewall report. The original Pinterest `native.ts` calls the global `fetch`; the adapted one must use `host.fetch`. A scan at build time rejects `fetch(`, `http`, `https`, `net`, `child_process`, `eval` and `new Function` in a native file that did not declare them.
4. **Results** are plain data or `ArrayBuffer` (the structured-clone types Electron's `invoke` can carry). A thrown error becomes `{ ok:false, error }` on the page with the plugin's name; it is also written to the health report.
5. **`ctx.native`** in the page: `call(fn, ...args): Promise<unknown>`, typed per plugin with `PluginNative<typeof import("./native")>`, like TestCord. If the bridge or the function is missing the promise rejects with a clear message (fail-open: only that plugin's feature fails).
6. **A plugin with native code needs a restart to switch on or off** (`restartToToggle`), because the main process loads it at boot.

## 3. Honest limit
Every plugin runs in the same page, so the main process **cannot tell which plugin really made a call**: the `plugin` name in the message is a claim. A plugin could call another plugin's native functions. What the checks give is: only enabled plugins, only declared functions, only declared hosts, only plain data. The design's words "the main process checks the caller" are therefore weaker than they sound; docs must say so.

## 4. Pieces and where they live
| Piece | Files | Notes |
|---|---|---|
| A. Host core (pure): validate a call, run it, the `host.fetch` with host and redirect checks | new `src/main/nativeHost.ts` | no Electron inside, tested with fakes |
| B. IPC: channel, message parser, preload bridge, main handler | `src/shared/ipc.ts`, `src/preload/*`, `src/main/*` | szlcx404's area; he allowed the edits |
| C. Build: bundle `entry.main`, the scan, the list of native functions in the manifest | `scripts/build/*`, `src/shared/manifest.ts` | the manifest gets `native: [..]` names (design s3 already describes it) |
| D. Engine: `ctx.native` | `src/renderer/engine.ts`, new `src/api/native.ts` | small |

## 5. Not verified
- That Electron's main process can load the bundle with lazy requires the way the build's current `main.js` is loaded (the main bundle's loader was not read for this note).
- That the preload bridge can pass `ArrayBuffer`s of several MB without trouble.
- That `fetch` exists in Discord's main-process Node (the Electron version was not checked); Pinterest's original assumes it.
- Anything in a real Discord.

## 6. Authorship decisions for the Pinterest Tool manifest (owner, 2026-10-25)
- Authors: Neversleeper (GitHub `https://github.com/Neversleeper`, Discord ID given by the owner in chat) and szlcx404 (`https://github.com/szlcx404`), who wrote the original ("the old one") that TestCord carries. Credits keep the Vencord template headers of the original files.
- `Author` in `src/shared/manifest.ts` has `name`, `discordId`, `role` and no link field: add an optional `github` (a `https://github.com/<user>` link, checked at build time).
- **Privacy note:** `CLAUDE.md` says no personal data in the repository, "IDs of private people". The ID is the owner's own and she asked for it. The repository is private now. It must be looked at again before the repository is ever made public, and the person decides.
