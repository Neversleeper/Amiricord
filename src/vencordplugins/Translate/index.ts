/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores, messages and components have no types */

// Adapted for Amiricord (2026) from the plugin Translate (authors Ven, AshtonMemer and koish1) as found in TestCord's copy of Vencord's plugins. The services, the language
// lists (`languages.ts`, unchanged) and the way a text is sent to each are the original's. Differences, all because Amiricord has no such part to hook into:
//  - there is no message popover button and no translation block drawn by Discord under a message: "Translate" is in the message's right click menu (`message`, NOT checked)
//    and the result is a small block put under the message text with plain page elements (`message-content-<id>`; it may disappear when Discord redraws that message);
//  - the chat bar button (Vencord's chat button API patch, which matches once on build 653945) opens one window with the service, the languages, the DeepL / Kagi secret and
//    "translate my messages", instead of the original's separate window; Shift + click or right click on it toggles the automatic translation, as in the original;
//  - "translate before sending" is a patch on Discord's `sendMessage` (matches once on build 653945) that changes the text of the message before it goes out; if the
//    translation fails the message is NOT sent (the original also stops it);
//  - the DeepL key and the Kagi session are secrets: saved from the window, kept encrypted by the main process, never shown again, used only by `native.ts`;
//  - no tooltip on the button when a message was translated (Amiricord has no tooltip to attach) and no "alert on first use".
// Privacy: every text you translate is sent to the service you chose (Google Translate by default). Nothing is sent unless you press Translate or switch on the automatic one.
// NOT tried with a real Discord or a real key.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { DeeplLanguages, deeplLanguageToGoogleLanguage, GoogleLanguages, KagiLanguages } from "./languages";

type Service = "google" | "deepl" | "deepl-pro" | "kagi";

const settings = definePluginSettings({
    service: {
        type: "select",
        default: "google",
        description: "Translation provider",
        options: [
            { label: "Google Translate", value: "google" },
            { label: "DeepL Free - API key required", value: "deepl" },
            { label: "DeepL Pro - API key required", value: "deepl-pro" },
            { label: "Kagi Translate - session token required", value: "kagi" }
        ]
    },
    receivedInput: { type: "string", default: "auto", description: "Language incoming messages are translated from" },
    receivedOutput: { type: "string", default: "en", description: "Language incoming messages are translated to" },
    sentInput: { type: "string", default: "auto", description: "Language your messages are translated from" },
    sentOutput: { type: "string", default: "en", description: "Language your messages are translated to" },
    autoTranslate: { type: "boolean", default: false, description: "Automatically translate your messages before sending. You can also Shift+click or right-click the translate button to toggle this" }
} as const);

const CSS = `
.ac-trans-accessory { display: block; margin-top: 4px; padding: 4px 8px; border-left: 3px solid var(--brand-500, #5865f2); color: var(--text-default, #dbdee1); font-size: 14px; white-space: pre-wrap; }
.ac-trans-accessory button { background: none; border: none; padding: 0; margin: 0; color: var(--text-link, #00a8fc); cursor: pointer; font: inherit; }
.ac-trans-label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; color: var(--header-secondary, #b5bac1); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.ac-trans-label select, .ac-trans-label input { padding: 6px; border-radius: 4px; border: none; background: var(--input-background, #1e1f22); color: var(--text-default, #dbdee1); font-size: 14px; text-transform: none; }
.ac-trans-row { display: flex; gap: 8px; align-items: center; }
`;

interface TranslationValue { sourceLanguage: string; text: string; }

let context: EnginePluginContext | undefined;
let styled = false;
let quotaShown = false;

const lists = (service: Service): Record<string, string> => {
    if (service === "google") return GoogleLanguages;
    return service === "kagi" ? KagiLanguages : DeeplLanguages;
};

function resetLanguageDefaults(): void {
    const google = settings.store.service === "google" || settings.store.service === "kagi";
    settings.store.receivedInput = google ? "auto" : "";
    settings.store.receivedOutput = google ? "en" : "en-us";
    settings.store.sentInput = google ? "auto" : "";
    settings.store.sentOutput = google ? "en" : "en-us";
}

