/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to Amiricord (context-injection engine) by szlcx404.
 * The original was a tab of Vencord's settings (`SettingsTab`, `wrapTab`, `SettingsPlugin.customEntries`). Amiricord has no custom settings entries for
 * plugins: the plugin draws it inside its own settings window (see SettingsPanel.tsx), so it is a plain section now. Layout and behaviour are the same.
 */

import { currentReact } from "../../../api/jsxRuntime";
import type { EnginePluginContext } from "../../../renderer/engine";
import type { AutoRedeemDeps } from "../deps";
import { withErrorBoundary } from "../errorBoundary";
import type { LogStore, RedeemLog, RedeemStatus, RedeemType } from "../store";

type StatusFilter = "all" | RedeemStatus;
type TypeFilter = "all" | RedeemType;

const statusOptions = [
    { label: "All", value: "all" },
    { label: "Succeeded", value: "success" },
    { label: "Failed", value: "failed" }
];

const typeOptions = [
    { label: "All", value: "all" },
    { label: "Nitro", value: "nitro" },
    { label: "Decorations", value: "decoration" },
    { label: "Other", value: "other" }
];

export interface LogTabOptions {
    ctx: Pick<EnginePluginContext, "components" | "reportError">;
    deps: Pick<AutoRedeemDeps, "ChannelStore" | "NavigationRouter">;
    store: LogStore;
}

export function createLogTab({ ctx, deps, store }: LogTabOptions) {
    function AutoRedeemTab() {
        const { useState, useEffect } = currentReact();
        const Select = ctx.components.Select.get();
        const Button = ctx.components.Button.get();
        const [logs, setLogs] = useState<RedeemLog[]>(store.getLogs());
        const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
        const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

        useEffect(() => {
            void store.loadLogs();
            return store.subscribe(() => setLogs([...store.getLogs()]));
        }, []);

        // Only before React exists, and then nothing is being drawn anyway.
        if (!Select || !Button) return null;

        const filtered = logs.filter(l =>
            (statusFilter === "all" || l.status === statusFilter) &&
            (typeFilter === "all" || l.type === typeFilter)
        );

        return (
            <div>
                <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
                    <div style={{ width: "160px" }}>
                        <Select
                            options={statusOptions}
                            value={statusFilter}
                            onChange={v => setStatusFilter(v as StatusFilter)}
                        />
                    </div>
                    <div style={{ width: "160px" }}>
                        <Select
                            options={typeOptions}
                            value={typeFilter}
                            onChange={v => setTypeFilter(v as TypeFilter)}
                        />
                    </div>
                    <div style={{ marginLeft: "auto" }}>
                        <Button
                            variant="danger"
                            onClick={() => { if (confirm("Clear all logs?")) void store.clearLogs(); }}
                        >
                            Clear Logs
                        </Button>
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                        No logs yet.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {filtered.map(log => (
                            <div key={log.id} style={{
                                display: "flex", alignItems: "center", gap: "10px",
                                padding: "8px 12px", borderRadius: "6px",
                                background: "var(--background-secondary)"
                            }}>
                                <span style={{
                                    padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600,
                                    background: log.status === "success" ? "var(--status-positive-background)" : "var(--status-danger-background)",
                                    color: log.status === "success" ? "var(--status-positive-text)" : "var(--status-danger-text)"
                                }}>
                                    {log.status === "success" ? "OK" : "FAIL"}
                                </span>
                                <span style={{
                                    padding: "2px 8px", borderRadius: "4px", fontSize: "12px",
                                    background: "var(--background-tertiary)"
                                }}>
                                    {log.type}
                                </span>
                                <code
                                    style={{
                                        flex: 1,
                                        ...(log.channelId && log.messageId ? { cursor: "pointer", textDecoration: "underline", color: "var(--text-link)" } : {})
                                    }}
                                    onClick={() => {
                                        if (!log.channelId || !log.messageId) return;
                                        const channel = deps.ChannelStore.getChannel(log.channelId);
                                        const guildId = channel?.guild_id ?? "@me";
                                        deps.NavigationRouter.transitionTo(`/channels/${guildId}/${log.channelId}/${log.messageId}`);
                                    }}
                                >{log.code}</code>
                                {log.error && <span style={{ color: "var(--text-danger)", fontSize: "12px" }}>{log.error}</span>}
                                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                                    {new Date(log.timestamp).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return withErrorBoundary(ctx, "AutoRedeem logs", AutoRedeemTab);
}
