/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The editor screen: the preview with its frame, the crop and turn controls, the colour sliders, the presets, undo/redo, before/after and saving to a file. It
// only draws what `EditorSession` says and reports clicks. Design: docs/analysis-34-pinterest-tool-editor.md.

import { currentReact } from "../../api/jsxRuntime";
import { ADJUSTMENT_RANGES, BUILT_IN_PRESETS, EDITOR_LIMITS, type NumericAdjustment, type OutputKind } from "./editorModel";
import type { EditorSession } from "./editorSession";

export interface EditorViewProps {
    editor: EditorSession;
    /** Back to the results. */
    onBack(): void;
}

export const SLIDERS: ReadonlyArray<{ key: NumericAdjustment; label: string; }> = [
    { key: "brightness", label: "Brightness" },
    { key: "contrast", label: "Contrast" },
    { key: "saturation", label: "Saturation" },
    { key: "hue", label: "Hue" },
    { key: "grayscale", label: "Black and white" },
    { key: "sepia", label: "Sepia" },
    { key: "tintAmount", label: "Tint" }
];

export const OUTPUT_OPTIONS: ReadonlyArray<{ value: OutputKind; label: string; }> = [
    { value: "AVATAR", label: "Profile icon (square)" },
    { value: "BANNER", label: "Banner (5:2)" }
];

/** How far an arrow button moves the frame: a tenth of the picture. */
export const ARROW_STEP = 0.1;

interface PointerLike { clientX: number; clientY: number; currentTarget?: { getBoundingClientRect?(): { width: number; height: number; }; setPointerCapture?(id: number): void; }; pointerId?: number; }

