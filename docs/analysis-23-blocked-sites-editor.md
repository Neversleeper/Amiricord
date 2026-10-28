# Analysis 23: adding and removing blocked sites from the Privacy & Security tab (P7b, second part)

Written on 2026-10-26 for the owners' approval. No code yet. The rules themselves exist since P4c (`analysis-17-host-rules.md`: block rules only, Discord's own hosts refused
by our editor, up to 10 000 rules, `firewall.json` in the folder of each Discord, matched by walking up the labels of the host). Until now the only way to add one was to edit the
file by hand. This note adds the editor in the tab, using the channel of P7b (`privacy-change`, analysis 22 section 10). Everything is written from scratch.

## 1. What exists (checked in the code)

| Piece | Where | State |
|---|---|---|
| Checks and edits of the list | `src/shared/hostRules.ts`: `normalizeHost`, `addRule`, `removeRule`, `makeHostMatcher`, `PROTECTED_HOSTS`, `HOST_RULE_LIMITS` | ready and tested (add refuses an invalid host, a Discord host, a duplicate, too many rules, a reason over 200 characters) |
| The file | `src/main/hostRulesFile.ts`: `loadHostRules`, `saveHostRules` (temporary file and rename) | ready |
| The list in force | `electronGlue.ts`: `owned.rules` read once at start; the firewall gets `blockedBy: makeHostMatcher(owned.rules)` | **fixed at start**: the matcher is built once |
| The snapshot | `privacy` channel carries the first 200 rules (host, subdomains flag, reason, id) and the total | ready, read only |
| The tab | "Blocked sites" card: a list, "None", and a sentence saying editing comes next | read only |

## 2. What the editor does

**In the tab** (card "Blocked sites"): a text field "Site (for example `ads.example.com`)", a switch "Also block everything under it" (on by default, like the file), an optional field "Why"
(at most 200 characters), and a button "Block site". Each row of the list gets a "Remove" button. After each action the card shows one plain sentence ("Blocked.", "That site is
already in the list.", "Discord's own sites cannot be blocked from here, they would stop Discord.", "Not a plain site name.", ...). Nothing the person typed is repeated in a sentence.

**Which changes ask the person.** Adding a block **strengthens** protection, so it is kept at once. Removing a block **weakens** it, so the main process asks first, in the same
native window as the other changes: "Stop blocking <host>? Discord and plugins will be able to reach it again." with the buttons "Stop blocking" and "Cancel".

**Channel.** Two more kinds of change in `privacy-change`: `{ type: "rule-add", host, subdomains, reason }` and `{ type: "rule-remove", id }`. Both rebuilt field by field in
`parsePrivacyChange` (host and reason as text with limits, `subdomains` a boolean, `id` a short plain id). The main process uses `addRule` and `removeRule`, never the page's list,
and the page can only name a rule by an id the main process made.

**Taking effect at once.** After a change is saved the matcher of the firewall is replaced (the firewall is given a small function that asks the current matcher, so no restart is
needed), and the next snapshot shows the new list. The counter "Blocked by your rules" keeps counting across changes in the same session.

## 3. Safety

1. **Never overwrite a file the engine could not read.** If `firewall.json` existed but could not be read, or some of its rules were dropped at load (invalid host, a Discord host kept
   with a warning, over the limit), saving would silently rewrite the owner's hand-written file. So: (a) the first save of a session first copies the existing file to
   `firewall.json.before-tab` (once, only if it exists, never replacing an older copy), and (b) if the file **could not be read at all**, the editor refuses with "firewall.json could
   not be read. Fix or rename it first." and changes nothing.
2. **A page or plugin that adds rules.** Blocking a site can only make something stop working, never leak anything, so adding needs no question. The limits are the file's limits (10 000 rules,
   Discord's hosts refused). One change at a time (already the rule of the changer). Not solved: a plugin sharing the page could add many rules to break another plugin; the person
   can see and remove them in the list. Said openly, not hidden.
3. **No data kept.** A rule holds the host, the flag, the reason the person typed and the time; nothing about requests. Sentences never include what was typed.
4. **Fail rule.** If saving fails the list in force is not changed, so what the person sees is what is in force.

## 4. Not in this step

Editing an existing rule (remove and add again), importing or exporting the list, "allow" rules, wildcards, rules made from a log entry ("Always block this host" is part of P7c, the
activity log), a bigger list than the first 200 rows (the card says how many more there are, as today).

## 5. Tests and checks

Pure code, tested with fakes: the parser of the two new kinds (every field, every limit), the changer (adds without asking; removal asks and only goes on if agreed; each refusal reason and its
sentence; the unreadable-file refusal; the one-time copy of the old file; save failure leaves the list unchanged; one at a time), the snapshot after a change, the tab (field, switch, reason,
button, remove asks nothing itself, sentences shown, the list refreshes). Mutation check as always. Not verifiable without the owner's Stable: the native window for a removal, the live swap
of the matcher in `electronGlue.ts`, and a real blocked request after adding a site (to be seen with a harmless test host chosen by the owner).

## 6. Questions for the owners (my proposal first)

1. Removing asks first, adding does not? (proposed: yes)
2. "Also block everything under it" on by default? (proposed: yes, as in the file)
3. The "Why" field optional? (proposed: yes, up to 200 characters)
4. Copy the old file to `firewall.json.before-tab` before the first save, and refuse to save when the file could not be read? (proposed: yes, both)
5. Anything else you want in this card now, or is "edit by remove and add again" enough? (proposed: enough for now)
