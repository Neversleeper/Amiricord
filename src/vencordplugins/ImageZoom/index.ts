/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's component instances have no types */

// Adapted for Amiricord (2026) from the plugin ImageZoom (author Aria) as found in TestCord's copy of Vencord's plugins. Hold the left mouse button on a picture in
// Discord's picture viewer to get a round lens; the scroll wheel changes the zoom and Shift + wheel the lens size. The patches are the original's: the four on the
// picture component (`.handleImageLoad)`) were checked on build 653945 and match once; the two on the viewer window (`disableArrowKeySeek:!0` and `="FOCUS_SENSITIVE",`)
// are in code Discord loads later, so they are lazy and NOT known to match (without them the lens still works; the viewer's buttons may hide while zoomed).
// Differences from the original:
//  - the lens is drawn with plain page elements and listeners instead of a second React root (no `createRoot` in the page's reach), with the same behaviour
//    (position, zoom, size, animated pictures through a video that follows the original, square and nearest neighbour options);
//  - the right click menu has the three sliders (zoom, lens size, zoom speed) as plain range inputs inside custom menu items, and the two switches (square lens, nearest
//    neighbour), if that menu can be reached (`image-context`, NOT checked; the sliders are also settings of the plugin card);
//  - `zoom`, `size` and `zoomSpeed` are numbers with limits instead of sliders.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const ELEMENT_ID = "ac-imgzoom-magnify-modal";

const settings = definePluginSettings({
    saveZoomValues: { type: "boolean", default: true, description: "Whether to save zoom and lens size values" },
    invertScroll: { type: "boolean", default: true, description: "Invert scroll" },
    nearestNeighbour: { type: "boolean", default: false, description: "Use Nearest Neighbour Interpolation when scaling images" },
    square: { type: "boolean", default: false, description: "Make the lens square" },
    zoom: { type: "number", default: 2, min: 1, max: 50, description: "Zoom of the lens" },
    size: { type: "number", default: 100, min: 50, max: 1000, description: "Radius / Size of the lens" },
    zoomSpeed: { type: "number", default: 0.5, min: 0.1, max: 5, description: "How fast the zoom / lens size changes" }
} as const);

const CSS = `
.ac-imgzoom-lens { position: fixed; left: 0; top: 0; z-index: 9999; border: 2px solid grey; border-radius: 50%; overflow: hidden; cursor: none; box-shadow: inset 0 0 10px 2px grey; filter: drop-shadow(0 0 2px grey); pointer-events: none; opacity: 0; }
.ac-imgzoom-square { border-radius: 0; }
.ac-imgzoom-nearest-neighbor img { image-rendering: pixelated; }
`;

let context: EnginePluginContext | undefined;
let styled = false;
let controller: { stop(): void; } | undefined;

