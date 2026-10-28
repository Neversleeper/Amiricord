# Analysis 24: the "Recent blocks" list of the Privacy & Security tab (P7c)

Written on 2026-10-26 for the owners' approval. No code yet. The owner asked for a list like TestCord's "Recent Blocks" (title with a count, where it came from, a tag, a BLOCKED badge, how long ago,
a search box, pages, Export JSON and Export CSV), and chose to build it before the editor of blocked sites (`analysis-23-blocked-sites-editor.md`, kept for later), because the list is what
shows a person which sites exist to be blocked. Everything is written from scratch. TestCord is only a reference for what a person wants to see (`analysis-12`, section 1.4).

## 1. What exists (checked in the code)

| Piece | Where | State |
|---|---|---|
| Log of what the network firewall cancelled | `src/main/firewall.ts`: `log()` keeps the last 500 entries `{ at, shield, method, host, path }` in memory | **exists, nothing reads it yet**. `path` is already a *shape* (`pathShape` of the census: numbers and long ids replaced), never a query, header, body or id |
| Token guard | `src/main/tokenGuard.ts`: counts `inspected`, `kept`, `stripped`, **and** a log of the last 500 removals `{ at, method, host, path shape }` | exists, nothing reads it yet (correction made while building: the first version of this note said the guard had counts only; it has the log) |
| What NoTrack stops inside Discord | page: `privacy.stopped(kind)` counts per kind | counts only, no time |
| The snapshot of the tab | `privacy` channel, asked every 2 seconds while the tab is open | has counters, no list |

So most of the work is **showing** what the firewall and the token guard already keep, plus one small addition (a time for the inside-Discord counts).

## 2. What the list shows

One line per **group**: the same kind of block to the same host and path shape, with a count and the time of the last one. Sorted newest first. Each line:

- **Title** in plain words from the kind ("Usage report to Discord blocked", "Metrics report blocked", "Crash report blocked", "Telemetry ping blocked", "Blocked by your rules", "Token removed from a request") and **×count** when more than one.
- **Where:** the host (and the path shape under it), in small type.
- **Tags:** the kind (`USAGE`, `METRICS`, `CRASH`, `PING`, `YOUR RULE`, `TOKEN`) and where it was stopped: `NETWORK` or `INSIDE DISCORD`.
- **Badge:** `BLOCKED` for a cancelled request, `STRIPPED` for a token removal (the request went on without the token, so it must not say blocked).
- **Time:** "7s ago", worked out by the main process as an age in milliseconds when it answers, so a difference between the clock of the page and the clock of the main process never shows.

Around the list: a **search box** (filters by host, title and tag, in the page, nothing sent), **pages** (proposed 8 groups per page, with Prev, Next and the page number), and **Export JSON** and **Export CSV**.

**Inside Discord.** NoTrack's counts become one group per kind ("Usage events stopped inside Discord ×212") with the time of the last one, tagged `INSIDE DISCORD`. They have no host and no path. They are **not mixed into the network groups and not added to them** (the two counters rule).

## 3. What is kept, and what never is

- Memory only, bounded (500 firewall entries, 500 token-guard entries), gone when Discord closes. Nothing written to disk by the log itself.
- Host, path shape, method, kind, count, time. **Never** a query, a header, a body, an id, a token, or the value of anything. Path shapes replace numbers and long ids (already so in the firewall).
- Token guard log (already there): the **host** and the path shape of the request that had its token removed, the method, the time. Never the token, never the header's value.
- The page can only read. It cannot add, edit or delete an entry; counts change only in the code that cancels the request.

## 4. How it reaches the tab

- The snapshot gets one number, `logVersion` (it grows when an entry is added). The page asks for the list through a new read-only channel `privacy-log` **only when that number changed** and the tab is open, so a quiet session sends nothing.
- The answer is rebuilt field by field in the page (limits on every text, a maximum of 200 groups, kinds from a fixed list, ages as numbers), like every other answer.
- Page, search and pages are page code; the data is the main process's.

## 5. Export

The page does not make the file. A new change `export-blocks` (kind JSON or CSV) goes through the confirmed channel of P7b; the **main process writes its own data** into an `exports` folder inside that Discord's data folder (`recent-blocks-<time>.json` or `.csv`, through the same temporary-file-and-rename writer) and answers with one sentence saying the file name and that it holds only host, path shape, kind, count and time, **no query values**. The tab then offers the existing "Open settings folder" action. Reason: a download made by the page (a link with a file name) is not verified to work inside Discord's window, and this way nothing the page could tamper with ends up in the file. Writing a file the person asked for adds nothing that weakens protection, so it needs no question.

## 6. Not in this step

Pause protection for ten minutes and reset to defaults (they appear in the Activity card as "later"); a log size setting (fixed at 500, as TestCord's default); "Allow this host" (we have no allow rules, `analysis-17`); "Always block this host" on a line (it belongs with the editor of blocked sites, `analysis-23`); the host's reputation tag (TestCord's list of two or three hand-picked hosts is replaced by what plugins declare, `analysis-12` section 4.2, later); a per-plugin view (a request cannot be traced to the plugin that made it, still unsolved).

## 7. Tests and checks

Pure code with fakes: the grouping (same kind, host, path shape and method together; counts; newest first; the cap), the ages, the token-guard log (host kept, no header or value, bounded), the parser in the page (every limit), the search (host, title, tag; nothing found), the pages (first, last, empty, out of range), the export (content, no query, file names, a failing write leaves nothing half written), `logVersion` growth. Mutation check as always. Not verifiable without the owner's Stable: real entries appearing while he uses Discord, the look of the list, and the exported files in the folder.

## 8. Open points (said, not hidden)

- The first lines will often be the same few: NoTrack stops most telemetry inside Discord, so the network list may stay short. That is the design working, not an empty feature.
- `pathShape` hides ids, but a host chosen by Discord can still say something (a random label in the host). The firewall already shows only the registrable host for its own rules; the token-guard log keeps the real host because that is the point of it. Stated here so the owners can say if they would rather see only the registrable host there too.

## 9. Questions for the owners (my proposal first)

1. Show NoTrack's inside-Discord counts as one line per kind (never mixed with the network lines)? (proposed: yes)
2. Show the token guard's existing log, so "Token removed" shows the host? (proposed: yes, host and path shape only; the log is already there)
3. Export written by the main process into an `exports` folder, not a browser download? (proposed: yes)
4. Eight groups per page? (proposed: 8)
5. Token-guard lines show the real host or only its registrable part (`x.example.com` or `example.com`)? (proposed: the real host; it is what you would block)
