# Design 05: the privacy engine and the Privacy & Security tab

Status: **proposal, to be approved by the owners** (nothing here is built). Written 2026-10-25 at the owner's request ("privacy is the most
important thing"). It merges: `analysis-02-privacy.md` section 4 (the 11 fixed rules), `design-01-manifest-permissions.md` (manifests feed
the firewall, the CSP and the isolation), the owners' decisions in `docs/decisions.md`, and `analysis-12-privacy-security-tab.md` (TestCord's tab,
its findings and the proposed order of the screen). Everything is written from scratch; from TestCord and the owner's other project only the *ideas* and the
*measurement method* are used.

## 1. Goal and promises (what the owners can rely on)
1. **The engine makes no request of its own** except to Discord (rule 1 of analysis 02). Nothing in this design adds a destination.
2. **Telemetry is stopped in two places**: inside Discord's code (so the data is never created) and on the network (so a missed one is cancelled).
3. **The client does not tell Discord that it has mods** (`has_client_mods` is `false`), and the engine **checks this itself at every start,
   including the very first message of the start**, and says so if it is not true.
4. **The account token only goes where Discord's own code sends it**, or to a host a plugin declared with a token permission.
5. **Everything the person can see is honest**: two kinds of numbers with two names, no invented addresses, no "applied" without proof.
6. **No plugin can quietly weaken any of this**: risky changes need the person's confirmation made in the main process, outside the page.
A note the owners already accepted (analysis 02, rule 4): modifying the client goes against Discord's terms, and the `has_client_mods` flag exists so that
Discord can know; this engine reduces what is sent, it does not make anything allowed.

## 2. The pieces and the order

