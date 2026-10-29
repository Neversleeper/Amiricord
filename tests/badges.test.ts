/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defineBadge, describeList, EMPTY_LIST, giveBadge, pictureExtension, removeBadge, takeBadge } from "../scripts/badgeEditor";
import type { NativeHostApi } from "../src/main/nativeHost";
import { badgesOf } from "../src/plugins/Badges/badgeLogic";
import plugin from "../src/plugins/Badges/index";
import { pronounsIn, type RestLike, syncMarker } from "../src/plugins/Badges/marker";
import { loadList, loadRegistry, registerSelf } from "../src/plugins/Badges/native";
import manifest from "../src/plugins/Badges/plugin.json";
import { cardsForPerson } from "../src/plugins/Settings/pluginsModel";
import { hasMarker, iconsNeeded, MARKER, MAX_PRONOUNS, parseBadgeList, parseRegistry, withMarker, withoutMarker } from "../src/shared/badgeList";
import { computeRisk } from "../src/shared/manifest";
import { OWNER_ONLY_PLUGINS, OWNERS, REGISTRY_HOST, REGISTRY_URL, UPDATE_REPO } from "../src/shared/project";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const USER = "123456789012345678";
const OTHER = "223456789012345678";

describe("the invisible mark", () => {
    it("is added once, found, and taken away without touching the rest of the pronouns", () => {
        assert.equal(hasMarker("she/her"), false);
        const marked = withMarker("she/her")!;
        assert.equal(marked, `she/her${MARKER}`);
        assert.equal(hasMarker(marked), true);
        assert.equal(withMarker(marked), marked, "not added twice");
        assert.equal(withoutMarker(marked), "she/her");
        assert.equal(withoutMarker(`a${MARKER}b${MARKER}`), "ab");
        assert.equal(hasMarker(undefined), false);
        assert.equal(hasMarker(5), false);
    });

    it("is not added when the pronouns would pass Discord's limit, and is not TestCord's mark", () => {
        assert.equal(withMarker("x".repeat(MAX_PRONOUNS)), null);
        assert.notEqual(withMarker("x".repeat(MAX_PRONOUNS - MARKER.length)), null);
        assert.equal(hasMarker("a​b"), false, "a zero-width space alone is TestCord's, not ours");
    });
});

describe("the badge list", () => {
    const good = { schema: 1, badges: { staff: { tooltip: " Staff\n", icon: "staff.png", extra: 1 }, bad_icon: { tooltip: "x", icon: "../x.png" }, "Bad Key": { tooltip: "x", icon: "a.png" }, notip: { tooltip: "", icon: "a.png" } }, users: { [USER]: ["staff", "bad_icon", "missing", "staff", 7], "not-an-id": ["staff"], [OTHER]: ["bad_icon"] } };

    it("is rebuilt field by field: a bad badge or person is dropped and the rest is kept", () => {
        const list = parseBadgeList(good);
        assert.ok(typeof list !== "string");
        assert.deepEqual({ ...list.badges }, { staff: { tooltip: "Staff", icon: "staff.png" } });
        assert.deepEqual({ ...list.users }, { [USER]: ["staff"] });
        assert.deepEqual(iconsNeeded(list), ["staff.png"]);
    });

    it("is refused, with a sentence, when it is not a list of a kind this version knows", () => {
        assert.match(parseBadgeList(null) as string, /not in the expected form/);
        assert.match(parseBadgeList({ schema: 2 }) as string, /kind this version does not know/);
        const empty = parseBadgeList({ schema: 1 }) as { badges: object; users: object; };
        assert.deepEqual([{ ...empty.badges }, { ...empty.users }], [{}, {}]);
    });

    it("takes only plain names for pictures, and never names that are not on the picture list", () => {
        for (const icon of ["a.png", "a_b-1.webp", "a.gif", "a.jpg", "a.svg"]) assert.ok(typeof parseBadgeList({ schema: 1, badges: { a: { tooltip: "t", icon } } }) !== "string");
        for (const icon of ["a.exe", "a/b.png", "..\\a.png", "a.png?x=1", "https://x/a.png", ".png", "a b.png"]) {
            const list = parseBadgeList({ schema: 1, badges: { a: { tooltip: "t", icon } } });
            assert.deepEqual(typeof list === "string" ? null : Object.keys(list.badges), [], icon);
        }
    });
});

