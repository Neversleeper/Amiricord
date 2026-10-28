/*
 * Pinterest Tool — TestCord user plugin
 * Based on the PinterestSearch browser/search implementation.
 * Adds Pinterest directly to Discord's "Select an Image" profile modal.
 */

import { currentReact } from "../../../api/jsxRuntime";
import { makeErrorBoundary } from "../../../plugins/Settings/ErrorBoundary";
import type { EnginePluginContext } from "../../../renderer/engine";
import { PinterestProfileModal } from "./components";
import { Native } from "./host";
import { t } from "./i18n";
import { PLUGIN_ICON } from "./icon";
import { isApplyLabel, isCancelLabel, isCloseLabel, isGifTileLabel } from "./labels";
import type { SearchKind } from "./shared";

/** What the picker needs from the engine: only the modal opener and the error report. */
let engine: Pick<EnginePluginContext, "modals" | "reportError"> | undefined;
let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;

let observer: MutationObserver | null = null;
let scanFrame = 0;
let lastProfileImageTarget: Extract<SearchKind, "AVATAR" | "BANNER"> = "AVATAR";
let lastProfileImageTargetAt = 0;

function exactText(root: ParentNode, text: string): HTMLElement | null {
    const nodes = root.querySelectorAll<HTMLElement>("button, [role='button'], div, span");
    for (const node of nodes) {
        if (node.textContent?.trim() === text) return node;
    }
    return null;
}

/** Discord's own wording is not read (its string store has no stable finder yet), so the English text is used. */
function discordLabel(_key: string, fallback: string) {
    return fallback;
}

function clickableRoot(element: HTMLElement, dialog: HTMLElement): HTMLElement {
    let current: HTMLElement | null = element;

    while (current && current !== dialog) {
        if (current.matches("button, [role='button'], [tabindex='0']")) return current;
        current = current.parentElement;
    }

    // Discord occasionally uses a clickable div without role/tabindex.
    // In that case, use a small ancestor around the label rather than the whole modal.
    current = element;
    for (let i = 0; i < 3 && current.parentElement && current.parentElement !== dialog; i++) {
        current = current.parentElement;
    }
    return current;
}

function commonAncestor(a: HTMLElement, b: HTMLElement, limit: HTMLElement): HTMLElement | null {
    const parents = new Set<HTMLElement>();
    let current: HTMLElement | null = a;

    while (current && current !== limit) {
        parents.add(current);
        current = current.parentElement;
    }

    current = b;
    while (current && current !== limit) {
        if (parents.has(current)) return current;
        current = current.parentElement;
    }

    return null;
}

// The target is decided once per picker dialog, right after it opens, and then
// kept. Clicks made inside the picker (Upload Image, Choose GIF, ...) must never
// change it, otherwise opening Pinterest Tool afterwards could search banners
// while the user is picking an avatar.
const dialogTargets = new WeakMap<HTMLElement, Extract<SearchKind, "AVATAR" | "BANNER">>();

function getTarget(dialog: HTMLElement): Extract<SearchKind, "AVATAR" | "BANNER"> {
    const known = dialogTargets.get(dialog);
    if (known) return known;

    const resolved = resolveTarget(dialog);
    dialogTargets.set(dialog, resolved);
    return resolved;
}

function resolveTarget(dialog: HTMLElement): Extract<SearchKind, "AVATAR" | "BANNER"> {
    // The control that opened Discord's image picker is the most reliable signal.
    // Discord can reuse the same "Select an Image" modal for avatars and banners,
    // so text such as "Recent Avatars" is not always safe to trust.
    if (Date.now() - lastProfileImageTargetAt < 4000) {
        return lastProfileImageTarget;
    }

    const text = dialog.textContent ?? "";

    if (text.includes(discordLabel("RECENT_AVATARS", "Recent Avatars"))) return "AVATAR";

    return lastProfileImageTarget;
}

// Discord class names are camelCase with hashes ("bannerUploader_a1b2"), so
// split them into words before matching "banner" / "avatar" on word boundaries.
function splitIdentifierWords(value: string) {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
}

