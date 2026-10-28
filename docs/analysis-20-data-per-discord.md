# Analysis 20: one data folder per Discord

Written 2026-10-25 before the code, after the owner said that Canary and Stable "should not stay in the same folder". Sources: the installer (`src/installer/commands.ts`, `dist.ts`, `scripts/installer.ts`),
`src/main/mainController.ts` (`dataDirectory`), `src/main/index.ts`, `src/main/electronGlue.ts`, and what happened on 2026-10-25 when Amiricord was in Canary and Stable at the same time. Nothing was run for this note. **Not verified** items are marked.

## 1. The problem
Every install of Amiricord uses the same folder, `%APPDATA%\Amiricord`: the engine (`dist`), the settings, the boot state and quarantine, the health report, the host rules, the development flag and the probe dumps, the boot trace and the backups.
With two Discord installs patched (Canary and Stable, later PTB) this means:
- They run **the same engine files**: updating the engine for one updates the other at its next start, so a change meant to be tried on Canary reaches Stable too.
- They share **one settings file, one boot state (quarantine and safe mode), one health report and one `firewall.json`**. A plugin that fails on one Discord can be quarantined on the other; the health report mixes sessions of different Discords.
- Two processes write the same files. It already happened: both wrote `probe/request-census.json` (fixed by giving each process its own file name, which only hides the wider problem). The writes are atomic (temporary file and rename), but "last writer wins" is still wrong for state.
- The development flag (`dev.flag`) switches the census on for **every** Discord, including the everyday one.

## 2. The idea
**Each patched Discord gets its own folder** under the shared parent:
```
%APPDATA%\Amiricord\
  backups\            installer backups of all Discords (their names already start with the branch); stays shared
  stable\             dist\, settings.json, state.json, health.json, firewall.json, dev.flag, boot-trace.log, probe\
  canary\             the same, only if Canary is patched
  ptb\                the same, only if PTB is patched
```
The main process already works out its folder from where its own files are (`src/main/index.ts` uses `dirname(__dirname)` for the trace), and the loader the installer writes points at `<folder>\dist\main.js`. So the change is mostly in the installer, which copies the build into `<branch>\dist` and writes the loader for that path. Two small changes in main: `startMain` takes the folder it was given (from `index.ts`) instead of rebuilding `%APPDATA%\Amiricord` from the environment (`dataDirectory`), so there is **one rule** for the folder; and the engine no longer depends on an environment variable to find it.

### 2b. Do Canary and PTB need their own clone of the repository?
No. The folder of the repository (for example the one on the Desktop) is only where the code is built. `pnpm inject --branch <branch>` **copies the build** into that Discord's own folder, and the loader points to that copy, not to the repository. So one clone can patch Stable, Canary and PTB, and the clone could even be deleted afterwards (the engine would keep running; updating it needs a clone again).
A second clone (or `git worktree`) is only useful to run **different versions of the code** on different Discords, for example a tested version on Stable and a work-in-progress branch on Canary: build in the clone you want and inject with its `--branch`. This is exactly what is **not safe today**, because all Discords share one `dist`: injecting one version for Canary would also change Stable's engine. With one folder per Discord it becomes safe.

## 3. What changes, piece by piece
- **Installer:** `distPaths(dataDir)` is given the branch's folder; `inject`, `uninject`, `repair`, `status` and the overview use it; `restore` and the backups keep the shared `backups\` (names carry the branch, so existing ones stay valid). Messages name the branch folder.
- **Main:** `startMain` receives `dataDir` (the folder above `dist`); `dataDirectory(env)` stays only as a fallback for tests and for the case the loader does not say.
- **Open Settings Folder** opens the folder of the Discord it is running in (it already opens the main process's own folder, so it follows).
- **Development mode** becomes per Discord: the flag goes in the folder of the Discord you want to observe (for example only Canary).
- **README and `CLAUDE.md`:** the folder layout and where to look (`%APPDATA%\Amiricord\<branch>\boot-trace.log`).

## 4. The move from today's layout (the owner has Amiricord only in Stable now)
Today everything is in the root of `%APPDATA%\Amiricord`. Proposed, with nothing deleted:
1. `pnpm inject --branch stable` (which is also how an engine is refreshed) finds the old root layout and **copies** the owner's `settings.json` and `firewall.json` (if there is one) into `stable\`; it does **not** copy the health report, the boot state, the probe dumps, the boot trace or the development flag (those are per-session noise or must start clean).
2. It writes the loader for `stable\dist\main.js` and the next start uses the new folder.
3. The old root files are **left where they are**; once the owner confirms that all works, they are moved by hand into a folder called `legacy-before-per-discord` (renamed, not deleted).
**Not verified:** how the loader behaves if Discord starts while the move is half done; the installer already writes the loader as the last step and checks it, so a failure leaves the old loader and the old folder working.

## 5. Risks and unknowns
- A Discord patched by an **older** installer still points to the old folder: it keeps working with the old files until it is injected again. Both layouts must keep working for that transition.
- The engine's own tests use one data folder; they keep working because the folder is a parameter. New tests: the installer puts each branch in its own folder, the other branch's folder is never touched, the old layout is copied (settings and rules only), and nothing is deleted.
- Backups stay shared on purpose: they are about Discord's files, not about the engine.
- The friend's PC starts with the new layout, so nothing to migrate there.

## 6. Questions for the owners
1. Layout as in section 2 (a folder per Discord under `%APPDATA%\Amiricord`, shared `backups\`)? **Proposed: yes.**
2. Move only `settings.json` and `firewall.json` (copy, never delete) and start the rest clean? **Proposed: yes.**
3. The development flag per Discord, so Stable stops being observed unless the flag is put in its folder? **Proposed: yes.**
4. Do this piece **before** continuing with P5b, so the token guard is tried in the final layout? **Proposed: yes.**
