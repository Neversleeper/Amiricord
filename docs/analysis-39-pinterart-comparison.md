# Analysis 39: the updated Pinterest Tool of the other TestCord author ("Pinterart v17.0-dev") against ours

Written 2026-10-26 for Neversleeper. The folder was given as `PinterestTool.rar` (260 KB); it was read in `probe/friend-pt/` (git ignores `probe/`) and **nothing in it was run**. What is not verified is marked.

## 1. What was asked
"Leave his interface as it was; compare the search of both and keep ours if it is better, his if not; and improve everything."

## 2. What the archive holds
| File | Lines | What it is |
|---|---|---|
| `components.tsx` | 2639 | The whole interface: results browser, favourites, the editor (crop, effects, text and image layers, paint, GIF), appearance panel, profile modal |
| `style.css` | 1758 | Its styles (loaded as a "managed" style) |
| `index.tsx` | 771 | The plugin: adds the Pinterest button to Discord's "Select an Image" dialog, decides avatar or banner, hands the result to Discord's own editor (Apply/Cancel) |
| `native.ts`, `searchRanking.ts`, `shared.ts` | 652 / 108 / 358 | Search, ranking, settings and types |
| `effects.ts`, `gif.ts`, `paint.ts` | 478 / 492 / 417 | Colour effects, GIF decode/encode, the colour brush (`paint.ts` is new) |
| `i18n.ts` | 57 | English and Spanish, plus 30 more locales for core navigation, right-to-left |
| `README.md`, `ATTRIBUTION.md`, `LICENSE`, `icon.*` | | GPL-3.0-or-later; modifications are credited to `szaleniec1327` (author/creator/maintainer), derived from Vencord's PinterestSearch |

## 3. The search: compared line by line
Both come from TestCord's Pinterest Tool at commit `af92dba`. **His `native.ts`, `searchRanking.ts` and `shared.ts` are the same code as the version we adapted**: a `diff` of the earlier copy (read on 2026-10-25) against this archive shows only a blank line and licence headers. So there is nothing in his search that ours lacks. Ours adds, on top of the same behaviour:
- the Pinterest cookie lives in the main process as a secret (`host.secret`) and is never an argument from the page; his takes it as a search argument from the page's settings;
- every network hop goes through the declared hosts (`*.pinterest.com`, `i.pinimg.com`, `s.pinimg.com`) with every redirect checked, timeouts and a size cap; his uses the host's plain `fetch`;
- the plugin cannot reach DeviantArt or any other host (his README speaks of a "Together" search with DeviantArt, but his `native.ts` has no DeviantArt search: it only keeps the hosts for favourites saved by older versions);
- tests (59 for the search, 29 for favourites, 17 for the theme) and a mutation check.
**Decision: keep our search.** Not verified: that his README's "Together"/sorting claims are implemented in his UI only (the sorting by resolution and best fit is in `components.tsx`; it works on the results we also return).

## 4. The interface: what keeping it means
His interface is the one the owner wants. It is written against Vencord/TestCord's own APIs, so keeping it as it was means **porting it, not rewriting it**: same screens, same classes, same CSS, same texts. What it needs from the host, and what Amiricord gives:
| It uses | Amiricord equivalent |
|---|---|
| `@api/DataStore` (favourites, recent searches, presets) | `ctx.storage` (already used by our `Library`) |
| `ModalRoot`, `ModalHeader`, `ModalContent`, `ModalCloseButton`, `openModal` | `ctx.components` (our window pieces) and `ctx.modals` (opener fixed in analysis 35) |
| `useState`, `useEffect`, `useMemo`, `useRef`, `useLayoutEffect` | Discord's own React through `currentReact()`; `useRef`, `useMemo` and `useLayoutEffect` must be added to `ReactLike` |
| `showToast`, `Toasts`, `copyWithToast`, `openImageModal`, `saveFile`, `classes`, `Logger` | small own versions in one `host.ts` of the plugin (toast element, clipboard, download link, `console`) |
| `FluxDispatcher`, `findByPropsLazy` | `ctx.common` / `ctx.finders` |
| `LocaleStore`, `useStateFromStores`, `getIntlMessage` | `ctx.common` store by name and a small subscription; Discord's own labels only through its intl store when found, else the English text |
| `style.css?managed` | the CSS as a string through `ctx.addStyle` |
| `PluginNative` | `ctx.native` (typed with `nativeOf`) |
| `TestcordDevs.szcx404` | `plugin.json` authors and credits |
`effects.ts`, `gif.ts`, `paint.ts` and `searchRanking.ts` have no host imports and come over almost as they are.

## 5. The integration with Discord's picker
`index.tsx` finds the "Select an Image" dialog by its labels with a `MutationObserver`, inserts the Pinterest button under "Upload Image / Choose GIF", decides avatar or banner once per dialog (the newer code, kept), and hands the finished picture to Discord's own editor and waits for Apply. This is the "button in the picker" and the "hand-off to the profile" we had planned for steps 6 and 7, already written, with fixes for the problems its author found (a wrong target, a wrong editor detected, the Nitro upsell dialog). It is ported with the rest. It needs real testing in Discord (it depends on Discord's labels).

