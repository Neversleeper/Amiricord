# Amiricord registry (Cloudflare Worker)

Remembers which Discord accounts use Amiricord, so every Amiricord can draw the "Amiricord User" badge on them without anything in their profile.

- `POST /register` with `{"id": "<discord user id>"}`: stores the id (a known id is not written again).
- `GET /users`: the ids, one per line (kept in the edge cache for 10 minutes).

It stores only ids. It cannot check that the sender owns the id, so anyone could register someone else's id; the worst that does is show a badge on that account. No GitHub token and no secret is involved.

## Deploy (once, by the project owner)
1. Create a free Cloudflare account at dash.cloudflare.com (no card needed).
2. In this folder run, in order:
   ```
   npx wrangler login
   npx wrangler kv namespace create USERS
   ```
   Paste the `id` it prints into `wrangler.toml` (replace `PUT_THE_ID_THAT_WRANGLER_PRINTED_HERE`).
3. `npx wrangler deploy`. It prints the address, like `https://amiricord-registry.<name>.workers.dev`. Give that address to the engine (`REGISTRY_URL` in `src/shared/project.ts`).

## Limits of the free plan (checked from memory, confirm in the dashboard)
About 100 000 requests a day and 1 000 new ids written a day. If a limit is passed, the service refuses until the next day; nothing is charged.
