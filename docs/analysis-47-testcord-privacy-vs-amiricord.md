# Analysis 47: TestCord's Privacy & Security tab against ours, and what would make ours better

Written 2026-10-26 for szlcx404, who asked for a deep comparison ("quiero mejoras para que sea mejor que TestCord"). Read-only: the files of the local clone of TestCord (`Desktop\testcord`, commit `af92dbaec`, 2026-10-19, not fetched since) were read in our own words; nothing was run, nothing was copied. What was NOT read or checked is listed in section 9.

## 1. What was read in TestCord

| File | Lines | How much was read |
|---|---|---|
| `src/main/privacy/trafficGuard.ts` | 846 | all of it |
| `src/main/privacy/ipc.ts` | 109 | the list of channels |
| `src/main/privacy/dnsResolver.ts` | 651 | the provider table, the list of members, the diagnostic and the provider check (by search, not line by line) |
| `src/components/settings/PrivacySecurityPanel.tsx` | 1726 | the state it keeps, the headings, the first card in full, the labels of the others (by search) |
| `tests/privacyProtections.test.ts` | 187 | not read (size only) |
| `PRIVACY_POLICY.md` | 1 | size only |

## 2. How TestCord's firewall works (read in full)

One handler on `webRequest.onBeforeRequest` for all web addresses, and one on `onBeforeSendHeaders`. In order:

