/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage:
//   pnpm badges list
//   pnpm badges define <name> "<text shown on the badge>" <path to a picture>   (png, webp, gif, jpg or svg, up to 150 KB; the picture is copied into badges/icons/)
//   pnpm badges give <discord user id> <name>
//   pnpm badges take <discord user id> <name>
//   pnpm badges remove <name>
// It edits `badges/badges.json` and `badges/icons/` in this folder and prints the git commands that publish the change. It publishes nothing itself: the list is
// what Amiricord users download (the Badges plugin reads it from the repository's main branch, at start and every 30 minutes), so only a person who can push to
// that branch can change anyone's badges. The owners' own badge ("Amiricord Owner") does not come from this list.

import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_ICON_BYTES } from "../src/shared/badgeList";
import { defineBadge, describeList, type Edit, EMPTY_LIST, giveBadge, pictureExtension, removeBadge, takeBadge } from "./badgeEditor";

const root = fileURLToPath(new URL("../", import.meta.url));
const listPath = join(root, "badges", "badges.json");
const iconsDir = join(root, "badges", "icons");

const USAGE = [
    "pnpm badges list",
    "pnpm badges define <name> \"<text shown on the badge>\" <path to a picture>",
    "pnpm badges give <discord user id> <name>",
    "pnpm badges take <discord user id> <name>",
    "pnpm badges remove <name>"
].join("\n  ");

const readList = () => readFile(listPath, "utf8").catch(() => EMPTY_LIST);

async function save(edit: Edit): Promise<number> {
    if ("error" in edit) {
        console.error(`Nothing was changed: ${edit.error}.`);
        return 1;
    }
    await mkdir(join(root, "badges"), { recursive: true });
    await writeFile(listPath, edit.text);
    console.log(edit.message);
    console.log("\nTo publish it (the main branch is what people download):\n");
    console.log("  git add badges && git commit -m \"Badges: update the list\" && git push origin HEAD:main\n");
    return 0;
}

async function main(args: string[]): Promise<number> {
    const [command, ...rest] = args;
    switch (command) {
        case "list":
            console.log(describeList(await readList()));
            return 0;
        case "define": {
            const [key, tooltip, source] = rest;
            if (!key || !tooltip || !source) return fail();
            const extension = pictureExtension(source);
            if (extension === null) return refuse("the picture must be a .png, .webp, .gif, .jpg or .svg file");
            const size = await stat(source).then(info => info.size, () => -1);
            if (size < 0) return refuse(`there is no file at ${source}`);
            if (size > MAX_ICON_BYTES) return refuse(`the picture is ${Math.ceil(size / 1024)} KB; the limit is ${MAX_ICON_BYTES / 1024} KB`);
            const iconName = `${key}.${extension}`;
            const edit = defineBadge(await readList(), key, tooltip, iconName);
            if ("error" in edit) return save(edit);
            await mkdir(iconsDir, { recursive: true });
            await copyFile(source, join(iconsDir, iconName));
            console.log(`Copied ${basename(source)} to badges/icons/${iconName}.`);
            return save(edit);
        }
        case "give":
            return rest.length === 2 ? save(giveBadge(await readList(), rest[0], rest[1])) : fail();
        case "take":
            return rest.length === 2 ? save(takeBadge(await readList(), rest[0], rest[1])) : fail();
        case "remove": {
            if (rest.length !== 1) return fail();
            const edit = removeBadge(await readList(), rest[0]);
            const code = await save(edit);
            if (code === 0 && "icon" in edit && edit.icon) await rm(join(iconsDir, edit.icon), { force: true });
            return code;
        }
        default:
            return fail();
    }
}

function fail(): number {
    console.error(`Usage:\n  ${USAGE}`);
    return 1;
}

function refuse(reason: string): number {
    console.error(`Nothing was changed: ${reason}.`);
    return 1;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
