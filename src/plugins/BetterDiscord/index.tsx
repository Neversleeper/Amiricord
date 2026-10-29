/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BetterDiscord support, written for Amiricord. It follows Amiricord's rules: the plugins are the files of `src/betterdiscordplugins` that were bundled into the build (nothing is read from the disk or downloaded),
// the layer is off until the person switches it on, and its card says it runs code without Amiricord's permission limits (`permissions.code.dynamic`).
// Written to be run in Discord; tried only with test doubles at the time of writing.

/* eslint-disable @typescript-eslint/no-explicit-any -- the components are Discord's, with props of their own */

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";
import { bundledPlugins } from "./bundled";
import { type BdLayer, createBdLayer } from "./layer";
import type { BdPluginInfo } from "./manager";

let layer: BdLayer | undefined;
let components: { Switch: any; Button: any; Text: any; Heading: any; } | undefined;

function Panel({ info }: { info: BdPluginInfo; }) {
    const react = currentReact();
    if (!react.useRef) return <div>This React has no useRef, so the plugin's settings cannot be drawn.</div>;
    const ref = react.useRef<HTMLElement | null>(null);
    react.useEffect(() => {
        const host = ref.current;
        if (!host || !layer) return undefined;
        const panel = layer.manager.settingsPanelOf(info.id);
        host.textContent = "";
        if (panel instanceof Node) host.append(panel);
        else if (typeof panel === "string") host.innerHTML = panel;
        return () => { host.textContent = ""; };
    }, [info.id]);
    return <div ref={ref} style={{ marginTop: 8 }} />;
}

function PluginRow({ info, open, onToggleOpen }: { info: BdPluginInfo; open: boolean; onToggleOpen(): void; }) {
    const manager = layer!.manager;
    const { Switch, Button, Text } = components!;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{info.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>v{info.version} by {info.author}</span></div>
                    {info.description ? <Text muted>{info.description}</Text> : null}
                    {info.state === "failed" ? <div style={{ color: "var(--text-danger, #fa777c)", fontSize: 13 }}>Could not run: {info.error}</div> : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {info.hasSettings ? <Button onClick={onToggleOpen}>{open ? "Hide settings" : "Settings"}</Button> : null}
                    <Switch checked={info.state === "on"} label={`Turn ${info.name} ${info.state === "on" ? "off" : "on"}`}
                        onChange={(on: boolean) => { void (on ? manager.enable(info.id) : manager.disable(info.id)); }} />
                </div>
            </div>
            {open && info.hasSettings ? <Panel info={info} /> : null}
        </div>
    );
}

function BetterDiscordSettings() {
    const react = currentReact();
    const [, bump] = react.useState(0) as [number, (n: number) => void];
    const [openId, setOpenId] = react.useState<string | null>(null) as [string | null, (id: string | null) => void];
    react.useEffect(() => layer?.manager.subscribe(() => { bump(Date.now()); }), []);
    if (!layer || !components) return <div>The BetterDiscord layer is not running.</div>;
    const { Heading, Text } = components;
    const plugins = layer.manager.list();
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Heading level={2}>BetterDiscord plugins</Heading>
            <Text muted>Only the BetterDiscord plugins that came inside this build are listed. They run with full access to the page, like any code that runs in Discord, so switch on only the ones you trust.</Text>
            {plugins.length === 0 ? <Text>No BetterDiscord plugin is inside this build.</Text> : null}
            {plugins.map(info => <PluginRow key={info.id} info={info} open={openId === info.id} onToggleOpen={() => { setOpenId(openId === info.id ? null : info.id); }} />)}
        </div>
    );
}

const plugin: PluginCode = {
    settingsComponent: BetterDiscordSettings,

    async start(ctx) {
        const modules = ctx.modules;
        if (!modules) throw new Error("BetterDiscord: the engine did not hand over the module list (the manifest must declare permissions.code.dynamic)");
        const page = globalThis as unknown as Parameters<typeof createBdLayer>[0]["page"];
        // The components are read through `get()` when they are drawn, because React and Discord's pieces may appear after this plugin starts.
        const lazy = (finder: { get(): unknown; }) => (props: any) => {
            const Component = finder.get() as ((p: any) => unknown) | undefined;
            return Component ? currentReact().createElement(Component, props) : null;
        };
        components = { Switch: lazy(ctx.components.Switch), Button: lazy(ctx.components.Button), Text: lazy(ctx.components.Text), Heading: lazy(ctx.components.Heading) };
        layer = createBdLayer({
            modules,
            storage: ctx.storage,
            toasts: ctx.toasts,
            modals: ctx.modals,
            react: () => ctx.components.react.get(),
            reportError: (source, error) => { ctx.reportError(source, error); },
            page,
            pageGlobal: globalThis
        }, bundledPlugins);
        await layer.manager.startSaved();
    },

    stop() {
        layer?.dispose();
        layer = undefined;
        components = undefined;
    }
};

export default plugin;
