/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContextMenus, clickedThing, ContextMenuHub, MENU_CSS, MENU_WAIT_MS, type MenuPage } from "../src/api/contextMenus";
import { FakeElement, fakePage } from "./helpers/fakeDom";

function setup() {
    const world = fakePage();
    const styles: string[] = [];
    const reports: Array<{ plugin: string; source: string; error: unknown; }> = [];
    const hub = new ContextMenuHub(world.page as unknown as MenuPage, css => { styles.push(css); }, (plugin, source, error) => { reports.push({ plugin, source, error }); });
    return { ...world, hub, styles, reports };
}

/** Discord's menu, as far as the hub looks at it: a menu, a scroller, a group, an item with an icon and a label. */
function discordMenu() {
    const menu = new FakeElement("div", { role: "menu" });
    const scroller = new FakeElement("div");
    const group = new FakeElement("div", { role: "group" });
    const item = new FakeElement("div", { role: "menuitem", class: "item_x", id: "native-open", tabindex: "-1", "aria-label": "Open Image" });
    item.append(new FakeElement("svg"), new FakeElement("div", { class: "label_y" }, "Open Image"));
    group.append(item);
    scroller.append(group);
    menu.append(scroller);
    return { menu, scroller, group, item };
}

function rightClick(world: ReturnType<typeof setup>, target: FakeElement) {
    world.document.body.append(target);
    target.dispatchEvent({ type: "contextmenu", target });
}

describe("what was right-clicked", () => {
    it("finds the picture and the link above the element, and nothing else", () => {
        const link = new FakeElement("a"); link.href = "https://a.example/page";
        const image = new FakeElement("img"); image.src = "https://i.example/a.png";
        link.append(image);
        const inner = new FakeElement("span");
        image.append(inner);
        assert.deepEqual(clickedThing(inner as unknown as Element), { src: "https://i.example/a.png", href: "https://a.example/page" });
        assert.deepEqual(clickedThing(new FakeElement("div") as unknown as Element), { src: undefined, href: undefined });
        assert.deepEqual(clickedThing(null), { src: undefined, href: undefined });
    });

    it("prefers the address a video or picture is really showing, and ignores an empty one", () => {
        const video = new FakeElement("video"); video.src = "https://v.example/a.mp4"; video.currentSrc = "https://v.example/b.mp4";
        assert.equal(clickedThing(video as unknown as Element).src, "https://v.example/b.mp4");
        const empty = new FakeElement("img");
        assert.equal(clickedThing(empty as unknown as Element).src, undefined);
    });

    it("looks only a few levels up", () => {
        const image = new FakeElement("img"); image.src = "https://i.example/a.png";
        const chain = [image];
        for (let i = 0; i < 7; i++) { const child = new FakeElement("div"); chain[chain.length - 1].append(child); chain.push(child); }
        assert.equal(clickedThing(chain[5] as unknown as Element).src, "https://i.example/a.png", "five levels below");
        assert.equal(clickedThing(chain[6] as unknown as Element).src, undefined, "six levels below is too far");
    });

    it("counts the one picture next to or inside what was clicked when it is an overlay with no words, and guesses nothing else", () => {
        const wrapper = new FakeElement("div");
        const overlay = new FakeElement("a"); overlay.href = "https://cdn.example/file.png";
        const holder = new FakeElement("div"); const image = new FakeElement("img"); image.src = "https://media.example/file.png?width=400"; holder.append(image);
        wrapper.append(overlay, holder);
        assert.deepEqual(clickedThing(overlay as unknown as Element), { src: "https://media.example/file.png?width=400", href: "https://cdn.example/file.png" }, "beside, one level down");
        assert.equal(clickedThing(holder as unknown as Element).src, "https://media.example/file.png?width=400", "inside the clicked holder");
        // a link with words next to an emoji, a click on a name, and two pictures: nothing is guessed
        const line = new FakeElement("div"); const words = new FakeElement("a", {}, "read this"); words.href = "https://t.example/";
        const emoji = new FakeElement("img"); emoji.src = "https://e.example/smile.png"; emoji.className = "emoji";
        line.append(words, emoji);
        assert.deepEqual(clickedThing(words as unknown as Element), { src: undefined, href: "https://t.example/" });
        const row = new FakeElement("div"); const name = new FakeElement("span", {}, "someone"); const first = new FakeElement("img"); first.src = "https://a.example/1.png";
        row.append(name, first);
        assert.equal(clickedThing(name as unknown as Element).src, undefined, "a name is not a picture holder");
        const two = new FakeElement("div"); const bare = new FakeElement("a"); const x = new FakeElement("img"); x.src = "https://a.example/x.png"; const y = new FakeElement("img"); y.src = "https://a.example/y.png";
        two.append(bare, x, y);
        assert.equal(clickedThing(bare as unknown as Element).src, undefined, "two pictures, none chosen");
        // an emoji beside an empty overlay does not count as the picture
        const only = new FakeElement("div"); const bare2 = new FakeElement("a"); const e2 = new FakeElement("img"); e2.src = "https://e.example/x.png"; e2.className = "emoji";
        only.append(bare2, e2);
        assert.equal(clickedThing(bare2 as unknown as Element).src, undefined);
        // Discord shows a stand-in picture beside the real one while it loads: only the real one counts
        const frame = new FakeElement("div"); const link = new FakeElement("a"); const real = new FakeElement("img"); real.src = "https://m.example/real.gif"; real.className = "lazyImg";
        const stand = new FakeElement("img"); stand.src = "data:image/gif;base64,AAAA"; stand.className = "imagePlaceholder_ab12";
        frame.append(link, real, stand);
        assert.equal(clickedThing(link as unknown as Element).src, "https://m.example/real.gif");
        // too far: three parents up
        const far = new FakeElement("div"); const mid1 = new FakeElement("div"); const mid2 = new FakeElement("div"); const mid3 = new FakeElement("div"); const lone = new FakeElement("a"); const farImage = new FakeElement("img"); farImage.src = "https://f.example/f.png";
        far.append(mid1, farImage); mid1.append(mid2); mid2.append(mid3); mid3.append(lone);
        assert.equal(clickedThing(lone as unknown as Element).src, undefined);
    });

    it("takes the nearest picture and the nearest link, and an empty link is no link", () => {
        const outerLink = new FakeElement("a"); outerLink.href = "https://outer.example/";
        const innerLink = new FakeElement("a"); innerLink.href = "https://inner.example/";
        const outerMedia = new FakeElement("video"); outerMedia.src = "https://outer.example/v.mp4";
        const innerMedia = new FakeElement("img"); innerMedia.src = "https://inner.example/i.png";
        outerLink.append(innerLink); innerLink.append(outerMedia); outerMedia.append(innerMedia);
        assert.deepEqual(clickedThing(innerMedia as unknown as Element), { src: "https://inner.example/i.png", href: "https://inner.example/" });
        assert.equal(clickedThing(new FakeElement("a") as unknown as Element).href, undefined);
    });
});

