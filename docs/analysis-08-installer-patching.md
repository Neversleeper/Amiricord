# Analysis 08: how TestCord's installer patches Discord, and what Amiricord's installer does differently

Reference only, in our own words. Source: the public repository `TestcordDev/Testcordinstaller` (Go, GPL-3.0), files `patcher.go`,
`app_asar.go` and `find_discord_windows.go`, read on 2026-10-24 through a web summarizer (nothing downloaded or run). Line numbers
below are the summarizer's approximations; check them in the repository before quoting them. Nothing was copied.

## 1. What it does (the same mechanism as Vencord and the owner's other project)
1. Rename `resources\app.asar` to `resources\_app.asar`.
2. Write a new `resources\app.asar`: a tiny asar archive with `index.js` (`require(<JSON-encoded path>)`) and `package.json`
   (`{"name":"discord","main":"index.js"}`).
3. Unpatch: rename the loader to `app.asar.tmp`, rename `_app.asar` back to `app.asar`, delete the temporary file.
4. Already patched? It unpatches first, then patches again.
The loader points at `testcord.asar` inside its data folder, or at a path from environment variables.

## 2. Weak points found (all avoided by our design)
| TestCord installer | Amiricord installer |
|---|---|
| Does not check that `_app.asar` already exists before renaming (on Unix a rename overwrites silently). | Classifies the state first and refuses to continue when it is not a state it knows. |
| `cleanupDesyncedPatchedInstall` deletes `_app.asar` when `app.asar` is not a loader, before any backup. If its guess is wrong the only copy of Discord's file is gone. | Never deletes the original. A desynced install is backed up and then handled by `repair`, with the owner's confirmation. |
| Rollback walks the renames in forward order; if one fails it prints "probably bricked" and continues. | Rollback in reverse order, a journal of every step, and a verified backup taken first. |
| The loader is written straight to `app.asar`; a crash can leave a truncated file. | Written to a temporary file and renamed. |
| "Is a loader" is a substring test (`package.json` text and `require(`) on a file of at most 128 KB. | A marker line, an exact content check and a size limit. |
| Closing Discord kills the first matching process only, ignores errors and never checks that files are free. | Lists every process, asks Discord to close normally, force-closes only with an explicit flag, and checks that none is left. |
| "Patched" means only that `_app.asar` exists. | Eight states (pristine, patched, patched folder, another mod's loader, desynced, broken, unsupported, leftovers). |
| Install order of results depends on map iteration (random). | Fixed order. |
| Loader path comes from three environment variables without validation. | A fixed folder, `%APPDATA%\Amiricord\dist`. No environment overrides in the product. |
| If the loaded file is missing, Discord does not start. | The loader falls back to Discord's original app when our file is missing or fails to load. |

## 3. Things TestCord does that we should look at
- It unpatches before patching again. Our `repair` does the equivalent, but only after the state check.
- `CheckScuffedInstall`: it looks for a Discord folder named after the user under `%PROGRAMDATA%` and handles it. We do not know what
  that case is. The installer will only warn when such a folder exists, and do nothing about it, until the case is understood.
- Flatpak, system Electron and `.unpacked` folders: Linux only, out of scope for now.

## 4. The asar format
Its writer pads the JSON header with the character `0`, not with zero bytes; the size field still holds the unpadded length, so
readers ignore the padding. Our writer pads with zero bytes. Both layouts have to be accepted by Electron; the real proof is
Discord Canary starting with our loader (first test, step 4e).
