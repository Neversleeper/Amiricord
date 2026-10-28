/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** SHA-256 of a file, read as a stream so a large file does not sit in memory. */
export function hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(path)
            .on("error", reject)
            .on("data", chunk => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")));
    });
}
