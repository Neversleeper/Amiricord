# Amiricord: rules for Claude (and for people) working in this repository

Amiricord is a Discord client mod engine for Windows, written from scratch by its two owners, **szlcx404** and **Neversleeper**, under GPL-3.0-or-later.
Read `README.md` first, then `docs/collaboration.md` (who works where and how work is joined), then the design notes in `docs/` that touch your area.
Each owner keeps a personal log on their own PC, `CONTEXTO-<github user>.md`. It is NOT published: git ignores it (it holds working notes and personal details). Never commit it and never copy personal details from it into the repository.
Decisions that concern both owners go into `docs/decisions.md`.

## Language
Everything inside the project (code, comments, docs, commit messages, logs) is in **English**. Talk to the person you work with in the language and style they ask for, and explain jargon simply.

## Rules that never change
- **Asking.** Claude stops and asks before: a commit or push; installing, downloading or running something new, or touching a real Discord; deleting anything; anything sent or published outside the machine; a decision the owner has not made. Do not invent orders or work that was not asked for; what the person says now outranks old plans. One commit per piece. Never force-push `main`.
- **Write down everything** the person asks or decides, at once, in their log (`CONTEXTO-<github user>.md`).
- **Analyse only when asked.** Analysis notes, designs and reports (`docs/analysis-NN-...`, `docs/design-NN-...`) are written only when the owner asks for them in words. A plugin is never analysed on Claude's own initiative, and asking to adapt a plugin does not mean reading everything it does: read what the port needs. Always say what was not verified.
- **Test only on the Discord the owner names** (today his Stable; Canary before). Never pick a branch yourself or leave it to the menu (its first option is Stable): always pass `--branch <name>`. Installing closes Discord by force: warn first, and never do it while the owner is in a call.
- **Back up before touching a real Discord** (the installer does it and verifies the copy) and say how to undo (`pnpm uninject --branch <name>`).
- **Never read private Discord chats, never paste or store tokens, passwords or keys.** Never put personal data in the repository (user names in paths, e-mails, IDs of private people). Development dumps live in `probe/`, which git ignores.
- **Say what you could not read or verify.** A result that was not seen is "not seen", never a pass. Report failures as they are.
- **No permanent deletions** without explicit confirmation; prefer renaming.
- **Before installing or running anything new,** say what it is, where it goes and what it does, and wait for the OK.
- **TestCord, the owner's other project and similar projects are read-only references.** Do not run their installers. Credits and licence headers are written only for code that is ADAPTED from another project, Either owner may bring a plugin in from another project without asking the other first (see `docs/decisions.md`).
- **Privacy design:** nothing is sent anywhere by the engine, with TWO exceptions (`docs/decisions.md`): (1) the Updates tab (decided by both owners, 2026-10-28), which only when the person presses a button asks the project's GitHub releases for `update.json` and the four engine files, and installs nothing whose SHA-256 differs from the one in the release; (2) the Badges plugin (decided by Neversleeper, 2026-10-29; the registry part 2026-10-28 with szlcx404's agreement to sending the account id), which is a core plugin (always on, no switch: it is how people who use Amiricord recognise each other), reads the owners' badge list from the repository's `badges/` folder at start and every 30 minutes, tells the project's registry (a Cloudflare Worker, `worker/`, at `amiricord-registry.amiricord.workers.dev`) the id of the person's own account once per start, reads the list of registered ids every two hours, and writes an invisible mark to the person's own pronouns (the card says "Writes to your account"). Safe mode does not stop it. The page cannot change protections on its own word; a failing check lets traffic through (fail-open) and reports instead of breaking Discord.

## Checks (all must pass before a piece is joined to `main`)
```
pnpm typecheck        # three tsc configurations
pnpm lint             # eslint. --fix only for @stylistic/* rules on named files, with the diff shown after; never repository-wide; every other rule by hand
pnpm test             # node test runner, tests/**/*.test.ts
pnpm build            # builds dist
```
In Windows PowerShell write `pnpm.cmd`; in cmd.exe plain `pnpm` works. Never change the PowerShell execution policy.

## Where things live
| Folder | What |
|---|---|
| `src/main` | Main-process side: request hub, firewall, boot trace, settings and health stores, Electron glue |
| `src/preload`, `src/renderer` | The bridge and the engine that runs in Discord's page |
| `src/webpack` | Finders, patches, module hook |
| `src/api` | What plugins can use (settings, styles, plugin cards, Discord components) |
| `src/shared` | Code used by both sides (settings, health, manifest, host rules) |
| `src/plugins` | Plugins. Core ones (`core: true`, cannot be switched off): `NoTrack`, `Settings` |
| `src/installer`, `scripts` | Installer (`pnpm inject` and friends) and the build |
| `tests` | Tests with fakes (no Discord needed) |
| `docs` | Analyses (`analysis-NN`), designs (`design-NN`), decisions |

A plugin is a folder with a `plugin.json` manifest (see `docs/design-01-manifest-permissions.md`). A plugin that is switched off is not loaded.

## Areas and branches
See `docs/collaboration.md`. In short: **szlcx404** works on the privacy engine and the Privacy & Security tab; **Neversleeper** works on the Plugins tab of the Settings plugin. Either owner may change the shared core files (`src/renderer/engine.ts`, `src/api`, `src/webpack`, `src/shared/manifest.ts`, `scripts/build`) without asking the other first; the pull request and the commit message say which shared files were touched, so the other owner can see it.
Work on your own branch named `<github user>/<topic>`; never work directly on `main`.

## Joining work (Claude does it, the person approves)
When a piece is finished and the checks pass, the person asks Claude to join it. Claude:
1. `git fetch origin` and brings the latest `origin/main` into the branch (`git merge origin/main`), resolving conflicts by keeping the intent of both sides and telling the person what was decided;
2. runs all the checks again and, when the piece touches Discord, a Canary check;
3. shows the person the summary and waits for the OK;
4. pushes the branch and opens a pull request (or merges into `main` when the owners agreed to skip it), with the merge as a normal merge commit so the one-commit-per-piece history stays.
