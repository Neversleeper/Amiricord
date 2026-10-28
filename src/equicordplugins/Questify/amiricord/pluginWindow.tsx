/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) by szlcx404 from the plugin Questify (author Etorix) as found in Equicord.

import type { ReactNode } from "react";

import { currentReact } from "../../../api/jsxRuntime";
import { Modal, useState } from "./common";
import { reportProblem } from "./context";
import { getSettingsScreens, resetPluginSettings } from "./settings";

const DESCRIPTION = "Enhance specific Quest features, disable annoyances, or completely remove Quests.";
const AUTHORS = [
    { name: "Etorix", role: "original author" },
    { name: "szlcx404", role: "Amiricord port" }
];
const TAGS = ["ui", "privacy", "utility"];

export const pluginModalCss = `
.questify-plugin-window { display: flex; flex-direction: column; gap: 16px; padding: 4px 12px 12px; box-sizing: border-box; }
.questify-plugin-window-description { margin: 0; line-height: 1.3; color: var(--text-default, var(--text-normal)); }
.questify-plugin-window-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.questify-plugin-window-tags li { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: var(--background-modifier-hover); color: var(--text-muted); }
.questify-plugin-window-box { border-radius: 12px; padding: 14px 16px; box-sizing: border-box; border: 1px solid var(--border-subtle, var(--background-modifier-accent)); background: var(--background-base-lower, var(--background-secondary)); }
.questify-plugin-window-box > h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--text-strong, var(--header-primary)); }
.questify-plugin-window-authors { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.questify-plugin-window-authors li { padding: 4px 10px; border-radius: 6px; background: var(--background-modifier-hover); }
.questify-plugin-window-authors small { margin-left: 6px; color: var(--text-muted); }
.amiricord-modal:has(.questify-plugin-window) { width: 680px; }
.questify-plugin-window-screens { display: flex; flex-direction: column; gap: 14px; }
.questify-settings-select svg { pointer-events: none; }
.questify-settings-select button svg { pointer-events: none; }
`;

interface PluginModalProps {
    onClose?(): void;
    transitionState?: number;
    plugin?: unknown;
    onRestartNeeded?(): void;
    [prop: string]: unknown;
}

export default function PluginModal({ onClose, transitionState }: PluginModalProps): ReactNode {
    const [confirmReset, setConfirmReset] = useState(false);
    const screens = getSettingsScreens();

    const reset = () => {
        if (!confirmReset) {
            setConfirmReset(true);
            return;
        }
        setConfirmReset(false);
        try {
            resetPluginSettings();
        } catch (error) {
            reportProblem("settings window reset", error);
        }
    };

    return (
        <Modal
            title="Questify"
            size="lg"
            transitionState={transitionState ?? 0}
            onClose={onClose ?? (() => undefined)}
            actions={[
                { text: confirmReset ? "Click again to reset all Questify settings" : "Reset", variant: "critical-secondary", onClick: reset },
                { text: "Close", variant: "primary", onClick: onClose }
            ]}
        >
            <div className="questify-plugin-window">
                <p className="questify-plugin-window-description">{DESCRIPTION}</p>
                <ul className="questify-plugin-window-tags">
                    {TAGS.map(tag => <li key={tag}>{tag}</li>)}
                </ul>
                <div className="questify-plugin-window-box">
                    <h3>Authors</h3>
                    <ul className="questify-plugin-window-authors">
                        {AUTHORS.map(author => <li key={author.name}>{author.name}<small>{author.role}</small></li>)}
                    </ul>
                </div>
                <div className="questify-plugin-window-box">
                    <h3>Settings</h3>
                    <div className="questify-plugin-window-screens">
                        {screens.map(screen => currentReact().createElement(screen.component, { key: screen.key }) as ReactNode)}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

const BUTTON_STYLE = { padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border-subtle, #3a3c42)", background: "var(--background-modifier-hover, #2b2d31)", color: "var(--text-default, #dbdee1)", cursor: "pointer", font: "500 14px sans-serif" } as const;

export function QuestifySettingsPanel({ onClose }: { onClose?(): void; }): ReactNode {
    const [confirmReset, setConfirmReset] = useState(false);
    const screens = getSettingsScreens();

    const reset = () => {
        if (!confirmReset) {
            setConfirmReset(true);
            return;
        }
        setConfirmReset(false);
        try {
            resetPluginSettings();
        } catch (error) {
            reportProblem("settings panel reset", error);
        }
    };

    return (
        <div className="questify-plugin-window">
            <div className="questify-plugin-window-screens">
                {screens.map(screen => currentReact().createElement(screen.component, { key: screen.key }) as ReactNode)}
            </div>
            <div>
                <button type="button" onClick={reset} style={BUTTON_STYLE}>{confirmReset ? "Click again to reset all Questify settings" : "Reset Questify settings"}</button>
                {onClose ? <button type="button" onClick={onClose} style={{ ...BUTTON_STYLE, marginLeft: 8 }}>Close</button> : null}
            </div>
        </div>
    );
}
