/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The loader that replaces Discord's `app.asar`: a tiny asar archive with two files in its root. Only the root is
// supported, which is all the loader needs. Pure: builds and reads buffers, touches no files.
// Design: docs/analysis-08-installer-patching.md.
//
// Layout of an asar file:
//   4 bytes  the number 4                      \
//   4 bytes  size of the second block           | 16 bytes
//   4 bytes  size of the header text + 4        |
//   4 bytes  length of the header text          /
//   header text (JSON), padded with zero bytes to a multiple of 4
//   file contents, one after the other; each file's `offset` counts from the end of the header

import { PROJECT_NAME } from "../shared/project";

/** First line of our loader's `index.js`. Tells our loader from another mod's. */
export const LOADER_MARKER = `/* ${PROJECT_NAME.toLowerCase()}-loader v1 */`;

export function buildAsar(files: Record<string, string | Buffer>): Buffer {
    const header: Record<string, { size: number; offset: string; }> = {};
    const contents: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
        header[name] = { size: data.length, offset: String(offset) };
        contents.push(data);
        offset += data.length;
    }

    const json = Buffer.from(JSON.stringify({ files: header }), "utf8");
    const padded = Math.ceil(json.length / 4) * 4;
    const prefix = Buffer.alloc(16 + padded);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(padded + 8, 4);
    prefix.writeUInt32LE(padded + 4, 8);
    prefix.writeUInt32LE(json.length, 12);
    json.copy(prefix, 16);
    return Buffer.concat([prefix, ...contents]);
}

export interface ParsedAsar {
    names: string[];
    /** Content of one file of the archive. Throws if the file is missing or points outside the archive. */
    read(name: string): Buffer;
}

/** Read an asar archive. Returns null if the bytes do not look like one. Never throws. */
export function parseAsar(buffer: Buffer): ParsedAsar | null {
    if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) return null;
    const secondBlock = buffer.readUInt32LE(4);
    const jsonLength = buffer.readUInt32LE(12);
    const dataStart = 8 + secondBlock;
    if (secondBlock < 8 || jsonLength > secondBlock || 16 + jsonLength > buffer.length || dataStart > buffer.length) return null;

    let files: unknown;
    try {
        files = (JSON.parse(buffer.toString("utf8", 16, 16 + jsonLength)) as { files?: unknown; }).files;
    } catch {
        return null;
    }
    if (typeof files !== "object" || files === null || Array.isArray(files)) return null;
    const table = files as Record<string, { size?: unknown; offset?: unknown; } | undefined>;

    return {
        names: Object.keys(table),
        read(name) {
            const entry = Object.hasOwn(table, name) ? table[name] : undefined;
            if (!entry || typeof entry.size !== "number" || typeof entry.offset !== "string") throw new Error(`${name} is not in the archive`);
            const start = dataStart + Number(entry.offset);
            const end = start + entry.size;
            if (!Number.isInteger(start) || start < dataStart || end > buffer.length) throw new Error(`${name} points outside the archive`);
            return buffer.subarray(start, end);
        }
    };
}

/**
 * Text of the loader's `index.js`. Runs inside Discord's main process, in this order:
 *  1. load the mod (an absolute path); if that fails, say so and go on;
 *  2. start Discord's own app, the original `_app.asar` next to the loader, as Discord itself would have.
 * So a missing or broken mod never stops Discord from opening.
 */
export function loaderSource(modPath: string): string {
    return [
        LOADER_MARKER,
        "\"use strict\";",
        "",
        "// The mod comes first: the installer reads this first require() to learn which mod the loader starts.",
        `try {`,
        "    trace(\"loader running\");",
        `    require(${JSON.stringify(modPath)});`,
        "    trace(\"mod returned\");",
        "} catch (error) {",
        `    console.error(${JSON.stringify(`[${PROJECT_NAME}] the mod could not be loaded, starting Discord without it:`)}, error);`,
        "    trace(\"the mod could NOT be loaded: \" + String(error && error.stack || error));",
        "}",
        "",
        "// The console of Discord's main process is seen by nobody, so each start leaves a line in a small file next to the mod's data (cut at 64 KB).",
        "function trace(text) {",
        "    try {",
        "        const path = require(\"path\");",
        "        const fs = require(\"fs\");",
        `        const file = path.join(path.dirname(path.dirname(${JSON.stringify(modPath)})), "boot-trace.log");`,
        "        try { if (fs.statSync(file).size > 65536) fs.writeFileSync(file, \"\"); } catch { /* no file yet */ }",
        "        fs.appendFileSync(file, new Date().toISOString() + \" pid=\" + process.pid + \" \" + String(text).replace(/[\\r\\n]+/g, \" \").slice(0, 300) + \"\\n\");",
        "    } catch {",
        "        // Nothing more can be done; Discord starts anyway.",
        "    }",
        "}",
        "",
        "const { join } = require(\"path\");",
        "const original = join(__dirname, \"..\", \"_app.asar\");",
        "const discordPackage = require(join(original, \"package.json\"));",
        "require.main.filename = join(original, discordPackage.main);",
        "require(\"electron\").app.setAppPath(original);",
        "require(require.main.filename);",
        ""
    ].join("\n");
}

export const LOADER_PACKAGE_JSON = JSON.stringify({ name: "discord", main: "index.js" });

/** The whole replacement `app.asar`. */
export function buildLoaderAsar(modPath: string): Buffer {
    return buildAsar({ "index.js": loaderSource(modPath), "package.json": LOADER_PACKAGE_JSON });
}