async function googleTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA", // the original's key (a public one used by the Google Translate web page)
        "query.sourceLanguage": sourceLang,
        "query.targetLanguage": targetLang,
        "query.text": text
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to translate (${sourceLang} -> ${targetLang})\n${response.status} ${response.statusText}`);
    const { sourceLanguage, translation } = await response.json() as { sourceLanguage: string; translation: string; };
    return { sourceLanguage: (GoogleLanguages as Record<string, string>)[sourceLanguage] ?? sourceLanguage, text: translation };
}

function fallbackToGoogle(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    return googleTranslate(text, deeplLanguageToGoogleLanguage(sourceLang), deeplLanguageToGoogleLanguage(targetLang));
}

async function deeplTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    if (!await context?.secrets.has("deeplApiKey")) {
        context?.toasts.show("DeepL API key is not set. Resetting to Google", "failure");
        settings.store.service = "google";
        resetLanguageDefaults();
        return fallbackToGoogle(text, sourceLang, targetLang);
    }
    // DeepL refuses an empty source language: leave it out to let DeepL detect it.
    const answer = await context?.native.call("deepl", settings.store.service === "deepl-pro", JSON.stringify({
        text: [text], target_lang: targetLang, ...(sourceLang ? { source_lang: sourceLang.split("-")[0] } : {})
    })) as { status: number; data: string; } | undefined;
    if (!answer) throw "DeepL could not be reached";
    switch (answer.status) {
        case 200: break;
        case -1: throw "Failed to connect to DeepL API: " + answer.data;
        case 403: throw "Invalid DeepL API key or version";
        case 456:
            if (!quotaShown) {
                quotaShown = true;
                context?.toasts.show("Deepl API quota exceeded. Falling back to Google Translate", "failure");
            }
            return fallbackToGoogle(text, sourceLang, targetLang);
        default: throw new Error(`Failed to translate (${sourceLang} -> ${targetLang})\n${answer.status} ${answer.data}`);
    }
    const { translations } = JSON.parse(answer.data) as { translations: Array<{ detected_source_language: string; text: string; }>; };
    const source = translations[0].detected_source_language;
    return { sourceLanguage: (DeeplLanguages as Record<string, string>)[source] ?? source, text: translations[0].text };
}

async function kagiTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const answer = await context?.native.call("kagi", text, sourceLang, targetLang) as { status: number; data: string; } | undefined;
    if (!answer) throw "Kagi could not be reached";
    if (answer.status === 401) throw "Invalid or expired Kagi session token";
    if (answer.status !== 200) throw new Error(`Failed to translate (${sourceLang} -> ${targetLang})\n${answer.status} ${answer.data}`);
    const { detected_language, translation } = JSON.parse(answer.data) as { detected_language: { label: string; }; translation: string; };
    return { sourceLanguage: detected_language.label, text: translation };
}

async function translate(kind: "received" | "sent", text: string): Promise<TranslationValue> {
    const run = settings.store.service === "google" ? googleTranslate : settings.store.service === "kagi" ? kagiTranslate : deeplTranslate;
    try {
        return await run(text, settings.store[`${kind}Input`], settings.store[`${kind}Output`]);
    } catch (error) {
        const message = typeof error === "string" ? error : "Something went wrong with the translation. The console may say more.";
        context?.toasts.show(message.slice(0, 280), "failure");
        throw error instanceof Error ? error : new Error(message);
    }
}

/** The block under a message's text. */
function showTranslation(messageId: string, value: TranslationValue): void {
    const content = document.getElementById(`message-content-${messageId}`);
    if (!content) {
        context?.toasts.show(`Translated from ${value.sourceLanguage}: ${value.text}`.slice(0, 290), "info");
        return;
    }
    content.parentElement?.querySelectorAll(".ac-trans-accessory").forEach(old => old.remove());
    const box = document.createElement("span");
    box.className = "ac-trans-accessory";
    const text = document.createElement("span");
    text.textContent = value.text;
    const note = document.createElement("span");
    note.append(`\n(translated from ${value.sourceLanguage} - `);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => box.remove());
    note.append(dismiss, ")");
    box.append(text, note);
    content.after(box);
}

const messageText = (message: any): string => message?.content
    || message?.messageSnapshots?.[0]?.message?.content
    || message?.embeds?.find((embed: any) => embed.type === "auto_moderation_message")?.rawDescription || "";

function openSettings(ctx: EnginePluginContext): void {
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) {
        ctx.toasts.show("The window could not be opened.", "failure");
        return;
    }
    const h = react.createElement;

    function Body({ onClose }: { onClose(): void; }) {
        const [, redraw] = react.useState(0) as [number, (value: number) => void];
        const [saved, setSaved] = react.useState({ deepl: false, kagi: false }) as [{ deepl: boolean; kagi: boolean; }, (value: { deepl: boolean; kagi: boolean; }) => void];
        const [typed, setTyped] = react.useState("") as [string, (value: string) => void];
        const again = () => redraw(Date.now());
        react.useEffect(() => {
            void Promise.all([ctx.secrets.has("deeplApiKey"), ctx.secrets.has("kagiSession")]).then(([deepl, kagi]) => setSaved({ deepl, kagi }));
        }, []);

        const service = settings.store.service as Service;
        const secret = service === "kagi" ? "kagiSession" : service === "google" ? undefined : "deeplApiKey";
        const select = (label: string, key: "receivedInput" | "receivedOutput" | "sentInput" | "sentOutput") =>
            h("label", { className: "ac-trans-label", key }, label,
                h("select", { value: settings.store[key], onChange: (event: any) => { settings.store[key] = event.target.value; again(); } },
                    Object.entries(lists(service)).map(([code, name]) => h("option", { key: code, value: code }, name))));

        return h("div", { style: { padding: "16px" } },
            h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: "0 0 8px" } }, "Translate"),
            h("label", { className: "ac-trans-label" }, "Translation provider",
                h("select", {
                    value: service,
                    onChange: (event: any) => { settings.store.service = event.target.value; resetLanguageDefaults(); again(); }
                }, [["google", "Google Translate"], ["deepl", "DeepL Free - API key required"], ["deepl-pro", "DeepL Pro - API key required"], ["kagi", "Kagi Translate - session token required"]]
                    .map(([value, name]) => h("option", { key: value, value }, name)))),
            secret ? h("label", { className: "ac-trans-label" }, `${secret === "kagiSession" ? "Kagi session token" : "DeepL API key"} (${(secret === "kagiSession" ? saved.kagi : saved.deepl) ? "saved" : "not set"}; it is never shown again)`,
                h("div", { className: "ac-trans-row" },
                    h("input", { type: "password", value: typed, autoComplete: "off", style: { flex: 1 }, onChange: (event: any) => setTyped(event.target.value) }),
                    h("button", {
                        type: "button", disabled: !typed,
                        onClick: () => {
                            ctx.secrets.set(secret, typed).then(() => {
                                setTyped("");
                                setSaved({ ...saved, [secret === "kagiSession" ? "kagi" : "deepl"]: true });
                            }, (error: unknown) => ctx.toasts.show(String(error instanceof Error ? error.message : error).slice(0, 280), "failure"));
                        }
                    }, "Save"),
                    h("button", {
                        type: "button",
                        onClick: () => { void ctx.secrets.clear(secret).then(() => setSaved({ ...saved, [secret === "kagiSession" ? "kagi" : "deepl"]: false })); }
                    }, "Forget"))) : null,
            select("Translate received messages from", "receivedInput"),
            select("Translate received messages to", "receivedOutput"),
            select("Translate my messages from", "sentInput"),
            select("Translate my messages to", "sentOutput"),
            h("label", { className: "ac-trans-row", style: { margin: "12px 0", color: "var(--text-default, #dbdee1)" } },
                h("input", { type: "checkbox", checked: settings.store.autoTranslate, onChange: (event: any) => { settings.store.autoTranslate = event.target.checked; again(); } }),
                "Translate my messages before sending them"),
            h("button", { type: "button", onClick: onClose }, "Done"));
    }
    ctx.modals.open(props => h(Root, { size: "small", onClose: props.onClose, label: "Translate" }, h(Content, null, h(Body, { onClose: props.onClose })), Close ? h(Close, { onClick: props.onClose }) : null));
}

function ChatBarButton(): unknown {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (value: number) => void];
    const on = settings.store.autoTranslate;
    const toggle = () => { settings.store.autoTranslate = !settings.store.autoTranslate; redraw(Date.now()); };
    return react.createElement("button", {
        type: "button",
        "aria-label": "Translate",
        title: on ? "Translate (automatic translation is on; Shift+click or right click turns it off)" : "Translate (Shift+click or right click turns automatic translation on)",
        onClick: (event: { shiftKey: boolean; }) => { if (event.shiftKey) toggle(); else if (context) openSettings(context); },
        onContextMenu: (event: { preventDefault(): void; }) => { event.preventDefault(); toggle(); },
        style: { background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: on ? "var(--status-positive, #23a55a)" : "var(--interactive-icon-default, #b5bac1)", display: "flex", alignItems: "center" }
    }, react.createElement("svg", { width: 24, height: 24, viewBox: "0 0 24 24" },
        react.createElement("path", { fill: "currentColor", d: "M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" })));
}

const plugin: PluginCode & {
    addChatBarButton(buttons: unknown[], props: any): void;
    beforeSend(message: { content?: string; } | undefined): Promise<void>;
} = {
    settings,

    patches: [
        {
            find: '"sticker")',
            lazy: true,
            required: false,
            replacements: [{ match: /0===(\i)\.length(?=.{0,25}?\(0,\i\.jsxs?\)\(.{0,75}?children:\1)/, replace: "($self.addChatBarButton($1,arguments[0]),$&)" }]
        },
        {
            find: "async sendMessage(",
            lazy: true,
            required: false,
            replacements: [{ match: /async sendMessage\((\i),(\i)\)\{/, replace: "$&await $self.beforeSend($2);" }]
        }
    ],

    start(ctx) {
        context = ctx;
        quotaShown = false;
        if (!styled) {
            styled = true;
            ctx.addStyle(CSS, "translate");
        }
        ctx.contextMenu.addNative("message", (children, props: any) => {
            const text = messageText(props?.message);
            if (!text) return;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!parts || !react) return;
            children.push(react.createElement(parts.MenuGroup as never, { id: "ac-translate", key: "ac-translate" },
                react.createElement(parts.MenuItem as never, {
                    id: "ac-translate-message", label: "Translate",
                    action: () => { void translate("received", text).then(value => showTranslation(props.message.id, value), () => undefined); }
                })));
        });
    },

    stop() {
        context = undefined;
        styled = false;
    },

    addChatBarButton(buttons, props) {
        try {
            if (props?.disabled || props?.type?.analyticsName !== "normal") return;
            const react = currentReact() as any;
            buttons.push(react.createElement(ChatBarButton, { key: "translate" }));
        } catch (error) {
            context?.reportError("Translate", error);
        }
    },

    async beforeSend(message) {
        if (!settings.store.autoTranslate || !message?.content) return;
        const value = await translate("sent", message.content);
        message.content = value.text;
    }
};

export default plugin;
