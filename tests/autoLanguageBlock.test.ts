/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Candidate, detectLanguage, RELATIONSHIP, shouldBlock } from "../src/testcordplugins/AutoLanguageBlock/index";
import { languageKeywords } from "../src/testcordplugins/AutoLanguageBlock/keywords";

describe("AutoLanguageBlock: the words", () => {
    it("has the 15 languages of the original, each with words", () => {
        assert.deepEqual(Object.keys(languageKeywords).sort(), ["ar", "de", "es", "en", "fr", "hi", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr", "zh"].sort());
        for (const [language, words] of Object.entries(languageKeywords)) assert.ok(words.length >= 30, language);
    });
});

describe("AutoLanguageBlock: telling the language", () => {
    it("counts the words of the language, each once, up to the number asked for", () => {
        assert.equal(detectLanguage("hola, muchas gracias", "es", 2), true);
        assert.equal(detectLanguage("hola hola hola", "es", 2), false, "the same word three times is one match");
        assert.equal(detectLanguage("hola", "es", 1), true);
        assert.equal(detectLanguage("hola", "es", 2), false);
    });

    it("finds a phrase of several words, in any case, and accepts the curved apostrophe", () => {
        assert.equal(detectLanguage("Buenos DIAS, por favor", "es", 2), true);
        assert.equal(detectLanguage("You’re right and I’m sure", "en", 2), true);
    });

    it("looks for whole words: a word inside another one does not count (the original counted it)", () => {
        assert.equal(detectLanguage("redentor monedas tender", "tr", 1), false, "den, dan and ten are inside other words");
        assert.equal(detectLanguage("queso quedar", "es", 1), false, "que is inside other words");
        assert.equal(detectLanguage("para que sirve", "es", 1), true);
    });

    it("finds the words of languages written without spaces anywhere in the text", () => {
        assert.equal(detectLanguage("今日はありがとうございます", "ja", 2), true);
        assert.equal(detectLanguage("你好，谢谢你", "zh", 2), true);
        assert.equal(detectLanguage("안녕하세요 감사합니다", "ko", 2), true);
    });

    it("says no for a language that does not exist, no words, or a number of matches below one", () => {
        assert.equal(detectLanguage("hola gracias", "xx", 1), false);
        assert.equal(detectLanguage("", "es", 1), false);
        assert.equal(detectLanguage("hola gracias", "es", 0), false);
    });
});

const message = (over: Partial<Candidate> = {}): Candidate => ({ selfId: "1", authorId: "2", authorIsBot: false, content: "hola, muchas gracias", relationship: RELATIONSHIP.none, ...over });
const rules = { language: "es", minMatches: 2, blockBots: false };

describe("AutoLanguageBlock: who gets blocked", () => {
    it("blocks a stranger who writes in the language", () => {
        assert.equal(shouldBlock(message(), rules), true);
        assert.equal(shouldBlock(message({ relationship: undefined }), rules), true);
    });

    it("never blocks yourself, a friend, someone already blocked, or a message without an author or without enough text", () => {
        assert.equal(shouldBlock(message({ authorId: "1" }), rules), false);
        assert.equal(shouldBlock(message({ relationship: RELATIONSHIP.friend }), rules), false);
        assert.equal(shouldBlock(message({ relationship: RELATIONSHIP.blocked }), rules), false);
        assert.equal(shouldBlock(message({ authorId: undefined }), rules), false);
        assert.equal(shouldBlock(message({ authorId: "" }), rules), false);
        assert.equal(shouldBlock(message({ content: undefined }), rules), false);
        assert.equal(shouldBlock(message({ content: "hi" }), rules), false);
    });

    it("blocks a bot only when asked to", () => {
        assert.equal(shouldBlock(message({ authorIsBot: true }), rules), false);
        assert.equal(shouldBlock(message({ authorIsBot: true }), { ...rules, blockBots: true }), true);
    });

    it("leaves alone a message in another language", () => {
        assert.equal(shouldBlock(message({ content: "good morning, how are you" }), rules), false);
    });
});
