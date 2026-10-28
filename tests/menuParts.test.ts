/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { locateMenuParts, readMenuModule } from "../src/api/menuParts";

// A module shaped like the one of Discord's Menu (same words, our own names and numbers): the exports, the import of the barrel, the Menu function and the code that
// compares what it is given with the barrel's markers.
const MENU_SOURCE = [
    "900(e,t,n){\"use strict\";n.d(t,{Zed:()=>MenuLoader,Wq:()=>Menu2}),n(1);var i,r=n(2),a=n(3),Q$=n(777),z=n(5);",
    "function Menu2(e){let{navId:t,variant:n=\"flexible\",hideScroller:i=!1,className:s,children:o,onClose:_}=e,h=function e(t){return list(t).reduce((t,n)=>{",
    "if(n.type===Q$.sepName)return t.push({type:\"separator\",navigable:!1}),t;",
    "if(n.type===Q$.grpName){let i=e(n.props.children);return i.length>0&&(t.push({type:\"groupstart\",length:i.length}),t.push(...i)),t}",
    "if(n.type===Q$.itmName)return t.push(null!=n.props.render?{type:\"customitem\",key:n.props.id}:{type:\"item\",key:n.props.id}),t;",
    "if(n.type===Q$.chkName)return t.push({type:\"checkbox\",key:n.props.id,props:n.props}),t;",
    "},[])}(o)}function MenuLoader(){return null}}"
].join("");

const facts = () => readMenuModule(MENU_SOURCE)!;

describe("reading the module of Discord's Menu", () => {
    it("finds the Menu function and its export, the module of the markers and the export of each marker", () => {
        assert.deepEqual(facts(), { component: "Menu2", exportName: "Wq", barrelId: "777", separator: "sepName", group: "grpName", item: "itmName", checkbox: "chkName" });
    });

    it("knows names that contain a dollar sign", () => {
        const f = facts();
        assert.equal(f.barrelId, "777", "the barrel is called Q$ in this source");
    });

    it("answers undefined when any word of the shape is missing", () => {
        for (const part of ["hideScroller", "\"flexible\"", "type:\"separator\"", "type:\"groupstart\"", "type:\"customitem\"", "type:\"checkbox\"", "Q$=n(777)", "Wq:()=>Menu2"]) {
            assert.equal(readMenuModule(MENU_SOURCE.replace(part, "x")), undefined, part);
        }
        assert.equal(readMenuModule(""), undefined);
        assert.equal(readMenuModule("function a(e){return e}"), undefined);
    });

    it("does not take another module's export for the Menu's", () => {
        const other = MENU_SOURCE.replace("Wq:()=>Menu2", "Wq:()=>Other");
        assert.equal(readMenuModule(other), undefined);
    });
});

function view(modules: Record<string, { source: string; exports: unknown; }>, ran: string[] = []) {
    return {
        ids: () => Object.keys(modules),
        sourceOf: (id: string) => modules[id]?.source,
        exportsOf: (id: string, load: boolean) => { if (load) ran.push(id); return modules[id]?.exports; }
    };
}

const marker = () => (() => null);

function world(over: { menu?: unknown; barrel?: Record<string, unknown>; } = {}) {
    const markers = { sepName: marker(), grpName: marker(), itmName: marker(), chkName: marker() };
    const Menu = () => null;
    const ran: string[] = [];
    const v = view({
        1: { source: "function(){var unrelated=1}", exports: {} },
        900: { source: MENU_SOURCE, exports: { Wq: "menu" in over ? over.menu : Menu } },
        777: { source: "function(){}", exports: over.barrel ?? markers }
    }, ran);
    return { v, markers, Menu, ran };
}

describe("locating Discord's menu pieces", () => {
    it("gives the real Menu and the four markers, and runs only the Menu's module and its barrel", () => {
        const w = world();
        const parts = locateMenuParts(w.v)!;
        assert.equal(parts.Menu, w.Menu);
        assert.equal(parts.MenuSeparator, w.markers.sepName);
        assert.equal(parts.MenuGroup, w.markers.grpName);
        assert.equal(parts.MenuItem, w.markers.itmName);
        assert.equal(parts.MenuCheckboxItem, w.markers.chkName);
        assert.deepEqual(w.ran.sort(), ["777", "900"], "the unrelated module is never run");
    });

    it("answers undefined when a piece is missing or is not a component", () => {
        assert.equal(locateMenuParts(world({ menu: undefined }).v), undefined);
        assert.equal(locateMenuParts(world({ menu: "text" }).v), undefined);
        assert.equal(locateMenuParts(world({ barrel: { sepName: marker(), grpName: marker(), itmName: marker() } }).v), undefined);
        assert.equal(locateMenuParts(world({ barrel: {} }).v), undefined);
    });

    it("answers undefined when no module has the shape, and skips a module that fails to read or to run", () => {
        assert.equal(locateMenuParts(view({ 1: { source: "nothing", exports: {} } })), undefined);
        const w = world();
        const broken = {
            ids: () => ["bad", "900", "777"],
            sourceOf: (id: string) => { if (id === "bad") throw new Error("no"); return w.v.sourceOf(id); },
            exportsOf: w.v.exportsOf
        };
        assert.ok(locateMenuParts(broken));
        const failing = { ...w.v, exportsOf: (id: string) => { if (id === "777") throw new Error("no"); return w.v.exportsOf(id, true); } };
        assert.equal(locateMenuParts(failing), undefined);
    });

    it("skips a module that only has some of the words", () => {
        const some = view({ 5: { source: "hideScroller \"flexible\"", exports: {} } });
        assert.equal(locateMenuParts(some), undefined);
    });
});

describe("the real code of Discord's Menu module (only when a probe dump of it is on this machine)", () => {
    const dump = "probe/module-source-980707.json";
    it("is read the same way", { skip: !existsSync(dump) }, () => {
        const f = readMenuModule(readFileSync(dump, "utf8"));
        assert.ok(f, "the shape of the real module is still the one this reads");
        assert.match(f.barrelId, /^\d+$/);
        for (const name of [f.component, f.exportName, f.separator, f.group, f.item, f.checkbox]) assert.match(name, /^[\w$]+$/);
        assert.equal(new Set([f.separator, f.group, f.item, f.checkbox]).size, 4, "four different markers");
    });
});
