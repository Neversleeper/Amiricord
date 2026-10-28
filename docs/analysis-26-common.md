# Analysis 26: `ctx.common`, Discord's stores and dispatcher by name

Written 2026-10-25 for Neversleeper, before the code. What is not verified is marked.

## 1. Why
`@webpack/common` is the module TestCord plugins import most (602 of 828, analysis 37/25): it gives names such as `UserStore`, `ChannelStore`, `FluxDispatcher`. Without an equivalent, each plugin repeats `ctx.finders.byStore("UserStore")` by hand and a typo hides a miss. It needs no patch and no new Discord code, so it is the least risky engine piece.

## 2. What is built
- `src/api/commonStores.ts`: `buildCommon(finders)` returns an object whose properties are finders, one per name: the stores `UserStore`, `ChannelStore`, `GuildStore`, `GuildMemberStore`, `SelectedChannelStore`, `SelectedGuildStore`, `RelationshipStore`, `PresenceStore`, `MessageStore`, `PermissionStore`, `ReadStateStore`, `VoiceStateStore`, and `FluxDispatcher` (found by `byProps("dispatch","subscribe")`, the shape `flux` already uses).
- Each property is created the first time it is read and then kept, so a plugin pays only for the names it uses. A finder creates nothing in Discord and searches only when asked (`get`, `peek`, `require`, `ready`), so a miss is recorded against the plugin that asked, like any finder.
- `ctx.common` in the plugin context (`src/renderer/engine.ts`), built from the plugin's own finders.
- Small typed shapes for the methods most plugins call (`getCurrentUser`, `getUser`, `getChannel`, `getChannelId`, `getGuild`...). Every other method is reachable as `unknown` and the plugin states the type it expects.

## 3. Not built, on purpose
- `moment` and other non-store helpers of `@webpack/common`: how to find them reliably is not known; each will be added when a plugin needs it, with its own finder.
- React components (`Button`, `Text`...): they already have `src/api/common.ts`, with fallbacks.

## 4. Not verified
- That `byStore("<Name>")` finds each store in today's Discord (it is how Vencord names them; nothing here ran in Discord). A wrong name only records a miss.
- That the `PermissionStore`, `ReadStateStore` and `VoiceStateStore` names exist with those exact names in this build.
- That the typed method shapes match Discord's real signatures.

## 5. Shared files
`src/renderer/engine.ts` is a shared core file and `src/api` is shared: szlcx404 must be told before this is joined.
