# Analysis 12: TestCord's Privacy & Security tab, element by element

Requested by the owner on 2026-10-25 (seven screenshots of the tab running in his PTB). Read only, from the local copy of TestCord
(`C:\Users\<user>\Desktop\testcord`). Nothing was run, installed or fetched. Everything below is described in our own words; Amiricord's
version is written from scratch. This extends section 1 of `analysis-11-testcord-tabs.md`, which only had the outline.

**What was read in full:** `src/components/settings/PrivacySecurityPanel.tsx` (all 1726 lines), `src/main/privacy/trafficGuard.ts` (846),
`src/main/privacy/dnsResolver.ts` (651), `src/main/privacy/ipc.ts` (109), `src/plugins/_core/noTrack.ts` (197).
**Read in part:** `src/testcordplugins/CustomDNS/index.tsx` (first 200 lines of the file plus a search for the fetch rewrite).
**Not read:** `PrivacySecurityPanel.css` (1476 lines, look only), `CustomDNS/native.ts`, the rest of `CustomDNS/index.tsx`.
Where a statement depends on something I could not see running, it says "not verified".

## 1. What is on the screen, piece by piece

### 1.1 Card "Privacy Protection" (top)
A badge says **Active** when "No Tracking" is on and encrypted DNS is applied, and **Partial** otherwise. The text says changes apply at once.