/** Everything the lens needs from the picture component, read when it is used. */
function startMagnifier(instance: any): { stop(): void; } {
    let ready = false;
    let element: HTMLElement | null = null;
    let zoom = settings.store.zoom;
    let size = settings.store.size;
    let shift = false;
    let frame = 0;
    let original: HTMLVideoElement | null = null;

    const lens = document.createElement("div");
    document.body.appendChild(lens);
    let media: HTMLImageElement | HTMLVideoElement | null = null;

    const classes = () => `ac-imgzoom-lens${settings.store.nearestNeighbour ? " ac-imgzoom-nearest-neighbor" : ""}${settings.store.square ? " ac-imgzoom-square" : ""}`;
    lens.className = classes();

    const source = (): string => {
        const src = String(instance.props.src);
        try {
            const url = new URL(src);
            if (url.protocol !== "http:" && url.protocol !== "https:") return src;
            if (url.pathname.startsWith("/attachments/")) url.hostname = "cdn.discordapp.com";
            url.searchParams.set("animated", "true");
            return url.toString();
        } catch {
            return src;
        }
    };

    const build = () => {
        const box = element?.getBoundingClientRect();
        if (!box) return;
        media?.remove();
        if (instance.props.animated) {
            const video = document.createElement("video");
            video.poster = instance.props.src;
            video.src = original?.src ?? instance.props.src;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            media = video;
        } else {
            const image = document.createElement("img");
            image.alt = "";
            image.src = source();
            media = image;
        }
        media.style.position = "absolute";
        media.width = box.width * zoom;
        media.height = box.height * zoom;
        lens.appendChild(media);
    };

    const place = (event: MouseEvent) => {
        if (!ready || !element || !media) return;
        if (instance.state.mouseOver && instance.state.mouseDown) {
            const offset = size / 2;
            const rect = element.getBoundingClientRect();
            const x = -((event.pageX - rect.left) * zoom - offset);
            const y = -((event.pageY - rect.top) * zoom - offset);
            lens.className = classes();
            lens.style.width = `${size}px`;
            lens.style.height = `${size}px`;
            lens.style.transform = `translate(${event.x - offset}px, ${event.y - offset}px)`;
            media.width = rect.width * zoom;
            media.height = rect.height * zoom;
            media.style.transform = instance.props.animated ? "" : `translate(${x}px, ${y}px)`;
            if (instance.props.animated) {
                media.style.left = `${x}px`;
                media.style.top = `${y}px`;
            }
            lens.style.opacity = "1";
        } else {
            lens.style.opacity = "0";
        }
    };

    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Shift") shift = true; };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === "Shift") shift = false; };
    const syncVideos = () => {
        if (media instanceof HTMLVideoElement && original) media.currentTime = original.currentTime;
    };
    const onMouseDown = (event: MouseEvent) => {
        if (!instance.state.mouseOver || event.button !== 0) return;
        zoom = settings.store.zoom;
        size = settings.store.size;
        // A menu that is open closes when the lens starts.
        if (document.getElementById("image-context")) context?.common.FluxDispatcher.get()?.dispatch({ type: "CONTEXT_MENU_CLOSE" });
        place(event);
        if (ready && instance.state.mouseDown) lens.style.opacity = "1";
    };
    const onMouseUp = () => { lens.style.opacity = "0"; };
    const onWheel = (event: WheelEvent) => {
        if (!instance.state.mouseOver || !instance.state.mouseDown) return;
        const direction = settings.store.invertScroll ? -1 : 1;
        if (!shift) {
            const value = zoom + (event.deltaY / 100) * direction * settings.store.zoomSpeed;
            zoom = value <= 1 ? 1 : value;
            if (settings.store.saveZoomValues) settings.store.zoom = Math.min(50, zoom);
        } else {
            const value = size + event.deltaY * direction * settings.store.zoomSpeed;
            size = value <= 50 ? 50 : value;
            if (settings.store.saveZoomValues) settings.store.size = Math.min(1000, size);
        }
        place(event);
    };

    // The picture is ready when Discord says so; until then there is nothing to measure.
    const wait = () => {
        if (instance.state.readyState === "READY") {
            element = document.getElementById(ELEMENT_ID);
            if (!element) return;
            element.querySelector("img,video")?.setAttribute("draggable", "false");
            if (instance.props.animated) {
                original = element.querySelector("video");
                original?.addEventListener("timeupdate", syncVideos);
            }
            build();
            ready = true;
        } else {
            frame = requestAnimationFrame(wait);
        }
    };
    wait();

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", place);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("wheel", onWheel);

    return {
        stop() {
            cancelAnimationFrame(frame);
            original?.removeEventListener("timeupdate", syncVideos);
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("keyup", onKeyUp);
            document.removeEventListener("mousemove", place);
            document.removeEventListener("mousedown", onMouseDown);
            document.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("wheel", onWheel);
            lens.remove();
        }
    };
}

