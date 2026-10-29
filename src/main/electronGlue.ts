/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The only file of the main process that talks to Electron. It is thin on purpose: everything it decides lives in
// MainController and in `shared/ipc.ts`, which are tested without Electron.
// Not verified yet: whether Discord's windows use the default session (so the preload below reaches them). That is
// checked on Canary; the fallback in design 02 section 9 is to wrap the window's own preload.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, IpcMainEvent, IpcMainInvokeEvent, net, netLog, safeStorage, session, shell } from "electron";

import { makeHostMatcher } from "../shared/hostRules";
import { IPC, isTrustedSender, parseHealthEvent } from "../shared/ipc";
import { PROJECT_VERSION, UPDATE_REPO } from "../shared/project";
import { readTextFile, writeTextAtomic } from "./atomicFile";
import { buildBlockLog, exportName, exportText } from "./blockLog";
import { makeCensus } from "./census";
import { applyDns, dnsOff, dnsText } from "./dns/apply";
import { chooseDns } from "./dns/config";
import { FetchLike, verifyProvider } from "./dns/verify";
import { dnsConfigPath, loadDnsConfig, saveDnsConfig } from "./dnsConfigFile";
import { makeFirewall } from "./firewall";
import { makeHeaderCheck } from "./headerCheck";
import { backupHostRules, hostRulesPath, loadHostRules, saveHostRules } from "./hostRulesFile";
import { dataDirectory, MainController } from "./mainController";
import { makeNativeFetch } from "./nativeFetch";
import { answerNativeCall, NativeHost, type NativeResponse } from "./nativeHost";
import { nativeModules } from "./nativeModules";
import { type NativeTable, nativeTableFromRegistry } from "./nativeTable";
import { nativeWindowOf } from "./nativeWindow";
import { openDataFolder } from "./openFolder";
import { openOwn } from "./openOwn";
import { makePause } from "./pause";
import { buildPrivacyAnswer, makeProviderTester } from "./privacyAnswer";
import { makePrivacyChanger, weakensTelemetry } from "./privacyChange";
import { makeRestart, planRelaunch } from "./relaunch";
import { RequestHub, WebRequestLike } from "./requestHub";
import { answerSecretCall, declaredSecrets, SecretStore } from "./secretStore";
import { makeTokenGuard } from "./tokenGuard";
import { TokenHosts, tokenHostsFromRegistry } from "./tokenHosts";
import { trace } from "./trace";
import { createUpdater } from "./updater";
import { answerUpdateRequest, type FetchLike as UpdateFetch, makeFetchBytes, realFiles } from "./updatesGlue";
import { anyCreationChoice, creationChoicesOf, hookBrowserWindow } from "./windowHook";
import { anyWindowOption, applyWindowOptions, type WindowLike, windowOptionsOf } from "./windowOptions";

export interface MainOptions {
    /** Absolute path of our preload script. */
    preloadPath: string;
    /** Absolute path of the bundled page script (`dist/renderer.js`). */
    rendererPath: string;
    /** The folder of this Discord's engine and data (`%APPDATA%\Amiricord\<branch>`): the folder above `dist`. When missing, the old shared folder from the environment is used. */
    dataDir?: string;
    /** Discord's build number when the stub knows it. */
    build?: number | null;
}

const senderUrl = (event: IpcMainEvent | IpcMainInvokeEvent) => event.senderFrame?.url;

/** Development only: count the requests Discord makes (design 05, P4a) and write the table to `probe/request-census-<process id>.json` every 30 seconds and at quit (one file per Discord, because Canary and Stable share the data folder). */
function startCensus(hub: RequestHub, controller: MainController, dataDir: string): void {
    const census = makeCensus({ now: () => Date.now() });
    hub.add(census.handler);
    const write = () => {
        const error = controller.devDump({ name: `request-census-${process.pid}`, text: JSON.stringify(census.snapshot()) });
        if (error !== null) trace(dataDir, `request census could not be written: ${error}`);
    };
    const timer = setInterval(write, 30_000);
    timer.unref();
    app.on("before-quit", write);
    trace(dataDir, `request census running (development mode): probe/request-census-${process.pid}.json is written every 30 seconds`);
}

