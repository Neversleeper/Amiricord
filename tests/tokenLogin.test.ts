/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Account, avatarUrl, looksLikeToken, MAX_ACCOUNTS, previewFromUser, readAccounts, readPreview, withAccount, withoutAccount, withPreview } from "../src/testcordplugins/TokenLogin/index";

// Not real tokens: only text of the right shape.
const FAKE_A = "fake-token-aaaaaaaaaaaaaaaa.bbbbbb";
const FAKE_B = "fake-token-cccccccccccccccc.dddddd";
const account = (id: string, token = FAKE_A, username = "Main"): Account => ({ id, username, token });

describe("TokenLogin: what counts as a token", () => {
    it("accepts letters, digits, dots, dashes and underscores, from 20 to 200 characters", () => {
        assert.equal(looksLikeToken(FAKE_A), true);
        assert.equal(looksLikeToken("a".repeat(20)), true);
        assert.equal(looksLikeToken("a".repeat(200)), true);
    });

    it("refuses what is too short or too long, or has a character that could break the text it is written into", () => {
        for (const value of ["", "short", "a".repeat(19), "a".repeat(201), `${FAKE_A}"`, `${FAKE_A}\\`, `${FAKE_A} x`, `${FAKE_A}\n`, "<script>alert(1)</script>-----"]) {
            assert.equal(looksLikeToken(value), false, JSON.stringify(value));
        }
    });
});

describe("TokenLogin: the saved list", () => {
    it("reads a good list and drops what has the wrong shape, a repeated id, or a token that does not look like one", () => {
        const saved = [account("1"), { id: "2", username: "x" }, null, "text", account("1", FAKE_B), { id: "3", username: "Bad", token: "no good" }, { id: "", username: "x", token: FAKE_B }, account("4", FAKE_B, "Alt")];
        assert.deepEqual(readAccounts(saved), [account("1"), account("4", FAKE_B, "Alt")]);
    });

    it("gives an empty list when there is nothing saved or it is not a list", () => {
        for (const value of [undefined, null, {}, "x", 5]) assert.deepEqual(readAccounts(value), []);
    });

    it("keeps at most 30 accounts and cuts a long name", () => {
        const many = Array.from({ length: 40 }, (_, index) => account(String(index), `fake-token-${String(index).padStart(10, "0")}.xxxxxx`));
        assert.equal(readAccounts(many).length, MAX_ACCOUNTS);
        assert.equal(readAccounts([account("1", FAKE_A, "n".repeat(100))])[0].username.length, 40);
    });
});

describe("TokenLogin: adding and removing an account", () => {
    it("adds an account with a trimmed name and token, after the ones that are there", () => {
        const result = withAccount([account("1")], "  Alt  ", `  ${FAKE_B}  `, "2");
        assert.deepEqual(result, { ok: true, list: [account("1"), account("2", FAKE_B, "Alt")] });
    });

    it("refuses a missing name, a token that does not look like one, a repeated token and a full list, and says why", () => {
        const refused = (username: string, token: string, list: Account[] = []) => {
            const result = withAccount(list, username, token, "9");
            assert.equal(result.ok, false);
            return result.ok ? "" : result.error;
        };
        assert.match(refused("  ", FAKE_A), /name/);
        assert.match(refused("Main", "nope"), /token/);
        assert.match(refused("Main", FAKE_A, [account("1")]), /already/);
        const full = Array.from({ length: MAX_ACCOUNTS }, (_, index) => account(String(index), `fake-token-${String(index).padStart(10, "0")}.xxxxxx`));
        assert.match(refused("Main", FAKE_B, full), /30 accounts/);
    });

    it("leaves the given list alone, and takes an account out by its id", () => {
        const list = [account("1"), account("2", FAKE_B)];
        const added = withAccount(list, "Third", "fake-token-eeeeeeeeeeeeeeee.ffffff", "3");
        assert.equal(added.ok && added.list.length, 3);
        assert.equal(list.length, 2);
        assert.deepEqual(withoutAccount(list, "1"), [account("2", FAKE_B)]);
        assert.deepEqual(withoutAccount(list, "nope"), list);
    });
});

describe("TokenLogin: the preview of an account", () => {
    const hash = "0123456789abcdef0123456789abcdef";
    const preview = { userId: "123456789012345678", name: "Alt", avatar: hash };

    it("is made from what Discord says about the account, taking the shown name before the user name", () => {
        assert.deepEqual(previewFromUser({ id: "123456789012345678", username: "alt_1", global_name: "Alt", avatar: hash }), preview);
        assert.equal(previewFromUser({ id: "123456789012345678", username: "alt_1", global_name: "", avatar: null })?.name, "alt_1");
        assert.equal(previewFromUser({ id: "123456789012345678", username: "x", avatar: null })?.avatar, null);
    });

    it("refuses an answer that is not one: no id, a picture that is not a hash, not an object", () => {
        for (const value of [null, "x", {}, { id: "abc", username: "x" }, { id: "123456789012345678", username: "x", avatar: "../evil" }, { id: "123456789012345678" }]) assert.equal(previewFromUser(value), undefined);
        assert.equal(readPreview({ userId: "123456789012345678", name: "n", avatar: "a_" + hash })?.avatar, "a_" + hash);
    });

    it("gives the picture address: the account's own, or one of six default ones", () => {
        assert.equal(avatarUrl(preview), `https://cdn.discordapp.com/avatars/123456789012345678/${hash}.png?size=64`);
        assert.match(avatarUrl({ ...preview, avatar: null }), /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    });

    it("is kept in the saved list, added with the account and set later; a bad one is dropped", () => {
        const added = withAccount([], "Alt", FAKE_A, "1", preview);
        assert.deepEqual(added.ok && added.list, [{ ...account("1"), username: "Alt", preview }]);
        assert.deepEqual(readAccounts(added.ok ? added.list : [])[0]?.preview, preview);
        assert.equal(readAccounts([{ ...account("1"), preview: { userId: "no", name: "x", avatar: null } }])[0]?.preview, undefined);
        assert.deepEqual(withPreview([account("1"), account("2", FAKE_B)], "2", preview)[1]?.preview, preview);
    });
});
