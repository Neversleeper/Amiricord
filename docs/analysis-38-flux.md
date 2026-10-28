# Analysis 38: `flux` for plugins (Discord's event bus)

Written 2026-10-25 for Neversleeper, after the fact: the piece was built at the owner's order to keep adding TestCord plugins without asking at each step. What is not verified is marked.

## 1. Why
TestCord plugins list the Discord events they react to in a `flux: { EVENT(data) {} }` map. In the clone read for analysis 37, `flux:` appears in 18 of the Vencord plugins, 36 of Equicord's and 85 of TestCord's (counted by text, so approximate). Without it, each of those plugins has to find the dispatcher and subscribe by hand.

## 2. What was built
- `PluginCode.flux` (`src/renderer/engine.ts`): a map from event type to handler.
- `src/api/flux.ts`: `subscribeFlux(dispatcher, handlers, report)`. One callback per event type; a handler that throws or returns a rejected promise is reported against its plugin (health report, source `flux <TYPE>`) and never reaches Discord; the function returns the undo that unsubscribes everything.
- Engine wiring: after the plugin's `start()` has finished (awaited if async), the engine waits for Discord's dispatcher through the plugin's own finder (`byProps("dispatch", "subscribe")`, the same shape TestCord uses) and subscribes; the undo is registered with `onDispose`, so switching the plugin off, or a failed start, takes every subscription back. A plugin without `flux` keeps its synchronous start exactly as before.
- Tests: `tests/flux.test.ts` (pure) and three tests in `tests/engine.test.ts` with a fake Webpack module standing for the dispatcher. Mutation check: 11 mutations, the 2 first survivors were an unreachable guard (removed: the lifecycle never stops a plugin that is still starting) and a missing test for an async `start()` (added); all real mutations killed after that.

## 3. Not verified
- That `byProps("dispatch", "subscribe")` finds the dispatcher and not another module in today's Discord (it is the shape TestCord uses; nothing here was run in Discord).
- That Discord's dispatcher accepts `unsubscribe` with the same callback we gave (the usual Flux API; not seen).
- The order in which Discord calls handlers of different plugins.
- What happens to events dispatched while the plugin waits for the dispatcher (they are missed; the dispatcher exists very early, so this should be rare).

## 4. What it does not cover
TestCord's other plugin hooks (`commands`, `contextMenus`, `renderMessageDecoration`, `toolboxActions`...) have no equivalent yet; see analysis 37.