/** Start the engine's main-process side. Call before Discord's own main code runs. Returns the controller, or null if it could not start. */
export function startMain(options: MainOptions): MainController | null {
    const dataDir = options.dataDir ?? dataDirectory(process.env);
    if (dataDir === null) return null;

    const controller = new MainController({ dataDir });
    controller.start(options.build ?? null);

    // The window options of the main tab (no minimum size, Ctrl+Q to close, the Windows background effect): read once now, applied to each window as Discord creates it. Nothing is
    // done when none is on or when Discord is in safe mode, and a failure here is only written in the boot trace: it must never keep Discord from starting or from opening a window.
    try {
        const windowChoices = windowOptionsOf(key => controller.pluginValue("Settings", key));
        if (anyWindowOption(windowChoices) && !controller.bootInfo().safeMode) {
            const applyToWindow = (win: unknown) => { applyWindowOptions(win as WindowLike, windowChoices, text => { trace(dataDir, text); }); };
            app.on("browser-window-created", (_event, win) => { applyToWindow(win); });
            for (const win of BrowserWindow.getAllWindows()) applyToWindow(win);
            trace(dataDir, `window options: on (minimum size ${windowChoices.removeMinimumSize ? "removed" : "kept"}, Ctrl+Q ${windowChoices.ctrlQ ? "on" : "off"}, background effect ${windowChoices.material})`);
        }
    } catch (error) {
        trace(dataDir, `window options: FAILED ${error instanceof Error ? error.message : String(error)}`);
    }

    // The two options that Electron only reads when a window is created (Windows title bar, transparent window): the window constructor is swapped before Discord asks for it.
    try {
        const creation = creationChoicesOf(key => controller.pluginValue("Settings", key));
        if (anyCreationChoice(creation) && !controller.bootInfo().safeMode) {
            hookBrowserWindow({ resolve: id => require.resolve(id), cache: require.cache }, creation, text => { trace(dataDir, text); });
        }
    } catch (error) {
        trace(dataDir, `window options: the creation options FAILED ${error instanceof Error ? error.message : String(error)}`);
    }

    ipcMain.on(IPC.bootInfo, event => {
        event.returnValue = isTrustedSender(senderUrl(event)) ? controller.bootInfo() : null;
    });
    ipcMain.on(IPC.health, (event, payload: unknown) => {
        if (!isTrustedSender(senderUrl(event))) return;
        const parsed = parseHealthEvent(payload);
        if (parsed) controller.recordHealth(parsed);
    });
    ipcMain.on(IPC.cleanBoot, event => {
        if (isTrustedSender(senderUrl(event))) controller.cleanBoot();
    });
    ipcMain.on(IPC.rendererCode, event => {
        let code: string | null = null;
        if (isTrustedSender(senderUrl(event))) {
            try {
                code = readFileSync(options.rendererPath, "utf8");
            } catch {
                // Without the script the page simply runs without the mod.
            }
        }
        event.returnValue = code;
    });
    // The hosts that may get the token depend on which plugins are switched on, so they are worked out again after every accepted change of a setting.
    let onSettingsChanged: () => void = () => undefined;
    ipcMain.on(IPC.settingsChange, (event, payload: unknown) => {
        if (!isTrustedSender(senderUrl(event))) return;
        // Switching one of NoTrack's two telemetry switches off weakens protection, so it may only come through the confirmed channel (privacy-change), never around it.
        if (weakensTelemetry(payload as Parameters<typeof weakensTelemetry>[0])) return;
        controller.changeSetting(payload);
        try {
            onSettingsChanged();
        } catch {
            // Working the hosts out again must never disturb a setting.
        }
    });
    ipcMain.on(IPC.devDump, (event, payload: unknown) => {
        if (isTrustedSender(senderUrl(event))) controller.devDump(payload);
    });
    // Restart on request. The steps are in relaunch.ts; `app.exit` does not send before-quit, so what is waiting is written first.
    const restart = makeRestart({
        dispose: () => { controller.dispose(); },
        plan: planRelaunch({ execPath: process.execPath, platform: process.platform, exists: existsSync }),
        relaunch: plan => { app.relaunch(plan); },
        exit: code => { app.exit(code); }
    });
    ipcMain.on(IPC.restart, event => {
        if (isTrustedSender(senderUrl(event))) restart();
    });
    // The page may read how many requests the firewall cancelled (counts only). Null until the firewall exists.
    let firewallStatus: () => unknown = () => null;
    ipcMain.handle(IPC.firewall, event => (isTrustedSender(senderUrl(event)) ? firewallStatus() : null));
    // The Privacy & Security tab (P7a): one read-only snapshot, and "Test now" for one provider of our table. Both are null until the request hub has started.
    let privacySnapshot: () => unknown = () => null;
    let testProvider: (id: unknown) => Promise<unknown> = async () => null;
    ipcMain.handle(IPC.privacy, event => (isTrustedSender(senderUrl(event)) ? privacySnapshot() : null));
    ipcMain.handle(IPC.privacyTest, (event, id: unknown) => (isTrustedSender(senderUrl(event)) ? testProvider(id) : null));
    let blockLog: () => unknown = () => null;
    ipcMain.handle(IPC.privacyLog, event => (isTrustedSender(senderUrl(event)) ? blockLog() : null));
    let privacyChange: (change: unknown) => Promise<unknown> = async () => null;
    ipcMain.handle(IPC.privacyChange, (event, change: unknown) => (isTrustedSender(senderUrl(event)) ? privacyChange(change) : null));
    ipcMain.on(IPC.leaveSafeMode, event => {
        if (isTrustedSender(senderUrl(event))) controller.leaveSafeMode();
    });
    ipcMain.on(IPC.openOwn, (event, place: unknown) => {
        // Only a fixed word: the file and the address are ours (`src/main/openOwn.ts`).
        if (!isTrustedSender(senderUrl(event))) return;
        void openOwn(place, {
            folder: dataDir,
            open: path => shell.openPath(path),
            reveal: path => { shell.showItemInFolder(path); },
            openExternal: url => shell.openExternal(url),
            trace: text => { trace(dataDir, text); }
        });
    });
    ipcMain.on(IPC.openDataFolder, event => {
        // The folder is ours (not sent by the page), so the page cannot make the explorer open anything else.
        if (!isTrustedSender(senderUrl(event))) return;
        void openDataFolder({
            folder: dataDir,
            open: path => shell.openPath(path),
            reveal: path => { shell.showItemInFolder(path); },
            trace: text => { trace(dataDir, text); }
        });
    });
    // The main-process part of plugins: only the plugins that are switched on in this boot and declare native functions. Plugins with native code need a restart to
    // be switched on or off, so the table is made once, from the registry and the saved choices (never from the page). A registry that cannot be read means no native code runs.
    const makeNativeTable = (): NativeTable => {
        const registry = readTextFile(join(dataDir, "dist", "registry.json"));
        if (registry.kind !== "text") return { plugins: {}, problems: ["the plugin registry could not be read, so no plugin has native code"] };
        const boot = controller.bootInfo();
        const choices: Record<string, boolean | undefined> = {};
        for (const [id, saved] of Object.entries(boot.settings.plugins)) choices[id] = saved.enabled;
        return nativeTableFromRegistry({ registryText: registry.text, safeMode: boot.safeMode, quarantine: boot.quarantine, choices, modules: nativeModules });
    };
    const nativeTable = makeNativeTable();
    for (const problem of nativeTable.problems) {
        controller.addProblem(problem);
        trace(dataDir, `native code: ${problem}`);
    }
    trace(dataDir, `native code: ${Object.keys(nativeTable.plugins).length} plugin(s) with main-process code are on`);
    // The secrets of plugins (a cookie, a key): encrypted with the operating system's secure storage, kept in `secrets.json` of this data folder. The page can write,
    // clear and ask whether one exists, but only a plugin's own native code can read it (`host.secret`).
    const secretsPath = join(dataDir, "secrets.json");
    const secrets = new SecretStore({
        backend: {
            available: () => safeStorage.isEncryptionAvailable(),
            encrypt: text => safeStorage.encryptString(text).toString("base64"),
            decrypt: cipher => safeStorage.decryptString(Buffer.from(cipher, "base64"))
        },
        file: {
            read: () => {
                const saved = readTextFile(secretsPath);
                if (saved.kind === "error") throw new Error(saved.message);
                return saved.kind === "text" ? saved.text : null;
            },
            write: text => writeTextAtomic(secretsPath, text)
        }
    });
    const declaredNow = () => {
        const registry = readTextFile(join(dataDir, "dist", "registry.json"));
        return registry.kind === "text" ? declaredSecrets(registry.text) : {};
    };
    ipcMain.handle(IPC.secret, (event, message: unknown) => {
        const answer = answerSecretCall(secrets, declaredNow, isTrustedSender, senderUrl(event), message);
        // Only what failed, in a few words: a value never appears in an answer, so it can never reach the trace.
        if (!answer.ok) trace(dataDir, `secret call refused: ${answer.error.slice(0, 120)}`);
        return answer;
    });
    let nativeBlockedBy: (hostname: string) => { host: string; } | null = () => null;
    let nativeBlockNote: (ruleHost: string, method: unknown, pathname: string) => void = () => undefined;
    const nativeHost = new NativeHost({
        plugins: nativeTable.plugins,
        secret: (plugin, name) => secrets.get(plugin, name),
        // After a check against the owner's blocked sites. Both come from the request hub block below (late binding).
        fetch: makeNativeFetch({
            // Electron's `net.fetch` cancels a request with `redirect: "manual"` at the first redirect ("Redirect was cancelled"), and the plugin host checks every hop itself, so the plain `fetch` stays for now.
            fetch: (url, init) => fetch(url, init) as Promise<NativeResponse>,
            blockedBy: host => nativeBlockedBy(host),
            onBlocked: (ruleHost, method, pathname) => { nativeBlockNote(ruleHost, method, pathname); }
        }),
        // Only what was refused or failed is traced, and never the arguments or the answer.
        onEvent: event => {
            if (event.type === "refused") trace(dataDir, `native call refused: ${event.reason}`);
            else if (event.type === "call" && !event.ok) trace(dataDir, `native call failed: ${event.plugin} ${event.fn}`);
            else if (event.type === "fetch" && !event.allowed) trace(dataDir, `native request to ${event.host} refused (${event.plugin})`);
            else if (event.type === "devtools") trace(dataDir, `developer tools ${event.opened ? "opened" : "could not be opened"} for ${event.plugin}`);
        }
    });
    // The window that made the call goes along, so a plugin with the devtools permission opens the tools of THAT window and no other.
    ipcMain.handle(IPC.native, (event, message: unknown) => answerNativeCall(nativeHost, isTrustedSender, senderUrl(event), message, nativeWindowOf(event.sender)));
    ipcMain.handle(IPC.report, event => (isTrustedSender(senderUrl(event)) ? controller.report() : null));
    // The Updates tab: look for a newer version, or install it. The request is checked in `answerUpdateRequest`; the address and the files are the updater's own.
    const updater = createUpdater({
        repo: UPDATE_REPO,
        currentVersion: PROJECT_VERSION,
        distDir: join(dataDir, "dist"),
        fetchBytes: makeFetchBytes(net.fetch as unknown as UpdateFetch),
        isBlocked: hostname => nativeBlockedBy(hostname) !== null,
        files: realFiles()
    });
    ipcMain.handle(IPC.updates, async (event, message: unknown) => {
        if (!isTrustedSender(senderUrl(event))) return null;
        const answer = await answerUpdateRequest(updater, message);
        if (answer?.status === "installed") trace(dataDir, `update installed: ${answer.current} -> ${answer.installed}`);
        else if (answer?.status === "error") trace(dataDir, `update: ${answer.message}`);
        return answer;
    });

    app.on("before-quit", () => controller.dispose());

    void app.whenReady().then(() => {
        session.defaultSession.registerPreloadScript({ type: "frame", filePath: options.preloadPath });

        // The request hub owns Electron's webRequest events from here on; the first user is check A of the privacy self-test.
        try {
            const hub = new RequestHub(session.defaultSession.webRequest as unknown as WebRequestLike, {
                onError: (handler, error) => { trace(dataDir, `request hub: handler ${handler} failed: ${error instanceof Error ? error.message : String(error)}`); }
            });
            hub.install();
            const status = hub.status();
            trace(dataDir, `request hub installed (keeps Discord's own listeners: ${status.chaining ? "yes" : "NO, they would replace ours"})`);
            let remove = () => { /* set below */ };
            const check = makeHeaderCheck({
                report: event => { controller.recordHealth(event); },
                now: () => Date.now(),
                after: (work, ms) => { const timer = setTimeout(work, ms); timer.unref(); return () => { clearTimeout(timer); }; },
                remove: () => { remove(); }
            });
            remove = hub.add(check.handler);
            if (controller.isDevMode()) startCensus(hub, controller, dataDir);
            // The shields come last, so the census (development only) still counts what they cancel. They follow NoTrack's two switches (on unless the owner turned them off).
            // The owner's own host rules (`firewall.json`, edited by hand until the Privacy & Security tab exists). A rule that cannot be used is dropped and told in the engine status.
            const owned = loadHostRules(hostRulesPath(dataDir));
            // The list in force. The tab can change it (add or remove a site); the firewall asks `hostMatcher`, which is replaced after each saved change, so no restart is needed.
            let ownedRules = owned.rules;
            let hostMatcher = makeHostMatcher(ownedRules);
            let backedUp = false;
            for (const problem of owned.problems) {
                controller.addProblem(problem);
                trace(dataDir, `host rules: ${problem}`);
            }
            trace(dataDir, `host rules loaded: ${owned.rules.length}`);
            // A pause (ten minutes, asked for in the Privacy & Security tab) lets the shields and the owner's blocked sites rest. It lives here, in memory; the token guard never looks at it.
            const pause = makePause({
                now: () => Date.now(),
                after: (work, ms) => { const timer = setTimeout(work, ms); timer.unref(); return () => { clearTimeout(timer); }; },
                onChange: active => { trace(dataDir, active ? "protection paused for ten minutes" : "protection pause ended"); }
            });
            const firewall = makeFirewall({ now: () => Date.now(), enabled: name => controller.pluginValue("NoTrack", name) !== false && !pause.active(), blockedBy: host => (pause.active() ? null : hostMatcher(host)) });
            hub.add(firewall.handler);
            // The main-process code of plugins does not pass the hub: its requests are checked against the owner's blocked sites and counted here.
            nativeBlockedBy = host => (pause.active() ? null : hostMatcher(host));
            nativeBlockNote = (ruleHost, method, pathname) => { firewall.noteOwnBlock(ruleHost, method, pathname); };
            trace(dataDir, "firewall shields installed (usage reports, metrics, crash reports, telemetry host)");

            // The token guard (P5b): the token goes only to Discord's hosts and to the hosts that enabled plugins with the token permission declared.
            const readTokenHosts = (): TokenHosts => {
                const registry = readTextFile(join(dataDir, "dist", "registry.json"));
                if (registry.kind !== "text") return { patterns: [], problems: ["the plugin registry could not be read, so no plugin may receive the token"] };
                const boot = controller.bootInfo();
                const choices: Record<string, boolean | undefined> = {};
                for (const [id, saved] of Object.entries(boot.settings.plugins)) choices[id] = saved.enabled;
                return tokenHostsFromRegistry({ registryText: registry.text, safeMode: boot.safeMode, quarantine: boot.quarantine, choices });
            };
            let tokenHosts = readTokenHosts();
            for (const problem of tokenHosts.problems) {
                controller.addProblem(problem);
                trace(dataDir, `token guard: ${problem}`);
            }
            const guard = makeTokenGuard({ now: () => Date.now(), tokenHosts: () => tokenHosts.patterns });
            hub.add(guard.handler);
            onSettingsChanged = () => { tokenHosts = readTokenHosts(); };
            trace(dataDir, `token guard installed (the token goes to Discord's hosts and to ${tokenHosts.patterns.length} declared host(s))`);
            if (controller.isDevMode()) {
                // Development only: the guard judges a made-up request that carries a made-up header (never a real token) and the answer is traced; nothing is counted.
                const answer = guard.judge({ url: "https://example.test/api", method: "GET", requestHeaders: { Authorization: "NOT-A-REAL-TOKEN", Accept: "*/*" } });
                const kept = guard.judge({ url: "https://discord.com/api/v9/users", method: "GET", requestHeaders: { Authorization: "NOT-A-REAL-TOKEN" } });
                trace(dataDir, `token guard self-check: a stranger's header is ${answer && !("Authorization" in answer.requestHeaders) && "Accept" in answer.requestHeaders ? "removed (ok)" : "NOT removed (FAILED)"}, Discord's is ${kept === undefined ? "kept (ok)" : "removed (FAILED)"}`);
            }

            // Encrypted DNS (P6b): off unless the owner chose a provider in dns.json. The provider is asked a real question first; only if it answers is the resolver told to use it.
            // This runs without holding Discord back, so the first moments after the start use the system's DNS.
            const dnsFile = loadDnsConfig(dnsConfigPath(dataDir));
            const chosen = chooseDns(dnsFile.config, controller.bootInfo().safeMode);
            const dnsProblems = [...dnsFile.problems, ...chosen.problems];
            for (const problem of dnsProblems) {
                controller.addProblem(problem);
                trace(dataDir, `encrypted DNS: ${problem}`);
            }
            let dnsLine = chosen.choice.mode === "off" ? dnsText(dnsOff(), dnsProblems) : "Checking the provider...";
            if (chosen.choice.mode !== "off") {
                void applyDns(chosen.choice, {
                    verify: address => verifyProvider(address, {
                        // Chromium's own network stack, not Node's `fetch`: Quad9 and Mullvad answer only over HTTP/2, which Node's `fetch` does not speak (seen on 2026-10-26: HTTP 505 and a closed socket).
                        fetch: net.fetch as unknown as FetchLike,
                        now: () => performance.now(),
                        after: (work, ms) => { const timer = setTimeout(work, ms); return () => { clearTimeout(timer); }; }
                    }),
                    wait: ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); }),
                    configure: options => { app.configureHostResolver(options); }
                }).then(status => {
                    dnsLine = dnsText(status);
                    trace(dataDir, `encrypted DNS: ${dnsLine}`);
                    if (controller.isDevMode() && status.state === "configured") {
                        // Development only: Chromium's own network log for one minute, written into the probe folder, to see whether it really asks the provider (the events named DNS_TRANSACTION_HTTPS*).
                        const logFile = join(dataDir, "probe", "netlog.json");
                        void netLog.startLogging(logFile, { captureMode: "default", maxFileSize: 50 * 1024 * 1024 }).then(() => {
                            trace(dataDir, "network log for encrypted DNS started (development): probe/netlog.json, one minute");
                            const stop = setTimeout(() => { void netLog.stopLogging().then(() => { trace(dataDir, "network log for encrypted DNS stopped"); }, () => undefined); }, 60_000);
                            stop.unref();
                        }, () => undefined);
                    }
                }, () => {
                    dnsLine = "Not applied: the check could not run";
                    trace(dataDir, `encrypted DNS: ${dnsLine}`);
                });
            } else {
                trace(dataDir, `encrypted DNS: ${dnsLine}`);
            }
            firewallStatus = () => {
                const status = firewall.status();
                return { cancelled: { ...status.cancelled, "token-stripped": guard.status().stripped }, total: status.total, dns: dnsLine };
            };
            // What dns.json holds now; changes made from the tab are written there and take effect at the next start.
            let savedDns = dnsFile.config;
            const safe = controller.bootInfo().safeMode;
            privacySnapshot = () => buildPrivacyAnswer({
                counts: { ...firewall.status().cancelled, "token-stripped": guard.status().stripped },
                dnsLine, dnsMode: chosen.choice.mode, dnsProvider: dnsFile.config.provider,
                // In safe mode the choice is kept off on purpose, so a restart is not what is pending.
                dnsSaved: safe ? { mode: chosen.choice.mode, provider: dnsFile.config.provider } : { mode: savedDns.mode, provider: savedDns.provider },
                telemetry: { usage: controller.pluginValue("NoTrack", "disableAnalytics") !== false, crash: controller.pluginValue("NoTrack", "disableCrashReports") !== false },
                logVersion: firewall.status().total + guard.status().stripped,
                pauseRemainingMs: pause.remainingMs(),
                rules: ownedRules
            });
            // The recent blocks: the log of the firewall and the log of the token guard, grouped (host and path shape only; never a query, a header, a body or an id).
            const blocks = () => buildBlockLog({ firewall: firewall.log(), token: guard.log() }, firewall.status().total + guard.status().stripped, Date.now());
            blockLog = () => blocks();
            privacyChange = makePrivacyChanger({
                telemetry: key => controller.pluginValue("NoTrack", key) !== false,
                setTelemetry: (key, value) => controller.changeSetting({ type: "plugin-setting", plugin: "NoTrack", key, value }),
                dns: () => savedDns,
                saveDns: config => {
                    const error = saveDnsConfig(dnsConfigPath(dataDir), config);
                    if (error === null) savedDns = config;
                    return error;
                },
                rules: () => ({ rules: ownedRules, editable: owned.broken !== true }),
                saveRules: list => {
                    // A copy of the owner's file is kept once before the tab first rewrites it.
                    if (!backedUp) {
                        const backupError = backupHostRules(hostRulesPath(dataDir));
                        if (backupError !== null) return backupError;
                        backedUp = true;
                    }
                    const error = saveHostRules(hostRulesPath(dataDir), list);
                    if (error === null) {
                        ownedRules = [...list];
                        hostMatcher = makeHostMatcher(ownedRules);
                    }
                    return error;
                },
                now: () => Date.now(),
                paused: () => pause.active(),
                startPause: () => pause.start(),
                stopPause: () => { pause.stop(); },
                // No value: the saved value is removed, so the plugin's default (on) applies again.
                resetTelemetry: key => controller.changeSetting({ type: "plugin-setting", plugin: "NoTrack", key }),
                exportBlocks: format => {
                    const at = Date.now();
                    const name = exportName(format, at);
                    const error = writeTextAtomic(join(dataDir, "exports", name), exportText(format, blocks().groups, at));
                    return error === null ? name : null;
                },
                confirm: async question => {
                    const options = { type: "question" as const, buttons: [question.button, "Cancel"], defaultId: 1, cancelId: 1, noLink: true, title: "Amiricord", message: question.title, detail: question.detail };
                    const parent = BrowserWindow.getFocusedWindow();
                    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
                    return answer.response === 0;
                }
            });
            testProvider = makeProviderTester({
                verify: address => verifyProvider(address, {
                    fetch: net.fetch as unknown as FetchLike,
                    now: () => performance.now(),
                    after: (work, ms) => { const timer = setTimeout(work, ms); return () => { clearTimeout(timer); }; }
                }),
                now: () => performance.now()
            });
        } catch (error) {
            trace(dataDir, `request hub could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    return controller;
}
