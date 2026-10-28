/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerSecretCall, declaredSecrets, parseSecretCall, SECRET_LIMITS, SecretStore } from "../src/main/secretStore";

/** A fake of the operating system's secure storage: "encrypts" by reversing and tagging, so a test can tell stored text from the secret. */
function setup(options: { available?: boolean; saved?: string | null; writeError?: string | null; encryptThrows?: boolean; readThrows?: boolean; } = {}) {
    let file: string | null = options.saved ?? null;
    const writes: string[] = [];
    const backend = {
        available: () => options.available ?? true,
        encrypt: (text: string) => { if (options.encryptThrows) throw new Error("no"); return `enc:${[...text].reverse().join("")}`; },
        decrypt: (cipher: string) => (cipher.startsWith("enc:") ? [...cipher.slice(4)].reverse().join("") : null)
    };
    const store = new SecretStore({
        backend,
        file: {
            read: () => { if (options.readThrows) throw new Error("locked"); return file; },
            write: text => { if (options.writeError) return options.writeError; file = text; writes.push(text); return null; }
        }
    });
    return { store, writes, file: () => file };
}

describe("SecretStore", () => {
    it("saves a secret encrypted, never as plain text, and reads it back for the main process", () => {
        const t = setup();
        assert.equal(t.store.set("Pin", "cookie", "abc=123"), null);
        assert.equal(t.store.get("Pin", "cookie"), "abc=123");
        assert.equal(t.store.has("Pin", "cookie"), true);
        assert.equal(t.file()?.includes("abc=123"), false, "the plain text is nowhere in the file");
        assert.match(t.file()!, /"Pin"/);
    });

    it("keeps each plugin's secrets apart", () => {
        const t = setup();
        t.store.set("A", "k", "one");
        t.store.set("B", "k", "two");
        assert.equal(t.store.get("A", "k"), "one");
        assert.equal(t.store.get("B", "k"), "two");
        assert.equal(t.store.has("C", "k"), false);
        assert.equal(t.store.get("C", "k"), null);
    });

    it("replaces a secret and forgets one", () => {
        const t = setup();
        t.store.set("A", "k", "one");
        t.store.set("A", "k", "two");
        assert.equal(t.store.get("A", "k"), "two");
        assert.equal(t.store.clear("A", "k"), null);
        assert.equal(t.store.has("A", "k"), false);
        assert.equal(t.store.clear("A", "k"), null, "forgetting what is not there is not an error");
        assert.equal(t.file()?.includes("\"A\""), false, "a plugin without secrets leaves no entry");
    });

    it("reads what an earlier run saved", () => {
        const first = setup();
        first.store.set("A", "k", "kept");
        const second = setup({ saved: first.file() });
        assert.equal(second.store.get("A", "k"), "kept");
        assert.deepEqual(second.store.problems, []);
    });

    it("refuses, and saves nothing, when the secure storage is not available", () => {
        const t = setup({ available: false });
        assert.match(t.store.set("A", "k", "v") ?? "", /secure storage is not available/);
        assert.equal(t.store.has("A", "k"), false);
        assert.equal(t.writes.length, 0);
    });

    it("refuses, and saves nothing, when the encryption fails", () => {
        const t = setup({ encryptThrows: true });
        assert.match(t.store.set("A", "k", "v") ?? "", /could not be encrypted/);
        assert.equal(t.writes.length, 0);
    });

    it("keeps the old state in memory when the file cannot be written", () => {
        const t = setup({ writeError: "disk full" });
        assert.equal(t.store.set("A", "k", "v"), "disk full");
        assert.equal(t.store.has("A", "k"), false, "a secret that was not saved is not there");
    });

    it("keeps the earlier secret when saving a new one fails, and when forgetting fails", () => {
        const good = setup();
        good.store.set("A", "k", "one");
        let failing = false;
        const store = new SecretStore({
            backend: { available: () => true, encrypt: text => `enc:${text}`, decrypt: cipher => cipher.slice(4) },
            file: { read: () => good.file(), write: () => (failing ? "disk full" : null) }
        });
        failing = true;
        assert.equal(store.set("A", "k", "two"), "disk full");
        assert.equal(store.get("A", "k"), "one".split("").reverse().join(""), "still the stored cipher of the first one");
        assert.equal(store.clear("A", "k"), "disk full");
        assert.equal(store.has("A", "k"), true);
    });

    it("refuses invalid names, empty or huge values and non-text", () => {
        const t = setup();
        for (const [plugin, name] of [["", "k"], ["A", ""], ["A", "__proto__"], ["__proto__", "k"], ["A", "has space"], ["1A", "k"]]) assert.ok(t.store.set(plugin, name, "v"), `${plugin}/${name}`);
        assert.ok(t.store.set("A", "k", ""));
        assert.ok(t.store.set("A", "k", "x".repeat(SECRET_LIMITS.maxValueChars + 1)));
        assert.ok(t.store.set("A", "k", 5 as unknown as string));
        assert.equal(t.store.set("A", "k", "x".repeat(SECRET_LIMITS.maxValueChars)), null);
        assert.equal(t.writes.length, 1);
    });

    it("limits the number of secrets of one plugin, but still lets one be replaced", () => {
        const t = setup();
        for (let i = 0; i < SECRET_LIMITS.maxPerPlugin; i++) assert.equal(t.store.set("A", `k${i}`, "v"), null);
        assert.match(t.store.set("A", "extra", "v") ?? "", /too many secrets/);
        assert.equal(t.store.set("A", "k0", "new"), null);
        assert.equal(t.store.get("A", "k0"), "new");
    });

    it("refuses a file that would grow too large", () => {
        const t = setup();
        let refused: string | null = null;
        for (let i = 0; i < 60 && !refused; i++) refused = t.store.set(`P${i}`, "k", "x".repeat(SECRET_LIMITS.maxValueChars));
        assert.match(refused ?? "", /too large/);
    });

    it("says so, and offers no secret, when the file is damaged or cannot be read", () => {
        for (const saved of ["not json", "[]", JSON.stringify({ schema: 2, plugins: {} }), JSON.stringify({ schema: 1, plugins: [] })]) {
            const t = setup({ saved });
            assert.equal(t.store.has("A", "k"), false);
            assert.equal(t.store.problems.length, 1, saved);
        }
        const unreadable = setup({ readThrows: true });
        assert.equal(unreadable.store.has("A", "k"), false);
        assert.equal(unreadable.store.problems.length, 1);
    });

    it("skips entries that are not valid and keeps the good ones", () => {
        const saved = JSON.stringify({ schema: 1, plugins: { A: { k: "enc:v", "bad name": "enc:x", n: 5 }, "bad id": { k: "enc:y" }, B: "no" } });
        const t = setup({ saved });
        assert.equal(t.store.get("A", "k"), "v");
        assert.equal(t.store.has("A", "bad name"), false);
        assert.equal(t.store.has("A", "n"), false);
        assert.equal(t.store.has("bad id", "k"), false);
        assert.equal(t.store.has("B", "k"), false);
        assert.deepEqual(t.store.problems, []);
    });

    it("gives null for a secret that cannot be decrypted (another user, a damaged value) and never throws", () => {
        const t = setup({ saved: JSON.stringify({ schema: 1, plugins: { A: { k: "garbage" } } }) });
        assert.equal(t.store.has("A", "k"), true);
        assert.equal(t.store.get("A", "k"), null);
        const throwing = new SecretStore({ backend: { available: () => true, encrypt: x => x, decrypt: () => { throw new Error("dpapi"); } }, file: { read: () => JSON.stringify({ schema: 1, plugins: { A: { k: "x" } } }), write: () => null } });
        assert.equal(throwing.get("A", "k"), null);
    });

    it("answers has for names that every object has without finding anything", () => {
        const t = setup();
        assert.equal(t.store.has("constructor", "toString"), false);
        assert.equal(t.store.get("A", "constructor"), null);
    });
});

