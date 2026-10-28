/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AudioLike, createSoundLayer, locateSoundContext, MAX_SOUNDS_PER_PLUGIN, NAME_MAX, SOUND_CONTEXT_MARKER, type SoundContext, volumeOf } from "../src/api/sounds";

function context(files: Record<string, unknown>): SoundContext {
    const fn = ((key: string) => files[key]) as SoundContext;
    fn.keys = () => Object.keys(files);
    return fn;
}

class FakeAudio implements AudioLike {
    volume = -1;
    played = 0;
    paused = 0;
    listeners = new Map<string, () => void>();
    constructor(readonly url: string, private readonly reject = false, private readonly throwOnPlay = false) { }
    play() {
        this.played++;
        if (this.throwOnPlay) throw new Error("no");
        return this.reject ? Promise.reject(new Error("blocked")) : Promise.resolve();
    }
    pause() { this.paused++; }
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
}

const FILES = { "./discodo.mp3": "/assets/aaa.mp3", "./message1.mp3": "/assets/bbb.mp3", "./deafen.mp3": "https://cdn.example/ccc.mp3" };

function setup(over: Partial<{ found: SoundContext | undefined; locates: () => SoundContext | undefined; noAudio: boolean; reject: boolean; throwOnPlay: boolean; }> = {}) {
    const audios: FakeAudio[] = [];
    const disposers: Array<() => void> = [];
    const errors: string[] = [];
    let clock = 1000;
    const calls = { locate: 0 };
    const layer = createSoundLayer({
        locate: () => { calls.locate++; return over.locates ? over.locates() : ("found" in over ? over.found : context(FILES)); },
        createAudio: url => {
            if (over.noAudio) return undefined;
            const audio = new FakeAudio(url, over.reject, over.throwOnPlay);
            audios.push(audio);
            return audio;
        },
        now: () => clock
    });
    const sounds = layer.forPlugin("P", undo => { disposers.push(undo); }, (source, error) => { errors.push(`${source}: ${String(error)}`); });
    return { sounds, audios, disposers, errors, calls, tick: (ms: number) => { clock += ms; }, layer };
}

describe("the volume", () => {
    it("is clamped to 0 and 1 and is 1 when it is not a number", () => {
        assert.equal(volumeOf(0.5), 0.5);
        assert.equal(volumeOf(0), 0);
        assert.equal(volumeOf(1), 1);
        assert.equal(volumeOf(7), 1);
        assert.equal(volumeOf(-3), 0);
        assert.equal(volumeOf(undefined), 1);
        assert.equal(volumeOf(Number.NaN), 1);
        assert.equal(volumeOf("0.2"), 1);
        assert.equal(volumeOf(Infinity), 1);
        assert.equal(volumeOf(-Infinity), 0);
    });
});

describe("list", () => {
    it("gives the names of the sounds, without the folder and the extension, sorted", () => {
        assert.deepEqual(setup().sounds.list(), ["deafen", "discodo", "message1"]);
    });

    it("ignores keys that are not the key of a sound file", () => {
        const t = setup({ found: context({ "./a.mp3": "/x.mp3", "./b.svg": "/y.svg", "c.mp3": "/z.mp3", "./sub/d.mp3": "/w.mp3", "./bad name.mp3": "/v.mp3" }) });
        assert.deepEqual(t.sounds.list(), ["a"]);
    });

    it("is empty, and does not throw, when Discord's sounds cannot be reached", () => {
        assert.deepEqual(setup({ found: undefined }).sounds.list(), []);
        assert.deepEqual(setup({ locates: () => { throw new Error("boom"); } }).sounds.list(), []);
    });

    it("is empty when what was found does not behave like a context", () => {
        const notAFunction = { keys: () => ["./a.mp3"] } as unknown as SoundContext;
        assert.deepEqual(setup({ found: notAFunction }).sounds.list(), []);
        const noKeys = (() => "/x.mp3") as unknown as SoundContext;
        assert.deepEqual(setup({ found: noKeys }).sounds.list(), []);
        const brokenKeys = (() => "/x.mp3") as unknown as SoundContext;
        brokenKeys.keys = () => { throw new Error("no"); };
        assert.deepEqual(setup({ found: brokenKeys }).sounds.list(), []);
        const keysNotAList = (() => "/x.mp3") as unknown as SoundContext;
        (keysNotAList as unknown as { keys: () => unknown; }).keys = () => "nope";
        assert.deepEqual(setup({ found: keysNotAList }).sounds.list(), []);
    });

    it("looks for the context again only after the wait, and keeps it once found", () => {
        let available = false;
        const t = setup({ locates: () => (available ? context(FILES) : undefined) });
        assert.deepEqual(t.sounds.list(), []);
        assert.deepEqual(t.sounds.list(), []);
        assert.equal(t.calls.locate, 1, "a second ask right after a miss does not look again");
        available = true;
        t.tick(4999);
        assert.deepEqual(t.sounds.list(), [], "still inside the wait");
        t.tick(1);
        assert.deepEqual(t.sounds.list(), ["deafen", "discodo", "message1"]);
        assert.equal(t.calls.locate, 2);
        t.sounds.list();
        assert.equal(t.calls.locate, 2, "once found it is kept");
    });
});

