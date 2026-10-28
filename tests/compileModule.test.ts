/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileModule, expandIdentifiers, normalizeFactorySource, PatchReplacement, RegisteredPatch } from "../src/webpack/compileModule";

const MODULE = "function(e,t,n){var a=n(1);function render(){return a.header(e.title)}t.default=render;t.label=\"Hello\"}";

function patch(plugin: string, find: string | RegExp, replacements: PatchReplacement[], extra: Partial<RegisteredPatch> = {}): RegisteredPatch {
    return { plugin, find, replacements, ...extra };
}

const compile = (patches: RegisteredPatch[], source = MODULE, build?: number | null) => compileModule("123", source, patches, { build });

describe("normalizeFactorySource", () => {
    it("turns the method style Discord uses into a function expression", () => {
        assert.equal(normalizeFactorySource("442228(e,t,n){return 1}"), "function(e,t,n){return 1}");
    });

    it("drops the name of a named function expression", () => {
        assert.equal(normalizeFactorySource("function foo(e){return e}"), "function(e){return e}");
    });

    it("leaves arrow functions alone, with or without parentheses", () => {
        assert.equal(normalizeFactorySource("(e,t)=>{return 1}"), "(e,t)=>{return 1}");
        assert.equal(normalizeFactorySource("e=>{return(1+(2))}"), "e=>{return(1+(2))}");
        assert.equal(normalizeFactorySource("async (e)=>{}"), "async (e)=>{}");
    });
});

describe("expandIdentifiers", () => {
    it("matches minified identifiers", () => {
        const re = new RegExp(expandIdentifiers(String.raw`\i\.header\(\i\.title\)`));
        for (const code of ["a.header(e.title)", "$x.header(_y1.title)", "ab9.header(Z$.title)"]) assert.ok(re.test(code), code);
        assert.ok(!new RegExp(expandIdentifiers(String.raw`\i\.x`)).test("9.x"));
    });

    it("keeps an escaped backslash followed by i as text", () => {
        const re = new RegExp(expandIdentifiers(String.raw`a\\i`));
        assert.ok(re.test("a\\i"));
        assert.ok(!re.test("ab"));
    });
});