function rememberProfileImageTarget(event: Event) {
    // Only the control that opens the picker decides the target. Ignore clicks
    // inside the picker itself (Discord's "Upload Image" tile is wide and used
    // to be mistaken for a banner) and inside Pinterest Tool's own window.
    if (event.target instanceof Element) {
        if (event.target.closest(".vc-pinterest-tool-profile-modal")) return;
        const picker = event.target.closest("[role='dialog']");
        if (picker?.querySelector("[data-vc-pinterest-tool='true']")) return;
    }

    const path = typeof event.composedPath === "function"
        ? event.composedPath().filter((node): node is HTMLElement => node instanceof HTMLElement)
        : [];

    const elements = path.length
        ? path.slice(0, 9)
        : (() => {
            const fallback: HTMLElement[] = [];
            let current = event.target instanceof HTMLElement ? event.target : null;

            for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) {
                fallback.push(current);
            }

            return fallback;
        })();

    // First prefer explicit Discord metadata. Include class/id/data/alt because
    // the large profile banner itself often has no visible "Banner" text.
    for (const current of elements) {
        const datasetText = Object.entries(current.dataset)
            .map(([key, value]) => `${key} ${value ?? ""}`)
            .join(" ");

        // Visible text only counts on small elements: a container holding the
        // whole profile editor mentions both "Avatar" and "Banner". The element
        // count check also avoids reading the text of the entire app on every click.
        const text = current.childElementCount <= 6 ? current.textContent ?? "" : "";
        const label = splitIdentifierWords([
            text.length <= 80 ? text : "",
            current.getAttribute("aria-label"),
            current.getAttribute("title"),
            current.getAttribute("alt"),
            current.id,
            typeof current.className === "string" ? current.className : "",
            datasetText
        ].filter(Boolean).join(" "));

        const banner = /\bbanner\b/i.test(label);
        const avatar = /\b(avatar|profile\s*(?:image|picture|icon)|user\s*avatar)\b/i.test(label);
        // Ambiguous element: keep walking up instead of guessing.
        if (banner === avatar) continue;

        lastProfileImageTarget = banner ? "BANNER" : "AVATAR";
        lastProfileImageTargetAt = Date.now();
        return;
    }

    // Discord's current profile preview may expose the banner only as a large
    // clickable image/div. Use its geometry as a fallback: banners are wide,
    // while avatars are approximately square/circular.
    for (const current of elements.slice(0, 6)) {
        const rect = current.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;

        const ratio = rect.width / rect.height;
        const area = rect.width * rect.height;

        // Ignore tiny icons and page-sized containers. A Discord profile banner
        // normally lands comfortably inside this range.
        if (
            rect.width >= 170
            && rect.height >= 55
            && ratio >= 1.7
            && area <= 220_000
        ) {
            lastProfileImageTarget = "BANNER";
            lastProfileImageTargetAt = Date.now();
            return;
        }
    }

    // Square/circular clickable controls are safe to classify as avatars only
    // when they are reasonably avatar-sized. Otherwise preserve the last target.
    for (const current of elements.slice(0, 5)) {
        const rect = current.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;

        const ratio = rect.width / rect.height;
        if (
            rect.width >= 42
            && rect.width <= 180
            && rect.height >= 42
            && rect.height <= 180
            && ratio >= 0.78
            && ratio <= 1.28
        ) {
            const radius = getComputedStyle(current).borderRadius;
            if (radius.includes("%") || parseFloat(radius) >= rect.width * 0.22) {
                lastProfileImageTarget = "AVATAR";
                lastProfileImageTargetAt = Date.now();
                return;
            }
        }
    }
}

function closeDiscordImageModal(dialog: HTMLElement) {
    const candidates = dialog.querySelectorAll<HTMLElement>("button, [role='button']");
    for (const candidate of candidates) {
        if (isCloseLabel(candidate.getAttribute("aria-label")) || isCloseLabel(candidate.getAttribute("title"))) {
            candidate.click();
            return;
        }
    }
}

function isImageInput(input: HTMLInputElement) {
    const accept = input.accept.trim().toLowerCase();
    if (!accept) return true;

    // Discord's profile uploader currently advertises image formats as file
    // extensions (for example: .jpg,.jpeg,.jfif,.png,.gif,.webp,.avif) rather
    // than MIME types such as image/*. Treat both forms as image-only inputs.
    return accept.split(",").some(rawToken => {
        const token = rawToken.trim();
        return token === "image/*"
            || token.startsWith("image/")
            || /^\.(?:jpe?g|jfif|png|gif|webp|avif|bmp|ico|tiff?)$/i.test(token);
    });
}

