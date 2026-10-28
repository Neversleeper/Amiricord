/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The "Settings tabs" card at the top of the main tab and the editor it opens (Editor Mode): which tabs of the section are shown, in which
// order, and which are pinned. The controls follow TestCord's editor (the owner's reference); the saving and the rules are in
// `tabLayout.ts` and the design in docs/design-04-editor-mode.md. This file only draws and passes clicks on.

import { currentReact } from "../../api/jsxRuntime";
import {
    allShown, isHidden, isPinned, MAIN_KEY, moveTab, orderTabs, parseLayout, restoreLayout, serializeLayout, setAllHidden, type TabLayout,
    toggleHidden, togglePinned, visibleTabs
} from "./tabLayout";

export interface EditorTab {
    key: string;
    title: string;
    icon?: () => unknown;
}

export interface TabsEditorDeps {
    /** The name under "Settings tabs", the name of the section. */
    title: string;
    /** Every tab that exists, in the original order. Called each time the editor is drawn, so tabs added later appear. */
    tabs(): EditorTab[];
    /** The saved layout text, and where to save a new one. */
    read(): string;
    write(text: string): void;
}

interface DragEventLike {
    preventDefault(): void;
    stopPropagation(): void;
    dataTransfer?: { effectAllowed: string; setData(type: string, data: string): void; } | null;
}

export const EDITOR_COPY = "Pick which tabs appear under";
export const SAVED_COPY = "Tabs you hide are kept and can be brought back here at any time. Your choice is saved right away and shows in the sidebar the next time Settings opens.";

export function makeTabsEditor(deps: TabsEditorDeps): () => unknown {
    return function TabsEditor() {
        const { useState } = currentReact();
        const [editing, setEditing] = useState(false);
        const [layout, setLayout] = useState<TabLayout>(() => parseLayout(deps.read()));
        const [dragging, setDragging] = useState<string | null>(null);
        const [over, setOver] = useState<string | null>(null);
        const [undo, setUndo] = useState<{ text: string; previous: TabLayout; } | null>(null);

        const tabs = deps.tabs();
        const keys = tabs.map(tab => tab.key);
        const ordered = orderTabs(tabs, layout);
        const shown = visibleTabs(tabs, layout);
        const hiddenCount = tabs.length - shown.length;
        const everythingShown = allShown(layout, keys);

        const save = (next: TabLayout, undoText?: string) => {
            deps.write(serializeLayout(next));
            setUndo(undoText ? { text: undoText, previous: layout } : null);
            setLayout(next);
        };

        const open = () => {
            if (!editing) setLayout(parseLayout(deps.read()));
            setEditing(!editing);
        };

        const drop = (event: DragEventLike, key: string) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragging) save(moveTab(layout, keys, dragging, key));
            setDragging(null);
            setOver(null);
        };

        const target = (event: DragEventLike, key: string) => {
            if (key === MAIN_KEY || !dragging) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(key);
        };

        return (
            <div className={`amiricord-editor${editing ? " amiricord-editor-open" : ""}`}>
                <div className="amiricord-editor-row">
                    <div>
                        <div className="amiricord-editor-kicker">Sidebar tabs</div>
                        <h2 className="amiricord-editor-title">{deps.title}</h2>
                    </div>
                    <button type="button" className={`amiricord-editor-toggle${editing ? " amiricord-editor-toggle-on" : ""}`} aria-expanded={editing ? "true" : "false"} onClick={open}>
                        <span className="amiricord-editor-dot" />
                        {editing ? "Done" : "Editor Mode"}
                    </button>
                </div>
                {editing && (
                    <div className="amiricord-editor-panel">
                        <div className="amiricord-editor-copy">
                            {EDITOR_COPY} {deps.title}. {SAVED_COPY}{hiddenCount > 0 && ` ${hiddenCount} hidden.`}
                        </div>
                        {undo && (
                            <div className="amiricord-editor-undo">
                                <span>{undo.text}</span>
                                <button type="button" onClick={() => { save(undo.previous); }}>Undo</button>
                            </div>
                        )}
                        <div className="amiricord-editor-preview">
                            <div className="amiricord-editor-preview-title">Preview</div>
                            <div className="amiricord-editor-preview-list">
                                {shown.map(tab => {
                                    const Icon = tab.icon;
                                    return (
                                        <span key={tab.key} className="amiricord-editor-preview-item">
                                            {Icon && <Icon />}
                                            {isPinned(layout, tab.key) && <span className="amiricord-editor-preview-pin">Pinned</span>}
                                            {tab.title}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="amiricord-editor-grid">
                            {ordered.map(tab => {
                                const locked = tab.key === MAIN_KEY;
                                const on = !isHidden(layout, tab.key);
                                const pinned = isPinned(layout, tab.key);
                                const Icon = tab.icon;
                                return (
                                    <div
                                        key={tab.key}
                                        role="button"
                                        tabIndex={locked ? -1 : 0}
                                        draggable={!locked}
                                        aria-disabled={locked ? "true" : "false"}
                                        className={`amiricord-chip${on ? " amiricord-chip-on" : ""}${dragging === tab.key ? " amiricord-chip-dragging" : ""}${over === tab.key && dragging !== tab.key ? " amiricord-chip-drop" : ""}`}
                                        onClick={() => { if (!locked) save(toggleHidden(layout, tab.key), on ? `${tab.title} hidden` : undefined); }}
                                        onDragStart={(event: DragEventLike) => {
                                            if (locked) return;
                                            setDragging(tab.key);
                                            if (event.dataTransfer) {
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("text/plain", tab.key);
                                            }
                                        }}
                                        onDragOver={(event: DragEventLike) => { target(event, tab.key); }}
                                        onDragEnter={(event: DragEventLike) => { target(event, tab.key); }}
                                        onDragLeave={() => { if (over === tab.key) setOver(null); }}
                                        onDrop={(event: DragEventLike) => { drop(event, tab.key); }}
                                        onDragEnd={() => { setDragging(null); setOver(null); }}
                                    >
                                        <span className="amiricord-chip-handle" aria-hidden="true">::</span>
                                        {Icon && <Icon />}
                                        <span className="amiricord-chip-title">{tab.title}</span>
                                        {!locked && (
                                            <button
                                                type="button"
                                                className={`amiricord-chip-pin${pinned ? " amiricord-chip-pin-on" : ""}`}
                                                onClick={(event: DragEventLike) => { event.stopPropagation(); save(togglePinned(layout, tab.key)); }}
                                            >
                                                {pinned ? "Pinned" : "Pin"}
                                            </button>
                                        )}
                                        <span className="amiricord-chip-state">{locked ? "Locked" : on ? "On" : "Off"}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            type="button"
                            className="amiricord-editor-link"
                            onClick={() => { save(setAllHidden(layout, keys, everythingShown), everythingShown ? "All editable tabs hidden" : undefined); }}
                        >
                            {everythingShown ? "Hide all" : "Show all"}
                        </button>
                        <button type="button" className="amiricord-editor-link amiricord-editor-restore" onClick={() => { save(restoreLayout()); }}>Reset to default</button>
                    </div>
                )}
            </div>
        );
    };
}
