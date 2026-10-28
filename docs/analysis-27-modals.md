# Analysis 27: `ctx.modals`, opening Discord's dialogs from a plugin

Written 2026-10-25 for Neversleeper, before the code. What is not verified is marked.

## 1. Why
80 of TestCord's 828 plugins import its modal helpers (analysis 25). A modal is Discord's own dialog window; a plugin gives a function that draws its content. It needs no patch: Discord already has the functions that open and close it, a finder reaches them.

## 2. What is built
- `src/api/modals.ts`: `buildModals(...)` gives each plugin `ctx.modals` with:
  - `open(render, options?)`: asks Discord to open a modal and returns its key, or `undefined` when Discord's opener is not found (the miss is recorded against the plugin; nothing breaks: fail-open).
  - `close(key)`: closes one modal of this plugin.
  - `closeAll()`: closes every modal this plugin opened and has not closed.
- **Cleanup:** the first `open` registers one undo with the plugin's lifecycle, so switching the plugin off (or a failed start) closes its modals instead of leaving a dialog whose code is gone. This is what a hand-written `openModal` does not give.
- A throw while closing is swallowed (the modal may already be closed by the person) and reported against the plugin.
- The finders: opener by code `modalKey:`, closer by code `.onCloseCallback()`. They are the snippets Vencord uses for these functions, written from memory.
- `ctx.modals` in the plugin context (`src/renderer/engine.ts`).

## 3. Not built
- Discord's modal components (`ModalRoot`, `ModalHeader`, `ModalContent`, `ModalFooter`) are not here: they belong to `src/api/common.ts` (components with fallbacks) and come with the first plugin that needs them.
- `openModalLazy` (a modal loaded later), and a confirm dialog helper.

## 4. Not verified
- That the two code snippets find the right functions in Stable `app-1.0.9265`; Discord renames and reshapes these. A wrong snippet only gives a miss and `open` returns `undefined`.
- The exact arguments of Discord's opener (`render` receiving `{ transitionState, onClose }`, options with `modalKey`, `onCloseRequest`, `onCloseCallback`) and that it returns the key.
- That closing a modal the person already closed does nothing bad.

## 5. Shared files
`src/renderer/engine.ts` and `src/api` (shared; szlcx404 said they may be edited).
