# Analysis 49: a plugin's own settings component (`settingsComponent` in `PluginCode`)

Owner's request (2026-10-27): "could you add to `PluginCode` an optional field, for example `settingsComponent?: ComponentType<{ onClose(): void }>`".
It changes the plugin API of the engine. Follows analysis 48 (the gear and its window).

## What exists
- `PluginCode` (`src/renderer/engine.ts`) is what a plugin's code gives the engine: `patches`, `settings` (declared with `definePluginSettings`), `flux`, `start`, `stop`.
- The window of the gear (`PluginWindow.tsx`) draws the declared settings as rows (switch, number, text, drop-down). A plugin that needs something
  else (a colour picker, a list the owner edits, a preview) has no way to draw it.
- The project has no `ComponentType` (it has its own `ReactLike`, `src/api/common.ts`), so the type is written with plain function types.

## What this piece does
1. `PluginCode.settingsComponent?: PluginSettingsComponent`, with `PluginSettingsComponent = (props: { onClose(): void; }) => unknown` (a function component;
   `unknown` as the other places that return React elements). Defined in `src/api/pluginSettings.ts`.
2. Core-only `ctx.plugins.settingsComponentOf(id)`: the component of a plugin whose code is running (attached), or `undefined` (off, unknown, nothing given,
   or something that is not a function). Like `settingsOf`, a plugin that is off is never loaded to find out.
3. The window of the gear draws it in the Settings section, **below the declared rows**, inside its own error boundary (a component that throws shows a short
   message there and is reported, and the rest of the window keeps working). `onClose` closes the window. A plugin that gives the component and declares no
   settings no longer says "There are no settings for this plugin".
4. The build scan counts a `settingsComponent` property as "has settings", so the card shows the gear and not the "i".

## Not decided / not verified
- It is drawn by the page's React with the plugin's own JSX; it can do anything the plugin's code can do (it runs in the page already). It gets no extra power.
- For a plugin that is off the component is not available (its code is not loaded): the window says to turn it on, like for declared settings. The
  `settings.ts` convention of analysis 48 does not cover components; a component needs the plugin's code.
- Not seen in a real Discord. The click problem in the gear window (reported 2026-10-27) is open and may affect this too.
- The name `settingsComponent` follows the owner's example; `settingsAboutComponent` of other mods (an info box, not settings) is a different thing and is not added.

## Shared files
`src/renderer/engine.ts` and `src/api/pluginSettings.ts` (shared, said in the commit message), `scripts/build/manifest/scanSource.ts`.