describe("parseSecretCall", () => {
    it("accepts the three actions with only the known fields", () => {
        assert.deepEqual(parseSecretCall({ action: "has", plugin: "A", name: "k", extra: 1 }), { action: "has", plugin: "A", name: "k" });
        assert.deepEqual(parseSecretCall({ action: "clear", plugin: "A", name: "k", value: "x" }), { action: "clear", plugin: "A", name: "k" });
        assert.deepEqual(parseSecretCall({ action: "set", plugin: "A", name: "k", value: "v" }), { action: "set", plugin: "A", name: "k", value: "v" });
    });

    it("rejects everything else", () => {
        for (const bad of [null, "x", [], {}, { action: "get", plugin: "A", name: "k" }, { action: "set", plugin: "A", name: "k" }, { action: "set", plugin: "A", name: "k", value: 5 },
            { action: "has", plugin: "__proto__", name: "k" }, { action: "has", plugin: "A", name: "constructor" }, { action: "has", plugin: "a b", name: "k" }, { action: "has", plugin: 5, name: "k" }]) {
            assert.equal(parseSecretCall(bad), null, JSON.stringify(bad));
        }
    });
});

describe("declaredSecrets", () => {
    it("lists the valid names each plugin declared", () => {
        const text = JSON.stringify({ plugins: [{ id: "A", secrets: ["k", "bad name", 5, "__proto__"] }, { id: "B", secrets: [] }, { id: "C" }, { id: "bad id", secrets: ["k"] }, "no"] });
        assert.deepEqual({ ...declaredSecrets(text) }, { A: ["k"], B: [] });
    });

    it("declares nothing when the registry cannot be read", () => {
        for (const text of ["not json", "[]", "{}", JSON.stringify({ plugins: 5 })]) assert.deepEqual({ ...declaredSecrets(text) }, {}, text);
    });
});

