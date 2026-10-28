# Design 04: Editor Mode and Settings Tabs

Owner's request (2026-10-25): the header card "SETTINGS TABS / Amiricord / Editor Mode" and the editor it opens, like TestCord's.
Reference read: TestCord `src/plugins/_core/settings.tsx` (lines 97-561, the editor and its storage) and
`src/components/settings/tabs/vencord/VencordTab.css` (lines 77-381, the look).

## What TestCord does
- Four saved lists: visible tabs, known tabs, order, pinned. A "known" list exists only to tell a hidden tab from a brand-new one.
- The main tab is locked: always first, always visible, cannot be pinned or dragged.
- Pinned tabs go right after the main one; the rest follow the saved order.
- It hides and reorders the sidebar by **searching the page's elements for the tab's text** and changing their CSS (`display: none`, `order`).
  It retries up to 10 animation frames. A tab whose title is also text somewhere else can be matched by mistake.
- Editor: "Editor Mode" pill (becomes "Done"), a text, a "Sidebar Preview", a grid of chips (drag handle, icon, name, Pin, On/Off/Locked),
  "Toggle all off" / "Add all tabs back", "Restore original layout", and a toast with Undo after hiding.

## What we do differently (and why)
1. **One saved list instead of four.** We save `hidden`, `order` and `pinned`. A tab that is not in `hidden` is visible, so a tab added later
   shows up by itself and no "known" list is needed.
2. **We change the tree, not the page.** The Settings plugin already builds the list of tabs for Discord's tree (`buildLayoutWithSection`).
   The saved layout is applied there (`visibleTabs`), so nothing searches elements by their text and nothing flickers.
3. **Pure functions** in `tabLayout.ts` (no React, no Discord): parse, apply, hide, pin, move, restore. They are tested on their own.
4. **Safe storage.** The layout is one text setting (`tabLayout`, JSON, at most 4000 characters). Anything wrong in it (not JSON, wrong
   shapes, too many or too long keys, the main tab in `hidden`/`pinned`) gives the default layout or is dropped. It never throws.
   Keys of tabs that do not exist at the moment are kept in storage (a plugin may be off for now) and only ignored when drawing.
5. **Undo inside the editor** (a small bar "X hidden. Undo") instead of a Discord toast, so we do not depend on Discord's toast module.

## Open point
"Changes apply instantly": TestCord can promise it because it edits the sidebar on the page. We apply the layout when Discord builds the tree.
Whether Discord builds it again while Settings stays open is only known by testing on Canary. If it does not, the editor says
"Changes apply the next time Settings opens" and we look for a way to make Discord rebuild it.

## Files
`src/plugins/Settings/tabLayout.ts` (pure), `TabsEditor.tsx` (the card and the editor), wiring in `index.tsx`, CSS in `styles.ts`,
tests `tests/tabLayout.test.ts` and in `tests/settingsTabs.test.ts`.
