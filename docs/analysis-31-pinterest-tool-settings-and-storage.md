# Analysis 31: Pinterest Tool, step 2: settings, secrets and storage

Written 2026-10-26 for Neversleeper, before the code. What is not verified is marked. Follows analysis 30 (the search).

## 1. What the owner asked
Theme, the cookie as a secret, favourites, recent searches, export and import.

## 2. What the engine has and lacks (read in the code)
| Need | Engine today | Consequence |
|---|---|---|
| Theme, appearance, switches | `definePluginSettings` with boolean, number, string, select; saved in `settings.json` | enough: the six settings of the original fit |
| Cookie as a **secret** | nothing. `settings.json` is plain text and **the page gets every plugin's saved values at boot** (`bootInfo.settings`), so any plugin could read it. `design-01` says secrets are "stored encrypted with the OS secure storage", never exported; not built | a **secret store in the main process** is needed |
| Favourites, recent searches | only the small typed settings (64 KB per value, 2 MB for the whole file, shown in the settings page). TestCord uses Vencord's `DataStore` (IndexedDB), which Amiricord does not have | a **plugin storage** is needed |
| Export and import | none | done by the plugin with a checked, versioned format |

Also found: in the original, the cookie option exists only as a type (`SearchExtras.pinterestCookie`) and **no setting or screen ever fills it**: the feature was dormant. It is built here properly because the owner asked, and because `design-01` already counted `pinterestCookie` as the plugin's secret.

## 3. Engine piece A: secrets (main process, szlcx404's area; he allowed the edits, per the owner)
- **Where:** `secrets.json` in the data folder of that Discord (on the owner's PC that is on D:). Every value is encrypted with Electron's `safeStorage` (Windows DPAPI: only this Windows user on this PC can decrypt it). If encryption is not available the value is **refused**, never stored in plain text.
- **The page can only write, never read.** `ctx.secrets.set(name, value)`, `clear(name)`, `has(name)` (true or false). There is no way for page code to get a value back. The value crosses to the main process once, when the person types it.
- **Only the plugin's own native code reads it**, through `host.secret(name)` (new on the host helper), and only for names the plugin declared in `plugin.json` `secrets`. A name that is not declared is refused on the three page calls and answers `null` to `host.secret`.
- **Checks on every call:** the sender is Discord's page; `plugin` is a known plugin of the registry; `name` is in that plugin's declared `secrets`; the value is text of 1 to 8192 characters; at most 50 secrets per plugin. Honest limit as in analysis 29: the plugin name in a message is a claim, since all plugins share one page: another plugin could **overwrite or clear** a declared secret of a plugin (it still cannot read it). `has` also leaks only a yes or no.
- **Never** in settings exports, presets or backups (the file is separate), never in the health report, never traced.

## 4. Engine piece B: plugin storage (page side)
- `ctx.storage` with `get`, `set`, `delete`, `keys`, namespaced by plugin id, backed by IndexedDB in Discord's page (Discord removes `localStorage`, which is why Vencord uses IndexedDB too). Values must be plain JSON, at most 1 MB each. A plugin cannot name another plugin's data.
- The IndexedDB part is a thin wrapper tested only with typecheck and a fake: no IndexedDB exists under the test runner and adding a fake IndexedDB package was not done without asking. **Not verified in Discord.**
- It lives in Discord's own browser data, so it is per Discord (Stable and Canary are separate) and it is lost if Discord's data is cleared; the export of favourites is the answer to that.

## 5. The plugin side (new files in `src/testcordplugins/PinterestTool`)
- `settings.ts`: `colorTheme` (select: Pinterest, Blurple, Violet, Cyan, Emerald, Custom), `customAccent` (text, a `#rrggbb`), `appearance` (select: Auto, Dark, Light), `randomizeSearch`, `effectsStep`, `editBeforeApply` (booleans), as in the original.
- `theme.ts`: the original's colour code, ported unchanged in behaviour (accent themes, contrast, readable accent, dark and light palettes, "follow Discord"). Pure, so tested.
- `library.ts`: favourites and recent searches over `ctx.storage`: add, remove, list, with limits the original lacked (300 favourites per kind, 10 recent searches of at most 80 characters), keys that never collide between kinds, and a **checked export and import**.
- **Export format:** `{ "format": "amiricord-pinterest-tool", "version": 1, "exportedAt": ..., "favourites": { "AVATAR": [...], "BANNER": [...] }, "recent": [...] }`. It never contains the cookie. On import, every favourite is rebuilt from a whitelist of fields; image addresses must be https on `i.pinimg.com` or `s.pinimg.com` and the pin page on `www.pinterest.com`; text fields are cut to a length; duplicates are merged; entries over the limit are left out; the answer says how many were taken and how many refused and why. Import never replaces what exists, it adds.
- `plugin.json` declares `secrets: ["pinterestCookie"]`; the native `search` reads the cookie with `host.secret("pinterestCookie")` instead of getting it as an argument (so the page never has it).

## 6. Changes to what step 1 did
- `search` no longer takes `pinterestCookie` in its options; the native side reads the secret itself. A new native function `hasCookie` is NOT needed: the page asks `ctx.secrets.has`.
- `PinterestClient.search` takes the cookie from a function given at creation (`cookie(): string | null`), so tests keep exact control.

## 7. Not verified
- `safeStorage` in Discord's Electron (42.11.15 per the trace): that it is available when the handler runs and that DPAPI works under Discord's process.
- IndexedDB from the page of Discord: that opening a database works there and that it survives restarts.
- That Pinterest accepts a person's own cookie the way the original sent it (it was never exercised in the original either).
- The look of any of it: there is no window yet (step 4).