| # | Piece | Where it runs | Depends on |
|---|---|---|---|
| P1 | **Self-test of `has_client_mods`** (baseline) | page + main (read only) | nothing new |
| P2 | **Request hub** (one place that owns Electron's `webRequest` events) | main | P1 uses it for the header check |
| P3 | **NoTrack** as a core plugin (analytics, metrics, crash reports, mod flag) | page | P1 tells what is still needed |
| P4 | **Firewall rules and log** | main | P2, manifests (hosts) |
| P5 | **Token guard and CSP from manifests** | main | P2, P4 |
| P6 | **Encrypted DNS** | main | settings store |
| P7 | **The Privacy & Security tab** | page | P1 to P6 |

Why this order: P1 is small and tells us the truth about the engine as it is today (is it already invisible?). If it says `false` everywhere, P3 is
only a safety net; if it says `true` somewhere, P3 starts with exactly that fix. P2 is a prerequisite because Electron allows **one listener per
event** in a session: if two features register their own, the second silently replaces the first.

## 3. P1: the self-test of `has_client_mods`

### 3.1 What is checked
Method taken from the owner's other project's measurements (`senales-cliente.md`, sections 6 to 6e), now automatic:
- **Check A, the header (main process, earliest network evidence).** The first request to Discord's API carries the header `X-Super-Properties`
  (base64 of a small JSON). The main process reads that header once, decodes it, reads **only** the value of `has_client_mods`, and throws the rest away.
- **Check B, the properties object (page).** Once Discord's module that builds the properties is found by a finder (`getSuperPropertiesBase64`), the page
  decodes it the same way and reads only `has_client_mods`.
- **Check C, the first gateway message (page, the one that matters "even at the start").** A watcher wraps `WebSocket.prototype.send` as early as the page
  script runs, looks at the **first 40 sends or the first 60 seconds, whichever ends first**, finds the key `has_client_mods` in the message and reads the value that
  follows it, then **puts `send` back exactly as it was**. The message may be text (JSON) or binary (Erlang term format used by the gateway); the reader
  understands both. Only three facts are kept: *found or not*, *the value*, *how many ms after the page script started*. The message content, the token and any other field are never stored.

### 3.2 Result and what happens with it
- Each check ends as **pass** (`false`), **fail** (`true`), or **not seen** (nothing observed in time; the reason is kept).
- One new health event kind, `selftest` (name, status, short detail, time), goes into the existing health report; it is redacted like every other event.
- If anything **fails**, the engine does not stop or change itself; it **reports loudly** (health report now; later the summary card of the tab, and a notice when the notification system exists). This follows design 02 ("the start-up self-check only reports").
- The result of the last start and of the previous one are kept (two entries), so the person can see that a Discord update changed something.

### 3.3 Why the start is the hard part (the facts from the owner's other project)
- The detector function has **three copies** in Discord's code: the main module, `fast-connect.js` and `sentry.js`. The properties computed first come from the `fast-connect` copy.
- It looks at the page's globals (names such as `BetterDiscord`, `BdApi`, `Vencord`, `VencordNative`, `rambox`, `jQuery`, `$`). Our rule: **we never define those names**; our one entry
  (`Amiricord`) is hidden and non-enumerable, and the bridge key is random per load.
- Our module hook wraps **only the main Webpack instance** (the other two are separate instances and are rejected on purpose). So patching the copies in `fast-connect` and `sentry` would need a new
  engine capability. **We do not decide that now**: P1 measures first. If the three checks pass with no patch at all, nothing more is needed; if Check C fails, the fix is chosen with the data.
- It is **not verified** that our page script runs before Discord's first script (design 02 flagged it; the first Canary runs suggest yes). Check C will also tell us the time of the first send relative to our start; if the watcher is late, the result says "not seen", never a false pass.

### 3.4 Tests
Without Discord: a fake WebSocket (text and binary messages, with `true`, `false`, missing key, key split across chunks, huge message, `send` replaced by someone else), a fake header, a fake properties module; the watcher always restores `send`, never stores anything but the three facts, never throws into Discord's code. Mutation checks: watcher not restored, token stored, `true` read as pass, key search past the limit, header decoded but whole JSON kept. Real check: the owner starts Canary, reads the self-test lines in the health report, and a Discord restart is repeated to see that the first message is covered.

## 4. P2: the request hub (main process)
One module registers Electron's `onBeforeRequest`, `onBeforeSendHeaders` (and later `onHeadersReceived` for the CSP) **once**, and hands each event to an ordered list of small handlers
(self-test header reader first, then rules, token guard...). A handler answers "pass", "cancel", "redirect" or "change headers"; the first decisive answer wins and the rest only observe.
A handler that throws is skipped and counted, never blocking Discord. Tested with fake events. This is also the place that guarantees the **order of decisions** is written down in one table.

## 5. P3: NoTrack (core plugin, cannot be turned off)
- **Patches** (the search texts are found by us in Discord's current code with the tools we already have; none is copied): replace the analytics store with an empty one; stop the metrics timer and its counters; make the mod-detection function return `false`; keep Sentry from starting.
- Counts what it stops under the name **"stopped inside Discord"** (never as network blocks). No invented addresses.
- `lazy` patches where the module appears late; every patch reports to health like any other.
- Which instances to patch (main only, or the others too) is decided **after P1**.

## 6. P4: firewall rules and log (main process)
- **Decision table in this order** (each row is data with a name and a reason): host rule "block" → remote-code guard → telemetry shields → link-parameter stripper → allowed.
- **Match by parsed host and path**, never by text found anywhere in the address.
- **Shields** (each separate, on/off, persisted): usage reports (`science` and `track` on Discord's API), metrics, crash reports, and the experimental three (tracing, call diagnostics, remote logs; off by default, decision open). Remote-code guard (third-party code files, signature words matched as whole path segments) raises an alert. Link-parameter stripper only for pages the person opens, allow-list of parameter names, per-host exceptions.
- **Counters of two kinds, never added together:** *stopped inside Discord* (NoTrack) and *cancelled on the network* (this table). Per shield and per host.
- **Host rules** (allow or block) with a visible **list**: add by hand, change, remove, say why. A rule that lets a host receive the token is a **risky change**: it needs a confirmation dialog shown by the main process.
- **Log:** in memory, bounded (250 to 10 000, default 500), **no query values by default** (host, path shape, category, outcome, time); full addresses only if the person turns that on; export says what it contains and asks first. Updates are **pushed** to the open tab, no polling.
- **Files:** one validated file, written through a temporary file and a rename (the helper we already have); a damaged file gives the defaults and says so in the report.

## 7. P5: token guard and CSP from manifests
- **Token guard by construction:** the `Authorization` header is removed from any request whose host is not Discord's, unless the host is declared by a plugin that holds the token permission in its `plugin.json` (or the person allowed it, with the confirmation of section 6). No list of "exempt" hosts.
- **CSP built from the enabled plugins' declared hosts** (design 01), shown to the person; no external script source. Needs the manifest data in the main process (the build already writes it).
- **Outbound table of the tab = live truth:** Discord, then every plugin with its declared hosts and counts, plus a flag for anything seen that nobody declared.

## 8. P6: encrypted DNS (engine feature, off by default)
- Providers as data (Quad9 and Mullvad Base among them, one custom field, latency shown). **Verification before applying** with the standard binary DoH query (the format every provider serves), not the JSON variant TestCord uses (not verified that it fails for some providers).
- **Two modes:** *Automatic* (falls back to normal DNS if the secure server fails; the screen says so) and *Strict* (never falls back). Default Automatic (open decision).
- Real status only: "applied" means verified and configured; the numbers shown are about real traffic, or are not shown. No fake cache counters.
- One DNS system, not two.

## 9. P7: the tab (order from analysis 12, section 5)
Summary card (with the self-test result) → Telemetry (master switch "Block Discord telemetry", the same setting as the main tab) → Your account (token, remote code, link parameters) → Who the client talks to (per plugin) → Activity (collapsed) → Encrypted DNS (own card) → Advanced (log size, host rules list, pause protection 10 minutes, reset). Plain words, a sentence on every switch about what happens if it is off, the "Restart" tag where a restart is needed. Presets *Recommended / Maximum / Off* (open decision).

## 10. Security rules for every channel added
- Each new message between page and main process: accepted only from trusted Discord pages (`isTrustedSender`), checked again in main, content rebuilt field by field (like `parseHealthEvent`), size limits, no function or path from the page.
- **A plugin shares the page**, so the page cannot be trusted to keep plugins away from the bridge. Therefore: privacy settings that weaken protection are never applied on the page's word alone; they need the confirmation of the main process. Whether the exposed bridge can be hidden from other page code after the engine takes it is an open technical question (to test on Canary).
- Counters can only be changed by the code that makes the decision, never by a message from the page.
- Nothing in this design stores or sends a token, a cookie, a message body or an account name.

## 11. Open decisions for the owners (from analysis 12, plus the self-test)
1. Is "Block Discord telemetry" the master switch of the whole telemetry group?
2. DNS default: Automatic or Strict?
3. Keep the three experimental blocks, off by default?
4. Logs: keep query values only if the person asks (proposed default: no)?
5. Presets *Recommended / Maximum / Off*: yes or no?
6. If the self-test fails, only report (proposed) or also offer a one-click fix when one exists?
7. Start by P1 (proposed) or by the screen?