function isSafeProfileImageInput(input: HTMLInputElement) {
    // Profile avatar/banner pickers are single-image flows. Reject generic or
    // multi-file uploaders so Pinterest Tool can never hand media to chat.
    return input.type === "file" && isImageInput(input) && !input.multiple;
}

function getReferencedFileInput(element: HTMLElement): HTMLInputElement | null {
    // Discord may render the visible Upload Image tile as a <label> whose real
    // file input lives elsewhere in the DOM. Resolve only explicit DOM
    // relationships; never scan arbitrary document-wide file inputs.
    let current: HTMLElement | null = element;

    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
        if (current instanceof HTMLLabelElement) {
            const control = current.control;
            if (control instanceof HTMLInputElement && isSafeProfileImageInput(control)) return control;
        }

        const descendant = current.querySelector<HTMLInputElement>("input[type='file']");
        if (descendant && isSafeProfileImageInput(descendant)) return descendant;

        const ids = [
            current.getAttribute("for"),
            current.getAttribute("aria-controls")
        ].filter((value): value is string => Boolean(value));

        for (const rawIds of ids) {
            for (const id of rawIds.split(/\s+/g)) {
                const referenced = document.getElementById(id);
                if (referenced instanceof HTMLInputElement && isSafeProfileImageInput(referenced)) {
                    return referenced;
                }
            }
        }
    }

    return null;
}

function getImageFileInput(dialog: HTMLElement): HTMLInputElement | null {
    const uploadRoot = findUploadTile(dialog);

    // First use an input physically owned by this dialog. Prefer the one
    // structurally related to Upload Image when Discord exposes that relation.
    if (uploadRoot) {
        const referenced = getReferencedFileInput(uploadRoot);
        if (referenced) return referenced;
    }

    const localInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type='file']"))
        .filter(isSafeProfileImageInput);

    return localInputs.length === 1 ? localInputs[0] : null;
}

function setInputFile(input: HTMLInputElement, file: File) {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    try {
        input.files = transfer.files;
    } catch {
        Object.defineProperty(input, "files", {
            configurable: true,
            value: transfer.files
        });
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findUploadTile(dialog: HTMLElement): HTMLElement | null {
    const labels = [
        discordLabel("SELECT_IMAGE_MODAL_UPLOAD_FILE", "Upload Image"),
        discordLabel("UPLOAD_IMAGE", "Upload Image"),
        "Upload Image",
        "Subir imagen",
        "Cargar imagen",
        "Upload",
        "Subir"
    ];

    for (const label of labels) {
        const match = exactText(dialog, label);
        if (match) return clickableRoot(match, dialog);
    }

    const candidates = Array.from(dialog.querySelectorAll<HTMLElement>("button, [role='button'], label, div"));
    return candidates.find(node => {
        const text = (node.textContent ?? "").trim().toLowerCase();
        const aria = (node.getAttribute("aria-label") ?? "").trim().toLowerCase();
        const title = (node.getAttribute("title") ?? "").trim().toLowerCase();
        return /upload|subir|cargar/.test(`${text} ${aria} ${title}`);
    }) ?? null;
}

function logProfileInputDiagnostics(dialog: HTMLElement) {
    const uploadRoot = findUploadTile(dialog);
    const localInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type='file']"));

    console.info("[PinterestTool] Edit handoff diagnostics", {
        uploadElement: uploadRoot?.tagName ?? null,
        uploadRole: uploadRoot?.getAttribute("role") ?? null,
        uploadFor: uploadRoot?.getAttribute("for") ?? null,
        uploadAriaControls: uploadRoot?.getAttribute("aria-controls") ?? null,
        localFileInputs: localInputs.map(input => ({
            accept: input.accept,
            multiple: input.multiple,
            id: input.id || null,
            name: input.name || null
        }))
    });
}

function findDiscordImageEditorDialog(originalDialog: HTMLElement): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));

    return candidates.find(candidate => {
        // Ignore the original "Select an Image" dialog itself — it can still
        // contain matching words mid-transition, which previously caused a
        // false positive: we'd close the Pinterest modal thinking the real
        // editor had appeared, before it actually had, making it look like
        // the editor "flashed and disappeared".
        if (candidate === originalDialog || originalDialog.contains(candidate)) return false;

        // Never treat Pinterest Tool's own modal as Discord's editor. It has a
        // range slider (appearance panel) and canvases (editor/thumbnails), and
        // it sits earlier in the DOM than Discord's editor, so it used to be
        // picked instead of the real one. Apply was then never detected and the
        // Pinterest window waited forever (Esc "applied" the photo by closing it).
        if (isPinterestDialog(candidate)) return false;

        // A real crop/zoom editor always has explicit Apply and Cancel buttons.
        // Requiring them also rejects unrelated dialogs that merely contain a
        // canvas, such as Discord's Nitro upsell (a Rive animation canvas) shown
        // to accounts without Nitro.
        if (!hasButtonLabelled(candidate, isApplyLabel) || !hasButtonLabelled(candidate, isCancelLabel)) return false;

        const text = candidate.textContent ?? "";
        const hasEditorText = text.includes(discordLabel("EDIT_IMAGE", "Edit Image"));

        // Some Discord builds (and the banner editor specifically) may not use
        // this exact wording, so also accept the actual crop/zoom controls
        // (a range slider and/or a canvas) alongside the Apply/Cancel buttons.
        const hasEditorControls =
            candidate.querySelector("input[type='range']") !== null
            || candidate.querySelector("canvas") !== null;

        return hasEditorText || hasEditorControls;
    }) ?? null;
}

