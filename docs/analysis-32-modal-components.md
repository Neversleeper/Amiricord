# Analysis 32: the pieces of a window (modal components) and `ctx.components`

Written 2026-10-26 for Neversleeper, with the code of this step. What is not verified is marked. Follows analysis 27 (`ctx.modals`, which opens Discord's dialogs) and analysis 31. Needed by the window of Pinterest Tool (step 4).

## 1. What was asked and what was found
The owner asked for Discord's modal components "with their own alternatives". Reading the code:
- `src/api/common.ts`, `discordComponents.ts` and `fallbackComponents.ts` already hold the idea: each component has a finder for Discord's own version and a fallback of ours; a miss is recorded and ours is used.
- That layer was **not connected to anything**: nothing in the engine called `declareCommon`, no plugin could reach React or a component, and `FALLBACK_CSS` was never put in the page (only tests used them).
- Discord's window pieces (`ModalRoot`, `ModalHeader`, `ModalContent`, `ModalFooter`, `ModalCloseButton`) have **no snippet** to find them by: the earlier discovery run on Canary sampled only Button, Text and Heading, and the window pieces were not on screen then. Another mod's way of finding them rests on Discord's minified names, which change between builds.

## 2. What was built
- **Our own five pieces** in `fallbackComponents.ts`:
  - `ModalRoot`: a window with its own dark backdrop, centred, sizes `small` (440 px), `medium` (600), `large` (800) and `dynamic`; Escape and a click on the backdrop (not inside the window) call `onClose`; it takes the focus when it appears (and does not take it back on a redraw); `role="dialog"`, `aria-modal`, a label for screen readers.
  - `ModalHeader`, `ModalContent` (scrolls), `ModalFooter` (buttons on the right), `ModalCloseButton` (a "×" with an accessible name).
  - Their CSS in `fallbackStyles.ts`, with Discord's own colour variables first and plain defaults behind them, so the window follows the person's theme.
- **Their slots in `declareCommon`** as components with a finder that finds nothing yet (the same way Switch, TextInput and Select already were). They are used, and the miss is recorded once in the health report ("component ModalRoot"). The day a snippet is sampled from a real Discord, it is added to `COMPONENT_SNIPPETS` with its adapter; nothing else changes.
- **Why no guessed snippet:** a snippet that matches the wrong function would put a broken window on the person's screen, which is worse than ours. This matches the earlier decision for Switch and the inputs.
- **`ctx.components`** in the plugin context: React and the eleven components (Button, Text, Heading, Switch, TextInput, Select and the five window pieces). Each is a `CommonEntry`: `.get()` gives the component (Discord's if found, ours if not), or `undefined` only before React exists; `.usingFallback()` says which. Nothing is looked up until a plugin asks. **The fallbacks' CSS is added to the page the first time any component is asked for** (once, under the name `common`, and it stays), so a person who never opens a plugin window has nothing added.

## 3. How a plugin uses it
`const { ModalRoot, ModalHeader, ModalContent, ModalFooter, Button } = ctx.components;` then, inside the function given to `ctx.modals.open(props => ...)`, draw `<ModalRoot.get()! onClose={props.onClose}>...`. (JSX uses the engine's own runtime; the step-4 window will show the pattern.)

## 4. Not verified
- That Discord's modal layer accepts a window drawn this way: it may draw its own backdrop and centre children, in which case ours doubles the backdrop (cosmetic) or the two close on Escape together (harmless). Nothing ran in a real Discord.
- `position: fixed` inside Discord's layer (an ancestor with a transform would break it).
- The focus behaviour in a real browser (the tests use a fake `document`).
- That the look matches Discord's: the colour variable names are the ones Canary had when the other fallbacks were written (analysis 09 section 9).
- A discovery run on Stable to sample Discord's real window pieces: not done. It needs the development flag and the person opening a window.
