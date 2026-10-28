# Analysis 19: the token guard and the CSP (piece P5 of design 05)

Written 2026-10-25 before the code. Sources: `design-05-privacy-engine.md` section 7, `design-01-manifest-permissions.md` (the `permissions` of a manifest), `analysis-12-privacy-security-tab.md` (how TestCord's token guard works and where it is weak),
`analysis-14-request-hub.md`, `analysis-16-firewall.md` and the real census of Discord Canary (builds 650200 to 650267, `probe/census*.json`). Nothing was run for this note. **Not verified** items are marked.
The numbers 18 and up are shared between the two owners; 18 is reserved for the Plugins tab (`analysis-18-plugins-tab.md`, Neversleeper), this one takes 19.

## 1. What this piece is for
The **token** is the secret that keeps the account logged in. Discord sends it in the `Authorization` header of its API requests. Anything that gets it can act as the account, so the engine must make sure it only goes where it should.
P5 has two parts that share one source of truth, the **manifests** of the enabled plugins:
- **Token guard (main process):** the `Authorization` header is removed from any request whose host is not Discord's and not a host that an **enabled plugin that declares `permissions.token: true`** declared in its `permissions.network`.
- **CSP (main process):** the `Content-Security-Policy` of Discord's pages is rebuilt from the hosts the enabled plugins declared for the page ("renderer"), with **no external source for scripts**.
The point is "by construction": there is **no list of exempt hosts written by hand** (TestCord has ten: music, AI and code hosting services, plus a per-host "allow" the page can set on its own word).

## 2. What exists today, and what does not
- **Manifests carry what is needed:** `permissions.token` (true or false), `permissions.network` (hosts, each with `from` and `why`). Both core plugins declare `permissions: {}` (no network, no token). **No plugin today needs the token or a host**, so the guard has no exception to make yet and the CSP has nothing to add yet.
- **The main process does not read the registry yet.** The build writes `dist/registry.json`; the page reads it, main does not. Main also does not know which plugins are enabled (the page computes that with `computeEnabledSet`, a shared function that main could call with the registry, the saved choices and the boot state). **Design rule (design 05, section 10): protection is never weakened on the page's word.** So main must compute the set itself.
- **The request hub has no `onHeadersReceived` yet** (the CSP needs it) and the census does not look at headers at all (on purpose).

## 3. What we do not know yet (so the first step is to look)
1. Does Discord send `Authorization` to any host that is not its own? **Expected: no. Not verified.** Our census keeps no headers.
2. Does Discord's own page ever need an exception (a partner host that really gets the token)? **Not verified.**
3. What exactly is in Discord's CSP today (its `connect-src`, `img-src`, `script-src`), and does the header change between builds? **Not verified.** It is read from a real response, in development mode.
So P5 starts with **observation, as P4 did**, then the guard, then the CSP when there is a plugin that needs it.

## 4. Cut into steps
| Step | What | Changes behaviour? |
|---|---|---|
| **P5a** | **Census of the token** (development mode only): for each row of the census, how many requests carried an **`Authorization` header** (only the fact, never the value), and in total how many carried it to a host that is not Discord's. **The names of the CSP directives Discord sends moved to P5c** (owners' OK, 2026-10-25): reading them needs the hub to handle `onHeadersReceived` and chain Discord's own listener on that event, which is the same work P5c needs, so it is done there. | No. It only counts. |
| **P5b** | **Token guard:** main reads the registry and computes the enabled set itself; the hub's header step removes `Authorization` from every request whose host is not allowed; counter "token stripped" and a log line (host and shape only). | Yes, only for requests that carry the token to a stranger. |
| **P5c** | **CSP from manifests:** `onHeadersReceived` in the hub; the policy is Discord's own plus the hosts enabled plugins declared for the renderer; shown in the tab; no external script source. | Yes. **Postponed until a plugin declares a renderer host**, because today there is nothing to add and rewriting Discord's CSP without a reason is a risk with no gain. |

## 5. The rule of the guard (P5b)
For a request with an `Authorization` header (any case of the name):
1. Parse the address. Not `http` or `https`: let it through (no header judgement).
2. The host is Discord's (`discord.com`, `discordapp.com`, `discordapp.net`, `discord.gg`, `discord.media` and their subdomains, the same list as the host rules) → keep the header.
3. The host is the declared host (or a subdomain, if the plugin said `*.domain`) of an **enabled** plugin with `permissions.token: true` → keep the header.
4. Otherwise **remove the header and let the request go on** (the request is not cancelled), count it and log it.
Failing closed would break pages; failing open would leak the token. Here the failure is decided so: **any error while judging removes the header** for non-Discord hosts (it can only make a stranger's request fail) and leaves it for Discord's hosts (so Discord never breaks). A missing or damaged registry means "no plugin may receive the token".

**Limits to say out loud (the tab will say them):**
- It guards the **header** only. A plugin that reads the token in the page and puts it in a URL, a body or a message is not stopped by this; that is what the permission, the manifest review and the risk label are for.
- The page is shared by all plugins, so main cannot tell **which plugin** made a request. A plugin with `token: false` could send the token to the declared host of **another** enabled plugin that has `token: true`. Closing that needs the engine to give plugins their own network calls (a design to come), not more header rules. **Not solved here.**
- Discord's own gateway sends the token inside a WebSocket message, not in a header. Not covered, and not needed for stranger hosts (none is expected).
- Cookies are not touched.

## 6. Data and files
- No new file is written by P5a or P5b. The allowed hosts are **derived** each start (and when plugins are switched on or off) from the registry and the enabled set; nothing the page sends changes them.
- New counter kind **"token-stripped"** next to the shields, shown as a row in the main tab ("Token kept safe": `N requests had the token removed`). Counts only; same bounded log as P4b.
- New read-only data for main: the registry (`dist/registry.json`), read by main with the same checks the page uses (a damaged file gives "no plugin may receive the token" and a problem in the engine status).
- Files touched are shared core: `src/shared/enabledSet.ts` is used by main (read only), `scripts/build/generate.ts` may need to put the token and network fields in the registry view that main reads. **Told to the other owner before it is joined** (see `docs/collaboration.md`).

## 7. Tests and checks planned
Without Discord or Electron: the host test (Discord hosts and look-alikes such as `discord.com.evil.test`, `notdiscord.com`), declared hosts and `*.domain` for enabled and disabled plugins, `token: false` plugins, the case-insensitive header name, a header value never kept, a throwing judge, a damaged registry, requests that are not http, counters and log bounded and holding no header value. Mutation check on each step of the rule (the order, "remove on error", "keep for Discord on error", "a disabled plugin gets nothing").
Canary check: P5a census says whether any non-Discord host receives `Authorization` (expected none). For P5b, because no real request carries the token to a stranger, a **development-only** trigger sends one request to an address that is not Discord's with a **fake** `Authorization` value (never the real token), and the counter must go up while Discord keeps working.

## 8. Questions for the owners
1. Remove the header and let the request go on (proposed), or cancel the whole request?
2. Start with the observation step P5a (proposed) and postpone the CSP (P5c) until a plugin needs a renderer host?
3. The guard reads the registry in main: is it fine that the build's registry view gains the token and network fields (a small shared-core change, to be told to Neversleeper)?
4. The tab row "Token kept safe" in the main tab now, as with the firewall (proposed)?
