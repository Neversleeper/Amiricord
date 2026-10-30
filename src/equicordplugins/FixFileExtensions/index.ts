/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FixFileExtensions (author thororen) as found in Equicord's copy of Vencord's plugins. Same patch and same table of extensions. The original skips its patch when AnonymiseFileNames is on (`predicate`); here both may patch the same function, and the rename is harmless when the name is already anonymised. `tarExtMatcher` is copied from that plugin.

import type { PluginCode } from "../../renderer/engine";

/** `.tar.gz` and friends: the extension to keep is both parts. */
const TAR_EXTENSION = /\.tar\.\w+$/;

const EXTENSIONS: Record<string, string[]> = {
    ogg: [".ogv", ".oga", ".ogx", ".ogm", ".spx", ".aac", ".wma"],
    jpg: [".jpe", ".jif", ".jfi", ".pjpeg", ".pjp", ".bmp", ".tiff", ".tif"],
    svg: [".svgz", ".ai", ".eps"],
    mp4: [".m4v", ".m4r", ".m4p", ".avi", ".mkv", ".wmv", ".flv", ".3gp"],
    m4a: [".m4b", ".aiff"],
    mov: [".movie", ".qt", ".asf", ".rm", ".rmvb"],
    png: [".ico", ".cur"]
};

const REVERSE: Record<string, string> = {};
for (const [target, list] of Object.entries(EXTENSIONS)) for (const extension of list) REVERSE[extension] = `.${target}`;

/** The file name with its extension changed to a format Discord can show, when it has a table entry. */
export function fixedName(file: string): string {
    const index = TAR_EXTENSION.exec(file)?.index ?? file.lastIndexOf(".");
    if (index === -1) return file;
    const extension = file.slice(index);
    return file.slice(0, index) + (REVERSE[extension] ?? extension);
}

const plugin: PluginCode & { fixExt(upload: { filename: string; }): void; } = {
    patches: [
        {
            find: "async uploadFiles(",
            lazy: true,
            required: false,
            replacements: [{ match: /async uploadFiles\((\i)\){/, replace: "$&$1.forEach($self.fixExt);" }]
        }
    ],

    fixExt(upload) {
        upload.filename = fixedName(upload.filename);
    }
};

export default plugin;