function isPinterestDialog(element: HTMLElement) {
    return element.classList.contains("vc-pinterest-tool-profile-modal")
        || element.querySelector(".vc-pinterest-tool-profile-modal, .vc-pinterest-tool-profile-base") !== null
        || element.closest(".vc-pinterest-tool-profile-modal") !== null;
}

function hasButtonLabelled(root: HTMLElement, isLabel: (value: string | null) => boolean) {
    return Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']")).some(button =>
        [button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")].some(isLabel)
    );
}

async function hasDiscordImageEditor(originalDialog: HTMLElement, settleMs = 220): Promise<boolean> {
    const first = findDiscordImageEditorDialog(originalDialog);
    if (!first) return false;

    // Confirm the editor dialog is still there a moment later, instead of
    // trusting the very first detection. This avoids reporting "found" on a
    // dialog that was only transiently present during Discord's own modal
    // transition.
    await new Promise(resolve => window.setTimeout(resolve, settleMs));
    return findDiscordImageEditorDialog(originalDialog) !== null;
}

type DiscordImageEditorOutcome = "APPLIED" | "CANCELLED";

async function waitForDiscordImageEditorOutcome(
    originalDialog: HTMLElement,
    onApplyStart?: () => void
): Promise<DiscordImageEditorOutcome | false> {
    const editor = findDiscordImageEditorDialog(originalDialog);
    if (!editor) return false;

    console.info("[PinterestTool] Edit lifecycle: editor opened; keeping Pinterest underneath until Apply/Cancel.");

    return await new Promise(resolve => {
        let pendingAction: DiscordImageEditorOutcome | null = null;
        let settled = false;

        const finish = (outcome: DiscordImageEditorOutcome) => {
            if (settled) return;
            settled = true;
            editor.removeEventListener("click", onEditorClick, true);
            observer.disconnect();
            resolve(outcome);
        };

        const onEditorClick = (event: Event) => {
            const target = event.target instanceof Element
                ? event.target.closest<HTMLElement>("button, [role='button']")
                : null;
            if (!target || !editor.contains(target)) return;

            const labels = [target.textContent, target.getAttribute("aria-label"), target.getAttribute("title")];
            if (labels.some(isApplyLabel)) {
                pendingAction = "APPLIED";
                // Remove the Pinterest layer before Discord removes Edit Image. This
                // prevents the brief Pinterest flash that otherwise appears on Apply.
                onApplyStart?.();
                console.info("[PinterestTool] Edit lifecycle: Apply selected; Pinterest closed before editor transition.");
            } else if (labels.some(isCancelLabel)) {
                pendingAction = "CANCELLED";
                console.info("[PinterestTool] Edit lifecycle: Cancel selected; Pinterest will remain open.");
            }
        };

        const observer = new MutationObserver(() => {
            if (editor.isConnected) return;

            // Closing with Escape/X/no explicit action is equivalent to Cancel:
            // keep the Pinterest picker and its current search state available.
            const outcome = pendingAction ?? "CANCELLED";
            console.info(`[PinterestTool] Edit lifecycle: editor closed with ${outcome.toLowerCase()} outcome.`);
            finish(outcome);
        });

        editor.addEventListener("click", onEditorClick, true);
        observer.observe(document.body, { childList: true, subtree: true });

        // The editor can disappear between detection and observer setup. Handle
        // that race as a cancellation instead of falling through to direct apply.
        if (!editor.isConnected) finish("CANCELLED");
    });
}