describe("answerSecretCall", () => {
    const trusted = (url: unknown) => url === "https://discord.com/app";
    const declared = () => ({ Pin: ["pinterestCookie"], Other: [] as string[] });
    const ask = (t: ReturnType<typeof setup>, message: unknown, url: unknown = "https://discord.com/app") => answerSecretCall(t.store, declared, trusted, url, message);

    it("sets, asks and clears a declared secret, and never answers with the value", () => {
        const t = setup();
        assert.deepEqual(ask(t, { action: "has", plugin: "Pin", name: "pinterestCookie" }), { ok: true, value: false });
        assert.deepEqual(ask(t, { action: "set", plugin: "Pin", name: "pinterestCookie", value: "sess=1" }), { ok: true });
        assert.deepEqual(ask(t, { action: "has", plugin: "Pin", name: "pinterestCookie" }), { ok: true, value: true });
        assert.equal(t.store.get("Pin", "pinterestCookie"), "sess=1");
        assert.deepEqual(ask(t, { action: "clear", plugin: "Pin", name: "pinterestCookie" }), { ok: true });
        assert.equal(t.store.has("Pin", "pinterestCookie"), false);
    });

    it("answers nothing to a page that is not Discord's", () => {
        const t = setup();
        for (const url of ["https://evil.example/", null, 5, "https://discord.com.evil.example/"]) {
            assert.deepEqual(ask(t, { action: "set", plugin: "Pin", name: "pinterestCookie", value: "v" }, url), { ok: false, error: "The caller is not Discord's page." });
        }
        assert.equal(t.store.has("Pin", "pinterestCookie"), false);
    });

    it("refuses a malformed call, an unknown plugin, an undeclared name and a plugin that declares none", () => {
        const t = setup();
        assert.deepEqual(ask(t, { action: "get", plugin: "Pin", name: "pinterestCookie" }), { ok: false, error: "The secret call is malformed." });
        assert.match((ask(t, { action: "set", plugin: "Nobody", name: "pinterestCookie", value: "v" }) as { error: string; }).error, /not a secret this plugin declared/);
        assert.match((ask(t, { action: "set", plugin: "Pin", name: "other", value: "v" }) as { error: string; }).error, /not a secret this plugin declared/);
        assert.match((ask(t, { action: "set", plugin: "Other", name: "pinterestCookie", value: "v" }) as { error: string; }).error, /not a secret this plugin declared/);
        assert.match((ask(t, { action: "has", plugin: "constructor", name: "toString" }) as { error: string; }).error, /malformed|not a secret/);
        assert.equal(t.writes.length, 0);
    });

    it("tells why a secret was refused, naming the plugin", () => {
        const t = setup({ available: false });
        const answer = ask(t, { action: "set", plugin: "Pin", name: "pinterestCookie", value: "v" }) as { ok: false; error: string; };
        assert.equal(answer.ok, false);
        assert.match(answer.error, /^Pin: .*secure storage is not available/);
    });
});
