# Analysis 45: a switch that stays blocked while a plugin starts

Written 2026-10-26 for szlcx404, who reported: "some plugins show a switch but pressing it does not turn them on, and the clicks on them stay blocked". Rewritten the same day after reading how TestCord does it (the first version of the fix used a grace timer and polling; the owner asked why TestCord needs no timer, and the answer led to this simpler design).

## 1. The cause (in our code)

- A plugin of Amiricord waits for Discord's objects **inside `start()`** (`ctx.finders...ready()`, up to 60 seconds), so that the engine knows whether it really started.
- `PluginSwitch` served **one change at a time for all plugins** (one global queue). A plugin that waited for a module of Discord held every other switch behind it, and each card stayed "on its way" with a blocked switch until the queue reached it.

## 2. How TestCord does it (read in `src/api/PluginManager.ts`, `startPlugin` and `stopPlugin`, and in `components/settings/tabs/plugins/PluginCard.tsx`, `doToggle`)

- `startPlugin` is **synchronous**: it calls `p.start()` in line and answers true or false at once. It never waits for Discord.
- A plugin with patches only saves "enabled" and asks for a restart; one without patches is started on the spot; a failure shows a notice and puts the switch back.
- A plugin that needs a module of Discord asks for it lazily, in the background, after its start has already returned. A `start()` that returns a promise is not awaited, so a later failure is not seen as "failed to start".
- So TestCord has **no timer in the toggle**: nothing in it waits. The price is that "enabled" does not mean "working".

## 3. The design (replaces the first version of this fix)

We keep what is better than TestCord (the card says "starting" and then "on" or why it did not start) and drop what caused the blocking:

1. **One line of changes per plugin, not one for all.** Changes to the same plugin go one after the other (two quick clicks never interleave a start and a stop); changes to different plugins do not wait for each other.
2. **No grace timer, no polling.** The tab waits in the background for the answer of that plugin only and writes the final sentence when it arrives. While it waits, the card says "Starting X... if it has to wait for something in Discord this can take up to a minute." (or "Turning X off...") and only that card's switch is blocked.
3. **The same plugin clicked again while it starts** waits for that start (it is in the same line), then does what the second click asked: an "off" stops it right after it started, so nothing is stopped half started.
4. **Plugins that need each other.** What two plugins both need is started once. What a plugin needs cannot be turned off while that plugin is running **or waiting to start**; a plugin cannot be turned on while what it needs is being turned off. A failed start of what is needed is the failure of the plugin that needs it.
5. The only limit left is the one the finders already have (60 seconds), after which the start fails and says why.

## 4. Not changed

The finders' 60 seconds, the lifecycle, any plugin, and the rule that a plugin with patches changes after a restart.

## 5. Not verified

In a real Discord: a plugin whose start waits for a module (the original report) is not yet tried on the owner's Stable. The code is covered by tests with fakes (36 plus 18 new for the line of changes), not by a real run.
