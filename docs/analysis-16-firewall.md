# Analysis 16: the firewall, rules and log (piece P4 of design 05)

Written 2026-10-25 before the code. Sources: `design-05-privacy-engine.md` section 6, `analysis-12` (how TestCord's guard decides and what is wrong with it),
`analysis-14` (the request hub), `analysis-15` (NoTrack, the inside-Discord layer). Nothing was run. **Not verified** items are marked.

## 1. What this piece is, and what it is not
NoTrack (P3) stops telemetry **inside Discord**, before a request exists. The firewall stops it **on the network**, in the main process, through the request hub (P2).
Two layers, two sets of counters, never added together (design 05, sections 2 and 6). The firewall is also the safety net when a Discord update breaks a NoTrack patch:
the patch says `no module matched`, the firewall still cancels the request.

P4 is big in design 05 (shields, remote-code guard, link stripper, host rules, log, persistence). **Proposal: cut it into three steps**, each with its own tests and commit:

| Step | What | Changes behaviour of Discord? |
|---|---|---|
| **P4a** | **Request census** (look only) | No. It only counts. |
| **P4b** | **Telemetry shields** (science, metrics, Sentry) + counters "cancelled on the network" + bounded log in memory | Yes: cancels requests that match. |
| **P4c** | **Host rules** (allow/block list, with reasons), persistence, the confirmation for risky rules | Yes, on the owner's request. |

Remote-code guard, link-parameter stripper and the token guard stay for later (P5 and after); they are not mixed into this piece.

## 2. Why a census first (P4a)
Everything we know about the endpoints (`/api/v*/science`, `/api/v*/track`, `/api/v*/metrics`, `sentry.io`) comes from TestCord's patterns and the owner's other project's notes, **not from our own
observation of build 650200**. The same lesson as P3: find the real texts in the real client first, then write rules. The census is a handler on the hub that never answers anything:
- keeps, in memory only, a table: **host, first two path parts (version and name, e.g. `/api/v9/science`), method, resource type, count**, plus first and last seen time;
- **no query values, no headers, no bodies, no full addresses** (the same rule as the log);
- bounded (at most 300 rows; when full, new shapes are counted in one "other" row);
- visible only in development mode, through the same dump route the NoTrack discovery used (a file under the data folder, ignored by git).
The owner runs Canary for a few minutes and sends the file; we check it for personal data before reading it, as with `notrack-discovery.json`.

## 3. The decision table of P4b (data, not code scattered around)
Each row has an **id, a plain-words reason, a matcher, and a counter name**. Rows are checked in this order; the first that matches cancels:
1. **Usage reports ("science")**: host is `discord.com` or a subdomain of it, path is `/api/v<number>/science` or `/api/v<number>/track`, matched as **whole path segments**.
2. **Metrics**: same host rule, path `/api/v<number>/metrics`, `/api/v<number>/metrics/v2`.
3. **Crash reports (Sentry)**: host is `sentry.io` or a subdomain of it (**matched on the parsed host, not on text found anywhere in the address**).
All three rows are **exact**: a path such as `/api/v9/tracking-number` or a query that merely contains the word `sentry.io` must **not** match (TestCord's loose matching is the
defect listed in analysis 12). Final row of the census may add or correct rows; nothing is added from memory alone.

**Fail-open rule:** any error, an address that cannot be parsed, a missing setting, a hub that is not installed: the request goes through. The firewall never makes Discord fail.
**Order with the self-test handler:** the header check keeps looking first (it only reads), then the firewall.

## 4. Settings: one switch, two layers
The existing NoTrack settings (`disableAnalytics`, `disableCrashReports`) are read by the firewall too, so "Block Discord telemetry" (design 05 §9, later in the tab) turns both layers together.
Defaults stay **on**. P4b adds **no new toggle on the page**: turning protection off is a weakening change, and design 05 §10 says weakening changes need the main
process's confirmation, which belongs to P4c/P7. How main reads those settings (the store already lives in main) is checked when coding; **not verified yet**.

## 5. Counters and log
- Counters kept by main: `cancelled` per **shield id** and per **host**, bounded the same way. Only the code that makes the decision changes them; the page cannot (design 05 §10).
- Log: ring buffer in memory, default 500 entries (limits 250 to 10 000 stay for the tab), each entry = time, shield id, host, path shape, outcome. **No query values.**
  Nothing is written to disk in P4b. Nothing is sent anywhere.
- Shown, for now, in the main tab's Engine status as a row **"Cancelled on the network"** (e.g. `12 usage reports, 3 crash reports`), through the engine status the page already
  reads. Needs a read-only message from page to main (trusted sender only, answer rebuilt field by field, like the health events).

## 6. Risks and unknowns
- **Cancelling can change Discord's behaviour:** if Discord retries a cancelled `science` call forever, the log would fill and the CPU could rise. Mitigation: counters never grow memory (bounded), and the traffic check on Canary looks at CPU and at Discord working normally.
- **A path we have not seen yet** (the census may show a differently named endpoint). Handled by the census; rows are data, easy to correct.
- **Sentry through Discord's own tunnel** (reports sent to a Discord address instead of `sentry.io`): **not verified**; the census will show it or not.
- **Websocket and media traffic** is not touched: the hub's filter sees them, rows only match the paths above.
- **Hub order:** the firewall registers after the header check; if the header check is removed (it removes itself after one answer) nothing else changes.

## 7. Tests and checks planned
Fake hub events: each row matches its address and **only** it; look-alike addresses do not match (`/api/v9/tracking`, `/api/v9/science-fair`, `sentry.io.evil.com`, `notsentry.io`, query containing `sentry.io`);
unparseable address passes; disabled setting passes; counters and log are bounded; a throwing matcher is skipped and the request passes; no query value ever reaches the log or the dump. Mutation checks on
every row, on the whole-segment rule, on the parsed-host rule, on fail-open, on the bounds. Real check: the census file from the owner's Canary first; after P4b, Canary traffic check (Discord works, counter grows, no CPU spike).

## 8. Questions for the owners
1. Cut P4 into the three steps above (census first)? **Proposed: yes.**
2. Show "Cancelled on the network" as a row in the main tab now, before the Privacy & Security tab exists? **Proposed: yes**, same style as "Stopped inside Discord".
3. Census dump only in development mode? **Proposed: yes**, and it never leaves the PC.
