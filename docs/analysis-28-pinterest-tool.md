# Analysis 28: Pinterest Tool

Written 2026-10-25 for Neversleeper, before any code. Read-only: the files were read from TestCord's public repository (`TestcordDev/TestCord`, branch `main`, read on 2026-10-25, commit not recorded) and the ones listed in section 5 were saved under `probe/tc/` on D: (git ignores `probe/`). Nothing was run or copied into `src/`.

## 1. Pinterest Tool (`src/testcordplugins/PinterestTool`, listed author szcx404 in TestCord)
**What it does.** Searches Pinterest for profile pictures and banners, shows them in a window, lets the person edit them (effects, GIF) and hands the result to Discord's profile upload.
**Size.** 11 files, about 290 KB: `components.tsx` 129 KB, `style.css` 45 KB, `native.ts` 26 KB, `index.tsx` 29 KB, `icon.png` 122 KB, others small.
**What it needs from the engine.**
- **A main-process part (`native.ts`).** It calls `www.pinterest.com` with `fetch`, keeps a session cookie, reads an optional cookie the person types in, and downloads images only from `i.pinimg.com`, `s.pinimg.com` (and DeviantArt hosts, for old saved favourites). Amiricord does not bundle plugin main-process code yet (the build says "Not bundled yet") and the page cannot call it. This is the big piece: a bridge `ctx.native.call(name, args)` and a main-process loader. It touches `src/main`, szlcx404's area (told by the owner that szlcx404 agreed; his own words are not written down).
- **Network permission.** The manifest must declare `www.pinterest.com`, `i.pinimg.com`, `s.pinimg.com` so the firewall and CSP know. The main process must apply the same host rules to the plugin's `fetch` (today only the page's requests go through the hub).
- **Modals** (`openModal`): `ctx.modals` exists, the components (`ModalRoot`...) do not.
- Discord's own pieces: `getIntlMessage`, the profile upload (the plugin probes Discord's file input to hand the image over: fragile DOM work).
**Not verified:** all of it. Not read yet: `components.tsx`, `effects.ts`, `gif.ts`, `style.css`, `icon.ts`.

## 7. Added after the owner's clarification: improving Pinterest Tool itself, not only its network side
The owner meant improving the plugin as a whole. Read after that: `components.tsx` (2634 lines: browser window, results grid, favourites, theme picker, effects editor, profile hand-off), `effects.ts` (477, canvas effects and text/image layers), `gif.ts` (491, GIF decode and re-encode under Discord's 10 MB limit), `i18n.ts`, and the end of `native.ts`. It is already a large, careful plugin (themes, light/dark, effects with presets, GIF fitting, favourites, recent searches, an allow-list of image hosts with manual redirect checks). It is a port first, an improvement second; the first target is "works the same in Amiricord", then these changes, each with its own test:
1. **Download size is only checked after the whole image is in memory when the server sends no `content-length`** (`fetchMedia`, `native.ts`): read the body in chunks and stop at the limit. Also it returns the bytes and a base64 copy of the same image, which can be two or three times the image's size in memory for up to 60 MB: return one form only.
2. **No Pinterest traffic until the person searches** (the original calls `warmUp()` at start). Drop it.
3. **Stale searches:** a new search or page click should cancel the one in flight, so old answers never overwrite new ones. How the original handles it was not checked (a text search found `AbortController` in only a couple of places).
4. **GIF editing limits:** `decodeGif` accepts up to 300 frames at 640 px; ask before decoding a GIF that would take hundreds of MB, and report progress with a cancel button.
5. **Favourites and recent searches** are kept with TestCord's `DataStore`, which Amiricord does not have: they need a small plugin storage API (analysis of its own), and an export/import of favourites so they are not lost when the data folder changes.
6. **Code only runs when the plugin is on** (already true since analysis 36), but its ~250 KB still travels in `renderer.js`; the editor part (`effects.ts`, `gif.ts`) can be loaded only when the editor opens.
7. **Keyboard use and focus:** the code has about 78 aria or key handlers; whether the grid and the editor can be used with the keyboard alone was not tested.
8. **Hand-off to Discord's profile upload** probes Discord's file input and intercepts its clicks (fragile on any Discord update); the code already has another path through Discord's pending-profile changes (`setPendingProfileChanges`). Prefer that path and keep the probe only as a fallback, if the owners agree.
Not changed on purpose: the interface stays in English (the original's own decision, to avoid mixed languages).
Not verified: all of the above is from reading, nothing ran.
