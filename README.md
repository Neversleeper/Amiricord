# Amiricord

A new Discord client mod engine for Windows, created by its two authors and owners,
[szlcx404](https://github.com/szlcx404) and [Neversleeper](https://github.com/Neversleeper).

**Status: early development.** The engine, the installer, the Settings page and the first privacy pieces (self-test, NoTrack, request hub, firewall shields and host rules) build and run on Discord Canary. Plugins are still few: only the two core ones exist.

Modifying the Discord client is against Discord's Terms of Service. Use it at your own risk.

## Goals

- Startup time and idle CPU no worse than vanilla Discord, and less memory than other mods.
- Per-plugin declared permissions (network hosts, native code) enforced by the engine.
- A patch-health report and a safe mode for plugins whose patches fail after a Discord update.
- A `plugin.json` manifest per plugin (origin, license, risk, hosts).
- No wasteful work in plugins, no calls to third-party servers, honest documentation.

## Try it on Discord Canary

You need Windows, [Node.js](https://nodejs.org) 22 or newer, [pnpm](https://pnpm.io) and Git. Test **only on Canary**, never on Stable.

```
git clone https://github.com/szlcx404/amiricord.git
cd amiricord
pnpm install
pnpm build
pnpm inject --branch canary
```

`pnpm inject` makes a verified backup, patches Canary, closes it if it is open (unsaved drafts are lost) and opens it again. In Discord, open User Settings and find **Amiricord** under "Amiricord Settings".
To go back: `pnpm uninject --branch canary`. Without `--branch canary` the installer shows a menu whose first option is Stable: do not choose it.
In Windows PowerShell write `pnpm.cmd` instead of `pnpm`.

### Where Amiricord keeps its files

`%APPDATA%\Amiricord\<branch>\` has one folder per patched Discord (`stable`, `canary`, `ptb`): its engine (`dist`), settings, host rules (`firewall.json`), health report and `boot-trace.log`. The two Discords never share them, so a different version can run on each. The installer's verified backups of Discord's own files are kept together in `%APPDATA%\Amiricord\backups`. A Discord patched by an older installer keeps using the old shared folder until you run `pnpm inject --branch <branch>` on it again (that run also copies your old settings and host rules into the new folder and leaves the old files where they are).

### Canary or Stable?

Everything so far (the engine, the patches, the installer) has been verified **only on Discord Canary**, never on Stable. Start on Canary: it is a separate, free install, so your everyday Discord is not touched. If you try it on Stable anyway, it is the same command with `--branch stable` (undo: `pnpm uninject --branch stable`); the installer makes a verified backup first, but nothing here has been verified on Stable, and Stable is the account you use every day.
Discord updates often and can stop a patch from matching; the engine reports it in the health report and has a safe mode for that case. `pnpm inject` without `--branch` shows a menu whose first option may be Stable: always pass `--branch`.

How the two owners work together: [docs/collaboration.md](docs/collaboration.md). Rules for Claude: [CLAUDE.md](CLAUDE.md).

## Commands

These mirror TestCord's workflow.

| Command | Purpose |
|---|---|
| `pnpm build` | Build `dist`. |
| `pnpm inject` | Choose a Discord install and patch it (verified backup first, closes and reopens Discord, coloured progress lines). |
| `pnpm uninject` | Choose an install and remove the patch. |
| `pnpm repair` | Choose an install and re-apply the patch after Discord updated. |
| `pnpm status` | Show the patch state of an install. |
| `pnpm installer` | The full menu (also restore from a backup, with a plan and a confirmation). |

The installer is written in Node. No prebuilt third-party installer is downloaded or run.

## Testing

Only in Discord Canary. Data lives in `%APPDATA%/Amiricord`. Stable Discord is never patched.

## Layout

```
src/main        Electron main process
src/preload     preload bridge
src/renderer    renderer entry
src/api         plugin APIs
src/webpack     Discord module access and patching
src/utils       shared helpers
src/components  UI components
src/plugins           our own plugins (each with a plugin.json)
src/vencordplugins    plugins adapted from Vencord (credit and license kept)
src/equicordplugins   plugins adapted from Equicord (credit and license kept)
src/testcordplugins   plugins adapted from TestCord (credit and license kept)
src/betterdiscordplugins   plugins adapted from BetterDiscord (credit and license kept; the folder exists, nothing is in it yet)
src/shared      code used by every process (project name, owners)
scripts         build and installer scripts
tests           tests
docs            documentation
```

## License

GPL-3.0-or-later. Code adapted from other projects keeps its original license header
and attribution.
