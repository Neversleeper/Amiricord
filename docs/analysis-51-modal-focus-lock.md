# Analysis 51: text fields in plugin windows lose the focus (Discord's focus lock)

Status: written 2026-10-28 from the dev probe `module-search-modal-parts` on the owner's Stable (Discord build 652418). What is not verified is marked.

## The problem
In the window of a plugin's gear, a click on a text field loses the focus at once, and Discord sends it to a `div.item_caf372` of the server list (owner's report). Buttons work because they do not need to keep the focus.

## What the probe showed (code read in memory, never run)
- Discord has a Dialog (module 113325 here). The module exports three things (`MV`, `lG`, `zR`); `lG` is the public Dialog `f({ ref, returnRef, modal = true, setDialogRef, trackingProps, trackingComponentName = "Dialog", ...rest })`: it keeps its own inner ref, hands the element to `ref` (`useImperativeHandle`), calls the focus hook `tj(ref, { returnRef, disable: !modal })` and draws the inner box `A` (or its non-modal sibling `h`) with `{ ...rest, ref }`. `A` is a `div` with `data-dialog="modal"`, `role="dialog"`, `aria-modal`, `tabIndex=-1` whose children are wrapped in a focus lock (`containerRef` = that same ref). `A` itself is NOT exported, so the first try (looking for `A` by its strings) missed; the one to find is `lG`. A bigger Dialog (module 305866) does the same plus analytics hooks.
- That lock is what Discord's own windows use to keep the focus inside the top window; it is not on our window, which is drawn by the engine's own `ModalRoot` (`src/api/fallbackComponents.ts`) because Discord's window pieces were never found (analysis 32). The lock of the layer below (Settings) therefore takes the focus back when it goes to a field of ours. This is my reading of the code; **the mechanism is not verified**, only that Discord's windows carry the lock and ours does not.
- Discord's own card form disables its lock while a foreign input has the focus (`setFocusLockDisabled`), which agrees with the idea that the lock moves the focus out of anything it does not know.

## The fix
Our window keeps its own look (backdrop, sizes, header, footer) but its box is Discord's dialog box when that is found, so Discord's lock knows our container. Found by fixed strings only (`setDialogRef:`, `trackingComponentName:`, `returnRef:`, all in the source of the public Dialog), never by minified names; the inner box and the bigger dialog of the other module do not match all three. When it is not found, the plain window is used as before (a recorded miss, nothing breaks).
- The Dialog hands the element to our `ref`; our ref is an object, and in this path the focus is taken from an effect on mount instead of a callback ref; the plain path is unchanged.
- No new permission, no new API for plugins: `ctx.components.ModalRoot` is the same name, now with the lock when Discord has it.

## Not verified
- That the Dialog's props `className` and `aria-label` reach the div (read in the code: they travel in `...rest`), and that the Dialog accepts our ref object.
- That the lock then keeps the focus in a text field of the window (to be seen on the owner's Stable).
- Other Discord builds.
