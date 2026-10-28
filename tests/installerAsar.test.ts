/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { buildAsar, buildLoaderAsar, LOADER_MARKER, loaderSource, parseAsar } from "../src/installer/asar";

describe("buildAsar and parseAsar", () => {
    it("round-trips files of any length, including odd ones that need header padding", () => {
        for (const text of ["", "a", "ab", "abc", "abcd", "x".repeat(1001)]) {
            const asar = parseAsar(buildAsar({ "one.txt": text, "two.bin": Buffer.from([1, 2, 3]) }));
            assert.ok(asar);
            assert.deepEqual(asar.names, ["one.txt", "two.bin"]);
            assert.equal(asar.read("one.txt").toString("utf8"), text);
            assert.deepEqual([...asar.read("two.bin")], [1, 2, 3]);
        }
    });

    it("writes the header sizes the way asar readers expect", () => {
        const buffer = buildAsar({ "index.js": "x" });
        const jsonLength = buffer.readUInt32LE(12);
        const padded = Math.ceil(jsonLength / 4) * 4;
        assert.equal(buffer.readUInt32LE(0), 4);
        assert.equal(buffer.readUInt32LE(4), padded + 8);
        assert.equal(buffer.readUInt32LE(8), padded + 4);
        // The padding is made of zero bytes and the data starts right after it.
        assert.ok(buffer.subarray(16 + jsonLength, 16 + padded).every(byte => byte === 0));
        assert.equal(buffer.subarray(16 + padded).toString("utf8"), "x");
    });

    it("refuses what is not an asar, without throwing", () => {
        const good = buildAsar({ "a": "b" });
        const bad: Buffer[] = [
            Buffer.alloc(0), Buffer.from("hello world, not an asar file"), Buffer.alloc(40),
            good.subarray(0, 14), good.subarray(0, 20),
            (() => { const b = Buffer.from(good); b.writeUInt32LE(0xffffff, 12); return b; })(),
            (() => { const b = Buffer.from(good); b.write("[", 16); return b; })()
        ];
        for (const buffer of bad) assert.equal(parseAsar(buffer), null);
    });

    it("throws a clear error for a file that is not there or points outside the data", () => {
        const asar = parseAsar(buildAsar({ "a": "text" }))!;
        assert.throws(() => asar.read("missing"), /not in the archive/);
        assert.throws(() => asar.read("__proto__"), /not in the archive/);
        const broken = parseAsar(Buffer.from(buildAsar({ "a": "text" }).subarray(0, -2)))!;
        assert.throws(() => broken.read("a"), /outside/);
    });
});

describe("the loader", () => {
    it("is a small asar whose index.js starts with our marker and whose package.json names index.js", () => {
        const asar = parseAsar(buildLoaderAsar("C:\\Users\\x y\\mod\\main.js"))!;
        assert.deepEqual(asar.names, ["index.js", "package.json"]);
        assert.ok(asar.read("index.js").toString("utf8").startsWith(LOADER_MARKER));
        assert.deepEqual(JSON.parse(asar.read("package.json").toString("utf8")), { name: "discord", main: "index.js" });
        assert.ok(asar.read("index.js").length < 2000);
        // The first require() is still the mod, even with the error log code after it: the installer reads that one.
        assert.equal(JSON.parse(/require\(("(?:[^"\\]|\\.)*")\)/.exec(asar.read("index.js").toString("utf8"))![1]), "C:\\Users\\x y\\mod\\main.js");
    });

    it("keeps an odd path inside its string", () => {
        const source = loaderSource("C:\\a\"b\\c'd\\main.js");
        const quoted = /require\(("(?:[^"\\]|\\.)*")\)/.exec(source)!;
        assert.equal(JSON.parse(quoted[1]), "C:\\a\"b\\c'd\\main.js");
    });

    /** Run the loader's text with stand-ins for Node's `require`, the way Discord's main process would. */
    function runLoader(options: { modThrows?: boolean; logFails?: boolean; } = {}) {
        const calls: string[] = [];
        const logged: Array<[string, string]> = [];
        const resources = join("C:\\", "Discord", "resources");
        const original = join(resources, "_app.asar");
        const fakeRequire = Object.assign((request: string): unknown => {
            if (request === "path") return { join, dirname };
            if (request === "fs") {
                return {
                    statSync: () => { throw new Error("no file yet"); },
                    writeFileSync: () => undefined,
                    appendFileSync: (file: string, text: string) => { if (options.logFails) throw new Error("disk full"); logged.push([file, text]); }
                };
            }
            if (request === "electron") return { app: { setAppPath: (path: string) => { calls.push(`setAppPath ${path}`); } } };
            if (request === "C:\\mod\\main.js") {
                calls.push("mod");
                if (options.modThrows) throw new Error("mod is broken");
                return {};
            }
            if (request === join(original, "package.json")) return { main: "app_bootstrap/index.js" };
            calls.push(`require ${request}`);
            return {};
        }, { main: { filename: join(resources, "app.asar", "index.js") } });

        const errors: unknown[][] = [];
        const consoleStub = { error: (...args: unknown[]) => { errors.push(args); } };
        // eslint-disable-next-line no-new-func -- runs the loader's own text, which is what Discord's main process does
        new Function("require", "__dirname", "console", loaderSource("C:\\mod\\main.js"))(fakeRequire, join(resources, "app.asar"), consoleStub);
        return { calls, errors, logged, original, filename: fakeRequire.main.filename };
    }

    it("loads the mod first, then starts Discord's original app as Discord would have", () => {
        const { calls, errors, original, filename } = runLoader();
        assert.deepEqual(calls, ["mod", `setAppPath ${original}`, `require ${join(original, "app_bootstrap/index.js")}`]);
        assert.equal(filename, join(original, "app_bootstrap/index.js"));
        assert.deepEqual(errors, []);
    });

    it("still starts Discord, and says why, when the mod cannot be loaded", () => {
        const { calls, errors, original } = runLoader({ modThrows: true });
        assert.deepEqual(calls, ["mod", `setAppPath ${original}`, `require ${join(original, "app_bootstrap/index.js")}`]);
        assert.equal(errors.length, 1);
        assert.match(String(errors[0][0]), /could not be loaded/);
    });

    it("writes a line of trace at each start, in the data folder (the parent of the mod's folder), whether the mod loads or not", () => {
        const ok = runLoader();
        assert.deepEqual(ok.logged.map(([file]) => file), [join("C:\\", "boot-trace.log"), join("C:\\", "boot-trace.log")]);
        assert.deepEqual(ok.logged.map(([, text]) => text.replace(/^\S+ pid=\d+ /, "").trim()), ["loader running", "mod returned"]);
        assert.match(ok.logged[0][1], /^\d{4}-\d{2}-\d{2}T\S+ pid=\d+ /);

        const failed = runLoader({ modThrows: true });
        assert.deepEqual(failed.logged.map(([, text]) => text.replace(/^\S+ pid=\d+ /, "").trim().slice(0, 40)), ["loader running", "the mod could NOT be loaded: Error: mod "]);
    });

    it("keeps each trace entry on one line", () => {
        const failed = runLoader({ modThrows: true });
        for (const [, text] of failed.logged) assert.equal(text.trimEnd().split("\n").length, 1);
    });

    it("still starts Discord when the trace cannot be written", () => {
        const { calls, original } = runLoader({ modThrows: true, logFails: true });
        assert.deepEqual(calls, ["mod", `setAppPath ${original}`, `require ${join(original, "app_bootstrap/index.js")}`]);
    });
});
