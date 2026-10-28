# Analysis 46: a confirmation window that looks like Discord, and still cannot be answered by the page

Written 2026-10-26 for szlcx404, who saw the pause window (a plain Windows message box) and said it should look like Discord's.

## 1. Today

- `electronGlue.ts` asks every weakening change (telemetry off, pause, reset, strict DNS, unblocking a site) with `dialog.showMessageBox`: a window of the main process. The page cannot press it or answer it. That is the whole point: a page that could click "Agree" could weaken protection on its own word.
- The window is the system's, so it looks foreign (light, Windows frame, a blue "i").

## 2. Why not a dialog inside the tab

A box drawn in the page, even if it looks perfect, is page code: a plugin or script running in the same page can click its button or fake the answer. It would break the rule "the page cannot change protections on its own word". So the question stays in the main process.

## 3. Proposal (to be approved before any code)

1. **P1. One small window of the main process, drawn like Discord** (dark, no system frame, the same words and two buttons as now), opened with `BrowserWindow` as a child of the focused window and modal to it.
2. **P2. The page of that window is ours, local and fixed.** It is built by the main process from the question's text (title, detail, button), loaded as a `data:` or local page with no network, no preload bridge to anything but one private answer channel, `sandbox: true`, `contextIsolation: true`, no navigation, no new windows, `webSecurity` on.
3. **P3. The answer comes back by a channel that only that window can use** (the sender is checked against the window's own `webContents`), never from Discord's page. Closing the window, pressing Escape, or losing it all mean **Cancel**.
4. **P4. Plain text only.** The question's text is put in with `textContent`, never as HTML, so a name inside a question (a blocked site's host) cannot inject anything.
5. **P5. If the window cannot be made, the system dialog is used as today** (fail to the safe side: the change is never applied without an answer).
6. **P6. Same behaviour as today:** one question at a time (already enforced by the changer), the default button is Cancel, and nothing is applied after a no.

## 4. Not changed

The changer (`privacyChange.ts`), what is asked, and every other part of the tab. Only `confirm` in `electronGlue.ts` changes, plus a new file for the window.

## 5. Not verified

- How it looks and behaves on the owner's Windows (focus, Escape, Enter, a second monitor, the window behind Discord): not seen yet.
- The new window file would be pure where possible (building the page, deciding the answer), with fakes for Electron; the Electron part itself is not covered by tests, as with the rest of `electronGlue.ts`.
- Whether a modal child window can be reached by Discord's page through any of its own APIs: not checked beyond the settings in P2.

## 6. Open question

Should the new window look like a copy of Discord's own dialog (its colours and the same button shapes), or only be dark and clean? Proposal: Discord's dark colours and rounded buttons, no Discord logo or name.
