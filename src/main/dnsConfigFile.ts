/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The encrypted DNS choice on disk (design 05, piece P6a): `dns.json` in the folder of each Discord, apart from the other files. Read once at start; written through a temporary
// file and a rename. The checks of what is read are in `./dns/config.ts`. A missing file is normal (off). Nothing here throws.

import { join } from "node:path";

import { readTextFile, writeTextAtomic } from "./atomicFile";
import { defaultDnsConfig, DnsConfig, ParsedDnsConfig, parseDnsConfig, serializeDnsConfig } from "./dns/config";

export const DNS_FILE = "dns.json";

export const dnsConfigPath = (dataDir: string): string => join(dataDir, DNS_FILE);

/** The choice in the file. A missing file means off with no problem; one that cannot be read means off with a sentence. */
export function loadDnsConfig(path: string): ParsedDnsConfig {
    const read = readTextFile(path);
    if (read.kind === "missing") return { config: defaultDnsConfig(), problems: [] };
    if (read.kind === "error") return { config: defaultDnsConfig(), problems: [`dns.json could not be read (${read.message}), so encrypted DNS stays off`] };
    return parseDnsConfig(read.text);
}

/** Write the choice. Returns the error text, or null when it worked. */
export function saveDnsConfig(path: string, config: DnsConfig): string | null {
    return writeTextAtomic(path, serializeDnsConfig(config));
}
