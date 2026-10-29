/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Part of the Amiricord port of AutoRedeem (original plugin: TestCord, by x2b and irritably).
 */

// What the plugin draws in its own settings window, below the settings it declares (`settingsComponent`). It holds what Vencord-style settings did with
// components and with fields that Amiricord's declared settings (boolean, number, string, select) cannot express:
//   - the legal notice (the original's `settingsAboutComponent`);
//   - the credentials (CAPTCHA keys, VoidSolver proxy, webhook address) as secrets: written here, never read back (see secretsState.ts);
//   - the "Send Test Webhook" button (the original's `testWebhook` component setting);
//   - the redeem log (the original's "AutoRedeem Logs" settings tab).

import { currentReact } from "../../../api/jsxRuntime";
import type { EnginePluginContext } from "../../../renderer/engine";
import { withErrorBoundary } from "../errorBoundary";
import type { SecretName, SecretsState } from "../secretsState";
import type { Webhook } from "../webhook";

interface SecretField {
    name: SecretName;
    label: string;
    placeholder: string;
    help: string;
}

const SECRET_FIELDS: readonly SecretField[] = [
    { name: "noneCapApiKey", label: "NoneCap API key", placeholder: "nc_live_...", help: "Used when the CAPTCHA service is NoneCap. Leave empty to retry challenged gifts with backoff." },
    { name: "noCaptchaAiApiKey", label: "NoCaptchaAI API key", placeholder: "nocap_...", help: "Used when the CAPTCHA service is NoCaptchaAI. Leave empty to retry challenged gifts with backoff." },
    { name: "voidSolverApiKey", label: "VoidSolver API key", placeholder: "VoidSolver API key", help: "Used when the CAPTCHA service is VoidSolver. Leave empty to retry challenged gifts with backoff." },
    { name: "voidSolverProxy", label: "VoidSolver proxy (optional)", placeholder: "http://user:pass@ip:port", help: "Optional proxy sent to VoidSolver in http://user:pass@ip:port format." },
    { name: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/...", help: "Discord webhook to notify after each redeem attempt. Leave empty to disable." }
];

const sectionTitle = { margin: "24px 0 8px", fontSize: "16px", fontWeight: 600, color: "var(--header-primary, var(--text-default, #f2f3f5))" };
const mutedText = { fontSize: "12px", color: "var(--text-muted, #949ba4)" };

export interface SettingsPanelOptions {
    ctx: Pick<EnginePluginContext, "components" | "toasts" | "reportError">;
    secrets: SecretsState;
    webhook: Webhook;
    LegalWarning: (props: Record<string, never>) => unknown;
    /** Omitted when the logs have their own settings tab. */
    LogTab?: (props: Record<string, never>) => unknown;
}

export function createSettingsPanel({ ctx, secrets, webhook, LegalWarning, LogTab }: SettingsPanelOptions) {
    const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
    const subscribe = (onChange: () => void) => secrets.subscribe(() => { onChange(); });

    function SecretRow({ field }: { field: SecretField; }) {
        const { useState } = currentReact();
        const Button = ctx.components.Button.get();
        const [value, setValue] = useState("");
        const [busy, setBusy] = useState(false);
        const saved = secrets.has(field.name);
        if (!Button) return null;

        const run = (work: () => Promise<void>, done: string) => {
            setBusy(true);
            work().then(
                () => { setValue(""); ctx.toasts.show(done, "success"); },
                (error: unknown) => { ctx.toasts.show(describe(error), "failure"); }
            ).then(() => { setBusy(false); });
        };

        return (
            <div style={{ margin: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                    <strong>{field.label}</strong>
                    <span style={{ ...mutedText, color: saved ? "var(--status-positive, #23a55a)" : "var(--text-muted, #949ba4)" }}>{saved ? "Saved" : "Not set"}</span>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                        type="password"
                        className="amiricord-input"
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={saved ? "Saved. Type a new value to replace it." : field.placeholder}
                        value={value}
                        disabled={busy}
                        onChange={(event: { target: { value: string; }; }) => setValue(event.target.value)}
                    />
                    <Button variant="primary" disabled={busy || value.trim().length === 0} onClick={() => run(() => secrets.save(field.name, value), `${field.label} saved.`)}>Save</Button>
                    <Button variant="danger" disabled={busy || !saved} onClick={() => run(() => secrets.clear(field.name), `${field.label} cleared.`)}>Clear</Button>
                </div>
                <div style={{ ...mutedText, marginTop: "4px" }}>{field.help}</div>
            </div>
        );
    }

    function TestWebhookButton() {
        const { useState, useSyncExternalStore } = currentReact();
        const Button = ctx.components.Button.get();
        const [busy, setBusy] = useState(false);
        useSyncExternalStore(subscribe, secrets.version);
        if (!Button) return null;

        return (
            <Button
                disabled={busy || !secrets.has("webhookUrl")}
                onClick={() => {
                    setBusy(true);
                    webhook.sendTestWebhook()
                        .then(() => ctx.toasts.show("Test webhook sent successfully.", "success"))
                        .catch((error: unknown) => ctx.toasts.show(error instanceof Error ? error.message : "Failed to send test webhook.", "failure"))
                        .then(() => { setBusy(false); });
                }}
            >
                Send Test Webhook
            </Button>
        );
    }

    function AutoRedeemSettings() {
        const { useSyncExternalStore } = currentReact();
        useSyncExternalStore(subscribe, secrets.version);

        return (
            <div>
                <LegalWarning />

                <div style={sectionTitle}>Credentials</div>
                <div style={mutedText}>Saved encrypted by Amiricord and used only by the plugin&apos;s own main-process code. They are never shown again and never leave this computer except to the service they belong to.</div>
                {SECRET_FIELDS.map(field => <SecretRow key={field.name} field={field} />)}
                <TestWebhookButton />

                {LogTab && <div style={sectionTitle}>Logs</div>}
                {LogTab && <LogTab />}
            </div>
        );
    }

    return withErrorBoundary(ctx, "AutoRedeem settings", AutoRedeemSettings);
}