describe("play", () => {
    it("starts the sound of a known name at the volume asked, and says true", () => {
        const t = setup();
        assert.equal(t.sounds.play("discodo", 0.5), true);
        assert.equal(t.audios.length, 1);
        assert.equal(t.audios[0].url, "/assets/aaa.mp3");
        assert.equal(t.audios[0].volume, 0.5);
        assert.equal(t.audios[0].played, 1);
    });

    it("uses the full volume when none is given and clamps one that is too big", () => {
        const t = setup();
        t.sounds.play("discodo");
        t.sounds.play("message1", 9);
        assert.deepEqual(t.audios.map(a => a.volume), [1, 1]);
    });

    it("accepts a file address with https as well as one of the page", () => {
        const t = setup();
        assert.equal(t.sounds.play("deafen"), true);
        assert.equal(t.audios[0].url, "https://cdn.example/ccc.mp3");
    });

    it("answers false for a name that is not one of the sounds and starts nothing", () => {
        const t = setup();
        for (const name of ["nope", "", "DISCODO", "../discodo", "discodo.mp3", "./discodo", " discodo"]) assert.equal(t.sounds.play(name), false, name);
        assert.equal(t.audios.length, 0);
    });

    it("answers false for a name that is not text or is too long", () => {
        const t = setup();
        for (const name of [undefined, null, 5, {}, ["discodo"], "x".repeat(NAME_MAX + 1)]) assert.equal(t.sounds.play(name as unknown as string), false);
        assert.equal(t.audios.length, 0);
        assert.deepEqual(t.errors, []);
    });

    it("does not play an address that is not a plain sound file address", () => {
        const bad = ["javascript:alert(1)", "data:audio/mp3;base64,AAAA", "http://x.example/a.mp3", "//x.example/a.mp3", "/a.mp3\"onerror=x", "/a b.mp3", "/a.wav", "", 5, undefined, null, {}];
        for (const address of bad) {
            const t = setup({ found: context({ "./x.mp3": address }) });
            assert.equal(t.sounds.play("x"), false, String(address));
            assert.equal(t.audios.length, 0);
        }
    });

    it("answers false when Discord's sounds cannot be reached, and when the page cannot play sounds", () => {
        assert.equal(setup({ found: undefined }).sounds.play("discodo"), false);
        const quiet = setup({ noAudio: true });
        assert.equal(quiet.sounds.play("discodo"), false);
        assert.deepEqual(quiet.errors, [], "a page with no sounds is not an error");
    });

    it("does not even ask Discord's context for a name that is not one of its keys (a real context throws for those)", () => {
        const asked: string[] = [];
        const strict = ((key: string) => { asked.push(key); if (!(key in FILES)) throw new Error("Cannot find module"); return (FILES as Record<string, string>)[key]; }) as SoundContext;
        strict.keys = () => Object.keys(FILES);
        const t = setup({ found: strict });
        assert.equal(t.sounds.play("nope"), false);
        assert.deepEqual(asked, [], "the context was never called");
        assert.deepEqual(t.errors, []);
    });

    it("answers false and reports when starting the sound throws", () => {
        const t = setup({ throwOnPlay: true });
        assert.equal(t.sounds.play("discodo"), false);
        assert.equal(t.errors.length, 1);
        assert.match(t.errors[0], /sounds\.play\(P\)/);
    });

    it("does not fail when the browser refuses to start the sound", async () => {
        const t = setup({ reject: true });
        assert.equal(t.sounds.play("discodo"), true);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(t.errors, []);
    });

    it("stops the oldest sound of the plugin when it asks for more than it may have", () => {
        const t = setup();
        for (let i = 0; i < MAX_SOUNDS_PER_PLUGIN + 2; i++) t.sounds.play("discodo");
        assert.equal(t.audios.length, MAX_SOUNDS_PER_PLUGIN + 2);
        assert.deepEqual(t.audios.map(a => a.paused), [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("lets a sound that ended make room for a new one", () => {
        const t = setup();
        for (let i = 0; i < MAX_SOUNDS_PER_PLUGIN; i++) t.sounds.play("discodo");
        t.audios[0].listeners.get("ended")!();
        t.sounds.play("discodo");
        assert.equal(t.audios[1].paused, 0, "nothing had to be stopped");
    });
});

describe("stopping", () => {
    it("stopAll stops every sound the plugin started", () => {
        const t = setup();
        t.sounds.play("discodo");
        t.sounds.play("message1");
        t.sounds.stopAll();
        assert.deepEqual(t.audios.map(a => a.paused), [1, 1]);
        t.sounds.stopAll();
        assert.deepEqual(t.audios.map(a => a.paused), [1, 1], "a second call stops nothing more");
    });

    it("registers one cleanup, the first time a sound is started, and it stops the sounds", () => {
        const t = setup();
        assert.equal(t.disposers.length, 0, "nothing is registered by only listing");
        t.sounds.list();
        t.sounds.play("nope");
        assert.equal(t.disposers.length, 0, "nor by a name that failed");
        t.sounds.play("discodo");
        t.sounds.play("message1");
        assert.equal(t.disposers.length, 1);
        t.disposers[0]();
        assert.deepEqual(t.audios.map(a => a.paused), [1, 1]);
    });

    it("keeps going when a sound cannot be stopped", () => {
        const t = setup();
        t.sounds.play("discodo");
        t.sounds.play("message1");
        t.audios[0].pause = () => { throw new Error("no"); };
        t.sounds.stopAll();
        assert.equal(t.audios[1].paused, 1);
    });

    it("does not share sounds between plugins", () => {
        const t = setup();
        const other = t.layer.forPlugin("Q", () => undefined, () => undefined);
        t.sounds.play("discodo");
        other.stopAll();
        assert.equal(t.audios[0].paused, 0);
    });
});

describe("finding Discord's sound context", () => {
    const sources: Record<string, string> = {
        1: "function(e){var a='nothing'}",
        2: `function(e,t,n){var i={${SOUND_CONTEXT_MARKER}:"558133"}}`,
        3: `function(e){var m=${SOUND_CONTEXT_MARKER}}`
    };

    function view(exportsById: Record<string, unknown>, ran: string[] = []) {
        return {
            ids: () => Object.keys(sources),
            sourceOf: (id: string) => sources[id],
            exportsOf: (id: string, load: boolean) => { if (load) ran.push(id); return exportsById[id]; }
        };
    }

    it("runs only the modules whose source carries the marker and returns the first that behaves like a context", () => {
        const ran: string[] = [];
        const wanted = context(FILES);
        const found = locateSoundContext(view({ 2: { notAContext: true }, 3: wanted }, ran));
        assert.equal(found, wanted);
        assert.deepEqual(ran, ["2", "3"], "module 1 has no marker and is never run");
    });

    it("answers undefined when no module carries the marker or none behaves like a context", () => {
        assert.equal(locateSoundContext({ ids: () => ["1"], sourceOf: () => "nothing here", exportsOf: () => context(FILES) }), undefined);
        assert.equal(locateSoundContext(view({ 2: 5, 3: "text" })), undefined);
        assert.equal(locateSoundContext({ ids: () => [], sourceOf: () => undefined, exportsOf: () => undefined }), undefined);
    });

    it("skips a module whose source cannot be read or that fails to run", () => {
        const wanted = context(FILES);
        const found = locateSoundContext({
            ids: () => ["2", "3", "4"],
            sourceOf: id => { if (id === "2") throw new Error("no"); return sources[id === "4" ? "3" : id]; },
            exportsOf: id => { if (id === "3") throw new Error("no"); return wanted; }
        });
        assert.equal(found, wanted);
    });
});
