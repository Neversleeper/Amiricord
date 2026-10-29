/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ConsoleJanitor (authors Nuckyz and sadan) as found in TestCord's copy of Vencord's plugins. The patches are the original's.
// Differences: the original drew a row of six checkboxes for the log levels that stay allowed; here each level is its own on/off setting. The settings that change which
// patches apply (`disableLoggers`, `disableSpotifyLogger`) are read when the plugin starts, so a change needs a restart, as in the original. Not checked against a live
// page: which of the many "quiet this message" patches still match on the current build is NOT known (each one is optional and lazy).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

type Level = "error" | "warn" | "trace" | "log" | "info" | "debug";

const settings = definePluginSettings({
    disableLoggers: { type: "boolean", default: false, restartNeeded: true, description: "Disables Discord's loggers" },
    disableSpotifyLogger: { type: "boolean", default: true, restartNeeded: true, description: "Disable the Spotify logger, which leaks account information and access token" },
    whitelistedLoggers: { type: "string", default: "GatewaySocket; Routing/Utils", description: "Semicolon (;) separated list of loggers to allow even if others are hidden" },
    allowError: { type: "boolean", default: true, description: "Always allow loggers of the type error" },
    allowWarn: { type: "boolean", default: false, description: "Always allow loggers of the type warn" },
    allowTrace: { type: "boolean", default: false, description: "Always allow loggers of the type trace" },
    allowLog: { type: "boolean", default: false, description: "Always allow loggers of the type log" },
    allowInfo: { type: "boolean", default: false, description: "Always allow loggers of the type info" },
    allowDebug: { type: "boolean", default: false, description: "Always allow loggers of the type debug" }
} as const);

const LEVEL_SETTING: Record<Level, "allowError" | "allowWarn" | "allowTrace" | "allowLog" | "allowInfo" | "allowDebug"> = {
    error: "allowError", warn: "allowWarn", trace: "allowTrace", log: "allowLog", info: "allowInfo", debug: "allowDebug"
};

const Noop = () => { /* does nothing on purpose */ };
const NoopLogger = {
    log: Noop, logDangerously: Noop, verboseDangerously: Noop, verbose: Noop, info: Noop, warn: Noop, error: Noop, trace: Noop, time: Noop, fileOnly: Noop
};

let allowed = new Set<string>();
let originalPlay: HTMLMediaElement["play"] | undefined;

const quiet = (find: string, match: RegExp, replace: string): PatchDefinition => ({ find, lazy: true, required: false, replacements: [{ match, replace }] });

const plugin: PluginCode & {
    Noop(): void;
    NoopLogger(): typeof NoopLogger;
    shouldLog(logger: unknown, level: unknown): boolean;
} = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [
            quiet('The "interpolate" function is deprecated in v10 (use "to" instead)', /,console.warn\('react-spring: The "interpolate" function is deprecated in v10 \(use "to" instead\)'\)/, ""),
            quiet('console.warn("Window state not initialized"', /console\.warn\("Window state not initialized",\i\),/, ""),
            quiet("is not a valid locale.", /\i\.error(?=\(`\$\{\i\} is not a valid locale.`)/, "$self.Noop"),
            quiet('"AppCrashedFatalReport: getLastCrash not supported."', /console\.log(?=\("AppCrashedFatalReport: getLastCrash not supported\."\))/, "$self.Noop"),
            quiet("Unknown type for applicationId", /new \i\.\i\("NowPlayingViewStore"\)\.error(?=\(`Unknown type for applicationId: \$\{typeof \i\}, value: \$\{\i\}`)/, "$self.Noop"),
            quiet("RPCServer:WSS", /\i\.error\(`Error: \$\{(\i)\.message\}/, '!$1.message.includes("EADDRINUSE")&&$&'),
            quiet("Tried getting Dispatch instance before instantiated", /null==\i&&\i\.warn\("Tried getting Dispatch instance before instantiated"\),/, ""),
            quiet("Unable to determine render window for element", /console\.warn\("Unable to determine render window for element",\i\),/, ""),
            quiet("failed to send analytics events", /console\.error\(`\[analytics\] failed to send analytics events query: \$\{\i\}`\)/, ""),
            quiet("Slow dispatch on", /\i\.totalTime>\d+?&&\i\.verbose\([`"]Slow dispatch on.{0,55}\);/, "")
        ];
        // Discord's generic logger function.
        if (settings.store.disableLoggers) patches.push(quiet('"file-only"!==', /(?<=&&)(?=console)/, "$self.shouldLog(arguments[0],arguments[1])&&"));
        if (settings.store.disableSpotifyLogger) patches.push(quiet('("Spotify")', /new \i\.\i\("Spotify"\)/, "$self.NoopLogger()"));
        return patches;
    },

    start() {
        allowed = new Set(settings.store.whitelistedLoggers.split(";").map(name => name.trim()).filter(Boolean));
        // A play() that Discord does not wait for must not report an error when the browser refuses it.
        const play = HTMLMediaElement.prototype.play;
        originalPlay = play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
            const result = play.apply(this);
            result?.catch(() => undefined);
            return result;
        };
    },

    stop() {
        if (originalPlay) HTMLMediaElement.prototype.play = originalPlay;
        originalPlay = undefined;
    },

    Noop,
    NoopLogger: () => NoopLogger,

    shouldLog(logger, level) {
        if (typeof logger === "string" && allowed.has(logger)) return true;
        const key = LEVEL_SETTING[level as Level];
        return key !== undefined && settings.store[key] === true;
    }
};

export default plugin;
