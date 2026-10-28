# Analysis 21: encrypted DNS (piece P6 of design 05)

Written 2026-10-26 before the code. Sources: `design-05-privacy-engine.md` section 8, `analysis-12-privacy-security-tab.md` (how TestCord does it and what is wrong there: sections 1.2, 2.6 and findings 11 to 13), and what the owners asked (Quad9 and Mullvad Base among the providers, two modes, Automatic and Strict).
Nothing was run for this note. **Not verified** items are marked; most of them are checked with a real test on Discord, as in the earlier pieces.

## 1. What it is, in plain words
Before Discord connects to `discord.com`, something has to turn that name into a number (an IP address). That step is **DNS**. By default it goes in the clear to the DNS server of your internet provider or router, so they can see **which sites Discord looks up**.
**Encrypted DNS (DoH, "DNS over HTTPS")** sends the same question inside an encrypted HTTPS connection to a provider **you** choose. The network between you and the provider no longer sees the names.

## 2. What it does NOT do (the tab must say this too)
- It does **not** hide **where** you connect: the IP address you finally connect to is visible, and the name of the site in the TLS handshake (SNI) is visible too (unless Encrypted Client Hello is used, which is not something we control).
- It moves the trust: **the DNS provider you pick sees every lookup**. It is a choice between your internet provider and that provider, not "nobody sees it".
- It covers only what Discord's own **network stack** (Chromium) looks up. Not the updater program (`Update.exe`), not other programs, not names resolved by Discord's native voice code. **Not verified** what voice does.
- The first lookup, the name of the DoH provider itself, has to be resolved with the normal system DNS (it cannot encrypt before it knows where to connect). A provider given as a bare IP address in its template avoids it; the default list uses names.

## 3. How Electron lets us do it
`app.configureHostResolver({ secureDnsMode, secureDnsServers, enableBuiltInResolver })` in the main process (it is what TestCord uses). Modes:
- **`automatic`**: tries the secure server and **falls back to ordinary DNS** if it fails. Discord keeps working; privacy is "best effort".
- **`secure`** (our "Strict"): **never** falls back. If the provider is down or blocked, **Discord cannot connect at all**.
- **`off`**: the system's way.
**Not verified:** that the call works as documented in the Electron versions of our Discords (Stable 42.x and Canary 44.x were seen in the boot trace), when it may be called (after the app is ready, and whether lookups already made are kept), and whether it also reaches the lookups made by the voice code.

