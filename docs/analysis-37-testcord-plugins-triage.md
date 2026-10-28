# Analysis 37: TestCord's plugins, sorted by how much work each one needs

Written 2026-10-25 for Neversleeper. The owner (with szlcx404's agreement, as she says) wants the TestCord plugins in Amiricord, switched off by default and without using RAM. This note says what is in TestCord's three plugin folders and how many could come over without building new engine pieces first. Read-only: a script read the text of each plugin's entry file in the clone `af92dba` (kept in the scratchpad, not in the repository); no plugin was run, installed or copied. All numbers come from simple text matching, so they are estimates, not exact.

## 1. What is there
| Folder | Entries | Real plugins (`definePlugin`) | With patches | With a `native` part (main process) | No patches, no native |
|---|---|---|---|---|---|
| `plugins` (Vencord's) | 166 | 164 | 124 | 9 | 36 |
| `equicordplugins` | 200 | 198 | 116 | 12 | 77 |
| `testcordplugins` | 468 | 466 | 130 | 54 | 294 |
| **Total** | 834 | 828 | 370 | 75 | 407 |

- **Licence:** 693 entry files carry `SPDX-License-Identifier: GPL-3.0-or-later`, 134 carry the GPL-3.0 text, 1 has no header. The licence is compatible with Amiricord's (GPL-3.0-or-later), but every adapted plugin must keep the copyright and credits of its authors (project rule). One file without a header must be checked by hand. Not checked: the licence of any other file in a plugin folder (assets, native parts).
- **What they import** (how many plugins use each TestCord module): `@api/Settings` 507, `@webpack/common` 602, `@utils/types` 828, `@utils/constants` 693, `@webpack` 235, `@api/ContextMenu` 150, `@utils/discord` 111, `@api/Commands` 85, `@components/Icons` 81, `@utils/modal` 80, `@api/HeaderBar` 68, `@api/ChatButtons` 44, `@api/Notifications` 42, `@api/Styles` 40, and more.

## 2. What Amiricord has today
`src/api` has the plugin settings, styles, the Discord component layer (`common`, with fallbacks), the Plugins cards and the switch. It does **not** have the equivalents of `ContextMenu`, `Commands`, `HeaderBar`, `ChatButtons`, `Notifications`, the modal helpers or the Discord utilities. Those are what most plugins call.

## 3. How many could come over soon
Counting only plugins with **no patches and no native part** that import nothing outside `@utils/types`, `@utils/constants`, `@api/Settings`, `@webpack/common`, `@webpack` and `@utils/Logger`: **about 81** (6 in `plugins`, 14 in `equicordplugins`, 61 in `testcordplugins`). These are the candidates for a first wave, each still needing a manifest (permissions, credits, licence), adapted imports, a test and a check in Discord.
The other ~750 need something first:
- **~370 have patches.** Our patch format is similar in spirit (`$self`, `\i`, find/replace) but it was never tried on code written for TestCord, and each patch text must match today's Discord build. Each one needs its own check.
- **75 have a native part** (code in the main process). The build does not bundle plugin main-process entries yet (it says "Not bundled yet" in its output), and a plugin running in the main process is the riskiest kind for privacy.
- **Most of the rest** call APIs Amiricord has not built (`ContextMenu` 150, `Commands` 85, `HeaderBar` 68, `ChatButtons` 44, `Notifications` 42, modals...). Each of those is an engine piece of its own (code, tests, commit).

## 4. Why "all, and test them" cannot be done in one step
- **Testing:** the unit tests use fakes; a real check needs the plugin running in a real Discord, which only the owners can do, one plugin or small group at a time, on the Discord they agree on (the rule in `CLAUDE.md` still says Canary only).
- **RAM:** the lazy loading done in analysis 36 stops the code of an off plugin from running, but all plugin code still travels inside `renderer.js`. With hundreds of plugins that file would grow by megabytes (it is 571 KB with two plugins). To keep RAM and start time low, plugin code would need to be loaded only when switched on, which needs a request-free way to load a separate file (not designed yet).
- **Privacy:** several plugins send things over the network or to Discord's servers. Each one needs its permissions declared in its manifest so the firewall and the CSP know; that is done by reading each plugin.

## 5. Proposal
1. **Pilot:** adapt 3 plugins from the 81 (the smallest ones: for example `noMiddleClickPaste`, `dontRoundMyTimestamps`, `noNitroUpsell`, each 30 to 40 lines), with manifest, credits, tests and a check in Discord. Measure how long it really takes and what breaks.
2. **First wave:** the rest of the 81, in small groups, each group its own commit after the owner's OK and after being tried in Discord.
3. **Engine pieces** in the order the plugins ask for them (ContextMenu and Commands first, which cover the most plugins), each with its own analysis.
4. Decide with szlcx404 how plugin code is loaded without growing `renderer.js` before the list gets long.
5. Update `docs/decisions.md` with both owners' words (it still says "no mass import").

## 6. Not verified
- That the text matching classified every plugin correctly (a plugin whose patches are built in code or whose entry is not `index.ts` may be misread).
- That any of these plugins works with Amiricord's API; none was tried.
- The licence and origin of assets and native parts inside the plugin folders.
- The names used as examples above were picked by line count, not by reading the plugins.
