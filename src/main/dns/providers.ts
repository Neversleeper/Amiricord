/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The encrypted DNS providers the owner can choose from, as data (design 05, piece P6a), and the check of an address typed by hand.
// The addresses were written from memory: they are never trusted, the verification of docs/analysis-21-encrypted-dns.md section 5 asks the provider a real question first.
// Nothing is chosen by default. Google, OpenDNS, Control D, the "ECS" variant of Quad9 and every filtered variant (family, adblock, malware) are left out on purpose:
// a filter can block a name Discord needs, and they can be added later as one line each, after being looked at one by one.

import { normalizeHost } from "../../shared/hostRules";

export interface DnsProvider {
    /** Lowercase letters, digits and hyphens: what `dns.json` stores. */
    id: string;
    name: string;
    /** The DNS-over-HTTPS address. */
    address: string;
    /** What the provider blocks by itself. */
    filters: "none" | "malware";
    /** One plain sentence for the tab. */
    note: string;
}

export const DNS_PROVIDERS: readonly DnsProvider[] = [
    { id: "quad9", name: "Quad9", address: "https://dns.quad9.net/dns-query", filters: "malware", note: "Run by a non-profit foundation; blocks known malware sites. It sees every name Discord looks up." },
    { id: "mullvad-base", name: "Mullvad (base)", address: "https://base.dns.mullvad.net/dns-query", filters: "none", note: "No filtering; the company says it keeps no logs. It sees every name Discord looks up." },
    { id: "cloudflare", name: "Cloudflare 1.1.1.1", address: "https://cloudflare-dns.com/dns-query", filters: "none", note: "Very fast, no filtering. It sees every name Discord looks up." },
    { id: "adguard-unfiltered", name: "AdGuard (unfiltered)", address: "https://unfiltered.adguard-dns.com/dns-query", filters: "none", note: "No filtering. It sees every name Discord looks up." }
];

/** The id that means "the address the owner typed". */
export const CUSTOM_PROVIDER = "custom";

export const MAX_ADDRESS_CHARS = 200;
const MAX_PATH_CHARS = 100;
const TEMPLATE = "{?dns}";

export const findProvider = (id: unknown): DnsProvider | undefined => (typeof id === "string" ? DNS_PROVIDERS.find(provider => provider.id === id) : undefined);

// A number above 255 is refused later by the address parser itself; here only the plain dotted form (no leading zeros) is told from the odd forms.
const isIPv4 = (host: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && host.split(".").every(part => String(Number(part)) === part);

/**
 * The address in its plain form (`https://host[:port]/path`, with the optional `{?dns}` ending of a URI template), or null when it is not acceptable:
 * only `https`, a plain host name or an IPv4 number, an optional port, a short plain path, no user name or password, no query, no fragment, no spaces.
 */
export function checkAddress(value: unknown): string | null {
    if (typeof value !== "string") return null;
    let text = value.trim();
    if (text.length === 0 || text.length > MAX_ADDRESS_CHARS || /[\s\\"'<>`]/.test(text)) return null;
    // Plain ASCII only: a name with other letters would be turned into another form by the address parser.
    if (/[^\x21-\x7e]/.test(text)) return null;
    let template = "";
    if (text.endsWith(TEMPLATE)) {
        template = TEMPLATE;
        text = text.slice(0, -TEMPLATE.length);
    }
    if (!/^https:\/\//i.test(text) || /[?#@]/.test(text)) return null;
    let address: URL;
    try {
        address = new URL(text);
    } catch {
        return null;
    }
    if (address.protocol !== "https:") return null;
    // The address parser turns odd number forms (`1.2.3`, `0x7f.1`, `2130706433`) into dotted numbers; what was typed must already be the plain dotted form.
    const typedHost = text.slice("https://".length).split(/[/:]/)[0]!;
    if (/^(?:0x[0-9a-f]*|[0-9]+)(?:\.(?:0x[0-9a-f]*|[0-9]+))*$/i.test(typedHost) && !isIPv4(typedHost)) return null;
    const host = isIPv4(address.hostname) ? address.hostname : normalizeHost(address.hostname);
    if (host === null) return null;
    const port = address.port === "" ? "" : `:${address.port}`;
    if (address.port !== "" && (!/^\d{1,5}$/.test(address.port) || Number(address.port) < 1 || Number(address.port) > 65535)) return null;
    const path = address.pathname;
    if (path.length > MAX_PATH_CHARS || !/^\/[A-Za-z0-9._~/-]*$/.test(path)) return null;
    return `https://${host}${port}${path}${template}`;
}
