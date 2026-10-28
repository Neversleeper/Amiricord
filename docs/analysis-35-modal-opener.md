# Analysis 35: Discord's modal opener (the crash of Ctrl+Shift+P)

Written 2026-10-26 for Neversleeper. What is not verified is marked.

## 1. What happened
On Discord Stable app-1.0.9265 (build 649389) the owner turned Pinterest Tool on and pressed Ctrl+Shift+P. Discord showed its "Well, this is awkward" crash screen. The Discord log (`renderer_js.log`) has one error at that very second: `TypeError: I is not iterable`, a minified name, so it comes from Discord's own code, not from ours (our bundle keeps its names). `health.json` shows the five window pieces were asked for (our fallbacks were used, as designed), so the plugin reached the point of opening the window.

## 2. Most likely cause (not verified)
`ctx.modals.open` finds Discord's opener by a snippet of its code, `modalKey:` (analysis 27, marked there as unverified). That text appears in more than one function of Discord's modal code (for example the lazy opener, which takes a different kind of argument), so the finder can return a function that is not the plain opener, and Discord's code then fails on what we pass it. The other mods find the plain opener by a different snippet (`onCloseRequest:null!=` for the opener and `onCloseCallback&&` for the closer, from memory, not checked against this build).

## 3. What this step does
- Dev mode only (the `dev.flag` file): the module search of the engine also looks for `modalKey:`, `onCloseRequest:null!=`, `onCloseCallback&&`, `.onCloseCallback()`, `MODAL_PUSH` and `MODAL_POP` in Discord's code in memory and writes `module-search-modals.json` into the probe folder (redacted like the other dumps). From that file the right snippets are chosen and checked against the real code, then `buildModals` is changed and tested.
- Nothing about the plugin changes until then. Until the snippets are checked, **pressing Ctrl+Shift+P on this build can crash Discord**; the way out is turning the plugin off.

## 4. Not verified
Everything above about which function the finder returns. The dump is what settles it.

## 5. What the dump showed (2026-10-26, Discord build 649389)
The dev search found `modalKey:` in six modules: payment and checkout flows, a group-chat editor, an "urgent message" alert and others, all of which call Discord's lazy opener with `{modalKey: ...}`. So a finder on `modalKey:` alone could return any of them; the one it returned crashed on our arguments.
The real opener is in module 192308 (the same module that exports `closeModal` and `openModalLazy`). Its code takes the options `{modalKey, dismissable, instant, Layer, onCloseRequest, onCloseCallback, backdropStyle, stackingBehavior, stackNextByDefault, allowsNavigation}` and stores `{key, ..., render: e, ...}` (our render function) in its own store; it returns the key. The closer in the same module reads the stored entry, removes it and calls `onCloseCallback()`.
Changes: the opener finder now needs all of `stackNextByDefault:`, `dismissable:` and `onCloseCallback:` in one function (names of options, which do not change with the minifier, unlike variable names); the closer finder stays `.onCloseCallback()` (found in that module only). `modals.open` now catches an opener that throws, and the window is drawn inside the error boundary, so a failure shows a message and goes to the health report instead of the "Well, this is awkward" screen.
Still not verified: that the window opens and looks right through this opener (a real run is needed).
