# Analysis 02: privacy baseline (TestCord vs the owner's other project) and what Amiricord must guarantee

Reference only, in our own words. Sources:
- **Read by me in this session (TestCord, commit `af92dbaec`):** `src/main/patcher.ts`,
  `src/main/privacy/trafficGuard.ts` (the Badge Spoofer exception, ~L545-560), `src/main/privacy/dnsResolver.ts`
  (defaults and `configureHostResolver`, ~L68-150), `src/main/index.ts` (startup calls),
  `src/plugins/_core/noTrack.ts` (diffed against the owner's other project's), `src/testcordplugins/TestcordHelper/native.ts`
  (all), `TestcordHelper/index.tsx` (settings and `syncPronounsBadge`), `TestcordHelper/LIVEFIX.md` (first 60 lines),
  network/eval greps over `src/Betterdiscordplugins`.
- **Taken from the owner's the owner's other project analyses (not re-verified by me):** `the owner's other project\analysis\privacidad-testcord.md`,
  `senales-cliente.md`, `red-rastros-y-obligatorios.md`, `seguridad.md`, `updater-y-csp.md`, and
  `the owner's other project\CONTEXTO.md` section 8 (measurements).
- **Not analysed in depth:** the ~3 100 plugin files. Only BadgeSpoofer, TestcordHelper, DXTokenImporter, DMBomb
  and the Badge/Cloud/Updater pieces have been looked at (by me or in the owner's other project's notes). `osSpoofer`,
  `spoofmsgv2`, `systemMessageSpoofer` and the rest are **unanalysed**. Each one gets its own analysis (rule 3) before any decision.

## 1. What the owner's other project achieved (the bar to meet or beat)

| Area | the owner's other project state | Evidence |
|---|---|---|
| Servers of the mod authors | None contacted: updater off, Cloud removed, badges local only, SupportHelper deleted. | `CONTEXTO.md` s4-5, s8 |
| Domains seen from the renderer | Only `discord.com`, `cdn.discordapp.com`, `status.discord.com`. | `senales-cliente.md` s6, s6b |
| `has_client_mods` | `false` in `X-Super-Properties`, in later IDENTIFY, and in the **first** IDENTIFY at startup (measured with a local probe plugin). | `senales-cliente.md` s6, 6c-6e |
| Telemetry | NoTrack: analytics store stubbed, metrics off, Sentry off, `TRACK` handled locally, mod-detection function returns false. | `noTrack.ts` |
| CSP | Three author/GitHub domains removed; the rest of the list kept on purpose. `unsafe-eval`/`unsafe-inline` kept (needed by eval-based patching). | `CONTEXTO.md` s5, s11.2 |
| Written to the account | Nothing automatic. | `red-rastros...md` s3 |

**the owner's other project's own limits (honest list):**
1. `window.Vencord` / `VencordNative` still exist; the detection function looks for exactly those names. The false value
   depends on a patch that skips the `fast-connect` and `sentry` bundles, so it works but is indirect.
2. NoTrack makes a **synchronous** XHR at start (blocks the thread briefly).
3. The full inherited CSP was kept, which allows more hosts than the owner's other project's own plugins need.
4. Main-process traffic (plugins with native code) is known only from code, not measured.
5. Measurements were manual and one-off.

## 2. What TestCord adds to privacy (deep look)

### 2.1 `privacy/*` (read: Badge Spoofer exception, DNS defaults, startup)
- **Starts unconditionally.** `main/index.ts` calls `initCsp()`, `trafficGuard.init()`, `dnsResolver.init()` with no setting in front.
- **TrafficGuard (firewall).** Hooks every request of the default session. On by default: block Discord science/track,
  metrics, Sentry; strip `Authorization` from non-Discord hosts (with an allow-list of AI/music APIs); strip tracking
  parameters from outgoing navigations; cancel code downloads whose path matches words like "stealer". Off by default:
  tracing, RTC diagnostics, remote logging. Useful ideas.
