# Analysis 03: how TestCord shows owner, admin, developer and user badges

Reference only, in our own words. Read in TestCord (commit `af92dbaec`): `src/plugins/_api/badges/index.tsx`
(lines 1-92, 109-234, 271-440), `src/utils/testcordAdmins.ts` (lists), `src/utils/misc.ts` (helpers).
Not read: `src/api/Badges.ts` (the registry), `modals.tsx`, the `globalBadges` plugin.

## 1. How it works
1. A badge is a small object: an id, a tooltip text, an icon, a position, and a `shouldShow(userId)` function.
2. The badge API patches Discord's profile-badge component so that, besides Discord's own badges, it also draws
   the client-side ones returned by `shouldShow`.
3. **Owner, admin, developer and artist badges** are decided by **hardcoded lists of Discord user IDs** inside
   the mod's code (`TestcordOwners`, `TestcordAdmins`, `TestcordDevelopers`, `TestcordArtists`). If the profile you
   are looking at has an ID in the list, your client draws that badge.
4. **"Testcord User" badge** (a heart): shown when the person's profile **pronouns contain the invisible
   character U+200B** (see analysis 02). Written by the badge API (`ensurePronounsMarker`) and by TestcordHelper,
   both honoring the `pronounsBadge` switch.
5. **Donor/custom badges:** three JSON lists are downloaded at start and every 30 minutes (`badges.vencord.dev`,
   `badge.equicord.org`, and a TestCord GitHub repo of badge images and `badges.json`).
6. Badge icons for owner/admin/dev are PNGs fetched from `raw.githubusercontent.com` (TestCord's `tbadges` repo)
   when shown. The artist icon is embedded in the code.
7. Badges only exist **on the screen of whoever runs the mod**. A person without the mod sees nothing. They cannot
   create real Discord badges.

## 2. What this means for Amiricord
- We can give both owners an "Amiricord Owner" badge with the same technique, with **no server and no marker**:
  a list of IDs in the code (`OWNERS` in `src/shared/project.ts` is already that list), a badge object, and an icon
  **bundled inside the mod** (no download).
- Other roles (developer, contributor, artist) = more lists, or a field per person in the same file.
- "Amiricord User" badge for everyone else = the profile marker we decided on (option C), distinct from TestCord's.
- Because the check runs locally and only on clients with the mod, TestCord users see nothing from this.
- We need our own artwork for the icons (owner, developer, user). Nothing is copied from TestCord's images.
- Network: zero. TestCord's version contacts GitHub and two badge servers; ours would not.

## 3. Things worth noting
- Hardcoded ID lists mean adding a person requires a new release. A local file read at start would allow adding
  people without rebuilding (but trusting a file raises the question of who may edit it).
- A badge list must never grant anything but a cosmetic icon. No privileges in the engine depend on being "owner".
