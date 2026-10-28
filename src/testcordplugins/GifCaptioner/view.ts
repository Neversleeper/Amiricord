/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// What the caption window looks like for a given state: a plain function from the state to elements (no hooks), so it is looked at in tests without a page.

import { type CaptionState, drawPreview, MAX_SIZE, MAX_TEXT_LENGTH, MIN_SIZE, PLACEHOLDER } from "./captioner";
import type { CaptionMedia } from "./media";

type Make = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;

export interface WindowParts {
    Root: unknown;
    Header: unknown;
    Content: unknown;
    Footer: unknown;
    CloseButton: unknown;
}

export interface WindowActions {
    setText(text: string): void;
    setSize(size: number): void;
    setFont(family: string): void;
    setVideo(element: unknown): void;
    setMediaSize(width: number, height: number): void;
    cancel(): void;
    apply(): void;
}

export interface FontChoice { family: string; displayName: string; }

type PreviewCanvas = Parameters<typeof drawPreview>[0];

export function renderCaptionWindow(h: Make, parts: WindowParts, media: Pick<CaptionMedia, "url" | "isVideo">, state: CaptionState, fonts: FontChoice[], actions: WindowActions): unknown {
    return h(parts.Root, { size: "medium", onClose: actions.cancel, label: "Edit GIF" },
        h(parts.Header, null, h("span", null, "Edit GIF"), h(parts.CloseButton, { onClick: actions.cancel })),
        h(parts.Content, { className: "vc-gif-captioner-modal-content" },
            h("div", { className: "vc-gif-captioner-editor" },
                h("input", {
                    className: "vc-gif-captioner-caption",
                    placeholder: PLACEHOLDER,
                    maxLength: MAX_TEXT_LENGTH,
                    value: state.text,
                    autoFocus: true,
                    onChange: (event: { target: { value: string; }; }) => { actions.setText(event.target.value); }
                }),
                h("div", { className: "vc-gif-captioner-range" },
                    h("div", null, "Font"),
                    h("div", { className: "vc-gif-captioner-font-selector" }, fonts.length === 0
                        ? h("div", null, "Loading fonts...")
                        : h("select", {
                            className: "vc-gif-captioner-select",
                            value: state.font,
                            onChange: (event: { target: { value: string; }; }) => { actions.setFont(event.target.value); }
                        }, ...fonts.map(font => h("option", { key: font.family, value: font.family }, font.displayName))))),
                h("div", { className: "vc-gif-captioner-range" },
                    h("div", null, "Font size"),
                    h("input", {
                        type: "range", min: MIN_SIZE, max: MAX_SIZE, value: state.size,
                        onChange: (event: { target: { value: string; }; }) => { actions.setSize(Number.parseFloat(event.target.value)); }
                    })),
                h("div", { className: "vc-gif-captioner-preview-stack" },
                    h("canvas", {
                        className: "vc-gif-captioner-preview-canvas",
                        ref: (canvas: PreviewCanvas | null) => { if (canvas) drawPreview(canvas, state); }
                    }),
                    h("div", { className: "vc-gif-captioner-preview-media" }, media.isVideo
                        ? h("video", {
                            className: "vc-gif-captioner-media-element",
                            ref: (element: unknown) => { actions.setVideo(element); },
                            src: media.url, autoPlay: true, loop: true, muted: true, playsInline: true,
                            onLoadedMetadata: (event: { currentTarget: { videoWidth: number; videoHeight: number; }; }) => {
                                actions.setMediaSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
                            }
                        })
                        : h("img", { className: "vc-gif-captioner-media-element", alt: "GIF preview", src: media.url }))))),
        h(parts.Footer, null,
            h("button", { type: "button", className: "vc-gif-captioner-button vc-gif-captioner-button-quiet", onClick: actions.cancel }, "Cancel"),
            h("button", { type: "button", className: "vc-gif-captioner-button", onClick: actions.apply }, "Apply")));
}
