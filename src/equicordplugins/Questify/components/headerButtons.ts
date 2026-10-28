/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adds "Start All" and "Stop All" buttons to the header of the Quests page, next to Discord's "Filters" button.
// The buttons are plain DOM copies of the Filters button (same look), kept in place by a light timer, because the header belongs to Discord's own page.

import { getQuestifySettings } from "../settings/access";
import { rerenderQuests } from "../settings/rerender";
import { getActiveAutoCompletes, getQueueableAutoCompleteQuests, getQueueAllStatus, isQuestEnrollmentRateLimited, isQueueAllAutoCompleteQuestsInProgress, queueAllAutoCompleteQuests, stopAllAutoCompletes } from "../utils/completion";
import { QUEST_PAGE } from "../utils/ui";

const WRAPPER_ATTRIBUTE = "data-questify-header-buttons";

let timer: ReturnType<typeof setInterval> | null = null;

function findFiltersButton(): HTMLElement | null {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("button, [role=\"button\"]"))) {
        if (element.textContent?.trim() === "Filters" && !element.closest(`[${WRAPPER_ATTRIBUTE}]`)) {
            return element;
        }
    }

    return null;
}

function setLabel(button: HTMLElement, label: string): void {
    button.querySelectorAll("svg").forEach(icon => icon.remove());

    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let first = true;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) {
            continue;
        }

        node.textContent = first ? label : "";
        first = false;
    }

    if (first) {
        button.append(label);
    }
}

function makeButton(template: HTMLElement, id: string, label: string, onPress: () => void): HTMLElement {
    const button = template.cloneNode(true) as HTMLElement;

    button.removeAttribute("id");
    button.removeAttribute("aria-expanded");
    button.removeAttribute("aria-haspopup");
    button.setAttribute("data-questify-header-button", id);
    button.style.marginRight = "8px";
    setLabel(button, label);

    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        if (button.getAttribute("aria-disabled") === "true") {
            return;
        }

        onPress();
        sync();
    });

    return button;
}

function startAll(): void {
    const queueAllPromise = queueAllAutoCompleteQuests();

    rerenderQuests();

    void queueAllPromise.finally(() => {
        rerenderQuests();
        sync();
    });
}

function stopAll(): void {
    stopAllAutoCompletes({
        manual: true,
        preserveResume: false,
        terminalHeartbeat: true
    });
    rerenderQuests();
}

function setDisabled(button: Element | null, disabled: boolean): void {
    if (!(button instanceof HTMLElement)) {
        return;
    }

    button.setAttribute("aria-disabled", String(disabled));
    button.style.opacity = disabled ? "0.5" : "";
    button.style.pointerEvents = disabled ? "none" : "";
}

function removeWrapper(): void {
    document.querySelectorAll(`[${WRAPPER_ATTRIBUTE}]`).forEach(element => element.remove());
}

function sync(): void {
    try {
        if (window.location.pathname !== QUEST_PAGE || getQuestifySettings().disableQuestsEverything) {
            removeWrapper();
            return;
        }

        let wrapper = document.querySelector<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`);

        if (!wrapper || !wrapper.isConnected) {
            const filters = findFiltersButton();

            if (!filters?.parentElement) {
                return;
            }

            wrapper = document.createElement("div");
            wrapper.setAttribute(WRAPPER_ATTRIBUTE, "");
            wrapper.style.display = "flex";
            wrapper.style.alignItems = "center";
            wrapper.append(
                makeButton(filters, "start", "Start All", startAll),
                makeButton(filters, "stop", "Stop All", stopAll)
            );
            filters.parentElement.insertBefore(wrapper, filters);
        }

        const inProgress = isQueueAllAutoCompleteQuestsInProgress();
        const status = getQueueAllStatus();
        const left = status.remaining > 0 ? ` · ${status.remaining} left` : "";
        const label = inProgress
            ? (status.nextStartInSeconds !== null ? `Next in ${status.nextStartInSeconds}s${left}` : `Starting…${left}`)
            : "Start All";
        const startButton = wrapper.querySelector<HTMLElement>("[data-questify-header-button=\"start\"]");

        if (startButton && startButton.textContent !== label) {
            setLabel(startButton, label);
        }

        // Nothing left to start (everything eligible is already running or done): the button cannot be pressed.
        setDisabled(startButton, inProgress || isQuestEnrollmentRateLimited() || getQueueableAutoCompleteQuests().length <= 0);
        setDisabled(wrapper.querySelector("[data-questify-header-button=\"stop\"]"), !inProgress && getActiveAutoCompletes().length <= 0);
    } catch {
        // The header is Discord's own page; if it changed shape there is nothing to add this time.
    }
}

export function startQuestHeaderButtons(): void {
    if (timer !== null) {
        return;
    }

    timer = setInterval(sync, 1000);
    sync();
}

export function stopQuestHeaderButtons(): void {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }

    removeWrapper();
}