describe("the right-click menu hub", () => {
    it("adds a plugin's items after Discord's own, with our own look, when the menu opens", async () => {
        const world = setup();
        const done: string[] = [];
        world.hub.add("P", "copy", click => click.src ? { label: "Copy Link", action: () => { done.push(click.src!); } } : null);
        const image = new FakeElement("img"); image.src = "https://i.example/a.png";
        rightClick(world, image);
        const native = discordMenu();
        world.document.body.append(native.menu);
        world.mutate();
        const ours = native.scroller.children[1];
        assert.equal(ours.getAttribute("role"), "group");
        assert.match(ours.className, /amiricord-menu-group/);
        const item = ours.children[0];
        assert.equal(item.getAttribute("role"), "menuitem");
        assert.equal(item.className, "amiricord-menu-item", "our own class only: nothing is copied from Discord's items");
        assert.equal(item.getAttribute("id"), null);
        assert.equal(item.getAttribute("aria-label"), null);
        assert.equal(item.querySelectorAll("svg").length, 0, "no icon");
        assert.equal(item.textContent, "Copy Link");
        assert.equal(native.group.children.length, 1, "Discord's group is left alone");
        assert.deepEqual(world.styles, [MENU_CSS]);
        item.dispatchEvent({ type: "click", target: item });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(done, ["https://i.example/a.png"]);
        const escape = world.document.events.find(event => event.type === "keydown");
        assert.equal(escape?.key, "Escape", "the menu is closed");
        assert.equal(world.timers.size, 0);
        assert.equal(world.observers.every(observer => observer.disconnected), true);
    });

    it("adds nothing, and does not touch the menu, when no plugin has anything for what was clicked", () => {
        const world = setup();
        world.hub.add("P", "copy", click => click.src ? { label: "x", action: () => undefined } : undefined);
        rightClick(world, new FakeElement("div"));
        const native = discordMenu();
        world.document.body.append(native.menu);
        world.mutate();
        assert.equal(native.scroller.children.length, 1);
        assert.deepEqual(world.styles, []);
    });

    it("decorates a menu only once, and only the menu that opened after the click", () => {
        const world = setup();
        world.hub.add("P", "a", () => [{ label: "One", action: () => undefined }, { label: "Two", action: () => undefined }]);
        const early = discordMenu();
        world.document.body.append(early.menu);
        rightClick(world, new FakeElement("div"));
        // A menu that was already open is taken for the one that was asked for: it is the first with the role.
        assert.equal(early.scroller.children.length, 2);
        assert.equal(early.scroller.children[1].children.map(item => item.textContent).join(","), "One,Two");
        world.mutate();
        assert.equal(early.scroller.children.length, 2, "a second look finds nothing new");
    });

    it("stops waiting when no menu comes, and does not decorate a menu that opens later by itself", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "One", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        assert.deepEqual([...world.timers.values()].map(timer => timer.ms), [MENU_WAIT_MS]);
        world.runTimers();
        assert.equal(world.observers.every(observer => observer.disconnected), true);
        const late = discordMenu();
        world.document.body.append(late.menu);
        world.mutate();
        assert.equal(late.scroller.children.length, 1);
    });

    it("gives every provider the click, keeps going when one fails, and reports it", () => {
        const world = setup();
        world.hub.add("Bad", "boom", () => { throw new Error("broken"); });
        world.hub.add("Good", "ok", () => ({ label: "Fine", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const native = discordMenu();
        world.document.body.append(native.menu);
        world.mutate();
        assert.equal(native.scroller.children[1].textContent, "Fine");
        assert.equal(world.reports.length, 1);
        assert.deepEqual([world.reports[0].plugin, world.reports[0].source], ["Bad", "context menu boom"]);
    });

    it("reports an item whose action fails, without breaking the page", async () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Go", action: () => { throw new Error("no"); } }));
        rightClick(world, new FakeElement("div"));
        const native = discordMenu();
        world.document.body.append(native.menu);
        world.mutate();
        const item = native.scroller.children[1].children[0];
        item.dispatchEvent({ type: "click", target: item });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(world.reports.length, 1);
        assert.equal(world.reports[0].source, "context menu item Go");
    });

    it("draws our own item at the end of the menu when Discord's has none to copy", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Alone", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const menu = new FakeElement("div", { role: "menu" });
        world.document.body.append(menu);
        world.mutate();
        assert.equal(menu.children[0].children[0].textContent, "Alone");
        assert.match(menu.children[0].children[0].className, /amiricord-menu-item/);
    });

    it("puts a label into a Discord item that has no nested label", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Flat", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const menu = new FakeElement("div", { role: "menu" });
        const group = new FakeElement("div", { role: "group" });
        group.append(new FakeElement("div", { role: "menuitem", class: "flat" }));
        menu.append(group);
        world.document.body.append(menu);
        world.mutate();
        assert.equal(menu.children[1].children[0].textContent, "Flat");
    });

    it("draws in the menu that is on screen and has items, not in a hidden or empty one found first", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Ours", action: () => undefined }));
        const hidden = new FakeElement("div", { role: "menu" });
        (hidden as unknown as { getBoundingClientRect(): { width: number; height: number; }; }).getBoundingClientRect = () => ({ width: 0, height: 0 });
        const empty = new FakeElement("div", { role: "menu" });
        const real = new FakeElement("div", { role: "menu" });
        const group = new FakeElement("div", { role: "group" });
        group.append(new FakeElement("div", { role: "menuitem", class: "item" }));
        real.append(group);
        world.document.body.append(hidden, empty, real);
        rightClick(world, new FakeElement("div"));
        world.mutate();
        assert.equal(hidden.children.length, 0, "the hidden menu is left alone");
        assert.equal(empty.children.length, 0, "the empty one is left alone while another has items");
        assert.equal(real.children.length, 2);
        assert.equal(real.children[1].children[0].textContent, "Ours");
    });

    it("never copies the classes of Discord's items, whatever state they are in", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Ours", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const menu = new FakeElement("div", { role: "menu" });
        const reactions = new FakeElement("div", { role: "group" });
        reactions.append(new FakeElement("div", { role: "menuitem", class: "reactionButton" }));
        const group = new FakeElement("div", { role: "group" });
        group.append(new FakeElement("div", { role: "menuitem", class: "item_a focused_b selected_c" }, "Reply"));
        menu.append(reactions, group);
        world.document.body.append(menu);
        world.mutate();
        const ours = menu.children[menu.children.length - 1].children[0];
        assert.equal(ours.className, "amiricord-menu-item");
        assert.equal(ours.textContent, "Ours");
    });

    it("removing a provider twice removes nobody else's", () => {
        const world = setup();
        const removeFirst = world.hub.add("P", "a", () => undefined);
        world.hub.add("P", "b", () => ({ label: "Still here", action: () => undefined }));
        removeFirst();
        removeFirst();
        rightClick(world, new FakeElement("div"));
        const native = discordMenu();
        world.document.body.append(native.menu);
        world.mutate();
        assert.equal(native.scroller.children[1].textContent, "Still here");
    });

    it("lets go of the first wait when the person right-clicks again", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "x", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        rightClick(world, new FakeElement("div"));
        assert.equal(world.observers[0].disconnected, true);
        assert.equal(world.observers[1].disconnected, false);
        assert.equal(world.timers.size, 1);
    });

    it("marks a menu it decorated, so a later right-click does not decorate it again", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "x", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const first = discordMenu();
        world.document.body.append(first.menu);
        world.mutate();
        assert.equal(first.menu.hasAttribute("data-amiricord-menu"), true);
        rightClick(world, new FakeElement("div"));
        world.mutate();
        assert.equal(first.scroller.children.length, 2, "the old menu is left as it is");
        const second = discordMenu();
        world.document.body.append(second.menu);
        world.mutate();
        assert.equal(second.scroller.children.length, 2, "the new menu is decorated");
        assert.deepEqual(world.styles, [MENU_CSS], "and the style is added once");
    });

    it("reports a menu it could not draw in, and leaves it alone", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "x", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const menu = new FakeElement("div", { role: "menu" });
        menu.append = () => { throw new Error("nope"); };
        world.document.body.append(menu);
        world.mutate();
        assert.equal(world.reports.length, 1);
        assert.deepEqual([world.reports[0].plugin, world.reports[0].source], ["engine", "context menu"]);
    });

    it("keeps only the first text of Discord's item, and none of its icon", () => {
        const world = setup();
        world.hub.add("P", "a", () => ({ label: "Ours", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        const menu = new FakeElement("div", { role: "menu" });
        const group = new FakeElement("div", { role: "group" });
        const item = new FakeElement("div", { role: "menuitem", class: "item" });
        const icon = new FakeElement("svg");
        icon.append(new FakeElement("path"));
        item.append(icon, new FakeElement("div", {}, "Label"), new FakeElement("div", {}, "Ctrl+C"));
        group.append(item);
        menu.append(group);
        world.document.body.append(menu);
        world.mutate();
        const ours = menu.children[1].children[0];
        assert.equal(ours.textContent, "Ours");
        assert.equal(ours.querySelectorAll("svg").length, 0);
        assert.equal(ours.querySelectorAll("path").length, 0);
        assert.equal(ours.children.length, 0, "only our text");
    });

    it("does not listen before a plugin adds something, and stops listening when the last provider goes", () => {
        const world = setup();
        assert.equal(world.document.querySelectorAll("*").length, 1);
        const remove = world.hub.add("P", "a", () => ({ label: "x", action: () => undefined }));
        rightClick(world, new FakeElement("div"));
        assert.equal(world.observers.length, 1);
        remove();
        remove();
        assert.equal(world.observers[0].disconnected, true);
        const before = world.observers.length;
        world.document.body.children[0].dispatchEvent({ type: "contextmenu", target: world.document.body.children[0] });
        assert.equal(world.observers.length, before, "nobody listens any more");
    });

    it("ignores a right-click that has no element, or that nobody wants to answer", () => {
        const world = setup();
        world.hub.add("P", "a", () => undefined);
        world.document.dispatchEvent({ type: "contextmenu", target: null });
        world.document.dispatchEvent({ type: "contextmenu", target: "not an element" });
        assert.equal(world.observers.length, 0);
    });

    it("takes a plugin's providers away when the plugin stops", () => {
        const world = setup();
        const undo: Array<() => void> = [];
        const menus = buildContextMenus(world.hub, "P", fn => { undo.push(fn); });
        menus.add("a", () => ({ label: "x", action: () => undefined }));
        assert.equal(undo.length, 1);
        undo[0]();
        rightClick(world, new FakeElement("div"));
        assert.equal(world.observers.length, 0);
    });
});