| Row | What it really does | Where it runs | Notes |
|---|---|---|---|
| **No Tracking** | Switches the setting `disableAnalytics` of the `NoTrack` plugin (Vencord's own plugin, kept as a required core plugin). With it on, the plugin patches Discord's analytics store with an empty stub, turns off the metrics timer and counters, and breaks Sentry's own module loader so crash reporting never starts. | Page (patches) | The plugin declares that this setting **needs a restart**, yet the card says "changes apply immediately". Turning it off does nothing until Discord restarts. |
| **Custom DNS** | Turns the encrypted DNS engine of the main process on or off (see 1.2). Also writes `autoStart` of the separate `CustomDNS` plugin. | Main process | Two DNS systems exist in TestCord (this engine and the plugin, which uses plain DNS servers); the tab mixes both, see 2.6. |
| **Rewrite Fetch URLs** | Setting `rewriteFetch` of the `CustomDNS` plugin: replaces the page's `fetch` so the address is swapped for the IP resolved by the plugin. | Page | Marked experimental, "can break HTTPS": an IP in the address does not match the site's certificate name. |
| **Block Tracing** | Cancels requests to Discord's own API whose path ends in `/tracing`. Off by default. | Main (network) | Pattern is a path match on first-party hosts only. |
| **Block RTC Diagnostics** | Cancels call-quality reports (`/rtc/...` or `/voice/...` ending in `quality-report` or `diagnostics`). Off by default. | Main | Does not touch voice itself. |
| **Block Remote Logs** | Cancels uploads whose path contains `debug-log` or `debug-logs`. Off by default. | Main | Local logs stay. |
| **Block Log Buffer Limit** | How many blocked events (and allowed ones) are kept in memory: 250 up to 10 000. The text shows "431/500 active". | Main | The same number caps both lists. The code accepts 50 to 20 000. |

### 1.2 Card "Secure Connect" (left column)
Encrypted DNS: the names of sites (discord.com) are looked up through an encrypted channel (DNS over HTTPS) to a provider the person chooses.
- **DNS provider list:** 18 entries (Cloudflare normal, malware, family; Mullvad adblock, base, extended, family, all; Quad9 and Quad9 ECS; AdGuard default, family, unfiltered; Google; Control D unfiltered and malware; OpenDNS Home and FamilyShield). Each has a DoH address, a plain IP and a DoT name. A function to add a custom provider exists in the main process, but **the tab has no field to use it**.
- **How it is applied:** `app.configureHostResolver` with `secureDnsMode: "automatic"` and the chosen address. "Automatic" means Chromium tries the secure server and **falls back to ordinary DNS** if it fails. The tab says so ("with plain DNS fallback"). Before applying, TestCord checks the provider by asking it for `discord.com` with a 2 second limit; if the check fails, it keeps the system resolver and says why.
- **Status table:** *Engine* (main resolver, or the plugin), *Encrypted DNS* (applied / unavailable with the reason / disabled), *Endpoint* (the DoH address), *Cache* (entries), *Native calls* (counter of the plugin).
- **Buttons:** *Test DoH* (reach the endpoint and resolve discord.com), *Test DoT* (open a TLS connection to port 853 of the provider's plain IP and ask for discord.com), *Test Automatic* (both), *Stop* (cancel the running test), *Refresh* (read data now), *Clear Cache*.
- **Console:** the last 4 of up to 100 lines of messages from the engine and the tests.
- **Not shown in the tab although the code has it:** latency of every provider (`pingAllLatencies`), custom endpoints, cache time-to-live setting.

### 1.3 Card "Outbound Surfaces" (left column)
A table of **six route groups**, written by hand in the code (Discord API and gateway, Discord media and assets, Secure Connect resolver, AI provider APIs, Optional plugin services, Badge Spoofer). Each has hosts, a state word (Monitored, Active, On demand, Plugin controlled, Permitted) and a description. Three small numbers on top: *Mapped* (how many groups), *Allowed* (size of the allowed-requests list, click to open a window), *Blocked* (blocks counted inside the groups). Clicking a group opens the allowed-requests window filtered by that group (search, route filter, clear).
- It is an **inventory written by the authors**, not a measurement: the footer says it makes no test requests. A plugin that talks to a host nobody listed shows up as "Outbound".
- In the screenshot the numbers were Mapped 6, Allowed 2, Blocked 0 on a running Discord. The code puts every request that reaches the end of the handler into the allowed list, so 2 looks low; **I could not explain it from the code (not verified)**.

### 1.4 Card "Privacy Suite Protection" (right column)
- **Eight counters:** *Total blocked*, *Headers stripped*, *Tracking*, *Network*, *Tokens*, *Webhooks*, *Remote code*, *Link trackers*. "Network" is just the sum of the three telemetry kinds again, so it repeats *Tracking*, *Sentry* and *Metrics* (the first two of which are not even shown separately). "Tracking" also includes tracing, RTC and remote-log blocks.
- **The big numbers are mostly not network blocks.** The 431, 434, 436... in the screenshots grow by themselves and every entry reads "Discord analytics event blocked, `renderer-patch`, `testcord://renderer-patch/tracking`". That address is made up by the code: NoTrack listens to Discord's internal `TRACK` events inside the page and reports one count per event. So the number says "Discord tried to record N analytics events, which NoTrack dropped inside the page", not "N requests were cancelled on the network". Honest enough in the detail window, confusing in the headline.
- **Covered Surfaces:** twelve clickable chips (Science, Analytics, Metrics, Sentry, Token Guard, Webhook Guard, Remote Code Guard, Fetch/XHR/Beacon, Link Tracker Stripper, Tracing, RTC Diag, Remote Logs). Blue means on. "Science" and "Analytics" are **the same switch** (`scienceAnalytics`); clicking either flips both. The last three are the experiments of 1.1 (the same switches in two places).
- **Recent Blocks:** search box; events grouped by site and action ("x436"), four groups per page, Prev/Next/page number; **Export JSON** and **Export CSV** save the whole list (full URLs, including the part after `?`).
- **Detail window of one block:** explanation of the kind of block, action, category, "caught by", domain, **reputation** (Discord / Trusted CDN / Third party / Untrusted third party, from a short list in the code), the host rule in force, outcome, time, id, the URL cut into scheme/host/port/path/query, and buttons **Allow this host**, **Always block this host** (or Clear host rule) and **Copy details**.
- **Security alert banner** (only appears when needed): "Dismiss all". Raised by the remote code guard (3.2).
- **Connection issue banner:** shown when the tab cannot reach the main process; it retries every 2 seconds.

### 1.5 Where the rules are managed
There is **no list of host rules** anywhere. A rule can only be created from the detail window of a block, and it can only be cleared from the detail window of a block for that host (so a rule for a host that stops appearing in the log cannot be found again). Rules live in `TestCordHostRules.json` (user data folder), together with the shield states and the log limit.

## 2. How it works inside (the traffic guard)

Everything runs in the main process on `session.defaultSession.webRequest`, so it sees every request of every window. Two hooks:

**Before the request (`onBeforeRequest`), in this order:**
1. Not http/https: let through.
2. **Host rule "block"** for the host (or a parent domain): cancel.
3. **Remote code guard** (third-party host and a path ending in `.js .mjs .cjs .wasm .ts`): if a path segment equals one of 13 words (`rat`, `stealer`, `keylogger`, `grabber`, `tokengrab`, `token-grab`, `webhookspam`, `nitrogen`, `exfil`, `backdoor`, `trojan`, `infostealer`, `discordrat`), cancel and raise a **security alert** (also pushed to open windows); otherwise write a "Remote Code Observed" line in the blocked log and let it through.
4. **Badge Spoofer exception:** a request to a Discord API address whose text contains `source=badge_spoofer` (or `badge_spoofer=true` or `=1`) is let through before any shield looks at it.
5. **Telemetry shields**, each owning its pattern: `/science` or `/track` in the path (science/analytics), `/metrics`, `sentry.io` anywhere in the address, and the three experimental ones; plus a "residual" rule (`/api/v*/science`, `/api/v*/track`, `/api/v*/metrics`, `sentry.io`) under the Fetch/XHR/Beacon shield. A match cancels the request and counts it.
6. **Webhook guard:** any address containing `/api/webhooks/` is only logged ("monitored") and let through. It does not guard anything.
7. **Link tracker stripper:** only for pages the person opens (top-level navigations) on third-party hosts: removes ~70 known tracking parameters (utm_*, gclid, fbclid, msclkid, igshid, ...), keeps `si` on YouTube and Spotify, and redirects to the cleaned address. It is an allow-list of names, so it never removes a parameter it does not know.
8. Everything else: counted and written to the **allowed log** (method, type, route group, full address).

**Before the headers are sent (`onBeforeSendHeaders`) = Token Guard:** if a request to a **non-Discord host** carries an `Authorization` header, the header is removed, unless the host is on a list of ten exempt hosts (Spicy Lyrics, LRCLIB, Spotify, OpenAI, Groq, Anthropic, Google's language API, GitHub, Yandex Music), or the person set "allow" for that host. A host with rule "block" is cancelled earlier anyway.

**Page to main process** (`ipc.ts`): 16 channels (read all data, set the log limit, clear logs, host rules, acknowledge alerts, toggle a shield, DNS choose/enable/custom/ping/test/stop/clear cache, increment a counter, post science events).

## 3. Findings (what is good, what is wrong or weak)

### 3.1 Good ideas worth keeping
- One place that shows what the client talks to and what was stopped, with reasons.
- Each shield separate and explained; the "caught by" and the plain explanation per kind of block.
- Allow-list (not deny-list) for removing link parameters, with per-host exceptions.
- DNS verified before it is used; honest "with plain DNS fallback" wording; test buttons.
- Reputation label and a button "Allow / Always block this host" right at the evidence.
- Remote-code alert pushed at once instead of waiting for the next refresh.

### 3.2 Problems
1. **Anyone can talk to the privacy service.** `ipc.ts` never checks who is asking: any page code, including any plugin, can create "allow" rules (so the token goes to any host), turn shields off, **inflate the counters** (`incrementCounter`) or call `postScienceEvents` with the account token. Amiricord already answers only trusted Discord pages (`isTrustedSender`); the plugin boundary needs its own permission (a plugin must not reach these controls).
2. **A hole by design:** the Badge Spoofer exception lets any Discord API call that says `badge_spoofer` in its address skip every telemetry shield. And `postScienceEvents` sends forged analytics events to Discord **with the account's token, cookie and super-properties**: a terms-of-service risk. Amiricord has nothing like it.
3. **The headline numbers mislead** (1.4): internal events counted as blocks, a repeated "Network" counter, "Science" and "Analytics" as two chips for one switch.
4. **"Changes apply immediately" is not always true** (No Tracking needs a restart).
5. **Badge says "Active/Partial" by mixing two unrelated things** (tracking and DNS).
6. **Names are insider words:** "Covered Surfaces", "Outbound Surfaces", "Suite", "Native calls", "Engine: Main resolver".
7. **Matching by text is loose:** `sentry.io` anywhere in an address (even in a query), `/track` matches `/tracking`, `/science` matches longer words; `Webhook Guard` is not a guard.
8. **The logs keep full addresses with their query values**, including the "allowed" list (every request), and the export writes them to a file. Query values can hold secrets.
9. **The allowed list and the blocked list are memory only, polled every 2 seconds**, while the tab is open. A push of changes is cheaper and quicker.
10. **Files:** host rules + shields + log limit live in one file next to the DNS settings in another (`privacy.json`), written without a temporary file; a crash while writing can leave a broken file (the code then starts clean, which silently turns shields back to defaults).
11. **DNS verification asks for the JSON answer format** (`Accept: application/dns-json`). Not every provider answers it on the address listed (I believe Quad9 and Mullvad serve the standard binary format on that address; **not verified, needs a real test**). If so, picking those would show "could not verify" even though the provider works. The standard (RFC 8484) binary query works with all of them.
12. **The DNS "Cache" and "Native calls" numbers are not about real traffic.** The real lookups are done by Chromium's own resolver after `configureHostResolver`; the cache shown belongs to TestCord's helper used by the test buttons and by the plugin. In the screenshot they read 0 and 0 while encrypted DNS is "Applied".
13. **Two DNS systems** (engine and plugin) and a tab that reads both.
14. **No list of host rules**, no way to add a host by hand, no way to see which plugin made a request.
15. The tab polls and re-renders everything every 2 seconds; the file is 1726 lines because each control is built by hand.

## 4. What Amiricord should do (recommendations)

### 4.1 Keep (rewritten from scratch)
Shields with plain explanations; token guard; link-parameter stripper (opt-in, allow-list); blocked and allowed logs with search, export and per-site rules; reputation; encrypted DNS with verification and tests; alerts.

### 4.2 Change
- **Build the "who may talk to whom" from the plugin manifests.** Every plugin already declares its hosts and reasons (`plugin.json`). The outbound table becomes **live truth**: Discord, then each plugin with its declared hosts, plus anything seen that nobody declared (a flag). TestCord's hand-written six-row table goes away.
- **Token protection by construction**, not by a list of exempt hosts: only Discord's own code and plugins with a declared token permission can send it.
- **Separate what is stopped where:** "stopped inside Discord (never created)" versus "cancelled on the network". Two numbers with two names, never added together without saying so.
- **Match by parsed host and path** (not by text in the address); every pattern in a data table with a name and a reason.
- **Logs without query values by default** (host, path shape, category, time); full addresses only if the person turns it on; export asks first and says what it contains.
- **Push updates** (events), no 2 second polling.
- **One DNS engine** in the main process; providers as data; standard binary DoH for verification; both modes selectable: *Automatic* (falls back to normal DNS, default) and *Strict* (never falls back); one custom provider field; latency shown per provider.
- **Atomic, validated files** (same helper as the other settings) and **sender check** on every channel, plus the extra rule that plugins cannot reach privacy controls.
- **Honest wording:** if a switch needs a restart, say so next to it (the "Restart" tag we already have).
- Offer **"Pause protection for 10 minutes"** for troubleshooting (a lot of "it stopped working" reports come from filters).
- **Self-test card:** `has_client_mods` is false, no known telemetry host contacted in the last N minutes, encrypted DNS verified now. A green or yellow result with the reasons.

### 4.3 Add (not in TestCord)
- A **per-plugin view**: which hosts each plugin may contact and how many requests it made.
- **Host rules list** with add, change and remove, and why each exists.
- **"Why" on every switch**: what turning it off lets through.
- **Presets in plain words**: *Recommended* (telemetry, token and DNS guards), *Maximum* (adds the experiments), *Off* (with a warning).
- **Safe-mode link:** if the engine is in safe mode, show it here too.

### 4.4 Leave out
Badge Spoofer route and the forged science events; fetch URL rewriting (breaks HTTPS and TestCord itself calls it experimental); the "reputation" list of two or three hand-picked hosts (replace by manifest data); the fake `testcord://` addresses.

## 5. A friendlier order (proposal)

TestCord's order follows the code (cards of one engine), not what a person wants to know. Proposed, top to bottom:

1. **Summary card** (the answer first): one line "Your privacy is protected / partly protected" with three numbers: *telemetry stopped this session*, *hosts contacted*, *encrypted DNS: on/off*, and the self-test result with a "Details" link.
2. **Telemetry** ("Stop Discord from collecting data"): one master switch "Block Discord telemetry" (this is the same setting as the switch in the main tab) and under it the individual items in plain words, each with a sentence: usage reports (Science/Analytics), crash reports (Sentry), metrics, and the experimental ones (tracing, call diagnostics, remote logs) under a small "Experimental" label.
3. **Your account** ("Keep your login safe"): never send my token to other sites; stop programs from fetching code from unknown sites; remove tracking parameters from links I open.
4. **Who the client talks to:** Discord, then each plugin with its declared hosts and how many requests; unknown hosts flagged; click a host for its rule and its log.
5. **Activity:** recent blocked and allowed events (search, filter by site or by plugin, export), collapsed by default.
6. **Encrypted DNS** (own card, collapsed under "Advanced" unless it is on): switch, mode (Automatic or Strict), provider, status, latency, the test buttons and the console.
7. **Advanced:** log size, host rules list, pause protection, reset to defaults.

Alerts and the connection banner stay on top, over everything.

## 6. Engine pieces this needs, in a sensible order
1. **Request rules table and log** in the main process (parsed host and path, data table of patterns, counters of the two kinds), with the sender check.
2. **Token guard by manifest** and the plugin host allow-list (needs the manifest data in the main process; the build already produces it).
3. **NoTrack as a core plugin** (rewritten; includes the mod-detection patch; reports counts as "stopped inside Discord").
4. **Encrypted DNS** (providers as data, binary DoH check, both modes, tests).
5. **The tab itself**, in the order of section 5, built on the common components layer.
6. Link parameter stripper and remote-code alerts (smaller shields, each with its table).

## 7. Open decisions for the owner
1. Is "Block Discord telemetry" the master switch of the whole telemetry group (the main-tab switch and this tab show the same setting)?
2. DNS default mode: Automatic (falls back to normal DNS) or Strict?
3. Keep the experimental telemetry blocks (tracing, call diagnostics, remote logs) and, if so, off by default as in TestCord?
4. Logs: do they keep query values if the person asks? (Default proposed: no.)
5. Presets *Recommended / Maximum / Off*: yes or no?
6. Order of work: start with the engine pieces (1 to 3 above) or with the screen?
