# Analysis 34: the Pinterest Tool image editor (step 5)

Written 2026-10-26 for Neversleeper, with the code of this step. What is not verified is marked. Follows analysis 33 (the window). Handing the result to Discord's profile is step 6 and is NOT part of this step.

## 1. What was asked, and what is in and out
Asked: "el editor (recorte, deshacer, presets, etc.)". From the owner's earlier list of ideas for the plugin, this step takes: **crop frame** (fixed shape: 1:1 for icons, 5:2 for banners; zoom and move), **rotate and flip**, **colour adjustments**, **built-in presets and presets the person saves**, **undo and redo**, **before/after**, **reset**, and **save the result to a file**.

Left for later, on purpose: GIF trim/speed/crop (needs a GIF decoder and encoder; the original also skips animated GIFs in its effects step, so a GIF shows "cannot be edited yet"), drag-and-paste of the person's own image, named collections, matching pairs, "more like this", profile preview, applied history. Applying to the profile is step 6.

## 2. Design
The work is split so that everything that decides is plain data and numbers, tested without Discord or a canvas:
- **`editorModel.ts`:** the edit as data (`EditState`): output kind, rotation (0/90/180/270), flips, zoom (1 to 8) and centre of the crop, and the adjustments. Pure functions change it and always clamp (a value outside its range, `NaN` or a bad colour is refused). `cropRect` / `planOutput` turn it into pixels: the biggest rectangle of the right shape that fits the (rotated) picture, divided by the zoom, kept inside the picture; the output is at most 512x512 (icon) or 1200x480 (banner) and never larger than the crop (no upscaling). `EditHistory`: up to 50 steps, undo/redo, and a drag of a slider or of the picture counts as **one** step (steps with the same gesture key are merged until the gesture ends). Built-in presets, and `PresetStore`: the person's own presets in `ctx.storage` (at most 30, names cleaned and cut to 30 characters, same name replaces, every stored preset is rebuilt through the clamps when read).
- **`pixelFilters.ts`:** the colour maths on a raw RGBA array, in this order: brightness, contrast, saturation, hue, grayscale, sepia, tint. Alpha is never touched.
- **`editorSession.ts`:** the state of one open editor (loading, ready, error; history; before/after; presets; notices) and every click. It asks for the picture, draws and saves through injected functions, so it runs in tests with fakes. Late answers after closing are ignored.
- **`editorCanvas.ts`:** the thin real part: draws the plan on a `<canvas>` (rotate, flip, crop, scale, then `applyAdjustments`) and makes a PNG. Only typecheck covers it; no test runs a real canvas.
- **`EditorView.tsx`:** sliders, preset chips, crop controls (zoom, arrows, drag on the picture), rotate/flip, undo/redo/reset, before/after, save to file. A card in the grid gets an "Edit" button.

## 3. Decisions
- Edits are non-destructive: the original is kept and the whole edit is drawn again from it.
- The picture comes through the main process (`fetchMedia`) like the thumbnails, then `createImageBitmap`. Pictures wider or taller than 8192 px are refused.
- Saving to a file is a click of the person, through the browser's own download; nothing is sent anywhere.
- The original's "effects step" setting (`effectsStep`) is not used yet; with the profile hand-off (step 6) it will decide whether the editor opens before applying.

## 4. Not verified
- Anything that needs a real canvas: the drawing, `createImageBitmap` with real pictures from Pinterest, `toBlob`, the look of the sliders in Discord's modal.
- Performance of the colour maths on a 1200x480 picture at every slider move (the tests only check the numbers).
- Pointer dragging on the picture (the tests call the handlers with fake events).
- Whether Discord's page allows the download link.
