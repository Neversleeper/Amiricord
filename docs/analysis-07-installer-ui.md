# Analysis 07: the terminal interface of TestCord's installer

Reference only, in our own words. Source: the public repository `TestcordDev/Testcordinstaller` on GitHub, files `go.mod` and
`cli.go` (main branch, read on 2026-10-24). The pages were fetched through a summarizing tool, not downloaded, so the quoted strings
below were relayed by that tool and may differ in small details from the raw file. Nothing was downloaded or run.

**Not read:** the other Go files, the graphical interface (the module list shows a GUI library too), and what `promptui` draws by
default. The statements about how `promptui` looks are general knowledge about that library, not something read in this repo.

## 1. What it is
A command line program written in **Go**, a fork of Equicord's installer, that `pnpm inject` downloads and runs
(`scripts/runInstaller.mjs`, see `docs/analysis-02-privacy.md`). It also contains a graphical interface (GUI libraries are in `go.mod`).

## 2. How the menus work
- **Libraries for the terminal:** `github.com/manifoldco/promptui` (selection menus with arrow keys, and text prompts) and
  `github.com/fatih/color` (colored text). Key handling is entirely done by `promptui`; the installer's own code does not read keys.
- **Main menu**, label `What would you like to do? (Press Enter to confirm)`, with the items:
  Install TestCord, Repair TestCord, Uninstall TestCord, Install OpenAsar, Uninstall OpenAsar, View Help Menu,
  Update Testcordinstaller, Quit. It is skipped when an action flag is given.
- **Choosing a Discord install** (`PromptDiscord`), label `Select Discord install to <action> (Press Enter to confirm)`. Each item is shown as
  `<Branch> - <path>`, followed by `[TestCord Installed]` when it is already patched, plus a final item `Custom Location`, which asks for a path
  (`Custom Discord Location`) in a loop until it is valid (`Invalid Discord install!`).
- **Colors:** the code only colors the **last line**: bright green `✔ Success!` or bright red `❌ Failed! If this issue persists, see <support url>`.
  The rest of the look (highlighted line, pointer) comes from `promptui`'s own defaults.
- **Small details:** a wrapper removes the terminal bell character; on Windows, when started by double click, it ends with `Press Enter to exit`;
  if it is outdated it tells the user to pick `Update Testcordinstaller` or run `--update-self`.
- **Flags:** `--install`, `--repair`, `--uninstall`, `--install-openasar`, `--uninstall-openasar`, `--location`, `--branch auto|stable|ptb|canary|development`
  (`--location` and `--branch` cannot be combined), `--update-self`, `--help`, `--version`, `--debug`.
- A custom path check looks for the text `com.discordapp` where it probably means a custom location; likely a bug in their code.

## 3. What we keep, what we leave out
| Idea | Amiricord |
|---|---|
| Arrow keys and Enter to choose, one question per screen | Yes |
| List of installs with the branch, path and whether it is already patched | Yes, plus the Discord version and the patch state (as in the the owner's other project injector) |
| `Custom Location` | Yes |
| Colored success and failure lines | Yes, and more colors (see design below) |
| Actions: install, repair, uninstall | Yes, plus `status` |
| `OpenAsar` install and uninstall | No (a third party replacement of Discord's program; out of scope) |
| `Update Testcordinstaller` / `--update-self` | No (the installer never updates itself or downloads anything) |
| A graphical installer | Not planned |

## 4. Proposed look for Amiricord's installer (to approve)
Written in Node with **no new dependencies**: ANSI color codes and Node's own `readline` key events.
- **Menu:** the current line has a pointer (`›`) and is shown in bold cyan; the others are normal. Up and down arrows move, Enter chooses,
  the digits work as shortcuts, Esc or Ctrl+C cancels without changing anything.
- **Install list:** `Canary · app-1.0.1281 · not patched`, with the path in dim gray. Patched shows in green, damaged or unknown in yellow.
- **Messages:** green `✔` for success, red `✖` for failure, yellow `!` for notes, dim gray for paths and details.
- **Safety lines before a change:** what will be touched, where the backup goes, how to undo it (as the owner's rules ask).
- **Not an interactive terminal** (output redirected, or `NO_COLOR` set): no colors and no arrow menu; the same options by flag.
- **Stable is not blocked.** The owner chose this on 2026-10-24. The tool lists Stable like the others, makes a backup first, and prints a
  plain note, nothing more.