async function captureDiscordProfileInput(dialog: HTMLElement): Promise<HTMLInputElement | null> {
    const uploadRoot = findUploadTile(dialog);
    if (!uploadRoot) return null;

    // Discord does not currently expose the profile file input in/through the
    // Select an Image dialog. Ask Discord's own Upload Image control which input
    // it would use, while temporarily intercepting the native file-picker calls.
    // This gives us Discord's exact input without opening Windows Explorer and
    // without ever scanning/guessing document-wide inputs such as chat upload.
    const inputPrototype = HTMLInputElement.prototype;
    const originalClick = inputPrototype.click;
    const originalShowPicker = (inputPrototype as { showPicker?: (this: HTMLInputElement) => void; }).showPicker;

    const probe: { captured: HTMLInputElement | null; rejected: HTMLInputElement | null; } = { captured: null, rejected: null };

    const capture = (input: HTMLInputElement) => {
        if (input.type !== "file") return false;

        // Suppress every native file chooser during this very short probe so an
        // unexpected Discord implementation still cannot open Windows Explorer.
        if (!probe.captured && isSafeProfileImageInput(input)) probe.captured = input;
        else if (!isSafeProfileImageInput(input)) probe.rejected = input;
        return true;
    };

    function interceptedClick(this: HTMLInputElement) {
        if (capture(this)) return;
        return originalClick.call(this);
    }

    function interceptedShowPicker(this: HTMLInputElement) {
        if (capture(this)) return;
        return originalShowPicker?.call(this);
    }

    // Prevent browser/label default activation while still allowing Discord's
    // React click handler to run. If that handler calls input.click/showPicker,
    // the temporary hooks above capture the exact input and suppress the picker.
    const preventNativeActivation = (event: Event) => event.preventDefault();

    try {
        inputPrototype.click = interceptedClick;
        if (originalShowPicker) (inputPrototype as { showPicker?: (this: HTMLInputElement) => void; }).showPicker = interceptedShowPicker;
        uploadRoot.addEventListener("click", preventNativeActivation, true);

        uploadRoot.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
        }));

        // React handlers normally call the file input synchronously, but leave a
        // tiny window for a queued callback while the interception remains active.
        for (let attempt = 0; attempt < 8 && !probe.captured; attempt++) {
            await new Promise(resolve => window.setTimeout(resolve, 20));
        }
    } catch (error) {
        console.warn("[PinterestTool] Edit handoff: Discord upload-input probe failed.", error);
    } finally {
        uploadRoot.removeEventListener("click", preventNativeActivation, true);
        inputPrototype.click = originalClick;
        if (originalShowPicker) (inputPrototype as { showPicker?: (this: HTMLInputElement) => void; }).showPicker = originalShowPicker;
    }

    if (probe.captured) {
        console.info("[PinterestTool] Edit handoff: captured Discord's profile upload input without opening the OS picker.", {
            insideDialog: dialog.contains(probe.captured),
            accept: probe.captured.accept,
            multiple: probe.captured.multiple,
            id: probe.captured.id || null,
            name: probe.captured.name || null
        });
        return probe.captured;
    }

    if (probe.rejected) {
        console.warn("[PinterestTool] Edit handoff: Discord requested a non-profile/multi-file input; refusing it.", {
            accept: probe.rejected.accept,
            multiple: probe.rejected.multiple,
            id: probe.rejected.id || null,
            name: probe.rejected.name || null
        });
    }

    return null;
}

// Set on the page while Discord's editor is open; `HOST_CSS` hides our window meanwhile.
const EDITING_ATTRIBUTE = "data-pinterart-editing";

