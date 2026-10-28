/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) by szlcx404 from the plugin Questify (author Etorix) as found in Equicord.

import type { JSX, ReactNode } from "react";

import { useEffect, useRef, useState } from "../amiricord/common";
import type { ManaSelectFormattedOption, ManaSelectOption } from "./shared";

export interface QuestifySelectProps {
    options: ManaSelectOption[];
    value?: string | string[] | null;
    onSelectionChange?: (value: string | string[] | null) => void;
    selectionMode?: "single" | "multiple";
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    clearable?: boolean;
    maxOptionsVisible?: number;
    formatOption?: (option: ManaSelectOption) => ManaSelectFormattedOption;
    [key: string]: unknown;
}

const ROW_HEIGHT = 34;

interface PressEvent { stopPropagation(): void; preventDefault(): void; }

function Chevron({ open }: { open: boolean; }): JSX.Element {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ pointerEvents: "none", transform: open ? "rotate(180deg)" : undefined, flex: "none" }}>
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
    );
}

function Check({ on }: { on: boolean; }): JSX.Element {
    return (
        <span aria-hidden="true" style={{
            width: 18, height: 18, borderRadius: 4, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: on ? "none" : "1px solid var(--border-strong, #5c5f66)", background: on ? "var(--brand-500, #5865f2)" : "transparent", color: "#fff"
        }}>
            {on ? <svg width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5 9-10" /></svg> : null}
        </span>
    );
}

export default function QuestifySelect({
    options, value, onSelectionChange, selectionMode = "single", placeholder = "Select...", disabled, readOnly, clearable, maxOptionsVisible, formatOption
}: QuestifySelectProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement | null>(null);
    const multiple = selectionMode === "multiple";
    const locked = !!disabled || !!readOnly;

    const selected: string[] = Array.isArray(value) ? value : value !== null && value !== undefined && value !== "" ? [value] : [];
    const labelOf = (option: ManaSelectOption): ManaSelectFormattedOption => formatOption ? formatOption(option) : option;

    useEffect(() => {
        if (!open) return undefined;
        const page = (globalThis as { document?: Document; }).document;
        if (!page) return undefined;
        const outside = (event: Event) => {
            if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
        };
        const key = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
        };
        page.addEventListener("mousedown", outside, true);
        page.addEventListener("keydown", key, true);
        return () => {
            page.removeEventListener("mousedown", outside, true);
            page.removeEventListener("keydown", key, true);
        };
    }, [open]);

    useEffect(() => {
        if (locked && open) setOpen(false);
    }, [locked, open]);

    function choose(option: ManaSelectOption): void {
        if (option.disabled || locked) return;
        if (multiple) {
            const next = selected.includes(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value];
            onSelectionChange?.(next);
        } else {
            onSelectionChange?.(option.value);
            setOpen(false);
        }
    }

    function remove(item: string): void {
        if (locked) return;
        onSelectionChange?.(selected.filter(other => other !== item));
    }

    const current = options.filter(option => selected.includes(option.value));
    const visible = Math.max(1, Math.min(maxOptionsVisible ?? 8, options.length));

    let shown: ReactNode;
    if (!current.length) {
        shown = <span style={{ display: "block", lineHeight: "24px", color: "var(--text-muted, #949ba4)" }}>{placeholder}</span>;
    } else if (multiple) {
        shown = (
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {current.map(option => (
                    <span key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px", borderRadius: 4, background: "var(--background-modifier-hover, #2b2d31)", border: "1px solid var(--border-subtle, #3a3c42)" }}>
                        {option.label}
                        <button type="button" aria-label={`Remove ${option.label}`} disabled={locked}
                            onClick={(event: PressEvent) => { event.stopPropagation(); remove(option.value); }}
                            style={{ all: "unset", cursor: locked ? "default" : "pointer", display: "inline-flex", lineHeight: 0 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style={{ pointerEvents: "none" }}><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                    </span>
                ))}
            </span>
        );
    } else {
        shown = <span style={{ display: "block", lineHeight: "24px" }}>{current[0].label}</span>;
    }

    return (
        <div ref={root} className="questify-select" style={{ position: "relative", width: "100%", opacity: locked ? 0.5 : 1 }}>
            <div role="combobox" aria-expanded={open} aria-disabled={locked} tabIndex={locked ? -1 : 0}
                onClick={() => { if (!locked) setOpen(!open); }}
                onKeyDown={(event: PressEvent & { key: string; }) => { if (!locked && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpen(!open); } }}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 40, padding: "6px 10px", boxSizing: "border-box",
                    borderRadius: 8, cursor: locked ? "default" : "pointer", background: "var(--input-background-default, var(--background-base-lower, #1e1f22))",
                    border: `1px solid ${open ? "var(--brand-500, #5865f2)" : "var(--border-subtle, #3a3c42)"}`, color: "var(--text-default, #dbdee1)"
                }}>
                <span style={{ display: "block", flex: 1, minWidth: 0, lineHeight: "24px", overflow: "hidden", textOverflow: "ellipsis" }}>{shown}</span>
                {clearable && !multiple && current.length && !locked
                    ? <button type="button" aria-label="Clear" onClick={(event: PressEvent) => { event.stopPropagation(); onSelectionChange?.(null); }}
                        style={{ all: "unset", cursor: "pointer", display: "inline-flex", lineHeight: 0, opacity: 0.8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ pointerEvents: "none" }}><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                    : null}
                <Chevron open={open} />
            </div>
            {open ? (
                <div role="listbox" style={{
                    position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 1000, maxHeight: visible * ROW_HEIGHT + 8, overflowY: "auto", padding: 4, boxSizing: "border-box",
                    borderRadius: 8, background: "var(--background-base-lowest, #111214)", border: "1px solid var(--border-subtle, #3a3c42)", boxShadow: "0 8px 16px rgba(0,0,0,.4)"
                }}>
                    {options.map(option => {
                        const info = labelOf(option);
                        const on = selected.includes(option.value);
                        return (
                            <div key={option.id} role="option" aria-selected={on} aria-disabled={!!option.disabled} onClick={() => choose(option)}
                                style={{ display: "flex", alignItems: "center", gap: 8, minHeight: ROW_HEIGHT - 4, padding: "4px 8px", borderRadius: 6, cursor: option.disabled ? "default" : "pointer", opacity: option.disabled ? 0.5 : 1, background: on && !multiple ? "var(--background-modifier-selected, #35373c)" : undefined }}>
                                {info.leading}
                                <span style={{ flex: 1, minWidth: 0 }}>{option.label}{info.description ? <span style={{ display: "block", fontSize: 12, color: "var(--text-muted, #949ba4)" }}>{info.description}</span> : null}</span>
                                {info.trailing}
                                {multiple ? <Check on={on} /> : on ? <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5 9-10" /></svg> : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
