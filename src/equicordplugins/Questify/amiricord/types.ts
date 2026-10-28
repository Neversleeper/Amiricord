/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NativeFunctions } from "../../../api/native";
import type { PluginCode } from "../../../renderer/engine";
import type { DefinedSettings as Defined, VencordDefinition } from "./settings";

export { OptionType } from "./settings";
export type SettingsDefinition = VencordDefinition;
export type DefinedSettings<D extends VencordDefinition = VencordDefinition> = Defined<D>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a plugin may carry any extra field of the original
export type Plugin = PluginCode & Record<string, any>;

export type PluginNative<T> = NativeFunctions<T> & {
    canOpenDevTools: () => Promise<boolean>;
    openDevTools: () => Promise<boolean>;
};