- **Verified exception:** requests to Discord's API carrying `source=badge_spoofer` are **always allowed**, bypassing the
  telemetry shields. The firewall therefore blocks Discord's real telemetry but lets a plugin's fabricated telemetry through.
- **DNS:** `dnsEnabled = true` by default (the log message calls it "Opt-in"). At start it calls
  `app.configureHostResolver` with `secureDnsMode: "automatic"` and Cloudflare DoH. Effect: Cloudflare sees the host names
  the client resolves, instead of the user's own resolver. Falls back to the system if DoH fails.
- **IPC:** a channel accepts a token and cookie from the renderer and sends them from the main process to
  `discord.com/api/v9/science` (per the owner's other project's analysis; the call chain I did not re-trace).
- **Storage:** rules and DNS choice in two JSON files; logs (full URLs, up to 500/1000 entries) in memory only.
- **Verdict:** valuable ideas, wrong defaults and one plugin-specific hole. Do not port as is; rebuild the useful parts (see s4).

### 2.2 TestcordHelper (required plugin in TestCord, 2 106 lines + `native.ts`)
- **Verified: writes to your Discord profile by default.** `pronounsBadge` has `default: true`. `syncPronounsBadge()`
  reads your profile and, if the marker is missing, does `RestAPI.patch` on your profile adding an invisible zero-width
  character to **pronouns**. Other users' clients can see that marker, so it identifies TestCord users. Same file
  also toggles other plugins' settings (`OrchestratorAPI`, `TestcordOptimizer`) from `start()`.
- **Verified: LiveFix local server** (`native.ts`). Off by default. When on: HTTP server on `127.0.0.1:18963` that
  queues JSON commands to the renderer through files under `/tmp/opencode/livefix`; the owner's other project's notes say one action runs
  `eval` in the renderer. Protections present: per-session random token (file mode 0600, which Windows ignores),
  rejects any request with `Origin`/`Referer` or another `Host`. Weakness: `liveFixRequireToken` can be switched off,
  which makes `isAuthorized` return true for any local process. Made for an AI debugging tool, not for end users.
- **Verdict:** both belong out of the engine. A profile marker is exactly what a privacy-first mod must not do.
  A remote-eval bridge, if ever wanted, is a separate developer-only tool, never in release builds.

