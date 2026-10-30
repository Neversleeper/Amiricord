/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * `Notice.Warning` and `Margins.bottom8` (Vencord components) do not exist here: the notice is drawn with Discord's own warning colors.
 * The text is the original's, word for word.
 */

import type { EnginePluginContext } from "../../renderer/engine";
import { withErrorBoundary } from "./errorBoundary";

const noticeStyle = {
    padding: "12px 16px",
    borderRadius: "8px",
    fontSize: "14px",
    lineHeight: 1.4,
    color: "var(--text-default, var(--text-normal, #dbdee1))",
    // Fixed translucent colors: Discord's `--status-warning-background` is a solid yellow in some themes, which makes the light text unreadable.
    background: "rgba(240, 178, 50, 0.12)",
    border: "1px solid rgba(240, 178, 50, 0.55)"
};

const marginBottom8 = { marginBottom: "8px" };

function Warning({ style, children }: { style?: Record<string, unknown>; children?: unknown; }) {
    return <div role="alert" style={{ ...noticeStyle, ...style }}>{children}</div>;
}

function AutoRedeemWarning() {
    return (
        <>
            <Warning style={marginBottom8}>
                <strong>Automated redemption and external-service warning.</strong>
                <p>You are responsible for ensuring that every redemption attempt is authorized and complies with Discord&apos;s rules. Do not use automation, third-party CAPTCHA services, proxies, or webhooks to claim codes unfairly, evade safeguards, misuse another account, or expose personal data and credentials.</p>
                <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
            </Warning>
            <Warning>
                Automatic CAPTCHA solving sends the site key, request data, Discord page URL, and your user agent to the selected third-party service and may spend credits. If solving fails, AutoRedeem falls back to retrying the code with backoff. NoCaptchaAI does not currently document hCaptcha token tasks, so its compatible task mode may stop working if the provider rejects it.
            </Warning>
        </>
    );
}

/** The legal notice shown at the top of the plugin's settings window (the original passed it as `settingsAboutComponent`). */
export function createAutoRedeemLegalWarning(ctx: Pick<EnginePluginContext, "reportError">) {
    return withErrorBoundary(ctx, "AutoRedeem legal warning", AutoRedeemWarning);
}
