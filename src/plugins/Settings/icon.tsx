/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Small icons of the Amiricord tabs, drawn with `currentColor` so they follow the theme like Discord's own icons.
//
// RefreshIcon, FolderIcon, SourceIcon and WarningIcon (the set `Amiricord_Iconos_SVG`) and the ten tab icons (the set `amiricord-icons`, which
// replaced the first tab set `Amiricord_11_Iconos_SVG`, kept in `assets/icons/tabs-v1`) are the owner's own drawings; the shapes here are
// theirs, only wrapped in components. Two tiles borrow a tab drawing at his request: the notification log uses the Changelog one and custom CSS
// uses the Themes one. The one exception is UpdaterIcon, which is Discord's own "update ready" icon taken from Discord's interface (supplied by
// the owner). HealthIcon, InfoIcon and GearIcon are stand-ins drawn from scratch until the owner draws them too. Nothing in this file comes from Vencord,
// TestCord or any other project.
// Every user of an icon imports it by name from here, so a new drawing only changes the shape in this file.

/** The sidebar icon is the logo itself, at the size of Discord's icons. The image comes from the plugin entry, so these files stay free of image imports (and testable). */
export function makeSidebarIcon(logo: string) {
    return function SidebarIcon() {
        return <img src={logo} width="20" height="20" alt="" aria-hidden="true" style={{ objectFit: "contain" }} />;
    };
}