1. **Host rules** (the owner's `allow` / `block` per host, saved in `TestCordHostRules.json` together with the shield switches and the log size): a `block` cancels at once.
2. **Remote-code guard.** For a request to a non-Discord host whose path ends in `.js .mjs .cjs .wasm .ts`, the path segments are compared with a list of words (`rat`, `stealer`, `keylogger`, `grabber`, `nitrogen`, `exfil`, `backdoor`, ...). A hit cancels the request and raises an alert pushed to the open windows; no hit is logged as "observed" and let through.
3. **Telemetry shields.** Each is a separate switch: usage reports (`/science`, `/track` under a Discord host), metrics (`/metrics`), crash reports (any address containing `sentry.io`), plus three that are OFF by default: tracing (`/tracing`), call-quality diagnostics (`/rtc|voice/quality-report|diagnostics`) and remote debug logs (`/debug-log(s)`). A fourth, "Fetch/XHR/Beacon", is a net for leftovers (the same patterns by substring or by wildcard over the whole address).
4. **Webhook guard.** A request to `/api/webhooks/` is only counted and logged, never stopped.
5. **Link-tracker stripper.** For a navigation of the main frame to a non-Discord host, a fixed list of 49 tracking parameters (`utm_*`, `gclid`, `fbclid`, `msclkid`, ...) is removed and the request is redirected to the clean address. `si` is kept on YouTube and Spotify.
6. **Token guard** (`onBeforeSendHeaders`): the `Authorization` header is removed from requests to non-Discord hosts, except an exempt list written in the code (ten hosts: music-lyrics, Spotify, several AI services, GitHub, a Yandex music API). An owner's `allow` rule keeps the header on that host; a `block` rule removes it even on a Discord host.
7. **Everything else** is let through and written to a second log of ALLOWED requests, grouped into six "outbound route groups" with a counter each.

Logs: blocked events (default 500, the owner can set up to 20 000), allowed events (same size), alerts (100). All in memory.

## 3. How TestCord's tab looks (headings and state)

- **Privacy Protection**: badge, switches No Tracking, Custom DNS, Rewrite Fetch URLs (experimental, its own text says "can break HTTPS"), the three experimental shields, the log-size dropdown.
- **Secure Connect**: provider dropdown, status lines (encrypted DNS, native calls), buttons Test DoH / Test DoT / Test Automatic / Clear Cache, a diagnostic log, cache numbers (size, time to live, hits, misses), latency of every provider.
- **Outbound Surfaces**: the six route groups with counters; a click opens an inspector with every allowed request.
- **Privacy Suite Protection**: eight counters, the covered-surfaces pills (each one switchable), recent blocks with search, pages and a detail window per event, and the host rules.
- **DNS**: 18 providers (Cloudflare three variants, Mullvad five, Quad9 two, AdGuard three, Google, Control D two, OpenDNS two), custom endpoints, an **Automatic** mode only (no Strict mode was found in the files read).

## 4. What is better in Amiricord (checked in our own code)

| Point | TestCord | Amiricord |
|---|---|---|
| How an address is matched | substring of the whole address (`sentry.io` anywhere, a word in a path) | the parsed host and the whole path, exact (`sentry.io.evil.test` does not match); every rule says how much of it was really seen (`seen`, `partly`, `not-seen`) |
| Who may get the account token | everyone except an exempt list written in the code | only Discord and the hosts that an ENABLED plugin declared with `permissions.token`; nothing else |
| Who changes protection | the page asks the main process by IPC and the change is applied | the page cannot change protection on its own word: a change that weakens it is confirmed in a window of the main process |
| What the log keeps | the full address of every event, query included | never a query, a header, a body or an id |
| If a check fails | not stated in what was read | fail-open by design, and it says so |
| Encrypted DNS | Automatic only | Automatic and **Strict** (never falls back), a provider is verified before it is used |
| Plugins' own requests | not seen | requests of main-process plugin code go through our helper, obey the owner's blocked sites and are counted |
| Pause and reset | none found | pause ten minutes, reset to defaults, both confirmed |
| Tests | one small file | the privacy engine has many (the suite is about 1980 tests) |

## 5. What TestCord has that we do not (the real gaps)

| # | Gap | Worth it? |
|---|---|---|
| G1 | **A view of what is ALLOWED**: where the client talks to, not only what we cancelled. | **Yes, the biggest one** (section 6.1) |
| G2 | Three more shields (tracing, call-quality diagnostics, remote debug logs). | Only with proof (section 6.4) |
| G3 | Link-tracker stripper. | Doubtful (section 6.5) |
| G4 | Remote-code guard by keywords. | **No** (section 6.6) |
| G5 | Webhook guard (observe only). | No: it only counts |
| G6 | More DNS providers, **custom endpoint**, "test all" with latency, DoT test, cache numbers. | Partly (section 6.3) |
| G7 | Log size setting. | Small, cheap |
| G8 | Detail window per blocked event. | Small, cheap |
| G9 | Pushed alerts. | Only for the new-host notice (6.2) |
| G10 | Rewrite fetch URLs to resolved addresses. | **No**: its own text admits it can break HTTPS |
| G11 | A carve-out that lets spoofed game-time telemetry through to Discord. | Not relevant, not wanted |

## 6. Proposals, in the order I would do them

### 6.1 Allowed-traffic ledger by host ("Where this client talks to")
- What: a list of the HOSTS the client talked to this session, with a count, the first and last time, and a label: **Discord**, **declared by plugin X**, or **not known**. No address beyond the host, no query, no body.
- Why it is better than TestCord's inspector: theirs stores every full address (query included) of up to 20 000 requests; ours would store host and count only, which is enough to answer "who does my Discord talk to".
- It is **exact**: it is about hosts, so it needs no guess about which plugin made a request.
- Basis already in the code: the request hub sees every request and `census.ts` already counts shapes of requests for development; this makes a small, bounded, in-memory version of it visible to the owner.
- Not verified: how many different hosts a normal session shows (the census files of earlier sessions could answer this), and the cost of counting every request.

### 6.2 Notice for a host never seen before
- What: the first time the client talks to a host that is not Discord's and not declared by an enabled plugin, one line appears in the tab ("first request to `example.test`"), and the tab can offer **Block this site** (the editor we already have).
- It is exact (a host, not a plugin) and it is the part of TestCord's "alerts" that is actually useful: theirs fire on a guessed word; this fires on a fact.
- Risk: noise at the start of a session (many new hosts). Mitigation: a first-run list of what Discord normally uses, built from a real census, so only the unexpected shows.

### 6.3 DNS: custom provider and "test all"
- Custom endpoint: the owner types an `https` address; it is verified exactly as the built-in ones are before it is used (the `custom` field already exists in `dns.json`).
- "Test all": the latency of the four providers side by side, so the choice is not blind.
- Filtered variants (malware / family): cheap, but the owner already judged them low value; they only widen a table.
- Not done on purpose: DoT (a second protocol with its own failure modes) and a DNS cache of our own: Chromium already caches.

### 6.4 More shields, but only with proof
TestCord's three extra shields are addresses guessed from patterns. Our rule is that a shield needs evidence from a real census. Proposal: use 6.1 as a **census helper**: when the owner has the ledger open, an address shape that looks like `tracing` or `debug-log` can be spotted and, if it really appears, a shield is added with `evidence: "seen"`. No shield is added from TestCord's notes alone.

### 6.5 Link-tracker stripper: do not copy as it is
TestCord does it in the network layer, only for navigations of the main frame. Discord opens links in the user's browser, so that code may almost never run. Before anything is built: check, in a real session, whether a click on a link ever reaches `mainFrame` in the app. If it does not, the useful version is a small patch at the point where the client opens a link, which is a bigger piece. Not proposed now.

### 6.6 Remote-code guard by keywords: no
A script called `rat.js` is blocked, one called `r4t.js` is not; a harmless `rat` library is blocked. It gives a feeling of safety that it does not deliver. What protects the owner in our design is stronger: plugins can only reach hosts they declared, and the token goes only where declared.

### 6.7 Small and cheap
Log size setting (50 to 5000), a detail window for each recent block (host, shield, reason, how sure we are of the rule, the time). Both are plain tab work, no new risk.

## 7. What I would NOT do
- Attribution of a request to a plugin from the page (`who made this`): already judged impossible to make exact, since all plugins share one page.
- Copy anything that sends data to Discord on the owner's behalf (G11).
- Rewrite fetch URLs (G10).

## 8. Suggested order
1. 6.1 and 6.2 together (same data), as one piece: analysis detail, code, tests.
2. 6.3 (custom provider, test all).
3. 6.7.
4. 6.4 and 6.5 only after a real session shows evidence.

## 9. Not read or not verified
- The body of `PrivacySecurityPanel.tsx` beyond the first card and the headings (the detail window, the host-rules editor, the diagnostic log); the CSS; `tests/privacyProtections.test.ts`; most of `dnsResolver.ts` (how resolution is done, what the fallback does on failure); how TestCord's renderer-side code reports to the guard (`incrementCounter`); how "Rewrite Fetch URLs" works.
- Whether TestCord's DNS really has no strict mode (a search for the word found nothing, but the file was not read line by line).
- Everything I say about OUR tab comes from this session's work and the code I know (`firewall.ts`, `tokenGuard.ts`, `tokenHosts.ts`, `shields.ts`); I did not re-read the whole tab for this note.
- TestCord's code is of 2026-10-19; it may have changed.
- None of the proposals has been tried in a real Discord. The size of 6.1 and 6.2 depends on the census numbers in 6.1, not yet seen.
