# Analysis 52: patches on modules that load late, and what health.json says

Status: written 2026-10-28 from the code (`src/webpack/moduleWrapper.ts`, `patchRegistry.ts`, `src/renderer/engine.ts`, `src/shared/health.ts`). Not tested in a real Discord; what is not verified is marked.

## How late modules are patched today (read from the code)
- The module list `wreq.m` is replaced by a Proxy. Every factory Discord registers, now or later (lazy chunks included), is wrapped when it is set.
- A wrapped factory is patched the first time Discord RUNS it, with the patches that still wait. So a lazy module is patched if the plugin's patch was registered before the module ran. A module that never runs is never patched; one that already ran before the patch was registered cannot be patched afterwards.
- Every compile sends a `patch` event (status `applied`, `partial`, `failed`, `undone` or `skipped`), at that moment, early or late. The main process records each event in `health.json` (a delayed write).
- `patch-no-module` is judged ONCE, `cleanBootDelayMs` (5 s) after the page is ready, for the patches not marked `lazy` that have found no module by then. A required one counts as a patch failure of the session. Before this piece, nothing took that notice away when the module loaded later and the patch applied.

## What changes
1. **Late match settles the notice** (`src/shared/health.ts`, `settleNoModule`): a `patch` event for a plugin and find that already have a `patch-no-module` issue removes that issue, and takes away as many session patch failures as that issue had added (never below zero). A `skipped` patch (outside the Discord build range) does not settle it, because its module was not found. If the module was found but the patch partly failed, the no-module notice goes and the real failure (`patch-no-effect`, ...) is recorded instead. Nothing else changes: the event types and the engine are the same, so there is no new message from the page.
2. **Dev dump for the Quests strings** (`module-search-quests`): the dev-mode search also looks for `QUEST_HOME)},[]),`, `.ALL)}):(` and `questNameHeadingId`. Every hit now carries `loaded` (the module already ran: noted by the module wrapper, or present in the module cache when Discord exposes it). The file is written every round even with no hit, because "not found" means its chunk has not been downloaded yet, which is an answer.

## Not verified
- In a real Discord: that a Quests patch that was judged "no module" and applies later clears the issue in `health.json`.
- That `loaded` matches reality for every module (Discord's bundler does not expose its module cache, so it relies on the wrapper noting each module that ran).
- A module that loads after the dump ran its last round (12 rounds of 10 s) is not seen by the dump.