export function EditorView({ editor, onBack }: EditorViewProps) {
    const react = currentReact();
    const state = react.useSyncExternalStore(editor.subscribe, () => editor.state);
    const [presetName, setPresetName] = react.useState("");
    const [drag, setDrag] = react.useState<{ x: number; y: number; } | null>(null);
    const { edit } = state;
    const ready = state.status === "ready";
    const end = () => { editor.endGesture(); };

    const slider = (key: NumericAdjustment, label: string) => {
        const [low, high] = ADJUSTMENT_RANGES[key];
        return (
            <label className="pt-slider" key={key}>
                <span>{label}</span>
                <input
                    type="range"
                    min={low}
                    max={high}
                    step={1}
                    value={edit.adjustments[key]}
                    disabled={!ready}
                    aria-label={label}
                    onChange={(event: { target: { value: string; }; }) => { editor.adjust(key, Number(event.target.value)); }}
                    onMouseUp={end}
                    onTouchEnd={end}
                    onKeyUp={end}
                    onBlur={end}
                />
                <span className="pt-muted">{edit.adjustments[key]}</span>
            </label>
        );
    };

    const start = (event: PointerLike) => {
        setDrag({ x: event.clientX, y: event.clientY });
        try {
            if (event.pointerId !== undefined) event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch {
            // Without capture the drag still works while the pointer stays over the picture.
        }
    };
    const move = (event: PointerLike) => {
        if (!drag) return;
        const box = event.currentTarget?.getBoundingClientRect?.();
        if (!box || box.width <= 0 || box.height <= 0) return;
        editor.drag((event.clientX - drag.x) / box.width, (event.clientY - drag.y) / box.height);
        setDrag({ x: event.clientX, y: event.clientY });
    };
    const stop = () => {
        setDrag(null);
        end();
    };

    return (
        <div className="pt-editor">
            <div className="pt-bar">
                <button type="button" className="pt-button" onClick={onBack}>← Back to results</button>
                <h3 className="pt-title">Edit picture</h3>
                <button type="button" className="pt-button" disabled={!state.canUndo} onClick={() => { editor.undo(); }}>Undo</button>
                <button type="button" className="pt-button" disabled={!state.canRedo} onClick={() => { editor.redo(); }}>Redo</button>
                <button type="button" className="pt-button" disabled={state.untouched} onClick={() => { editor.reset(); }}>Reset</button>
            </div>

            {state.status === "loading" ? <div className="pt-muted" role="status">Loading the picture…</div> : null}
            {state.status === "error" ? <div className="pt-error" role="status">{state.error ?? "The picture could not be loaded."}</div> : null}

            <div className="pt-editor-body">
                <div className="pt-editor-preview">
                    <canvas
                        className={`pt-canvas${edit.output === "BANNER" ? " pt-canvas-banner" : ""}`}
                        ref={(element: unknown) => { editor.attachCanvas(element); }}
                        aria-label="Preview of the result"
                        onPointerDown={start}
                        onPointerMove={move}
                        onPointerUp={stop}
                        onPointerCancel={stop}
                    />
                    <div className="pt-row">
                        <button type="button" className="pt-button" aria-pressed={state.showOriginal ? "true" : "false"} disabled={!ready} onClick={() => { editor.setShowOriginal(!state.showOriginal); }}>
                            {state.showOriginal ? "Showing without colour changes" : "Compare without colour changes"}
                        </button>
                    </div>
                </div>

                <div className="pt-editor-tools">
                    <label className="pt-slider">
                        <span>Shape</span>
                        <select className="pt-select" aria-label="Shape of the result" value={edit.output} disabled={!ready} onChange={(event: { target: { value: string; }; }) => { editor.setOutput(event.target.value as OutputKind); }}>
                            {OUTPUT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label className="pt-slider">
                        <span>Zoom</span>
                        <input
                            type="range"
                            min={EDITOR_LIMITS.minZoom}
                            max={EDITOR_LIMITS.maxZoom}
                            step={0.1}
                            value={edit.zoom}
                            disabled={!ready}
                            aria-label="Zoom"
                            onChange={(event: { target: { value: string; }; }) => { editor.zoom(Number(event.target.value)); }}
                            onMouseUp={end}
                            onTouchEnd={end}
                            onKeyUp={end}
                            onBlur={end}
                        />
                        <span className="pt-muted">{edit.zoom.toFixed(1)}x</span>
                    </label>
                    <div className="pt-row" role="group" aria-label="Move the frame">
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Move left" onClick={() => { editor.pan(-ARROW_STEP, 0); end(); }}>←</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Move up" onClick={() => { editor.pan(0, -ARROW_STEP); end(); }}>↑</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Move down" onClick={() => { editor.pan(0, ARROW_STEP); end(); }}>↓</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Move right" onClick={() => { editor.pan(ARROW_STEP, 0); end(); }}>→</button>
                    </div>
                    <div className="pt-row" role="group" aria-label="Turn and mirror">
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Turn left" onClick={() => { editor.rotate(-1); }}>⟲</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Turn right" onClick={() => { editor.rotate(1); }}>⟳</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Mirror left to right" onClick={() => { editor.flip("H"); }}>⇋</button>
                        <button type="button" className="pt-button" disabled={!ready} aria-label="Mirror top to bottom" onClick={() => { editor.flip("V"); }}>⇅</button>
                    </div>

                    {SLIDERS.map(item => slider(item.key, item.label))}
                    <label className="pt-slider">
                        <span>Tint colour</span>
                        <input type="color" value={edit.adjustments.tint} disabled={!ready} aria-label="Tint colour" onChange={(event: { target: { value: string; }; }) => { editor.tint(event.target.value); }} onBlur={end} />
                    </label>

                    <div className="pt-row">
                        <span className="pt-muted">Presets:</span>
                        {BUILT_IN_PRESETS.map(preset => <button type="button" key={preset.name} className="pt-chip" disabled={!ready} onClick={() => { editor.usePreset(preset.adjustments); }}>{preset.name}</button>)}
                    </div>
                    {state.presets.length > 0 ? (
                        <div className="pt-row">
                            <span className="pt-muted">Yours:</span>
                            {state.presets.map(preset => (
                                <span key={preset.name} className="pt-row">
                                    <button type="button" className="pt-chip" disabled={!ready} onClick={() => { editor.usePreset(preset.adjustments); }}>{preset.name}</button>
                                    <button type="button" className="pt-chip" aria-label={`Remove preset ${preset.name}`} onClick={() => { void editor.removePreset(preset.name); }}>×</button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <div className="pt-row">
                        <input
                            className="pt-input"
                            type="text"
                            value={presetName}
                            placeholder="Name this look…"
                            aria-label="Preset name"
                            maxLength={EDITOR_LIMITS.presetNameChars}
                            onChange={(event: { target: { value: string; }; }) => { setPresetName(event.target.value); }}
                        />
                        <button type="button" className="pt-button" disabled={!ready || presetName.trim() === ""} onClick={() => { void editor.savePreset(presetName); }}>Save preset</button>
                    </div>

                    <div className="pt-row">
                        <button type="button" className="pt-button pt-button-primary" disabled={!ready || state.saving} onClick={() => { void editor.save(); }}>{state.saving ? "Saving…" : "Save as PNG"}</button>
                        <span className="pt-notice" role="status">{state.notice ?? ""}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