## 4. Providers are data
A small table in the code, each row: id, plain name, DoH address, what it filters (nothing, malware, adverts, family), a one-line note. First list (the addresses are from memory and **must be checked by the verification step of section 5 before they are trusted**):
- **Quad9** (`https://dns.quad9.net/dns-query`): blocks known malware sites. The standard one, **not** the "ECS" variant (it passes on part of your network address to the sites' servers, which is the opposite of what we want).
- **Mullvad, base** (`https://base.dns.mullvad.net/dns-query`): no filtering, no logs claimed by the provider.
- **Cloudflare** (`https://cloudflare-dns.com/dns-query`), the plain 1.1.1.1 one: fast, no filtering. **AdGuard unfiltered** (`https://unfiltered.adguard-dns.com/dns-query`): no filtering. The filtered variants of all of them (malware, adverts, family) are left out of the first list on purpose: a filter can block a name Discord needs; they can be added later as one data line each.
- Left out of TestCord's 18, with the owner's agreement to be confirmed: Google, OpenDNS (a company that logs and filters), Control D, and every "family" and "adblock" variant (see CONTEXTO, 2026-10-26).
- **Google is NOT in the list** (owner's decision, 2026-10-26: it is the worst for privacy). The owner can still type it as the custom address.
- **One custom address** typed by the owner: must be `https`, a plain host name or IP, an optional path, no user name or password in it, at most 200 characters.
Nothing is chosen by default. The owner picks one.

## 5. Verification before applying (the fix for TestCord's finding 11)
TestCord asks the provider for the **JSON** answer format, which not every provider offers at the address it lists. We use the **standard binary format of RFC 8484**, which every DoH provider must serve:
- Build a DNS question for `discord.com` (type A) by hand (a few dozen bytes, no library) and send it to the provider with `POST` and `Content-Type: application/dns-message`.
- Accept it only if: HTTP 200, `Content-Type: application/dns-message`, the answer's id matches, the "response" flag is set, the code is "no error", and there is at least one answer. At most 3 seconds, at most 4 KB read.
- Measure the time and keep it ("38 ms").
- If the check fails the setting is **not applied** and the reason is said in plain words (timeout, not DNS, blocked, wrong format). In Automatic mode it also says that normal DNS stays in use.
The question builder and the answer reader are pure code, tested without a network.

## 6. The two modes, and the danger of Strict
- **Automatic** (proposed default when the owner turns it on): tries the provider and falls back to normal DNS. The tab says so ("with a plain-DNS fallback").
- **Strict**: a lock-out risk. If the provider stops answering, Discord cannot connect and **the owner cannot even open the tab to turn it off**. Mitigations, all of them: (1) Strict is applied only after the verification above passes **at that start**; if it fails at start, the engine does **not** apply Strict and falls back to `off` for that session and reports it; (2) **safe mode switches encrypted DNS off**; (3) the setting is a small file in the Discord's own folder (section 7) that the owner can edit or delete by hand; (4) the tab asks for a confirmation before turning Strict on and says what happens if the provider fails. (Residual risk: the provider fails *after* the start check; then Discord loses connection until the next start or until the file is edited. Said in the confirmation.)

## 7. Where it lives
- A file `dns.json` in **the folder of each Discord** (`%APPDATA%\Amiricord\<branch>\dns.json`, the layout of analysis 20): `{ "schema": 1, "mode": "off" | "automatic" | "strict", "provider": "<id or custom>", "custom": "<address>" }`. Read once at start and checked field by field; a damaged file means "off" and a problem in the engine status; written through a temporary file and a rename (the helper already exists).
- The engine reads it in the main process, verifies, applies, and keeps a **status**: mode asked, mode in force, provider, time of the last check, how long it took, result and reason. **Real status only:** "configured and the provider answered a real question" is what we can say; **we cannot see inside Chromium whether it then uses it**, so the tab says "Configured", never "all your lookups are encrypted". (TestCord shows "cache" and "native calls" numbers that are not about real traffic: we show none.)
- One DNS system only, no plugin version (finding 13).
- Status goes to the page through the same read-only channel as the firewall counters; a row in the main tab, **"Encrypted DNS"** ("Off", "Configured: Quad9, automatic, 38 ms", or the reason it is not).
- The change channel and the confirmation for Strict come with the Privacy & Security tab (P7). Until then the owner edits `dns.json` by hand.

## 7b. How we will see it work (the check on Discord)
Because Chromium's own behaviour cannot be read from inside, the real evidence is **outside**: with Discord running, the list of its network connections (`netstat -ano`, filtered for the Discord process) must show connections to the **provider's addresses on port 443** that were not there with the setting off. Plus: Discord works normally, and with a **deliberately wrong** provider in Automatic mode it still works (fallback), while in Strict mode the check refuses to apply it at start (and Discord still opens).

## 8. Steps
| Step | What |
|---|---|
| **P6a** | The pure part: the DNS question builder and answer reader, the provider table, the address check, the `dns.json` reader and writer. No network, no Electron. |
| **P6b** | Verification in the main process (real network call, with a fake in the tests), applying with `configureHostResolver`, safe mode off, the status, the trace lines and the main tab row. Off by default; turned on by hand in `dns.json`. |
| **P6c** | The tab (with P7): provider list with the latency of each, the mode, the confirmation for Strict, the test button. |

## 8b. What the first real test on Stable showed (2026-10-26)
- **The check must speak HTTP/2.** Asked from plain Node (HTTP/1.1), Cloudflare and AdGuard answered (357 and 464 ms), **Quad9 answered "505 HTTP version not supported" and Mullvad closed the connection**. So the check now goes through **Chromium's own network stack** (`net.fetch` of Electron), which speaks HTTP/2 and is also the stack that will use the DoH setting.
- **A cold start can be slow:** once the check timed out after 3 seconds, the next start answered in 554 and 1213 ms. So when the first check fails there is **one more try after 10 seconds** (a provider that does not answer twice is not applied).
- **Real evidence that Chromium uses it** (the plan of section 7b used `netstat`, which was not enough: the connections are short and `netstat` saw none). Chromium's own network log (Electron's `netLog`, development mode only, one minute, kept in the probe folder) showed **12 DNS-over-HTTPS attempts, all to the Mullvad address, none to any other provider**, and 7 resolver jobs in the "automatic" secure mode. Not verified: Strict mode on a real Discord, and the voice lookups.

## 9. Risks and unknowns
- `configureHostResolver` may behave differently in the Electron version of Stable than in Canary's (**not verified**); the netstat check is made on the owner's Stable.
- A provider that blocks a site Discord needs (a filtering one, such as Quad9 for a domain it wrongly lists) can break something: that is why nothing is on by default and the notes say what each filters.
- Corporate or school networks that block DoH: Automatic falls back; Strict fails the check at start and is not applied.
- The provider list ages (addresses change): they are data, one line each, and the verification step is what protects the owner from a wrong one.

## 10. Questions for the owners
0. **Done:** Google out of the list (owner's order). TestCord's own list has Cloudflare, Mullvad and Quad9 as its resolvers in the tab and 18 entries in the code (analysis 12, section 1.2).
1. Default mode when the owner turns it on: **Automatic** (proposed), with **Strict** as an option behind a confirmation?
2. Providers: the four of section 4 (Quad9, Mullvad base, Cloudflare, AdGuard) plus one custom address, nothing chosen by default (proposed)?
3. The setting as `dns.json` in each Discord's own folder (proposed), edited by hand until P7?
4. Steps P6a, P6b, P6c as in section 8, starting with P6a (proposed)?
