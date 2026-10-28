# Analysis 17: host rules, their file and the confirmation (piece P4c of design 05)

Written 2026-10-25 before the code. Sources: `design-05-privacy-engine.md` sections 6 and 10, `analysis-16-firewall.md`, the real census of build 650200 to 650250
(`probe/census*.json`, which showed Stripe, Klipy, `dc-telemetry.net` and Discord's own hosts), and the code of P4b (`src/main/firewall.ts`). Nothing was run. **Not verified** items are marked.

## 1. What P4c is
P4b cancels four kinds of request that were decided by us. P4c lets the **owner** add rules of their own: "block this host" and "allow this host".
Everything else in design 05 section 6 for this piece: a **file** where the rules live, a **check** of every rule, a **confirmation shown by the main process** for risky changes, and a **read-only list** for the page.
There is **no screen** yet (that is P7). Until then the file can be edited by hand, and the page can already read the list.

## 2. The rules
One rule = `{ id, host, subdomains, action, reason, created }`.
- `host`: a plain lowercase name like `m.stripe.com`. Checked on entry: letters, digits, dots and hyphens only, at least one dot, at most 253 characters, no `*`, no scheme, no path, no port, no address with digits only. Names with non-ASCII letters must be given in their ASCII (punycode) form.
- `subdomains`: `true` also covers `x.m.stripe.com` (the same parsed-host test as P4b: `host` or a name ending in `.host`; never text found inside an address).
- `action`: `block` (cancel the request) or `allow` (see section 3).
- `reason`: the owner's words, at most 200 characters, shown later in the tab. It never affects behaviour.
- `id`: made by the main process; the page never chooses it. `created`: time, set by main.
- Limits: at most **200 rules**, no two rules with the same host, file at most 64 KB.

**Nothing is shipped by default.** In particular Stripe is **not** blocked: `m.stripe.com` is a device fingerprint, but blocking Stripe could break buying Nitro or the Shop.
The tab (P7) may offer it as an optional rule with that warning.

## 3. How a request is decided (the table of P4b grows by two rows at the top)
1. **Block rules** (owner's): the first block rule whose host matches cancels the request. Counted as "host rules".
2. **Allow rules** (owner's): if an allow rule matches, the telemetry shields of P4b are **skipped** for that host (so `allow dc-telemetry.net` really lets that ping through). An allow rule never overrides a block rule and never touches anything else.
3. **Telemetry shields** (P4b): as today.
Later (P5), the token guard comes into this table; **an allow rule in P4c never means "may receive the token"**. That needs its own permission and its own confirmation.
The same rules: web addresses only (`http`, `https`), fail-open (any error lets the request through), no query, no header and no body ever kept, counters and log bounded.

## 4. What counts as a RISKY change (the main process asks first)
| Change | Why it is risky | What happens |
|---|---|---|
| `allow` for a host that a shield matches (or any `allow` at all) | It switches a protection off for that host | **Asks** |
| Removing a `block` rule | It switches a protection off | **Asks** |
| Adding a `block` | Cannot hurt privacy | No question (can still break a site; the tab will say so) |
| `block` of a protected Discord host (`discord.com`, `discordapp.com`, `discordapp.net`, `discord.gg`, `discord.media`, and their subdomains) | It would stop Discord from working or from starting | **Refused**, with a plain message; to do it anyway the owner edits the file by hand |
| Removing an `allow` rule, editing only the reason | Only makes protection stronger or changes text | No question |
The confirmation is an **operating-system dialog shown by the main process** (`dialog.showMessageBox`), with the host, the action and one sentence of consequences in plain words. The default button is **Cancel**.
The page cannot click it and cannot make it say something else: the text is built in the main process from the validated rule. Only one dialog at a time; a second request while one is open is refused, so a plugin on the page cannot flood the owner with dialogs.
**Not verified:** how the dialog behaves over Discord's window in Electron 44 (focus, behind the window, full-screen). It is checked on Canary.

## 5. The file
- `%APPDATA%\Amiricord\firewall.json`, **separate from `settings.json`**, so a bug in the settings code cannot touch the rules and the other way round.
- `{ "schema": 1, "rules": [...] }`. Read once at the start and checked rule by rule: a rule that fails the check is **dropped and reported** in the health problems (host name only), the others stay. A file that cannot be read gives no rules and says so.
- Written through a temporary file and a rename (the helper `writeTextAtomic` we already have), after each accepted change. If the write fails the change is **not** kept in memory either, and the page is told it was refused.
- Edited by hand while Discord runs: not noticed until the next start. Said in the header comment of the module and later in the tab.

## 6. Between the page and the main process (design 05 section 10)
- **Read:** `firewall` (the channel of P4b) also returns the rule list: `id`, `host`, `subdomains`, `action`, `reason`, `created`. Trusted sender only; the page rebuilds it field by field.
- **Change:** one new channel `firewall-rules`, message `{ op: "add" | "remove" | "edit", ... }`; trusted sender only, checked again in main, the answer is `{ ok: true } | { ok: false, reason }` with reasons from a fixed list. No function, no path from the page.
- Counters change only where a request is decided. A new key `host-rules` is added to the network counters, next to the four shields (page and main are built together, so both sides change at once).
- Every accepted or refused change leaves a **line in the trace** (host and action, never the reason text).

## 7. Risks and unknowns
- **A block rule can break Discord or a page** (for example blocking a CDN). Mitigation: protected hosts are refused; the reason field helps the owner remember; removing the rule restores everything (requests are only cancelled, nothing is changed in Discord).
- **A plugin sharing the page can call the change channel.** Mitigation: the confirmation is made by main, one at a time; refused changes are refused without a dialog.
- **Dialog problems** (not shown, hidden): then nothing is applied (no answer means Cancel).
- **The rule file grows or is damaged:** limits and drop-and-report.
- **Matching by name only:** a block on a host name does not stop an address given as a raw IP number. Said in the tab later; not a reason to add more code now.

## 8. Tests and checks planned
Without Discord or Electron: the rule check (good hosts; `*`, schemes, paths, ports, uppercase, IP numbers, empty, too long, non-ASCII, duplicates, too many); host matching (host, subdomain, look-alikes such as `notstripe.com`, `stripe.com.evil.test`, text in the query); order block > allow > shields; allow does not beat block; allow skips only the shields; the risky table (each row asks or does not ask or refuses); a fake dialog (cancel, accept, no answer, throws, second request while open); the file (read good, read damaged, drop-and-report, write atomically, failed write keeps nothing); counters and log never hold a query or a reason. Mutation check on each row of the table, on the order, on the limits, on "default button is Cancel", on "refused without dialog".
Canary check: a rule added **by hand in the file** for a harmless host seen in the census (for example `static.klipy.com`, the GIF host; not a Discord host, because those are protected), restart, the row "Cancelled on the network" counts it and Discord works; then the dialog path checked with a tiny developer-only trigger (not part of the product), to see the dialog over Discord's window.

## 9. Questions for the owners
1. Refuse blocking Discord's own hosts (proposed: **refuse**; the file can still be edited by hand)?
2. An `allow` rule only skips the telemetry shields for that host and never means "may receive the token" (proposed: **yes**)?
3. No rule shipped by default, Stripe only offered later in the tab with a warning (proposed: **yes**)?
4. The rules in their own file `firewall.json` (proposed: **yes**) and at most 200 rules?