const plugin: PluginCode & {
    makeProps(instance: any): object;
    renderMagnifier(instance: any): void;
    updateMagnifier(instance: any): void;
    unMountMagnifier(): void;
} = {
    settings,

    patches: [
        {
            find: "disableArrowKeySeek:!0",
            lazy: true,
            required: false,
            replacements: [
                { match: /useFullWidth:!0,shouldLink:/, replace: `id:"${ELEMENT_ID}",$&` },
                // The viewer's own click handler must not close the viewer while the lens is used.
                { match: /(?<=null!=(\i)\?.{0,20})\i(?:\.\i)?,{children:\1/, replace: "'div',{onClick:e=>e.stopPropagation(),children:$1" }
            ]
        },
        {
            // The viewer's options must not hide when Discord's own zoom is used.
            find: '="FOCUS_SENSITIVE",',
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=\[\i\.\i]:)\i&&!\i&&"PINNED"!==\i/, replace: "false" }]
        },
        {
            find: ".handleImageLoad)",
            lazy: true,
            replacements: [
                { match: /placeholderVersion:\i,(?=.{0,50}children:)/, replace: "...$self.makeProps(this),$&" },
                { match: /componentDidMount\(\){/, replace: "$&$self.renderMagnifier(this);" },
                { match: /componentWillUnmount\(\){/, replace: "$&$self.unMountMagnifier();" },
                { match: /componentDidUpdate\(\i\){/, replace: "$&$self.updateMagnifier(this);" }
            ]
        }
    ],

    start(ctx) {
        context = ctx;
        if (!styled) {
            styled = true;
            ctx.addStyle(CSS, "image-zoom");
        }
        ctx.contextMenu.addNative("image-context", (children, props: any) => {
            // Discord re-uses the image menu for links, and for the emoji in statuses.
            if (!props || "href" in props || props.target?.classList?.contains("emoji")) return;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!parts || !react) return;
            const item = (id: string, label: string, key: "square" | "nearestNeighbour") => react.createElement(parts.MenuCheckboxItem as never, {
                id, key: id, label, checked: settings.store[key], action: () => { settings.store[key] = !settings.store[key]; }
            });
            // A slider is a custom menu item (`render`) holding a plain range input; the value is written to the settings as it moves.
            const slider = (id: string, label: string, key: "zoom" | "size" | "zoomSpeed", min: number, max: number, step: number) => react.createElement(parts.MenuItem as never, {
                id, key: id, label,
                render: () => react.createElement("div", { style: { padding: "4px 8px", display: "flex", flexDirection: "column", gap: "2px", color: "var(--text-default, #ddd)", fontSize: "12px" } },
                    react.createElement("span", null, label),
                    react.createElement("input", {
                        type: "range", min, max, step, defaultValue: settings.store[key],
                        onInput: (event: { currentTarget: HTMLInputElement; }) => { settings.store[key] = Number(event.currentTarget.value); },
                        onClick: (event: Event) => event.stopPropagation()
                    }))
            });
            children.push(react.createElement(parts.MenuGroup as never, { id: "image-zoom", key: "image-zoom" },
                slider("ac-zoom", "Zoom", "zoom", 1, 50, 0.5), slider("ac-size", "Lens Size", "size", 50, 1000, 10), slider("ac-speed", "Zoom Speed", "zoomSpeed", 0.1, 5, 0.1),
                item("ac-square", "Square Lens", "square"), item("ac-nearest-neighbour", "Nearest Neighbour", "nearestNeighbour")));
        });
    },

    stop() {
        controller?.stop();
        controller = undefined;
        context = undefined;
        styled = false;
    },

    makeProps(instance) {
        return {
            onMouseOver: () => instance.setState((state: any) => ({ ...state, mouseOver: true })),
            onMouseOut: () => instance.setState((state: any) => ({ ...state, mouseOver: false })),
            onMouseDown: (event: { button: number; }) => { if (event.button === 0) instance.setState((state: any) => ({ ...state, mouseDown: true })); },
            onMouseUp: () => instance.setState((state: any) => ({ ...state, mouseDown: false })),
            id: instance.props.id
        };
    },

    renderMagnifier(instance) {
        try {
            if (instance.props.id !== ELEMENT_ID || controller) return;
            controller = startMagnifier(instance);
        } catch (error) {
            context?.reportError("ImageZoom", error);
        }
    },

    // The lens reads the picture component's current props and state each time, so nothing has to be redrawn when it updates.
    updateMagnifier() { /* nothing to do */ },

    unMountMagnifier() {
        controller?.stop();
        controller = undefined;
    }
};

export default plugin;
