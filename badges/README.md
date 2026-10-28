# Badges

`badges.json` is the list of badges the owners hand out. People who use Amiricord download it from this repository's `main` branch (when Amiricord starts and every
30 minutes) and draw the badges on the profiles listed in it. Nobody else sees them: Discord knows nothing about these badges.

Change it with `pnpm badges` (see `scripts/badges.ts`); do not edit by hand unless you know the format:

```
pnpm badges define staff "Amiricord Staff" C:\pictures\staff.png
pnpm badges give 123456789012345678 staff
pnpm badges take 123456789012345678 staff
pnpm badges remove staff
pnpm badges list
```

Then publish with the git command it prints. Only a person who can push to `main` can change anyone's badges.

- A picture is a `.png`, `.webp`, `.gif`, `.jpg` or `.svg` of at most 150 KB, kept in `icons/`. Square pictures look best (Discord draws badges about 22 px wide).
- A person's id is the long number from Discord's "Copy User ID" (turn on Developer Mode in Discord's settings first).
- A badge nobody has is never downloaded. At most 60 badges, 2000 people and 6 badges each are read.
- The "Amiricord Owner" badge does not come from this list: the owners' ids are in `src/shared/project.ts`.
- "Amiricord User" is not in this list either: people get it from the invisible mark the Badges plugin adds to their own pronouns.
