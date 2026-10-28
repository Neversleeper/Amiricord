/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage: pnpm release      (after pnpm build)
// Makes the folder `release/` with the four engine files and `update.json` (their SHA-256, the size and the news), and prints the command that publishes it on GitHub.
// It publishes nothing itself: the owner runs the printed command. The version is the one of package.json and NEWS.json must have an entry for it.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { UPDATE_REPO } from "../src/shared/project";
import { UPDATE_FILES } from "../src/shared/updates";
import { makeRelease } from "./releaseManifest";

const root = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<number> {
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string; };
    const files: Record<string, Uint8Array> = {};
    for (const name of UPDATE_FILES) files[name] = await readFile(join(root, "dist", name)).catch(() => new Uint8Array());
    const newsText = await readFile(join(root, "NEWS.json"), "utf8").catch(() => "");

    const release = makeRelease({ version, files, newsText });
    if (Array.isArray(release)) {
        console.error("The release was not made:");
        for (const problem of release) console.error(`  - ${problem}`);
        return 1;
    }

    const folder = join(root, "release");
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    for (const name of UPDATE_FILES) await copyFile(join(root, "dist", name), join(folder, name));
    await writeFile(join(folder, "update.json"), release.manifestText);

    const title = release.manifest.news.find(entry => entry.version === version)?.title ?? version;
    console.log(`Release ${version} is ready in release/ (${UPDATE_FILES.length} files and update.json).`);
    console.log("To publish it, with the GitHub CLI logged in as an owner:\n");
    console.log(`  gh release create v${version} release/* --repo ${UPDATE_REPO} --title "Amiricord ${version}: ${title.replace(/"/g, "'")}" --notes "See the Updates tab."\n`);
    console.log("People then press \"Check for updates\" in Amiricord's settings. The repository must be public for them to read it.");
    return 0;
}

main().then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
