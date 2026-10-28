# Analysis 06: how TestCord detects and fixes broken patches

Reference only, in our own words. Read in TestCord commit `af92dbaec` and its git history:
`scripts/generateReport.ts` (all), `.github/workflows/reportBrokenPlugins.yml` (lines 28-120), the commit log of 2026-10-07 to
2026-10-19 (messages and the diffs of 6 commits), `src/preload.ts` (lines 20-60), `src/plugins/devCompanion.dev/README.md`.
Also uses the the owner's other project note `analysis/mantenimiento-patches.md` (manual procedure, tools list).

**Not read:** the VS Code extension behind `devCompanion`, the body of `devCompanion/*.tsx`, the other 43 fix commits (only counted),
and the bot on the receiving side of the webhook.

## 1. Detection: the daily reporter (CI)
- A scheduled job (every day at 00:00) builds a "reporter" version of the mod and runs `scripts/generateReport.ts`, once for Discord
  Stable and once for Canary at the same time.
- The script drives a **headless Chromium** (puppeteer) to Discord's **web login page** (`discord.com/login` or `canary.discord.com/login`),
  with the content security policy bypassed, and injects the mod before the page's scripts run. It never logs in.
- The mod's reporter (analysis 04 s5) loads every lazy chunk, requires every module, then tests every recorded finder.
- The script **reads the browser console** and classifies lines with regular expressions: `Patch by X had no effect / errored / found no module`,
  `Patch by X took N ms`, `Failed to start X`, `Webpack Find Fail`, plus any other console error from Discord. Known Discord noise is
  on an ignore list (about 9 patterns).
- Output: a report with sections (Bad Patches, Slow Patches, Bad Webpack Finds, Bad Starts, Discord Errors, Ignored Errors), written to
  the job summary and posted as embeds to a **Discord webhook**. The body is signed with an HMAC secret so the receiving bot can tell it is
  genuine (a comment says the webhook URL may be public, since it is a workflow input).
- A hard limit of 9 minutes prints a partial report and kills the browser instead of hanging.
- The report links to a third-party site that hosts Discord build dumps, using the build hash read from the page.
- It exercises only what loads **without being logged in** plus every chunk the loader can force. Patches on screens that only exist for a
  logged-in user are tested through the forced chunk loading, not through real use.

**Observation:** detection depends on **parsing the mod's own log text**. If someone rewords a log message, the report silently stops
seeing that failure. A structured event would not have this problem.

## 2. The alert goes to a person through a webhook
Their "notification" is a message in a Discord channel, produced by a server (GitHub Actions) that the maintainers run. There is no
connection from the mod on a user's PC to the maintainers. The `devCompanion` plugin's WebSocket is something else: a local link between
Discord and a code editor extension, for people writing patches.

## 3. How fixes really happen (the git history)
Between 2026-10-16 and 2026-10-17 a Discord update broke patches in dozens of plugins. In that window there are **49 commits** whose message is
"fix patch <plugin>" (plus "Attempt to fix 20 patches", "fix a bunch of patches", "fix more patches, fix crashes and a bunch of shit").
Another wave appears on 2026-10-07 to 10-10 ("fix a bunch of patches", "Fix more patches", "fix crashing & patches"). Fixes are made by hand,
one plugin at a time, by several people, and published as new versions.

Across the 49 commits, 680 changed lines: **149** touch a `match`, **111** a `replace`, **48** a `find`, **10** involve `#{intl::...}` markers,
**28** involve `predicate`, `fromBuild`, `toBuild` or `noWarn`.

**Fix patterns seen in the diffs read**
| Pattern | Example |
|---|---|
| Loosen a match that was tied to Discord's current code shape | a plugin that edits a list of tabs (the match also accepts a namespace prefix and a `;` ending, and the replacement keeps whatever followed) |
| Replace an internal identifier in `find` with a user facing text key | VoiceSettings (`pttReleaseDelay` became an `#{intl::...PTT_RELEASE_DELAY_LABEL}` marker; the match now anchors on neighbouring property names instead of a fixed value) |
| Match the neighbourhood (look-behind or look-ahead of bounded length) instead of one exact string | GifCaptioner (a match with a specific call shape became `children:[` followed within 100 characters by the target call) |
| Move the hook from wrapping a function to wrapping at the place it is used | ClickableRoles (a regex capturing a whole function body was replaced by a small match that swaps the component and passes the original in) |
| Fix an **engine API** patch, which affects every plugin that relies on it | ContextMenuAPI (class components cannot use `arguments`, so an empty array is passed there) |
| **Revert** a fix because it made Discord crash on every start | "Revert 'fix patch RealtimeTimestamps' cuz it crash looped" (2026-10-16) |

## 4. What this means for Amiricord
1. **Maintenance load grows with the number of ported plugins and patches.** Dozens of plugins broke within one update. A small
   plugin set with few, well anchored patches is the best defence, and each port should count its patches in its analysis.
2. **Patch writing rules** worth adopting in our patch guidelines (and checking in a future patch lint):
   anchor `find` on a fixed text, preferably an `#{intl::KEY}` marker, never on an internal minified name;
   use identifier wildcards (`\i`) and bounded neighbourhood matches; keep `replace` small and put logic in the plugin;
   avoid matching a whole function body.
3. **The crash-loop revert is real evidence for the boot counter** in design 02 (Q1): a "fixed" patch can crash Discord on every start,
   and the only way out for a user is a state the engine can detect and leave without help.
4. **Engine API patches are the most fragile and the most costly**: one break takes down every dependent plugin. The engine's own few
   patches get their own tests and a priority in every Discord update.
5. **Detection without a server:** the owners have no CI. Equivalent pieces: `tools/dump` + `tools/patch-test` (run every patch and finder
   offline against a Discord dump), the startup self-check, Canary as the early alert. A script run by hand, or by Windows Task Scheduler on a
   chosen PC, can write the same report to a local file.
6. **Structured events, not log parsing:** the reporter in Amiricord emits a JSON result (counts and per plugin outcomes) that the tools read.
7. **Alerts to the owners** (see design 02 s14): in the app first; sharing across two PCs needs either a manual export or an opt-in channel
   that the owners run themselves.

## 5. Open items
- Read `devCompanion` and decide whether a local editor link is worth having (a localhost WebSocket needs the same care as TestCord's LiveFix).
- Read a few more fix commits for patterns that show up in the 43 not read.
- Check what the "nelly" build site offers, if the owners want build dumps without extracting `app.asar` themselves (third party; privacy review needed).