describe("which badges a profile gets", () => {
    const list = { badges: { staff: { tooltip: "Staff", src: "data:image/png;base64,AA==" } }, users: { [USER]: ["staff"] } };
    const sources = (extra: Partial<Parameters<typeof badgesOf>[1]> = {}) => ({ owners: new Set([OWNERS[0].discordId]), list, showUsers: true, ...extra });

    it("gives an owner the owner badge, a listed person their badges, and a marked profile the user badge, in that order", () => {
        assert.deepEqual(badgesOf({ userId: OWNERS[0].discordId }, sources()).map(b => b.id), ["amiricord_owner"]);
        assert.deepEqual(badgesOf({ userId: USER, pronouns: `he/him${MARKER}` }, sources()).map(b => b.id), ["amiricord_badge_staff", "amiricord_user"]);
        assert.deepEqual(badgesOf({ userId: OWNERS[0].discordId, pronouns: MARKER }, sources()).map(b => b.id), ["amiricord_owner", "amiricord_user"]);
        assert.equal(badgesOf({ userId: USER }, sources())[0].description, "Staff");
        assert.ok(badgesOf({ userId: USER }, sources()).every(b => b.iconSrc.startsWith("data:")));
    });

    it("gives nothing to a stranger, to a profile it cannot read, or when the user badge is switched off", () => {
        assert.deepEqual(badgesOf({ userId: OTHER, pronouns: "she/her" }, sources()), []);
        assert.deepEqual(badgesOf(undefined, sources()), []);
        assert.deepEqual(badgesOf({ userId: 5 }, sources()), []);
        assert.deepEqual(badgesOf({ userId: OTHER, pronouns: MARKER }, sources({ showUsers: false })), []);
        assert.deepEqual(badgesOf({ userId: OTHER, pronouns: MARKER }, sources({ showUsers: false, registered: new Set([OTHER]) })), [], "the badge can be switched off for everybody");
    });

    it("gives the user badge to anybody the registry lists, with nothing in their pronouns, and keeps the mark as a second way", () => {
        const registered = new Set([OTHER]);
        assert.deepEqual(badgesOf({ userId: OTHER }, sources({ registered })).map(b => b.id), ["amiricord_user"]);
        assert.deepEqual(badgesOf({ userId: OTHER, pronouns: "she/her" }, sources({ registered })).map(b => b.id), ["amiricord_user"]);
        assert.deepEqual(badgesOf({ userId: USER, pronouns: "x" }, sources({ registered })).map(b => b.id), ["amiricord_badge_staff"], "somebody who is not listed and has no mark gets no user badge");
        assert.deepEqual(badgesOf({ userId: USER, pronouns: MARKER }, sources({ registered: null })).map(b => b.id), ["amiricord_badge_staff", "amiricord_user"], "without the list the mark still works");
        assert.deepEqual(badgesOf({ userId: OWNERS[0].discordId }, sources({ registered: new Set([OWNERS[0].discordId]) })).map(b => b.id), ["amiricord_owner", "amiricord_user"]);
        assert.deepEqual(badgesOf({ userId: USER }, sources({ list: null })), []);
    });
});

