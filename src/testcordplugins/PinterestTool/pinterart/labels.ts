/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The words of Discord's own buttons in the languages Discord offers, so the picker and the hand-off to Discord's editor do not depend on an English Discord. Discord's own string
// store has no stable finder, so these are written here. A language that is missing falls back to the structure of the dialog (see `picker.tsx`). Not verified against every
// Discord language: the Spanish and English words were seen on screen, the others are the common translations.

const APPLY = [
    "apply", "aplicar", "appliquer", "anwenden", "applica", "применить", "uygula", "zastosuj", "toepassen", "použít", "alkalmaz", "anvend", "använd", "toteuta", "εφαρμογή",
    "適用", "適用する", "적용", "应用", "應用", "החל", "تطبيق", "áp dụng", "terapkan", "ใช้", "застосувати", "aplică", "прилагане", "primijeni"
];
const CANCEL = [
    "cancel", "cancelar", "annuler", "abbrechen", "annulla", "отмена", "iptal", "anuluj", "annuleren", "zrušit", "mégse", "annuller", "avbryt", "peruuta", "ακύρωση",
    "キャンセル", "취소", "取消", "ביטול", "إلغاء", "hủy", "batal", "ยกเลิก", "скасувати", "anulează", "отказ", "odustani"
];
const CLOSE = [
    "close", "cerrar", "fechar", "fermer", "schließen", "chiudi", "закрыть", "kapat", "zamknij", "sluiten", "zavřít", "bezár", "luk", "stäng", "sulje", "κλείσιμο",
    "閉じる", "닫기", "关闭", "關閉", "סגור", "إغلاق", "đóng", "tutup", "ปิด", "закрити", "închide", "затвори", "zatvori"
];

function normal(value: string | null | undefined) {
    return (value ?? "").trim().toLocaleLowerCase();
}

export const isApplyLabel = (value: string | null | undefined) => APPLY.includes(normal(value));
export const isCancelLabel = (value: string | null | undefined) => CANCEL.includes(normal(value));
export const isCloseLabel = (value: string | null | undefined) => CLOSE.includes(normal(value));

/**
 * Whether a dialog is a real window of Discord (the "Select an image" one is) and not a pop-up that also has the role "dialog". Discord's windows say `aria-modal="true"`;
 * the expressions picker (GIFs, stickers, emoji) does not. Seen in Discord build 653945: "Selecciona una imagen" has it, "Selector de expresiones" has none.
 */
export function isModalDialog(dialog: { getAttribute(name: string): string | null; }): boolean {
    return dialog.getAttribute("aria-modal") === "true";
}

/** Whether a box is as big as one of the two large tiles of the picker ("Upload image", "Choose GIF"): 150 by 100 pixels or more. */
export function isBigTile(box: { width: number; height: number; }): boolean {
    return box.width >= 150 && box.height >= 100;
}

/** The "Choose GIF" tile of the picker, in any language: its label is short and always has the word GIF in it ("Choose GIF", "Elegir GIF", "GIF auswählen"). */
export function isGifTileLabel(text: string | null | undefined) {
    const value = (text ?? "").trim();
    return value.length > 0 && value.length <= 40 && /(^|[^A-Za-z0-9])GIF($|[^A-Za-z0-9])/i.test(value);
}
