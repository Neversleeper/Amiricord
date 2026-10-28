# Analysis 13: the `has_client_mods` self-test (piece P1 of design 05)

Written 2026-10-25, before the code. Read-only sources: `the owner's other project\analysis\senales-cliente.md` (the owner's earlier measurements, sections 6 to 6e) and
`testcord\src\plugins\_core\noTrack.ts`. Nothing was fetched or run. Everything the engine does here is written from scratch.

## 1. What the flag is and where it travels
Discord's client builds a small description of itself (operating system, version, language, build numbers...) and one of its fields is
`has_client_mods`, computed by a function that looks at the page's globals (`BetterDiscord`, `BdApi`, `rambox`, `Vencord`, `VencordNative`, `jQuery`, `$`).
The description travels in two places:
1. **The header `X-Super-Properties`** of every request to Discord's API (base64 of a JSON text), built from a function named `getSuperPropertiesBase64`.
2. **The first message the client sends on the gateway** (the WebSocket), the "identify" message, which has its own copy of the properties. In
   the owner's other project's measurement it was the first send of the start (1331 bytes at 3806 ms, against 2302 bytes for later identifies); the gateway message is **binary**
   (Erlang term format), where the flag is a short key followed by the atom `true` or `false`.
The detector exists in **three copies** inside Discord's code (the main module, `fast-connect.js` and `sentry.js`); the earliest properties come from the `fast-connect` copy.
Vencord's NoTrack patched only the main one, which is why the owner's other project needed to *measure*.

## 2. What can be observed from inside the page without storing anything private
| Observation | How | What is read | What is kept |
|---|---|---|---|
| The properties object | find Discord's module that exports `getSuperPropertiesBase64`, call it, decode | only the value after `has_client_mods` | `pass` / `fail` and the time |
| The first gateway messages | wrap `WebSocket.prototype.send` for a short while | for each of the first 40 sends or 60 s: look for the key and read the value after it | `pass` / `fail`, which send number, ms since the page script started; then `send` is put back |
The header check of the main process (check A of design 05) needs the request hub (P2); the reader written here is shared so it can be used there.

## 3. How the value is read (the one tricky piece)
A message is a string or a block of bytes. Both are turned into a text where every byte is one character (so nothing is decoded as a language), at most the first 64 KB.
1. **Text (JSON) form:** the key between quotes, a colon, then `true` or `false` (spaces allowed).
2. **Binary (Erlang term) form:** the key text, then one atom: tag byte `100` or `118` followed by a 2-byte length, or tag `115` or `119` followed by a 1-byte length, then the letters.
3. Anything else is **"found the key but could not read the value"** = not a pass.
The key may be missing (that is "not seen", not "pass"). The result is one of: `false` (pass), `true` (fail), `unreadable`, `missing`.

## 4. Decisions
- **A failure only reports.** The engine does not stop, change itself, or patch other copies on the strength of a failed check (design 02: the start-up check only reports). Fixes are chosen with the data.
- **"Not seen" is never a pass.** If the properties module is not found in time (we wait up to 60 s), or no gateway message carried the key in the first 40 sends, the result says *not seen* with the reason.
- **The watcher puts `send` back** the moment it has its answer, or at 40 sends or 60 s. If someone else wrapped `send` over ours meanwhile, ours stays in place as a plain pass-through (it cannot be removed safely) and says so.
- **Binary data that is not readable synchronously** (a `Blob`) is skipped and counted as "unreadable send".
- **Never breaks Discord:** the wrapper calls the original `send` first with the same `this` and arguments and returns exactly what it returns; every inspection is inside a `try`; an exception in our code is swallowed and reported once.
- **Privacy of the check itself:** nothing but the verdict, a send number and a time is stored or sent; no token, no message content, no other property is kept. The events go to the health report like every other event (text cut and redacted).
- **Where the answer shows:** the health report (new lines) and a new row **"Privacy check"** in the engine status block of the main tab (so the owner sees it at once in Canary).

## 5. What this does not prove (limits)
- It tells what **our page** sees and sends. It does not tell what Discord's server does with the flag, nor does it cover traffic of other processes.
- It does not cover the properties computed by `fast-connect` or `sentry` and used only inside those bundles, beyond what shows up in the first gateway message and the object we can reach.
- Whether our page script runs before Discord's first script is **not verified**. The watcher records its own start time and the number of the send in which the key appeared; a late watcher shows as "not seen", never as a pass.
- The finder for `getSuperPropertiesBase64` is a guess from the owner's other project's notes (not verified on the current build); a miss is reported as "not seen: the properties module was not found".

## 6. Tests planned
Reader: text and binary forms, `true`, `false`, missing, key without value, wrong tags, truncated input, huge input, spaces. Watcher: passes through arguments and result, finds the flag in the second send, stops at 40 sends and at the time limit, restores `send`, does not restore over someone else's wrapper, tolerates a throwing inspection, ignores `Blob`s. Orchestrator: both checks together, finder missing, later answer replaces "not seen". Health: new event recorded, worst result wins within a session, shown in the report, parsed back, survives bad data. Engine: the self-test starts when asked and not otherwise, the result reaches the bridge and the status. Mutation checks: key search past the limit, value read as pass when unreadable, `send` not restored, original return value changed, token or content stored.