describe("writing the mark to the person's own profile", () => {
    const rest = (start: string, options: { noPatch?: boolean; strips?: boolean; } = {}) => {
        const calls: string[] = [];
        let pronouns = start;
        const api: RestLike = {
            get: async ({ url }) => { calls.push(`GET ${url}`); return { body: { user_profile: { pronouns } } }; },
            ...(options.noPatch ? {} : { patch: async ({ url, body }) => { calls.push(`PATCH ${url} ${JSON.stringify(body)}`); pronouns = options.strips ? withoutMarker((body as { pronouns: string; }).pronouns) : (body as { pronouns: string; }).pronouns; return {}; } })
        };
        return { api, calls };
    };

    it("reads the pronouns from either shape of answer", () => {
        assert.equal(pronounsIn({ user_profile: { pronouns: "a" } }), "a");
        assert.equal(pronounsIn({ pronouns: "b" }), "b");
        assert.equal(pronounsIn(null), "");
        assert.equal(pronounsIn({ user_profile: { pronouns: 4 } }), "");
    });

    it("adds the mark to the end of the pronouns and writes only when something changes", async () => {
        const add = rest("she/her");
        assert.equal(await syncMarker(add.api, USER, true), "added");
        assert.deepEqual(add.calls, [`GET /users/${USER}/profile`, `PATCH /users/@me/profile ${JSON.stringify({ pronouns: `she/her${MARKER}` })}`, `GET /users/${USER}/profile`], "it reads the profile again to see what Discord kept");
        const already = rest(`she/her${MARKER}`);
        assert.equal(await syncMarker(already.api, USER, true), "unchanged");
        assert.equal(already.calls.length, 1, "only the read");
        const none = rest("");
        assert.equal(await syncMarker(none.api, USER, false), "unchanged");
        assert.equal(none.calls.length, 1);
    });

    it("takes the mark away when it is switched off, and says so when it cannot", async () => {
        const off = rest(`she/her${MARKER}`);
        assert.equal(await syncMarker(off.api, USER, false), "removed");
        assert.ok(off.calls[1].includes(JSON.stringify({ pronouns: "she/her" })));
        assert.equal(await syncMarker(rest("x".repeat(MAX_PRONOUNS)).api, USER, true), "too-long");
        assert.equal(await syncMarker(rest("a", { noPatch: true }).api, USER, true), "no-patch");
        assert.equal(await syncMarker(rest("a", { strips: true }).api, USER, true), "lost", "Discord accepted the request but did not keep the mark");
    });
});

