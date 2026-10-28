# Analysis 25: engine pieces still missing for TestCord plugins

Written 2026-10-25 for Neversleeper. The owner asked to keep adding TestCord plugins one by one, starting with an analysis of which engine pieces are missing: context menus, commands, top bar, chat buttons, notifications, modals. Nothing is built here, this is the plan. Everything marked "not verified" was not seen.

## 1. Sources and limits
- The counts come from analysis 37 (text matching over TestCord commit `af92dba`, 828 plugins). That clone is **not on this PC** (it lived in the earlier cloud workspace), so no TestCord file was re-read for this note. A plugin that uses several of these APIs is counted once per API, so the numbers overlap and cannot be added up.
- What Amiricord has today was read in the repository: `PluginCode` has `patches`, `settings`, `flux`, `start`, `stop`; the plugin context has `finders`, `addStyle`, `reportError`, `onDispose`; `src/api/common.ts` finds Discord's React and components with our own fallbacks. Nothing else.

## 2. The pieces, by how many plugins ask for them
| Piece | TestCord plugins that import it | What the plugin gives | Needs from Discord |
|---|---|---|---|
| `@webpack/common` names (stores, moment, `UserStore`, `ChannelStore`...) | 602 | Nothing; it reads | A set of named finders (`ctx.common`) |
| ContextMenu | 150 | A function that adds items to a right-click menu, by menu name | Patch on Discord's menu renderer, or a hook on the menu module |
| `@utils/discord` helpers | 111 | Nothing; it calls helpers (open a channel, copy, send a message) | Several small finders |
| Commands | 85 | A slash command: name, options, `execute` | Discord's command registry (the part most likely to change between builds) |
| Modals (`@utils/modal`) | 80 | Calls `openModal` with a React tree | Discord's modal module (finder only) |
| HeaderBar | 68 | A button for the top bar of a channel | Patch on the header renderer |
| ChatButtons | 44 | A button next to the message box | Patch on the chat bar renderer |
| Notifications | 42 | Shows a notification (toast or system one) | Our own toast (no Discord dependency) or `Notification` API |

## 3. Proposed order, and why
1. **`ctx.common` (stores and utilities).** The most used and the least risky: only finders, no patches, and it unlocks plugins that today have to find a store by hand. It follows the same fallback/miss-report pattern as `common.ts`.
2. **Modals.** Finder-only, so low risk; unlocks every plugin that opens a dialog and is a base for the Notifications' confirm cases.
3. **Notifications.** Can be built with no dependency on Discord's code (our own toast layer on top of `addStyle`), so it cannot break when Discord updates. The system notification variant needs a permission decision (see section 5).
4. **ContextMenu.** The biggest unlock (150) but it patches Discord's renderer, so each Discord build can break it. Needs a patch that fails open (menu without our items, never a broken menu) and a health entry.
5. **ChatButtons and HeaderBar.** Same kind of risk as ContextMenu; do them after it so the shared "add an item to a Discord list" code is reused.
6. **Commands.** Last: 85 plugins, but it depends on Discord's internal command registry, which changes often, and a bad registration can show up as a broken `/` list for the user.

Each piece: code, tests with fakes, a separate commit, then a check in Discord.

## 4. Plugins that need none of these
Per analysis 37 about 81 plugins need only what exists (finders, settings, `flux`, styles). Four are done. The next ones can keep coming while the pieces above are built; they do not wait for them.

## 5. Decisions for the owners
- **Where each piece lives.** `src/api` and `src/renderer/engine.ts` are shared core files: szlcx404 must be told before they are joined to `main`.
- **System notifications** would touch the main process (`src/main`, szlcx404's area) if they go through Electron; the page-only `Notification` API would not. Which one: not decided.
- **Permissions in the manifest.** A plugin that shows system notifications, opens external links or sends messages for the user should declare it; `docs/design-01-manifest-permissions.md` has no such permission yet. Needs both owners.
- **Plugins that act for the user** (send messages, commands that automate the account) were left out before on purpose; Commands and ChatButtons make them easy to add, so the same rule applies when they get to that point.

## 6. Not verified
- That any of these Discord modules (menu renderer, header, chat bar, command registry, modal module) has the same shape on Stable `app-1.0.9265`; nothing was run in a real Discord.
- That the counts in section 2 are right (text matching, from analysis 37).
- How TestCord itself implements each API: its clone was not available for this note, so the sizes of the pieces are estimates, not measurements.