async function handoffToDiscordImageEditor(
    dialog: HTMLElement,
    file: File,
    onApplyStart?: () => void
): Promise<DiscordImageEditorOutcome | false> {
    if (!dialog.isConnected) return false;

    // Fast path: use an input Discord explicitly exposes through the profile
    // dialog. Current builds usually do not, so the capture probe is the safe
    // fallback before direct-apply.
    let input = getImageFileInput(dialog);

    if (!input) {
        console.info("[PinterestTool] Edit handoff: no explicit profile input; probing Discord's native Upload Image action.");
        input = await captureDiscordProfileInput(dialog);
    }

    if (!input) {
        console.warn("[PinterestTool] Edit handoff: Discord did not reveal a safe profile image input; using direct-apply fallback.");
        logProfileInputDiagnostics(dialog);
        return false;
    }

    try {
        setInputFile(input, file);
    } catch (error) {
        console.warn("[PinterestTool] Edit handoff: failed to assign the Pinterest file to Discord's captured profile input.", error);
        return false;
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        if (await hasDiscordImageEditor(dialog)) {
            console.info("[PinterestTool] Edit handoff: Discord Edit Image detected.");
            document.body.setAttribute(EDITING_ATTRIBUTE, "");
            try {
                return await waitForDiscordImageEditorOutcome(dialog, onApplyStart);
            } finally {
                document.body.removeAttribute(EDITING_ATTRIBUTE);
            }
        }
        await new Promise(resolve => window.setTimeout(resolve, 60));
    }

    console.warn("[PinterestTool] Edit handoff: profile input accepted the file, but Edit Image was not detected; using direct-apply fallback.");
    return false;
}

function PinterestMark() {
    const mark = document.createElement("span");
    mark.className = "vc-pinterest-tool-mark";
    mark.setAttribute("aria-hidden", "true");

    const icon = document.createElement("img");
    icon.src = PLUGIN_ICON;
    icon.alt = "";
    icon.draggable = false;
    icon.className = "vc-pinterest-tool-mark-icon";
    mark.append(icon);
    return mark;
}

function buildPinterestEntry(
    dialog: HTMLElement,
    target: Extract<SearchKind, "AVATAR" | "BANNER">
) {
    // Use our own compact button instead of cloning Discord's upload-tile classes.
    // Cloning those classes can inherit height:100% and make the whole modal enormous.
    const entry = document.createElement("button");
    entry.className = "vc-pinterest-tool-profile-entry";
    entry.setAttribute("data-vc-pinterest-tool", "true");
    const label = `Pinterest Tool · ${t(target === "BANNER" ? "banner" : "avatar")}`;
    entry.setAttribute("aria-label", label);
    entry.setAttribute("tabindex", "0");
    if (!entry.hasAttribute("role")) entry.setAttribute("role", "button");
    entry.type = "button";

    entry.append(PinterestMark());

    const text = document.createElement("div");
    text.className = "vc-pinterest-tool-profile-entry-text";
    text.textContent = label;
    entry.append(text);

    const activate = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();

        const liveTarget = getTarget(dialog);

        openProfileModal(dialog, liveTarget);
    };

    entry.addEventListener("click", activate, true);
    entry.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") activate(event);
    }, true);

    return entry;
}

/**
 * The row that holds the two big tiles of the picker, found without Discord's wording: the "Choose GIF" tile is the one whose short label has the word GIF in it, in any
 * language. The tile is the smallest ancestor of that label that is drawn big; its row is the nearest ancestor with a second child (the upload tile).
 */
function findTileRow(dialog: HTMLElement): HTMLElement | null {
    // A dialog with a text box is some other picker (the chat's GIF search, for one).
    if (dialog.querySelector("input[type='text'], input[type='search'], textarea")) return null;
    const nodes = dialog.querySelectorAll<HTMLElement>("button, [role='button'], div, span");
    let label: HTMLElement | null = null;
    for (const node of nodes) {
        if (node.closest("[data-vc-pinterest-tool='true']")) continue;
        if (!isGifTileLabel(node.textContent)) continue;
        if (Array.from(node.children).some(child => isGifTileLabel(child.textContent))) continue;
        label = node;
        break;
    }
    if (!label) return null;

    let tile: HTMLElement = label;
    while (tile.parentElement && tile.parentElement !== dialog) {
        const box = tile.getBoundingClientRect();
        if (box.width >= 150 && box.height >= 100) break;
        tile = tile.parentElement;
    }

    let row = tile.parentElement;
    while (row && row !== dialog && row.children.length < 2) row = row.parentElement;
    return row && row !== dialog ? row : null;
}