### 2.3 BetterDiscord loader (`src/Betterdiscordplugins`, required in TestCord)
- Loads third-party BetterDiscord plugin source and runs it with `eval` / `new Function`
  (`PluginManager.ts` lines ~68, ~228, ~296), and exposes `window.TestcordBD.loadPlugin(name, code)` (per the owner's other project notes).
  Bundled sample plugins carry `@updateUrl` links to GitHub; the one network call I saw in the bundle is an
  `XMLHttpRequest` inside a bundled third-party plugin (EmbedMoreImages) — its target was not examined.
- **Verdict:** arbitrary code execution by design. Not in the engine. If ever offered, it is an optional plugin with the
  most restrictive permission set and a per-plugin consent prompt.

### 2.4 Updater and installers
- Updater (Vencord-derived, in TestCord): downloads `patcher/preload/renderer` from GitHub releases and overwrites installed
  files, no hash check (the owner's other project's A8). `runInstaller.mjs` downloads and runs a third-party binary, with a SHA-256
  check that protects against corruption but not a compromised account (A1-A3). Both out; our installer is local Node code.

### 2.5 Other plugins already flagged in the owner's other project's notes
- **BadgeSpoofer:** fabricates Discord telemetry (fake game launches, play time, streams), stamps requests with a
  `badge_spoofer` marker, sets `has_client_mods: false` in invented super-properties, and can change the real HypeSquad house.
  It works by sending false data to Discord and risks account sanctions. **Recommendation: do not port.** Your call.
- **DXTokenImporter:** reads Discord tokens from other installs and decrypts them (DPAPI via PowerShell). Out unless you decide otherwise.
- **DMBomb:** mass DMs through the Discord API. Out unless you decide otherwise.
- Plugins not yet analysed: see header.

## 3. Comparison

| Property | TestCord | the owner's other project | Amiricord target |
|---|---|---|---|
| Contacts author servers | No for the engine; helper/links unverified | No | **Never** |
| Writes to account automatically | Yes (pronoun marker, default on) | No | **Never** without an explicit user action |
| DNS | Cloudflare DoH on by default | Untouched | Untouched; opt-in only, off |
| Telemetry block | Firewall + NoTrack, with a plugin exception | NoTrack | Both, **no exceptions** |
| Token handling | Strips on non-Discord hosts; IPC takes token | NoTrack/the owner's other project unchanged | Token never crosses an IPC channel; strip on non-Discord hosts |
| Remote code | BD loader, LiveFix, updater | None active | None in release builds |
| Mod flag to Discord | `false` via patch | `false`, measured 3 ways | `false` by design and **self-tested at startup** |
| Verification | By hand | By hand | Built-in report |

## 4. Fixed privacy rules for the Amiricord engine (proposal for owner approval)

These are engine guarantees, not plugin options. A plugin cannot switch them off.

1. **No traffic of its own.** The engine makes zero network requests except to Discord. No updater, no badge lists, no cloud. (Changed 2026-10-29: the Badges plugin also reads a badge list from the project's repository, by itself, at start and every 30 minutes. Changed 2026-10-28: it also sends the id of the person's own account, once per start, to the project's registry (`worker/`) and reads the list of registered ids every two hours. Changed 2026-10-28: the Updates tab, which only on a button press reads the project's GitHub releases; see `docs/decisions.md`.)
2. **No automatic writes to the account.** Profile, status, pronouns, bio, messages: only on an explicit user action,
   and only for plugins that declare an `account.write` permission in `plugin.json`. (Changed 2026-10-29: the Badges plugin writes an invisible mark to the person's own pronouns by itself, on by default, with one switch to stop it and remove the mark; see `docs/decisions.md`.)
3. **Telemetry off at two layers.** (a) Patch layer: stub analytics, metrics and Sentry, handle `TRACK` locally;
   no synchronous XHR. (b) Network layer: block Discord `science`, `track`, `metrics`, Sentry in the main process.
   One rule set, no plugin-specific exceptions.
4. **Mod flag not sent as telemetry** (same intent as Vencord's NoTrack, same ToS caveat: modding the client violates
   Discord's terms). Our globals do not use Vencord names. A **startup self-test** decodes the client's super-properties
   and reports `has_client_mods`; if it is not `false`, the report says so.
5. **Token protection.** Strip `Authorization` from non-Discord hosts. No IPC channel accepts or returns a token.
   Plugins reading the token need a declared permission and a visible warning.
6. **CSP built from enabled plugins only,** from the hosts each `plugin.json` declares, shown to the user. No external
   `script-src`. The need for `unsafe-eval` is documented and reduced where possible.
7. **DNS is not touched.** If a DoH feature ever exists it is an opt-in plugin, off by default, naming its provider.
8. **No remote code execution paths in release builds:** no updater downloads, no eval bridge, no BetterDiscord-style loader.
9. **Logs are local, bounded, and never hold tokens;** URLs are shown in memory only.
10. **Privacy report built in:** domains actually contacted this session (renderer and main process), blocked telemetry
    counters, `has_client_mods` result, plugins holding network or account permissions. Replaces the manual measurements in the owner's other project.
11. **Same measurement method as the owner's other project** (`senales-cliente.md`) for the stage 5 acceptance test, compared against
    the owner's other project and vanilla.

## 5. Open items
- Analyse in depth, one by one, before deciding: `osSpoofer`, `spoofmsgv2`, `systemMessageSpoofer`, and any other plugin you want to port.
- Re-trace the `PRIVACY_POST_SCIENCE_EVENTS` IPC call chain myself (taken from the owner's other project's notes for now).
- Read the rest of `trafficGuard.ts` and `dnsResolver.ts` (only the cited parts were read by me).
- Decide whether `fast-connect`/`sentry` bundles need their own handling of the mod-detection copy, or whether
  not defining the checked global names is enough. Measure, as in the owner's other project.