describe("compileModule: applying patches", () => {
    it("leaves the module alone when no patch targets it", () => {
        const r = compile([patch("P", "not in this module", [{ match: "a", replace: "b" }])]);
        assert.equal(r.changed, false);
        assert.deepEqual(r.outcomes, []);
        assert.equal(r.code, MODULE);
    });

    it("applies text, regular expression and function replacements", () => {
        const r = compile([patch("P", "a.header", [
            { match: "\"Hello\"", replace: "\"Hi\"" },
            { match: /a\.header\((\i)\.title\)/, replace: "a.header($1.title+'!')" },
            { match: /t\.default=(\i)/, replace: (_m: string, name: string) => `t.default=wrap(${name})` }
        ])]);
        assert.equal(r.code, "function(e,t,n){var a=n(1);function render(){return a.header(e.title+'!')}t.default=wrap(render);t.label=\"Hi\"}");
        assert.equal(r.outcomes[0].status, "applied");
        assert.deepEqual(r.patchedBy, ["P"]);
        assert.equal(r.changed, true);
    });

    it("finds a module by regular expression too, and does not misbehave with a global one used twice", () => {
        const find = /render\(\)\{/g;
        const one = patch("P", find, [{ match: "return a.header", replace: "return a.header2" }]);
        assert.equal(compile([one]).outcomes.length, 1);
        assert.equal(compile([one]).outcomes.length, 1);
    });

    it("expands `$self` to the plugin, without confusing it with replacement patterns", () => {
        const r = compile([patch("MyPlugin", "a.header", [{ match: "a.header(", replace: "$self.header(a," }])]);
        assert.match(r.code, /Amiricord\.plugin\("MyPlugin"\)\.header\(a,e\.title\)/);
        const custom = compileModule("1", MODULE, [patch("X", "a.header", [{ match: "a.header(", replace: "$self.go(" }])], { selfExpression: id => `reg.get('${id}')` });
        assert.match(custom.code, /reg\.get\('X'\)\.go\(e\.title\)/);
    });

    it("expands `$self` in the text a replace function returns", () => {
        const r = compile([patch("P", "a.header", [{ match: "a.header(", replace: () => "$self.h(" }])]);
        assert.match(r.code, /Amiricord\.plugin\("P"\)\.h\(e\.title\)/);
    });

    it("applies patches of several plugins in order; a later one sees the earlier result", () => {
        const r = compile([
            patch("First", "a.header", [{ match: "a.header(", replace: "a.first(" }]),
            // `find` is checked against the original module, but a replacement's `match` runs on the code so far
            patch("Second", "a.header", [{ match: "a.first(", replace: "a.second(" }])
        ]);
        assert.match(r.code, /a\.second\(e\.title\)/);
        assert.deepEqual(r.patchedBy, ["First", "Second"]);
    });

    it("never runs the module", () => {
        const source = "function(e){globalThis.__amiricordRan = true;}";
        compile([patch("P", "__amiricordRan", [{ match: "true", replace: "false" }])], source);
        assert.equal((globalThis as Record<string, unknown>).__amiricordRan, undefined);
    });

    it("does not change the patches it is given", () => {
        const p = Object.freeze(patch("P", "a.header", Object.freeze([Object.freeze({ match: "a.header(", replace: "a.x(" })]) as PatchReplacement[]));
        assert.doesNotThrow(() => compile([p]));
    });

    it("reports a time for every replacement", () => {
        const r = compile([patch("P", "a.header", [{ match: "a.header(", replace: "a.x(" }])]);
        assert.ok(Number.isFinite(r.outcomes[0].replacements[0].ms));
    });
});

describe("compileModule: replacements that do not work", () => {
    it("records a replacement that finds nothing and still applies the others", () => {
        const r = compile([patch("P", "a.header", [
            { match: "does not exist", replace: "x" },
            { match: "\"Hello\"", replace: "\"Hi\"" }
        ])]);
        const o = r.outcomes[0];
        assert.deepEqual(o.replacements.map(x => x.status), ["no-effect", "applied"]);
        assert.equal(o.status, "partial");
        assert.match(r.code, /"Hi"/);
    });

    it("counts a replacement that gives identical code as no effect", () => {
        const r = compile([patch("P", "a.header", [{ match: "a.header", replace: "a.header" }])]);
        assert.equal(r.outcomes[0].replacements[0].status, "no-effect");
        assert.equal(r.outcomes[0].status, "failed");
        assert.equal(r.changed, false);
    });

    it("records an error and keeps going", () => {
        const r = compile([patch("P", "a.header", [
            { match: "a.header(", replace: () => { throw new Error("boom"); } },
            { match: "\"Hello\"", replace: "\"Hi\"" }
        ])]);
        const o = r.outcomes[0];
        assert.equal(o.replacements[0].status, "errored");
        assert.match(o.replacements[0].error ?? "", /boom/);
        assert.equal(o.replacements[1].status, "applied");
    });

    it("keeps other plugins' patches when one plugin's patch fails", () => {
        const r = compile([
            patch("Bad", "a.header", [{ match: "nope", replace: "x" }]),
            patch("Good", "a.header", [{ match: "\"Hello\"", replace: "\"Hi\"" }])
        ]);
        assert.deepEqual(r.outcomes.map(o => o.status), ["failed", "applied"]);
        assert.deepEqual(r.patchedBy, ["Good"]);
    });

    it("carries the required flag, true by default", () => {
        const r = compile([
            patch("A", "a.header", [{ match: "nope", replace: "x" }]),
            patch("B", "a.header", [{ match: "nope", replace: "x" }], { required: false })
        ]);
        assert.deepEqual(r.outcomes.map(o => o.required), [true, false]);
    });
});

describe("compileModule: groups", () => {
    it("takes back a whole group when one of its replacements does not work", () => {
        const r = compile([patch("P", "a.header", [
            { match: "\"Hello\"", replace: "\"Hi\"" },
            { match: "does not exist", replace: "x" },
            { match: "a.header(", replace: "a.never(" }
        ], { group: true })]);
        assert.equal(r.code, MODULE);
        assert.equal(r.changed, false);
        assert.deepEqual(r.outcomes[0].replacements.map(x => x.status), ["undone", "no-effect", "not-run"]);
        assert.equal(r.outcomes[0].status, "undone");
        assert.deepEqual(r.patchedBy, []);
    });

    it("applies a group when every replacement works", () => {
        const r = compile([patch("P", "a.header", [
            { match: "\"Hello\"", replace: "\"Hi\"" },
            { match: "a.header(", replace: "a.x(" }
        ], { group: true })]);
        assert.equal(r.outcomes[0].status, "applied");
        assert.match(r.code, /"Hi"/);
    });

    it("a failed group does not undo what earlier patches did", () => {
        const r = compile([
            patch("Early", "a.header", [{ match: "\"Hello\"", replace: "\"Hi\"" }]),
            patch("Group", "a.header", [{ match: "a.header(", replace: "a.x(" }, { match: "nope", replace: "y" }], { group: true })
        ]);
        assert.match(r.code, /"Hi"/);
        assert.doesNotMatch(r.code, /a\.x\(/);
    });
});

describe("compileModule: patched code that does not parse", () => {
    it("drops only the replacement that broke the code and keeps the rest", () => {
        const r = compile([
            patch("Good", "a.header", [{ match: "\"Hello\"", replace: "\"Hi\"" }]),
            patch("Bad", "a.header", [{ match: "a.header(", replace: "a.header(}}}" }])
        ]);
        assert.match(r.code, /"Hi"/);
        assert.doesNotMatch(r.code, /\}\}\}/);
        assert.equal(r.outcomes[0].status, "applied");
        assert.equal(r.outcomes[1].replacements[0].status, "syntax-error");
        assert.equal(r.outcomes[1].status, "failed");
        assert.deepEqual(r.patchedBy, ["Good"]);
        assert.ok(r.problems.some(p => p.includes("Bad")));
    });

    it("drops a whole group when one of its replacements breaks the code", () => {
        const r = compile([
            patch("Good", "a.header", [{ match: "\"Hello\"", replace: "\"Hi\"" }]),
            patch("Group", "a.header", [{ match: "a.header(", replace: "a.x(" }, { match: "t.default=render", replace: "t.default=render}}" }], { group: true })
        ]);
        assert.match(r.code, /"Hi"/);
        assert.doesNotMatch(r.code, /a\.x\(/);
        assert.ok(r.outcomes[1].replacements.every(x => x.status === "syntax-error"));
    });

    it("marks a replacement that depended on a dropped one as no longer applying", () => {
        const r = compile([
            patch("Breaker", "a.header", [{ match: "a.header(", replace: "{{{a.header(" }]),
            patch("Dependent", "a.header", [{ match: "{{{a.header(", replace: "{{{a.second(" }])
        ]);
        assert.equal(r.code, MODULE);
        assert.equal(r.outcomes[0].replacements[0].status, "syntax-error");
        assert.equal(r.outcomes[1].replacements[0].status, "no-effect");
        assert.deepEqual(r.patchedBy, []);
    });

    it("needs no recovery when a later patch repairs the code of an earlier one", () => {
        const r = compile([
            patch("First", "a.header", [{ match: "a.header(", replace: "{{{a.header(" }]),
            patch("Second", "a.header", [{ match: "{{{a.header(", replace: "a.fixed(" }])
        ]);
        assert.match(r.code, /a\.fixed\(e\.title\)/);
        assert.deepEqual(r.problems, []);
        assert.deepEqual(r.outcomes.map(o => o.status), ["applied", "applied"]);
    });

    it("works with a custom parser", () => {
        const r = compileModule("1", MODULE, [patch("P", "a.header", [{ match: "a.header(", replace: "FORBIDDEN(" }])], { canParse: code => !code.includes("FORBIDDEN") });
        assert.equal(r.code, MODULE);
        assert.equal(r.outcomes[0].replacements[0].status, "syntax-error");
    });

    it("applies nothing, and says so, when the module itself does not parse", () => {
        const r = compile([patch("P", "a.header", [{ match: "a.header(", replace: "x(" }])], "function(e){ a.header( this is not code");
        assert.equal(r.changed, false);
        assert.ok(r.problems.some(p => p.includes("does not parse")));
        assert.equal(r.outcomes[0].status, "failed");
    });
});

describe("compileModule: Discord build ranges", () => {
    const ranged = (discord: RegisteredPatch["discord"]) => patch("P", "a.header", [{ match: "a.header(", replace: "a.x(" }], { discord });

    it("skips a patch written for other builds", () => {
        const below = compile([ranged({ minBuild: 500 })], MODULE, 400);
        assert.equal(below.outcomes[0].status, "skipped");
        assert.equal(below.changed, false);
        assert.equal(compile([ranged({ maxBuild: 300 })], MODULE, 400).outcomes[0].status, "skipped");
    });

    it("applies a patch inside its range, and ignores ranges when the build is unknown", () => {
        assert.equal(compile([ranged({ minBuild: 300, maxBuild: 500 })], MODULE, 400).outcomes[0].status, "applied");
        assert.equal(compile([ranged({ minBuild: 999 })], MODULE, null).outcomes[0].status, "applied");
        assert.equal(compile([ranged({ minBuild: 999 })]).outcomes[0].status, "applied");
    });
});