describe("reading the list in the main process", () => {
    const base = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/badges`;
    const png = new Uint8Array([137, 80, 78, 71]);
    const listText = JSON.stringify({ schema: 1, badges: { staff: { tooltip: "Staff", icon: "staff.png" }, gone: { tooltip: "Gone", icon: "gone.png" }, unused: { tooltip: "Unused", icon: "unused.png" } }, users: { [USER]: ["staff"], [OTHER]: ["gone", "staff"] } });

    function fakeHost(answers: Record<string, Uint8Array | number>) {
        const asked: string[] = [];
        const host = {
            async fetch(url: string) {
                asked.push(url);
                const answer = answers[url];
                if (answer === undefined || typeof answer === "number") return { ok: false, status: answer ?? 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "", json: async () => ({}) };
                return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => answer.buffer.slice(answer.byteOffset, answer.byteOffset + answer.length) as ArrayBuffer, text: async () => "", json: async () => ({}) };
            },
            secret: () => null
        } as unknown as NativeHostApi;
        return { host, asked };
    }

    it("turns each picture somebody uses into a data address, and downloads nothing nobody uses", async () => {
        const { host, asked } = fakeHost({ [`${base}/badges.json`]: new TextEncoder().encode(listText), [`${base}/icons/staff.png`]: png });
        const loaded = await loadList(host);
        assert.deepEqual(loaded.users, { [USER]: ["staff"], [OTHER]: ["staff"] }, "the person whose picture is missing keeps only the badge that works");
        assert.deepEqual(loaded.badges, { staff: { tooltip: "Staff", src: `data:image/png;base64,${Buffer.from(png).toString("base64")}` } });
        assert.ok(!asked.some(url => url.includes("unused")), "an unused badge is not downloaded");
        assert.ok(asked.every(url => url.startsWith("https://raw.githubusercontent.com/")));
    });

    it("says why when the list cannot be read", async () => {
        await assert.rejects(loadList(fakeHost({}).host), /badge list could not be read \(the server answered 404\)/);
        await assert.rejects(loadList(fakeHost({ [`${base}/badges.json`]: new TextEncoder().encode("<html>") }).host), /could not be read/);
        await assert.rejects(loadList(fakeHost({ [`${base}/badges.json`]: new TextEncoder().encode("{\"schema\":9}") }).host), /kind this version does not know/);
    });
});

describe("the registry in the main process", () => {
    function registryHost(answer: { ok: boolean; status: number; text?: string; }) {
        const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number; }; }> = [];
        const bytes = new TextEncoder().encode(answer.text ?? "");
        const host = {
            async fetch(url: string, init?: object) {
                calls.push({ url, init });
                return { ok: answer.ok, status: answer.status, headers: { get: () => null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer, text: async () => "", json: async () => ({}) };
            },
            secret: () => null
        } as unknown as NativeHostApi;
        return { host, calls };
    }

    it("reads only valid ids, one per line, once each", () => {
        assert.deepEqual(parseRegistry(`${USER}

${OTHER}
not-an-id
${USER}
12
<html>
`), [USER, OTHER]);
        assert.deepEqual(parseRegistry(""), []);
    });

    it("lists the ids from the registry's address and says why when it cannot", async () => {
        const ok = registryHost({ ok: true, status: 200, text: `${USER}
${OTHER}` });
        assert.deepEqual(await loadRegistry(ok.host), [USER, OTHER]);
        assert.deepEqual(ok.calls.map(call => call.url), [`${REGISTRY_URL}/users`]);
        await assert.rejects(loadRegistry(registryHost({ ok: false, status: 503 }).host), /list of Amiricord users could not be read \(the server answered 503\)/);
    });

    it("sends the registry the id and nothing else, and only a real id", async () => {
        const ok = registryHost({ ok: true, status: 204 });
        await registerSelf(ok.host, USER);
        assert.equal(ok.calls.length, 1);
        assert.equal(ok.calls[0].url, `${REGISTRY_URL}/register`);
        assert.equal(ok.calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(ok.calls[0].init?.body ?? ""), { id: USER });
        await assert.rejects(registerSelf(registryHost({ ok: false, status: 400 }).host, USER), /registry answered 400/);
        await assert.rejects(registerSelf(ok.host, "not an id"), /not a Discord id/);
        assert.equal(ok.calls.length, 1, "nothing is sent for something that is not an id");
    });

    it("is declared on the card: the registry's host is the only other host the plugin reaches", () => {
        assert.equal(REGISTRY_HOST, new URL(REGISTRY_URL).host);
        assert.ok(manifest.permissions.network.some(item => item.host === REGISTRY_HOST));
    });
});

describe("the plugin", () => {
    it("is a core plugin that cannot be switched off, reads two hosts, writes only the pronouns, and says so on its card", () => {
        assert.equal(manifest.enabledByDefault, true);
        assert.equal((manifest as { core?: boolean; }).core, true);
        assert.deepEqual(manifest.permissions.network.map(item => item.host), ["raw.githubusercontent.com", REGISTRY_HOST]);
        assert.deepEqual(manifest.permissions.native.functions, ["loadList", "loadRegistry", "registerSelf"]);
        const risk = computeRisk({ network: manifest.permissions.network as never, native: manifest.permissions.native, account: manifest.permissions.account, messages: { read: "none", send: false }, token: false, files: "none", system: { spawn: false, clipboard: false, listen: [], openExternal: false, devtools: false }, code: { dynamic: false }, telemetry: { send: [] } });
        assert.equal(risk.level, "high");
        assert.ok(risk.reasons.some(reason => reason.startsWith("Writes to your account")));
    });

    it("has no switch of its own, so nobody can turn the mark or the badge off from its settings", () => {
        assert.equal(plugin.settings, undefined);
    });

    it("names the owners with their current Discord ids", () => {
        assert.deepEqual(OWNERS.map(owner => [owner.name, owner.discordId]), [["szlcx404", "1554284154009682032"], ["Neversleeper", "1564847328794382408"]]);
    });

    it("adds its badges to the list a Discord profile gives, and to nothing else", () => {
        // The shape of Discord's profile class in build 652418 (read from its public code, 2026-10-29), as a module function.
        const module = "function(e,t,n){class E{userId;constructor(e){this.userId=e.userId}getBadges(){return[...this._userProfile.badges??[],...this._guildMemberProfile?.badges??[]]}getLegacyUsername(){return this._userProfile.legacyUsername}}}";
        const registered: RegisteredPatch = { ...plugin.patches![0], plugin: "Badges" };
        assert.ok(module.includes(plugin.patches![0].find as string));
        const result = compileModule("1", module, [registered]);
        assert.equal(result.outcomes[0].replacements[0].status, "applied");
        assert.ok(result.code.includes("getBadges(){return[...Badges.badgesOf(this),...this._userProfile.badges??[]") || result.code.includes("badgesOf(this),...this._userProfile.badges??[]"));
        assert.equal(result.code.split("badgesOf(this)").length - 1, 1);
    });

    it("gives the patched code a list that never throws", () => {
        assert.deepEqual(plugin.badgesOf(undefined), []);
        assert.deepEqual(plugin.badgesOf({ userId: OWNERS[1].discordId }).map(badge => badge.id), ["amiricord_owner"]);
    });
});

describe("pnpm badges", () => {
    const run = (edits: Array<(text: string) => ReturnType<typeof defineBadge>>) => edits.reduce((text, edit) => {
        const result = edit(text);
        assert.ok("text" in result, "error" in result ? result.error : "");
        return result.text;
    }, EMPTY_LIST);

    it("defines a badge, gives it, takes it and removes it, always writing a list the program reads", () => {
        const text = run([t => defineBadge(t, "staff", "Amiricord Staff", "staff.png"), t => giveBadge(t, USER, "staff"), t => giveBadge(t, OTHER, "staff")]);
        const list = parseBadgeList(JSON.parse(text));
        assert.ok(typeof list !== "string");
        assert.deepEqual({ ...list.users }, { [USER]: ["staff"], [OTHER]: ["staff"] });
        assert.match(describeList(text), /staff: "Amiricord Staff" \(staff\.png\)/);
        const taken = takeBadge(text, USER, "staff");
        assert.ok("text" in taken && !(USER in (JSON.parse(taken.text) as { users: object; }).users));
        const removed = removeBadge(text, "staff");
        assert.ok("text" in removed);
        assert.deepEqual(JSON.parse(removed.text), { schema: 1, badges: {}, users: {} });
        assert.equal(removed.icon, "staff.png", "the picture is no longer needed");
    });

    it("refuses with a sentence, and changes nothing, for a wrong name, id, picture or repeated gift", () => {
        const text = run([t => defineBadge(t, "staff", "Staff", "staff.png"), t => giveBadge(t, USER, "staff")]);
        const error = (edit: ReturnType<typeof defineBadge>) => ("error" in edit ? edit.error : "accepted");
        assert.match(error(defineBadge(text, "Bad Name", "t", "a.png")), /not a good badge name/);
        assert.match(error(defineBadge(text, "ok", "", "a.png")), /between 1 and 60/);
        assert.match(error(defineBadge(text, "ok", "t", "a.exe")), /not an accepted picture name/);
        assert.match(error(giveBadge(text, "12", "staff")), /not a Discord user id/);
        assert.match(error(giveBadge(text, OTHER, "nope")), /no badge called "nope"/);
        assert.match(error(giveBadge(text, USER, "staff")), /already has/);
        assert.match(error(takeBadge(text, OTHER, "staff")), /does not have/);
        assert.match(error(removeBadge(text, "nope")), /no badge called/);
        assert.match(error(defineBadge("{", "ok", "t", "a.png")), /not valid JSON/);
    });

    it("keeps a picture another badge still uses, and knows which file endings are pictures", () => {
        const text = run([t => defineBadge(t, "a", "A", "same.png"), t => defineBadge(t, "b", "B", "same.png")]);
        const removed = removeBadge(text, "a");
        assert.ok("text" in removed && removed.icon === undefined);
        assert.equal(pictureExtension("x.JPEG"), "jpg");
        assert.equal(pictureExtension("x.png"), "png");
        assert.equal(pictureExtension("x.exe"), null);
    });
});

describe("the card of the Badges plugin in the Plugins tab", () => {
    const card = (id: string) => ({ id }) as unknown as Parameters<typeof cardsForPerson>[0][number];
    const cards = [card("Badges"), card("NoTrack")];
    const ids = (shown: ReturnType<typeof cardsForPerson>) => shown.map(item => item.id);

    it("is drawn for the owners only, and every other plugin is drawn for everybody", () => {
        assert.deepEqual(OWNER_ONLY_PLUGINS, ["Badges", "NoDevtoolsWarning"]);
        const owners = OWNERS.map(owner => owner.discordId);
        assert.deepEqual(ids(cardsForPerson(cards, OWNER_ONLY_PLUGINS, owners, OWNERS[1].discordId)), ["Badges", "NoTrack"]);
        assert.deepEqual(ids(cardsForPerson(cards, OWNER_ONLY_PLUGINS, owners, OWNERS[0].discordId)), ["Badges", "NoTrack"]);
        assert.deepEqual(ids(cardsForPerson(cards, OWNER_ONLY_PLUGINS, owners, "123456789012345678")), ["NoTrack"]);
        assert.deepEqual(ids(cardsForPerson(cards, OWNER_ONLY_PLUGINS, owners, undefined)), ["NoTrack"], "an account that is not known yet is not an owner");
    });
});
