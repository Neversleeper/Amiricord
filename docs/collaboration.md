# How szlcx404 and Neversleeper work together

Written 2026-10-25 from the owners' answers. Rules for Claude are in `CLAUDE.md`; decisions are in `docs/decisions.md`.

## Who works where (for now)
| Owner | Area | Main files |
|---|---|---|
| **szlcx404** | The privacy engine and the **Privacy & Security tab**: request hub, firewall, host rules, token guard and CSP, encrypted DNS, NoTrack, the tab itself | `src/main/*`, `src/plugins/NoTrack`, `src/shared/{shields,hostRules,health,ipc}.ts`, `src/plugins/Settings/PrivacyTab*` (to come), the installer |
| **Neversleeper** | The **Plugins tab** of the Settings plugin: the list of plugins with their cards (name, authors, origin, permissions, risk), the switch of each one (core plugins locked), restart notice, search and filters | `src/plugins/Settings/PluginsTab*` (new files), `src/api/pluginCards.ts` and `src/api/pluginSwitch.ts` (already there), tests of their own |
| Both | Shared core: the engine, the Settings plugin's shell, the build, the manifest format | `src/renderer/engine.ts`, `src/plugins/Settings/{index,tabLayout,mainItems,icon}.tsx`, `src/api/*`, `src/webpack/*`, `scripts/build/*`, `src/shared/manifest.ts` |

The two areas touch only a few shared lines (registering a tab in `src/plugins/Settings/index.tsx` and `tabLayout.ts`, an icon in `icon.tsx`). Those edits are small and are the likely place for a merge conflict: whoever joins second resolves it.
A change to a shared core file does not need the other owner's approval first (decided 2026-10-27); the pull request and the commit message say which shared files were touched, so the other owner can see it.

## A start for the Plugins tab
- Read `docs/analysis-11-testcord-tabs.md` (what TestCord's Plugins tab does and what was found weak) and `docs/design-03-settings.md`.
- The data is ready: the Settings plugin receives `ctx.plugins.cards()` (one plain-data card per plugin: id, name, version, description, authors, origin, licence, credits, permissions, whether it has patches, state, why it runs, `core`), `toggle(id, enabled)` and `restart()`. See `src/api/pluginCards.ts` and `src/api/pluginSwitch.ts`.
- A core plugin always runs (`core: true`): its switch must be shown locked. A plugin that is off is not loaded.
- Order of work as everywhere: code, tests, a commit per piece, and a Canary check.

## Branches
- `main` always builds and passes the checks. Nobody works directly on it.
- Each owner works on branches named `<github user>/<topic>`: `szlcx404/p5-token-guard`, `Neversleeper/plugins-tab`.
- Bring `main` into your branch often (`git fetch origin` then `git merge origin/main`) so conflicts stay small.
- GitHub cannot protect `main` on a free private repository, so "nobody pushes to `main`" is an agreement.

## Joining the work
Claude does the joining, the owner approves (steps in `CLAUDE.md`, section "Joining work"): bring `main` in, resolve conflicts, run typecheck, lint, tests and build, check on Canary when Discord is touched, show the summary, then push and open a pull request. The other owner can read it and try it on their Canary before it is merged. Merges are normal merge commits.

## Trying the other person's work
```
git fetch origin
git switch <their-branch>        # or: git switch main after it was joined
pnpm install
pnpm build
pnpm inject --branch canary      # always with --branch canary
```
To go back: `pnpm uninject --branch canary`. A verified backup is made before every inject, in `%APPDATA%\Amiricord\backups`.