function enhanceImageDialog(dialog: HTMLElement) {
    const existing = dialog.querySelector<HTMLElement>("[data-vc-pinterest-tool='true']");
    if (existing) {
        const label = `Pinterest Tool · ${t(getTarget(dialog) === "BANNER" ? "banner" : "avatar")}`;
        if (existing.getAttribute("aria-label") !== label) {
            existing.setAttribute("aria-label", label);
            const text = existing.querySelector(".vc-pinterest-tool-profile-entry-text");
            if (text) text.textContent = label;
        }
        return;
    }

    const uploadText = exactText(dialog, discordLabel("SELECT_IMAGE_MODAL_UPLOAD_FILE", "Upload Image"))
        ?? exactText(dialog, discordLabel("UPLOAD_IMAGE", "Upload Image"))
        ?? exactText(dialog, "Upload Image");
    const gifText = exactText(dialog, discordLabel("SELECT_IMAGE_MODAL_CHOOSE_GIF", "Choose GIF"))
        ?? exactText(dialog, "Choose GIF");
    let row: HTMLElement | null = null;
    if (uploadText && gifText) row = commonAncestor(clickableRoot(uploadText, dialog), clickableRoot(gifText, dialog), dialog);
    // Another Discord language, or wording that changed: the structure of the dialog is enough.
    row ??= findTileRow(dialog);
    if (!row) return;

    const target = getTarget(dialog);
    const entry = buildPinterestEntry(dialog, target);

    // Keep Discord's original two large tiles untouched and place a compact Pinterest
    // button immediately underneath them. This avoids stretching the image picker.
    row.insertAdjacentElement("afterend", entry);

    // Open the Pinterest session now, while the user is still looking at the
    // picker, so the first search does not wait for it.
    void Native.warmUp();
}

function scanForImageDialogs() {
    const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
    for (const dialog of dialogs) {
        if (!dialog.classList.contains("vc-pinterest-tool-profile-modal")) enhanceImageDialog(dialog);
    }
}

function queueScan() {
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(() => { scanFrame = 0; scanForImageDialogs(); });
}

function removeInjectedEntries() {
    document.querySelectorAll("[data-vc-pinterest-tool='true']").forEach(node => node.remove());
}

/** Opens Pinterest Tool's window for the picker `dialog`. A window that fails to draw shows a message and goes to the health report; it never takes Discord's page down. */
function openProfileModal(dialog: HTMLElement, target: Extract<SearchKind, "AVATAR" | "BANNER">) {
    engine?.modals.open(props => {
        Boundary ??= makeErrorBoundary(currentReact(), (label, error) => { engine?.reportError(label, error); });
        return (
            <Boundary label="Pinterest Tool">
                <PinterestProfileModal
                    {...props}
                    target={target}
                    onEditFile={(file: File, onApplyStart?: () => void) => handoffToDiscordImageEditor(dialog, file, onApplyStart)}
                    onApplied={() => closeDiscordImageModal(dialog)}
                />
            </Boundary>
        );
    });
}

/** Opens the window with no picker dialog behind it (the keyboard shortcut). Picking a picture then applies it straight to the profile editor if one is open. */
export function openStandalone(target: Extract<SearchKind, "AVATAR" | "BANNER"> = lastProfileImageTarget) {
    engine?.modals.open(props => {
        Boundary ??= makeErrorBoundary(currentReact(), (label, error) => { engine?.reportError(label, error); });
        return (
            <Boundary label="Pinterest Tool">
                <PinterestProfileModal {...props} target={target} />
            </Boundary>
        );
    });
}

/** Starts watching Discord's dialogs: the Pinterest button goes under "Upload Image / Choose GIF" in the "Select an Image" dialog. */
export function startPicker(ctx: Pick<EnginePluginContext, "modals" | "reportError">) {
    engine = ctx;
    document.addEventListener("pointerdown", rememberProfileImageTarget, true);
    queueScan();
    observer = new MutationObserver(records => {
        const relevant = records.some(record => {
            const parent = record.target instanceof Element ? record.target : record.target.parentElement;
            if (parent?.closest(".vc-pinterest-tool-profile-modal")) return false;
            if (parent?.closest("[role='dialog']")) return true;
            return Array.from(record.addedNodes).some(node => node instanceof Element
                && (node.matches("[role='dialog']") || node.querySelector("[role='dialog']")));
        });
        if (relevant) queueScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/** Stops watching and removes the buttons it added. */
export function stopPicker() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    document.removeEventListener("pointerdown", rememberProfileImageTarget, true);
    observer?.disconnect();
    observer = null;
    removeInjectedEntries();
    engine = undefined;
}
