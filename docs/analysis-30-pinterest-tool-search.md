# Analysis 30: Pinterest Tool, step 1: the search

Written 2026-10-26 for Neversleeper (the code of this step was written in the same sitting; what is not verified is marked). Follows analysis 28 (what the plugin is) and analysis 29 (the bridge to the main process, now built).

## 1. Scope of this step
Only the **search side** of the plugin: Pinterest's search, ranking, the anonymous session, and downloading one image. No window, no editor, no favourites, no hand-off to the profile yet (those are the next steps, each with its own note). The plugin is **off by default**, marked experimental, and **does nothing when switched on yet** besides making its functions callable; nothing contacts Pinterest until a search is made.

## 2. Where it lives and who it credits
- `src/testcordplugins/PinterestTool/` (origin `testcord`, because it is adapted from TestCord's copy; `docs/design-01` had it as `amiricord`: the folder follows the origin rule of the validator).
- Authors: **Neversleeper** (GitHub link and the Discord ID she gave) and **szlcx404** (GitHub link, role "original author", as the owner asked). Credits: Vencord's header and the plugin by szcx404 in TestCord (`github.com/TestcordDev/TestCord`). The file headers say which parts come from which TestCord file.
- Risk, computed by the engine: **medium** (network from the main process, native functions).

## 3. Files
| File | Side | What |
|---|---|---|
| `plugin.json` | build | manifest: three hosts `www.pinterest.com`, `i.pinimg.com`, `s.pinimg.com` from `main`; native functions `fetchMedia`, `search`, `warmUp` |
| `native.ts` | main | the three functions the page may call; nothing else is exported |
| `native.client.ts` | main | `PinterestClient`: session, search of two feeds, cache, image download; all network through `host.fetch` |
| `pinterest.ts` | both | pure: request address, reading the answer, cursors, query hints, cookie cleaning |
| `searchRanking.ts` | both | pure: ordering and de-duplication |
| `types.ts` | both | shared types |
| `index.ts` | page | does nothing at start; gives a typed view of the native functions for the window of the next step |

Helper files used by the main side are named `native.*` so the build's scan counts them as main-side code (that is how `sideOf` tells the sides apart).

## 4. Changes from the original, all NOT verified against Pinterest itself
1. **No network at start.** The original opened a session as soon as the plugin was on; here only a search or an explicit `warmUp` contacts Pinterest.
2. **One copy of the image.** The original returned the bytes and a base64 copy (two or three times the memory for up to 60 MB). Here only the bytes.
3. **The size limit reads the stream.** The original checked only the declared length, then loaded the whole body. The host's `fetch` now takes `maxBytes` (and has a default of 64 MB for every plugin): the declared length is checked first and the stream is read in pieces and cancelled when the limit is passed. This is a change to `src/main/nativeHost.ts` and benefits every future native plugin.
4. **The download must end on an image server.** After redirects the final address must be `i.pinimg.com` or `s.pinimg.com`; a redirect to `www.pinterest.com` or anywhere else is refused (the host already refuses undeclared hosts; this is stricter).
5. **DeviantArt is gone** (it was only for favourites saved by old versions; the favourites do not exist in Amiricord yet). Its hosts are not declared.
6. **Merged Set-Cookie lines** are trimmed (the original left a double space in the cookie it sent).
7. **Searches take an options object** instead of seven positional arguments, and unknown values fall back to plain defaults.
8. The random style word comes from a function the caller gives, so tests are exact.
9. The cache of next pages is kept per client object, not in module variables, so tests start clean. Its key holds the person's cookie, in memory only.

## 5. How it is checked
- `tests/pinterestTool.test.ts`: the pure parts (cursors, request, answer reading, ranking), the client against a fake Pinterest (session reuse and expiry, two feeds, partial failure, cookie handling, cache, in-flight sharing, GIF paging, time limit, image download rules), and the whole way through `NativeHost` (only the declared functions callable, undeclared hosts refused).
- `tests/nativeHost.test.ts`: the new size limit and the stable host object per plugin.

## 6. Not verified
- That Pinterest still answers the address, headers and user agent the original used (they are kept as they were; none was run). The old Chrome 61 user agent for search looks odd and was kept only because the original had it.
- That Discord's Node main process has `fetch` and runs the bundle with the lazy native requires.
- The ranking was not re-tuned; it is the original's.
- Pinterest's terms of use for automated searches were not read; the plugin works like a person typing in Pinterest's own site, the same as the original.
- Nothing ran in a real Discord.

## 7. Next steps
2. Plugin settings and storage (theme, cookie as a secret, favourites, recent searches, export/import).
3. Modal components (Discord's own, with fallbacks).
4. The window: results grid, pagination with cancel of stale searches, favourites.
5. The editor and its new functions (crop frame, drag and paste, before/after, undo, GIF trim).
6. The hand-off to Discord's profile (prefer its pending-profile changes).
