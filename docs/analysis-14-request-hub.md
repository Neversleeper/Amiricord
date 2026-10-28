# Analysis 14: the request hub (piece P2 of design 05)

Written 2026-10-25 before the code. Sources: `design-05-privacy-engine.md` section 4, `analysis-12` (how TestCord registers its guard), and Electron's documented behaviour of
`session.webRequest`. Nothing was run. **Not verified** items are marked.

## 1. The problem
Electron lets only **one listener per event** live on a session: `onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`... Registering a second listener **replaces** the first without a warning.
Amiricord needs several features on the same events (the self-test header check now; later the firewall rules, the token guard, the CSP). Discord's own main process may register
listeners of its own on the same session (not verified). If either side registers after the other, one of them silently stops working.

## 2. What the hub does
- It registers **one** listener per event, `{ urls: ["<all_urls>"] }`, and hands every request to an **ordered list of small handlers**.
- A handler can answer: nothing (just looked), **cancel**, **redirect** (before the request), or **new headers** (before the headers are sent).
  The first cancel or redirect ends the chain; header changes pass from one handler to the next.
- A handler that **throws** is skipped, counted by name, and never blocks the request; a hung handler cannot exist because answers are synchronous.
- **Chaining with Discord's own listener.** The hub replaces `webRequest.onBeforeRequest` and `onBeforeSendHeaders` (on the session object only) by functions that **store** what Discord registers (listener
  and its URL filter, or `null` to remove it) instead of letting it replace ours. After our handlers, the stored listener is called for the requests its filter matches, with the headers our
  handlers produced, and its answer is what Electron gets (our header changes are kept if it does not change headers itself). If the object cannot be replaced, the hub says so in its status and
  the trace and works without chaining.
- The hub is plain code over a small interface (`WebRequestLike`), so it is tested with a fake; `electronGlue.ts` is the only file that gives it Electron's real object.

## 3. What it does not do (yet)
`onHeadersReceived` (needed for the CSP, piece P5) is added when it is needed. The hub has no rules of its own: rules come in P4. Counting and logging come in P4.

## 4. First user of the hub: check A of the privacy self-test
The first request to Discord's API (any `discord.com` address under `/api/`) carries the header `X-Super-Properties`. The handler reads that header once, reads only the value of `has_client_mods`
with the shared reader (`src/shared/modFlag.ts`), reports `request-header: pass | fail` to the health report, and removes itself. If no such request appears within 60 seconds it reports
`not-seen` with the reason. Nothing but the verdict, and the time, is kept. It never changes or cancels anything.
Limit: the main process results go to the health report; the row "Privacy check" of the main tab shows what the page measured (the properties and the first gateway message).

## 5. Risks and unknowns
- Replacing `webRequest.onBeforeRequest` on the instance may not be possible in some Electron builds (the object may be sealed): then no chaining, and a later Discord listener would replace ours. The status and the trace say which case it is.
- A listener of Discord's registered **before** the hub is installed cannot be captured. Our loader runs before Discord's code, so this should not happen (not verified).
- Order of handlers matters and is fixed by the order of `add`; piece P4 will state the order of rules in its own table.

## 6. Tests planned
Fake `webRequest` with the two events: one registration per event; handlers in order; cancel and redirect end the chain; header changes pass along; a throwing handler is skipped and counted; removal of a handler; the host listener is stored, called after ours with our headers, not called when our handler cancels, not called when its filter does not match, removable with `null`, called with a filter or without one, and a throwing host listener does not hang the request; the filter patterns; install twice; replacement impossible. Header check: reads only the flag, ignores other hosts and paths, removes itself, times out as not-seen, never changes headers.
