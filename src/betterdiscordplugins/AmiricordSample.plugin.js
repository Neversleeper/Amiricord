/**
 * @name Amiricord Sample
 * @author Neversleeper
 * @version 1.0.0
 * @description A small plugin in BetterDiscord's format, made to try Amiricord's BetterDiscord support: it counts how many times it was switched on, shows a message, and has a setting that rounds the corners of Discord's buttons.
 * @source https://github.com/Neversleeper/Amiricord
 */

/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

module.exports = class AmiricordSample {
    constructor(meta) {
        this.name = meta.name;
        this.api = new BdApi("Amiricord Sample");
    }

    start() {
        const starts = (this.api.Data.load("starts") || 0) + 1;
        this.api.Data.save("starts", starts);
        this.apply();
        this.api.UI.showToast(`Amiricord Sample is on (switched on ${starts} time${starts === 1 ? "" : "s"})`, { type: "success" });
    }

    stop() {
        this.api.DOM.removeStyle("amiricord-sample");
        this.api.Patcher.unpatchAll();
    }

    apply() {
        if (this.api.Data.load("roundButtons")) {
            this.api.DOM.addStyle("amiricord-sample", "button { border-radius: 999px !important; }");
        } else {
            this.api.DOM.removeStyle("amiricord-sample");
        }
    }

    getSettingsPanel() {
        return this.api.UI.buildSettingsPanel({
            settings: [
                { type: "switch", id: "roundButtons", name: "Round buttons", note: "Gives Discord's buttons fully rounded corners.", value: Boolean(this.api.Data.load("roundButtons")) }
            ],
            onChange: (_category, id, value) => {
                this.api.Data.save(id, value);
                this.apply();
            }
        });
    }
};