## 6. Plan (one piece at a time, each with its tests and a check on the real Discord)
1. **Host layer** (`host.ts`) and the extra React hooks in `ReactLike`; port of `i18n.ts`, `effects.ts`, `gif.ts`, `paint.ts`, `searchRanking.ts` (ours stays for the search). Tests for the pure parts with a mutation check.
2. **Interface**: `components.tsx` and `style.css` ported with their classes and texts unchanged, wired to our search, storage and secret cookie. Smoke tests with fakes for every screen.
3. **Integration**: `index.tsx` (picker button, target, hand-off to Discord's editor), settings, credits, attribution.
4. **Improvements** found while porting, each with its own test.
Our own window (`PinterestWindow`, `EditorView`) is replaced by his interface once it works; until then both are in the tree and nothing is deleted.

## 7. Credits and licence
The archive is GPL-3.0-or-later like us. Its notices are kept in every file we adapt, `ATTRIBUTION.md` and `LICENSE` come with it, and `plugin.json` credits `szaleniec1327` as author of the plugin and Vencord/PinterestSearch as origin (the `szcx404` name in the TestCord source is the same plugin; the archive's own attribution names `szaleniec1327` as maintainer, so both are written).

## 8. Not verified
- That the port works: nothing of it is written yet.
- How his interface looks and behaves in Amiricord's Discord: it needs a real run.
- His README's claims about sorting and locales beyond what the code shows.
- ~~That `szcx404` and `szaleniec1327` are the same person~~ Both names are credited as each file states them (licence credit). Not checked by me against GitHub.

## 9. What was built (2026-10-26, same day; still local, nothing committed)
The four steps were done in one go because the owner asked for it ("empezá todos los pasos, no preguntes").
- **Host layer** `src/testcordplugins/PinterestTool/pinterart/host.ts`: the names his screens import (`DataStore`, `Modal*`, `ModalSize`, `showToast`/`Toasts`, `copyWithToast`, `saveFile`, `openImageModal`, `openExternal`, `Logger`, `classes`, `FluxDispatcher`, `ReactDOMPortal`, the five hooks, `Native`) built on `ctx.storage`, `ctx.components`, `ctx.common`, `ctx.native` and the React Discord runs. `ReactLike` got optional `useRef`, `useMemo`, `useLayoutEffect`. The fallback `ModalRoot` now accepts `className`, `style` and `dir`.
- **His code, ported with its classes, texts and CSS unchanged:** `components.tsx`, `effects.ts`, `gif.ts`, `paint.ts`, `i18n.ts` (English only; the locale store hook is a no-op), `icon.ts`, `styles.ts` (his `style.css` as one string). Changes: imports, `any` casts removed, a few indents and one `==`, all listed in the git diff against `probe/friend-pt/`. `searchRanking.ts` is not copied: his screens import ours (same code).
- **Picker integration** `pinterart/picker.tsx` (his `index.tsx`): the Pinterest button under "Upload Image / Choose GIF", target decided once per dialog, hand-off to Discord's editor with Apply/Cancel detection. Differences: Discord's own label strings are not read (no stable finder), so the English texts are used; the window opens through `ctx.modals` inside the error boundary. Ctrl+Shift+P opens the same window without the dialog.
- **Search:** ours. `Native.search(query, perPage, filter, bookmarks, kind, randomize)` of his calls maps to `search({ query, mediaFilter, target, bookmarks, randomize })`; the page size is the main process's.
- **Manifest:** version 0.3.0; `permissions.system` now declares `clipboard` and `openExternal` (the build refused the plugin until it did: his screens copy links, paste pictures and open the pin); credits list the Pinterart interface by szcx404 (also credited as szaleniec1327).
- **Not carried over from his plugin:** his `native.ts` and `shared.ts` settings (replaced by ours), `README`/`LICENSE` files (the licence is the project's; the credit is in `plugin.json`).
- `tsconfig.node.json` now has the `DOM` lib because a test imports the plugin entry (shared config: tell szlcx404).

Tests: `pinterartHost` (25), `pinterartScreen` (10, a small React of our own that runs his screen: search, cards, hearts, hand-off to Discord's editor, direct apply to the profile), `pinterartPlugin` (5), plus one in `modalComponents`. Mutation check of the host layer, the entry and the modal change: 51 mutations, first run 2 survivors (a missing `await` on a storage write, the portal fallback), fixed with tests, 0 survivors. NOT mutation-checked: his own screen code (about 6000 lines, foreign); it is covered by the smoke tests above and has to be tried in Discord.
Not verified in a real Discord until noted otherwise below: the picker button, the hand-off, `createPortal` lookup, the look of his CSS inside our modal, GIF decode, paint.

## 10. Other Discord languages (2026-10-28)
Seen on a Discord set to Spanish, on an account without Nitro ("Selecciona una imagen", "Subir imagen", "Elegir GIF"): the Pinterest button did not appear. Cause: the picker was found by English words only ("Upload Image" and "Choose GIF"), and the hand-off to Discord's editor looked for English "Apply" and "Cancel".
- `pinterart/labels.ts` (new): Apply, Cancel and Close in about 25 languages, and `isGifTileLabel` (a short label with the word GIF in it, in any language).
- `picker.tsx`: when the English words are not found, `findTileRow` finds the "Choose GIF" tile by that label, takes the smallest big ancestor as the tile and its row (the nearest ancestor with a second child); a dialog with a text box is ignored (the chat's GIF search). The editor detection and the Apply/Cancel clicks use the word lists.
- Tests: `pinterartLabels` (5), mutation check 10 mutations, 1 survivor explained (an empty text cannot match the GIF pattern anyway).
- Not verified: the structural search in a real Spanish Discord (the picker seen in Spanish has the same two tiles), the translations other than English and Spanish (written from common usage), the window's own texts (still English only, so a Spanish person sees the Pinterest window in English). Nitro: the screenshot shows the picker of an account without Nitro has both tiles (the GIF tile carries a Nitro mark), so the button should appear; the hand-off on such an account is not tried.