/** A solid icon. */
function Solid({ children, size = 24 }: { children?: unknown; size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>;
}

/** A solid shape with cut-outs: the shape is painted through a mask in which the cuts are black, so a hole can have any form. */
function Masked({ id, cuts, children }: { id: string; cuts: unknown; children?: unknown; }) {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <defs>
                <mask id={`amiricord-mask-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect width="24" height="24" fill="#fff" />
                    {cuts}
                </mask>
            </defs>
            <g mask={`url(#amiricord-mask-${id})`}>{children}</g>
        </svg>
    );
}

/** A thick line with round ends, for the shapes that are strokes by nature (a ring, brackets, a pulse). */
const thick = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** The same, black: what a cut in a mask is made of. */
const cutLine = { fill: "none", stroke: "#000", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A ring open at the right with a solid arrowhead: relaunch. */
export function RefreshIcon() {
    return (
        <Solid>
            <path d="M18.8 15.17A7.5 7.5 0 1 1 16.82 6.25" {...thick} strokeWidth="2.9" />
            <path d="M18.7 3.1 14 8.6l5.7.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </Solid>
    );
}

/** A solid folder: the settings folder. */
export function FolderIcon() {
    return <Solid><path d="M4.75 4h4.6c.62 0 1.2.3 1.56.8l1.38 1.95h6.93A2.78 2.78 0 0 1 22 9.53v8.7A3.77 3.77 0 0 1 18.23 22H5.77A3.77 3.77 0 0 1 2 18.23V6.75A2.75 2.75 0 0 1 4.75 4Z" /></Solid>;
}

/** The Changelog drawing (a page with lines), used for the notification log. */
export function LogIcon() {
    return <ChangelogIcon />;
}

/** The Themes drawing (a paint roller), used for custom CSS. */
export function PaintbrushIcon() {
    return <ThemesIcon />;
}

// --- The tabs of the section ---------------------------------------------------------------------------------------------------------------

/** A shield split in two halves. */
export function PrivacyIcon() {
    return (
        <Solid>
            <path d="M11 2.4 4 5v6c0 4.8 3 9.3 7 10.7z" />
            <path d="M13 2.4 20 5v6c0 4.8-3 9.3-7 10.7z" />
        </Solid>
    );
}

/** A plug. */
export function PluginsIcon() {
    return (
        <Solid>
            <g transform="rotate(45 12 12)">
                <rect x="8.25" y="1.5" width="2.5" height="6" rx="1.25" />
                <rect x="13.25" y="1.5" width="2.5" height="6" rx="1.25" />
                <path d="M6 7h12v3a6 6 0 0 1-12 0z" />
                <path d="M12 15v6.5" {...thick} strokeWidth="3" />
            </g>
        </Solid>
    );
}

/** A paint roller. */
export function ThemesIcon() {
    return (
        <Solid>
            <rect x="3" y="2" width="15" height="6.5" rx="2" />
            <path d="M18 5.25h1.5A1.5 1.5 0 0 1 21 6.75v3a1.5 1.5 0 0 1-1.5 1.5h-7a1.25 1.25 0 0 0-1.25 1.25V14" {...thick} strokeWidth="2" />
            <rect x="9.5" y="13.5" width="3.5" height="8.5" rx="1.75" />
        </Solid>
    );
}

/** Discord's own "update ready" icon (an arrow down onto a line), taken from Discord's interface by the owner. Used for the Updater instead of his drawing. */
export function UpdaterIcon() {
    return <Solid><path d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z" /></Solid>;
}

/** A page with three lines cut out. */
export function ChangelogIcon() {
    return (
        <Masked id="changelog" cuts={<path d="M7.5 7.85h6.37M7.5 11.85h6.37M7.5 15.9h5.15" {...cutLine} strokeWidth="1.85" />}>
            <path d="M5.2 2.5h13.3a2.3 2.3 0 0 1 2.3 2.3v2.45a1.03 1.03 0 0 1-2.06 0V5.6a.695.695 0 0 0-1.39 0v10.66a.5.5 0 0 0 .5.5h1.45a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5H5.2a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z" />
        </Masked>
    );
}

/** A circle with an "i". */
export function StatsIcon() {
    return <Solid><path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 4a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 1 0 12 6zm-1.3 4.5h2.6v7.5h-2.6z" /></Solid>;
}

/** A shield with a heartbeat line cut out. */
export function PluginHealthIcon() {
    return (
        <Masked id="plugin-health" cuts={<path d="M6.5 12.5h2.5l1.5-3.5 3 7 1.5-3.5h2.5" {...cutLine} strokeWidth="1.8" />}>
            <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z" />
        </Masked>
    );
}

/** A bookmark. */
export function PresetsIcon() {
    return <Solid><path d="M7 2h10a2 2 0 0 1 2 2v17.2a.6.6 0 0 1-.95.5L12 17l-6.05 4.7a.6.6 0 0 1-.95-.5V4a2 2 0 0 1 2-2z" /></Solid>;
}

/** A cloud. */
export function CloudIcon() {
    return <Solid><path d="M7 19a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 10z" /></Solid>;
}

/** Two arrows chasing each other in a circle. */
export function BackupRestoreIcon() {
    return (
        <Solid>
            <path d="M4 12a8 8 0 0 1 13.7-5.7M20 12a8 8 0 0 1-13.7 5.7" {...thick} strokeWidth="2.6" />
            <path d="M21 3.5V10h-6.5z" />
            <path d="M3 20.5V14h6.5z" />
        </Solid>
    );
}

/** A wrench. */
export function PatchHelperIcon() {
    return <Solid><path transform="matrix(-1 0 0 1 24 0)" d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" /></Solid>;
}

/** A thick pulse line: the health report (a stand-in until the owner draws it). */
export function HealthIcon() {
    return <Solid><path d="M2.5 12h4.5l2.2-6.5 4 13 2.3-6.5h6" {...thick} strokeWidth="2.6" /></Solid>;
}

/** Two bold angle brackets, `<` and `>`: the source code. */
export function SourceIcon() {
    return <Solid><path d="M8.6 6.6 3.2 12l5.4 5.4M15.4 6.6 20.8 12l-5.4 5.4" {...thick} strokeWidth="2.7" /></Solid>;
}

/** A solid triangle with an exclamation mark cut out: the warning notice. */
export function WarningIcon() {
    return (
        <Solid size={20}>
            <path fillRule="evenodd" d="M10.13 3.1a2.18 2.18 0 0 1 3.74 0l8.21 14.16a2.52 2.52 0 0 1-2.18 3.78H4.1a2.52 2.52 0 0 1-2.18-3.78L10.13 3.1Zm1.85 4.76a1.45 1.45 0 0 0-1.44 1.55l.45 5.2a1.02 1.02 0 0 0 2.03 0l.45-5.2a1.45 1.45 0 0 0-1.49-1.55ZM12 16.15a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9Z" />
        </Solid>
    );
}

/** A solid circle with an "i" cut out: the information notice (a stand-in until the owner draws it). */
export function InfoIcon() {
    return <Solid size={20}><path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm-1.1 4.6a1.1 1.1 0 0 1 2.2 0v5.5a1.1 1.1 0 0 1-2.2 0V11Z" /></Solid>;
}

/** A solid gear (a disc with eight teeth and a round hole): the settings of a plugin (a stand-in until the owner draws it). */
export function GearIcon() {
    const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
    return (
        <Masked id="gear" cuts={<circle cx="12" cy="12" r="3.1" fill="#000" />}>
            <circle cx="12" cy="12" r="7.4" />
            {teeth.map(angle => <rect key={angle} x="10.4" y="1.6" width="3.2" height="5.2" rx="1.1" transform={`rotate(${angle} 12 12)`} />)}
        </Masked>
    );
}
