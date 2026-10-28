# Analysis 44: all 468 plugins of TestCord's `testcordplugins`, sorted by what each one needs

Written 2026-10-26 for szlcx404. The owner asked to analyse every plugin in `testcord\src\testcordplugins` and adapt them to Amiricord's own API. This note is the first step (rule: analysis first, one step at a time). **Read-only:** a script read the text of each plugin folder (entry file and the rest of its `ts`, `tsx`, `css`, `json` files) in the local TestCord copy; nothing was run, installed or copied into the repository. Every number comes from text matching on the code, so it is an estimate; the lists say which plugin falls where, so any single decision can be checked by hand.

## 1. What is in the folder
- 468 folders. 466 have an `index.ts(x)` entry; `deleteMe` and `_kamidereCompat` have none.
- 447 entry files carry `GPL-3.0-or-later`; 21 carry no licence header (listed in section 7). GPL-3.0-or-later is compatible with Amiricord, but credits of the original authors must stay in every adapted plugin.

## 2. What Amiricord has today (checked in `src/api`, 2026-10-26)
Plugin settings, styles, `flux`, `ctx.common` (12 stores), `ctx.modals`, `ctx.components` (Discord's with our fallbacks), `ctx.storage`, `ctx.secrets`, `ctx.native` (bridge to the main process, limited to declared hosts), finders, patches, plugin cards and the switch. **Missing:** context menu, slash commands, header bar, chat-bar buttons, notifications and toasts, message events, member-list and server-list decorations, badges.

## 3. The result
| Bucket | Meaning | Plugins |
|---|---|---|
| A | Needs only what exists, no patches, no native part | 80 |
| B | Needs only what exists but has a native (main process) part | 11 |
| P | Needs only what exists but has patches (tied to Discord's current code) | 76 |
| N1 | Needs exactly one engine piece that does not exist yet | 132 |
| N2 | Needs two or more engine pieces that do not exist yet | 93 |
| H | Held back: needs the owners' decision (section 4) | 76 |

N1 split by the missing piece: ContextMenu 38, Commands 31, Notifications 18, Toasts 17, HeaderBar 12, MessageEvents 7, MemberList 5, ChatButtons 3, Badges 1. (Toasts is TestCord's small pop-up, part of the notification family.)

## 4. Held back (my proposal; the owners decide)
I did not read these to adapt them. My reason, in each group, is what the plugin does to the account or to other people, not that the code is hard. Some groups are fine to adapt once you say so (for example local-only visual fakes); others I would not adapt in any case. The list comes from names and descriptions plus keyword matches, so a plugin may be here by mistake, and others may belong here that I did not catch.

**Bypasses age or content checks** (3):
NoAgeVerif, nsfwGateBypass, setAge

**Reads, shows, imports or stores account tokens** (9):
apisniper, DXTokenImporter, getMyToken, ghostClient, GhostSelfbot, rotatorSuite, testcordosinttoolkit, token, tokenImporter

**Automates the account (mass send, auto reply, sniping, auto actions, running code)** (37):
AutoBumpSelf, autoChannelReact, autoClaim, autoDeleteDms, autoDeleter, AutoMessageRepeater, AutoMessageSender, AutoReact, autoRedeem, autoReply, AutoReplyContent, bulkFriendRemove, disconnect, dmAway, dontLimitMe, eval, gctrap, gifSpammer, greedcmds, huskbot, KFOCleanupSuite, MassDM, messageCleaner, messageScheduler, NitroSniper, noOnboarding, owoself, punishmentcommands, purgeMessages, remoteControl, repeatMessage, rPunisher, runInConsole, sendtoalldms, shareVCBan, stickymessages, UserTools

**Fakes identity, messages, badges, permissions or platform** (18):
BadgeSpoofer, BetterGodMode, FakeAccounts, fakeDM, fakeFriends, fakePerm, FakeProfile, fakeurl, fakeUserProfile, FakeUserSwitcher, FakeVoicePremium, impersonate, mimicTroll, osSpoofer, overlayFix, PlatformEmulator, spoofmsgv2, systemMessageSpoofer

**Hides or undoes deletions (anti-log) and message loggers** (6):
AntiAntilog, antiDeleteMessage, AntilogPremium, messageLoggerTestcord, SilentEdit, timeAlog

**Other: not a normal plugin or already ruled out** (3):
_kamidereCompat, deleteMe, TestcordHelper

My own view per group: (1) age bypass: no. (2) tokens: no; Amiricord's token guard exists to keep the token away from plugins. (3) automation of the account (sending on a timer, mass messages, sniping, auto actions, running typed code): no, these are what Discord bans accounts for and what hurts others. Exceptions to discuss: `messageScheduler`, `stickymessages`, `repeatMessage`, `purgeMessages` (your own messages only). (4) fakes: only the ones that are visibly local (for example `fakePerm`, `fakeFriends`) could be discussed; fake messages, fake system messages, impersonation and badges that look real to others: no. (5) anti-log and loggers: loggers of other people's deleted messages are a privacy decision; `ghostPingAlert` is not held back. (6) `TestcordHelper` was left out from the start (CONTEXTO decisions).

## 5. Plugins by bucket
### A: ready to adapt (no patches, no native part)
Flags: `net` = the code seems to use the network (needs declared hosts in the manifest), `dom` = touches the page directly (fragile), `desktop` = mentions a desktop-only condition.

- `amrpcStatusDisplayType.desktop` (1 files, 2 KB): What to show instead of the generic listening message
- `animalese` (1 files, 8 KB) [net, dom]: Volume of the animalese sound
- `antiDeco` (1 files, 10 KB): Automatically reconnects to voice channel in case of forced disconnection
- `antiNickname` (1 files, 4 KB): Show a notification when a forced nickname is removed
- `askMeToMute` (1 files, 2 KB): Mute yourself when moderators server mute you, and automatically remove your server mute if you have permissi…
- `AutoThemeSwitcher` (8 files, 21 KB): Automatically switches between themes based on the time of day, or based on system appearance (ie. light/dark…
- `autoTranslateNightcord` (1 files, 47 KB): Automatic translation for Testcord.
- `autoUnmute` (1 files, 9 KB): Automatically unmutes and undeafens when server mute/deafen occurs if you have permissions (no notifications)
- `betterJoinedDate` (1 files, 2 KB): Add a tooltip to the joined date showing the exact time and how many days ago it was
- `bypassAccounts` (1 files, 35 KB) [dom]: Enable Alt+G hotkey to quickly open account switcher
- `ClanSwitcher` (1 files, 3 KB) [net]: Clan IDs (comma-separated)
- `ClassHighlighter` (2 files, 17 KB) [dom]: Toggle Highlighter
- `clickSparkles` (2 files, 2 KB) [dom]: Sprinkles little neon sparkles wherever you click.
- `compactCompose` (2 files, 1 KB): Slims down the message box and hides the upload/gift clutter until you focus it.
- `contextMenuSelectFix` (1 files, 2 KB) [dom]: Releasing right click when hovering over a context menu entry selects it, bringing the behaviour in line with…
- `crtEffect` (2 files, 1 KB): Overlays retro CRT scanlines on the client for that old-monitor vaporwave look.
- `CustomStreamPreview` (3 files, 17 KB) [net, dom]: Set a custom image as your Discord stream preview.
- `DecibelLimiter` (1 files, 11 KB): Enable DecibelLimiter
- `detectBlock` (5 files, 33 KB) [net]: Show the blocked user warning modal
- `DiscordLock` (1 files, 19 KB) [net, dom]: Unlock password
- `dmReadReceipt` (1 files, 2 KB): Shows a Seen indicator on your messages in DMs when the other person has read them.
- `doubleEmoji` (1 files, 1 KB) [dom]: Keeps the emoji picker open on click and highlights selected emojis with a blue border.
- `DynamicIslande` (2 files, 57 KB) [dom]: Choose the Dynamic Island color.
- `embeddedURLs` (1 files, 2 KB) [net]: Turns plain social links into embeddable URLs so posts and videos are fully viewable in Discord instead of fo…
- `fakeConnections` (2 files, 15 KB) [net]: Text color for connection names on your profile
- `FakeIndicators` (1 files, 0 KB): Placeholder plugin scaffold for fake indicators.
- `fastPing` (2 files, 6 KB) [dom]: Double-click a user ID you just typed in the chat box to instantly turn it into a <@mention>.
- `fileSplitter` (2 files, 12 KB) [dom]: Chunk size in MB (1-100)
- `FollowMajority` (1 files, 4 KB): Percentage of your channel that has to move before you follow.
- `glassPanels` (2 files, 1 KB): Frosted-glass blur on the sidebar and member list.
- `gridFloor` (2 files, 1 KB): Scrolling retro grid floor along the bottom of the window.
- `HasStrip` (1 files, 5 KB) [dom]: Removes :has() stylesheet rules to reduce style recalculation cost, with visual tradeoffs.
- `HideSuggestedChannels` (1 files, 2 KB) [dom]: Automatically dismisses the \
- `importMultiTokens` (1 files, 5 KB): Import tokens to Token Login Manager
- `jstextreplace` (5 files, 12 KB): 
- `lastfmRichPresence` (1 files, 7 KB) [net]: Your Last.fm API key. Get one free at last.fm/api/account/create.
- `lazyMessageRender` (2 files, 1 KB): Prevents message action toolbar from clipping under the message above. content-visibility was removed — Disco…
- `liveWallpaper` (1 files, 12 KB) [net, dom]: Wallpaper opacity (0 = invisible, 0.5 = max)
- `LivingAccent` (2 files, 9 KB) [net, dom]: Also recolor brand tokens and theme accent variables, not just Testcord panels
- `loginWithToken` (1 files, 9 KB) [dom]: Adds a
- `MediaStatus` (1 files, 15 KB) [net]: What media server are you using?
- `messageListeningCover` (1 files, 3 KB) [net]: Which listening activities to show covers for
- `messageNitroBadge` (2 files, 2 KB): Which treatment to enable the experiment with
- `navidromeRPC` (4 files, 13 KB) [net]: 
- `neonGlow` (2 files, 1 KB): Adds a neon glow to avatars, links and buttons when you hover them.
- `openOptimizer` (1 files, 1 KB): Ports OpenAsar
- `OpSec-Illegalcord` (1 files, 44 KB): Enable autocorrect
- `passwordManager` (2 files, 28 KB) [net, dom]: Securely store and manage your passwords
- `pastelMentions` (2 files, 1 KB): Recolors mentions and role pills with a soft pastel vaporwave gradient.
- `pluginManager` (1 files, 12 KB) [dom]: Manage custom plugins
- `PluginsShortcutButton` (1 files, 1 KB): Adds a shortcut button to the user area that opens the full TestCord Plugins settings page.
- `PluginStars` (1 files, 2 KB): Star your favourite plugins to pin them to the top of the plugin list.
- `quickDelete` (1 files, 2 KB) [dom]: Keyboard shortcut to delete your last message in the current channel.
- `quietHours` (1 files, 2 KB): Quiet hours start (24h hour, 0-23)
- `ReactionTracker` (2 files, 7 KB): Only count reactions whose emoji name contains this
- `readableSpoilers` (2 files, 1 KB): Gives unrevealed spoilers a subtle neon outline so you can spot them at a glance.
- `recentChannelSwitcher` (1 files, 24 KB) [net, dom]: Maximum recent channels to keep in the switcher
- `settingsShortcuts` (1 files, 2 KB): Adds Better Microphone and Better Screenshare shortcut buttons to Discord settings.
- `ShowOff` (1 files, 9 KB) [dom]: Turn your Discord avatar, name, and styling into an aesthetic showcase card you can copy, save, or post in ch…
- `showTypingUsers` (1 files, 3 KB): Shows a badge in the channel header listing who is currently typing.
- `sillyMaxwell` (2 files, 5 KB) [net, dom]: Silly Silly Silly
- `smoothmessages` (3 files, 8 KB) [dom]: Fade messages in while they slide.
- `soundcloudRichPresence` (1 files, 8 KB) [net]: Your SoundCloud OAuth token. Get it from soundcloud.com → F12 DevTools → Application → Cookies → oauth_token.
- `starfield` (2 files, 1 KB): A faint twinkling starfield drifting behind everything.
- `StereoGuard` (2 files, 32 KB): Watch the call and silence anyone whose audio is not fully mono: slight panning, stereo width, panning around…
- `stereoScreenshareAudio` (1 files, 3 KB) [net]: Patches Discord
- `sunsetChat` (2 files, 1 KB): Paints a dreamy vaporwave sunset gradient behind the message area.
- `tokenLogin` (2 files, 9 KB) [net, dom]: Manage and login with user tokens
- `TypingSettings` (1 files, 21 KB) [dom]: Smooth typing caret (the full SmoothType implementation). When on, all other caret settings below are ignored
- `UniversalVolume` (1 files, 2 KB): The volume everyone in your voice channel is set to.
- `userAreaTweaks` (1 files, 4 KB) [dom]: Creates an elegant floating dock for Testcord plugins using pure CSS, preventing overlap and crashes.
- `vaporScrollbar` (2 files, 1 KB): Replaces scrollbars with a neon pink-to-cyan vaporwave gradient.
- `vc-goodperson` (1 files, 7 KB): Filter incoming messages
- `videoStartNotifier` (1 files, 3 KB) [net]: Play notification sound in private voice calls (DMs)
- `Vimium` (3 files, 12 KB) [dom]: Key to toggle link hints (Vimium style)
- `voiceJoinMessages` (1 files, 7 KB): Receive notifications in your friends
- `webcamStartNotifier` (1 files, 3 KB) [net]: Play notification sound in private voice calls (DMs)
- `WebCordHardened` (1 files, 14 KB) [net]: Block Discord telemetry endpoints.
- `webRtcLeakPrevent` (1 files, 5 KB): ICE transport policy. Relay forces TURN relay only (best privacy), public allows public IP discovery.
- `wordCount` (1 files, 1 KB): Shows the word count of a message below it

### B: only existing pieces, with a native part (main process)
These need the native bridge and declared hosts; each one needs its native file read in full.

- `cursorMacOS` (3 files, 13 KB): Replaces Windows SYSTEM cursors with authentic macOS cursors (.cur/.ani). Restores default cursors when disab…
- `DsaWarnings` (6 files, 57 KB) [net]: Shows active DSA standing warnings on user profiles.
- `macOsButtons` (2 files, 9 KB) [dom]: Replaces Windows buttons with macOS-style buttons — red, yellow, green.
- `pdf-viewer` (3 files, 27 KB) [net, dom]: Max preview size (MB)
- `PinterestProfiles` (5 files, 49 KB) [net]: Adds Pinterest search to the GIF picker for images and GIFs.
- `PinterestTool` (10 files, 311 KB) [net, dom]: Find profile icons and banners on Pinterest, then edit them before applying.
- `rpcMirror` (2 files, 16 KB): Share my game and music status so my other Testcord windows can show it.
- `sentfrommyuname` (2 files, 3 KB) [desktop]: What to show after Sent from my
- `spotifyAddToQueue.desktop` (2 files, 6 KB) [net, dom]: Ignore repeat clicks for this many milliseconds
- `vc-blockKrisp` (2 files, 3 KB): Prevent Krisp from loading
- `yMusicSync.desktop` (31 files, 123 KB) [net, dom]: Control Yandex Music through Ynison and Discord RPC

### P: only existing pieces, with patches
Each patch must match the current Discord build, so each needs to be checked in Discord, not only in tests.

- `2FA HIder` (1 files, 1 KB): hide that annoying 2fa moderation warning
- `allConnectionsEnabled` (2 files, 2 KB): Enables all connections
- `auditLogChannel` (5 files, 9 KB): Adds an audit log channel
- `betterBios` (1 files, 1 KB) [no-licence]: Improves Discord
- `betterforwardmeta` (4 files, 7 KB) [net]: Show the server the message came from
- `betterGifLoad` (1 files, 6 KB) [net]: GIF quality
- `betterMicrophone.desktop` (11 files, 28 KB) [net, no-licence]: Hide the settings icon
- `betterplusreacts` (1 files, 2 KB): The amount of plus before :emoji: is the message to add it to
- `betterScreenshare.desktop` (17 files, 50 KB) [net, no-licence]: This plugin allows you to further customize your screen sharing.
- `Boo` (6 files, 6 KB) [net]: A cute ghost will appear if you don
- `bypassBlockedOrIgnored` (4 files, 6 KB): Bypass the blocked or ignored user modal if is present in voice channels.
- `ClickToUnmute` (1 files, 2 KB): Click the mute icon next to a locally muted voice member to unmute them instantly, instead of right-click > U…
- `CustomAppIcons` (2 files, 9 KB) [net, no-licence]: Add/upload your own custom (In-)App Icon(s).
- `customSounds` (3 files, 28 KB) [net, dom]: Override for ${t.name}
- `DeadMembers` (2 files, 2 KB): How to indicate dead members
- `defaultStatusForever` (1 files, 1 KB): Make statuses default to last forever
- `emojiOnMouseUp` (1 files, 1 KB): Sends the emoji you are hovering when you take your mouse button up.
- `ExpandedWidgets` (1 files, 1 KB): Enables setting multiple of the same tags for a game in your profile, Author: sadie but they aint in devs so …
- `fastDiscord` (1 files, 18 KB) [dom]: Maximizes app smoothness and responsiveness: animations, media, memory cache, background FPS, and network (pr…
- `FastGifPicker` (1 files, 24 KB) [net]: Use lighter preview URLs in the GIF picker.
- `favoriteMedia` (2 files, 1 KB): Favorite any type of media
- `fixScreenshare` (1 files, 9 KB): Prevents Discord from crashing and reloading when screensharing by intercepting media-related errors and bloc…
- `ForceRoleColor` (1 files, 6 KB) [net, no-licence]: 
- `freezePresence` (1 files, 5 KB): Freeze the member list — stop it from jumping around when people change status.
- `FriendCodes` (5 files, 7 KB): Generate FriendCodes to easily add friends
- `gatewayLogger` (1 files, 1 KB) [net]: logs gateway events to the console
- `gifTransfer` (1 files, 31 KB) [dom]: Skip GIFs that are already in your favorites when importing
- `goofcordSettings` (2 files, 3 KB): Apply paint containment to the message list and member list so they scroll without repainting the full layer …
- `hideSoap` (1 files, 9 KB): Detect Hebrew Unicode characters (\u0590-\u05FF)
- `idTranslater` (1 files, 7 KB): Convert user IDs to clickable @ mentions
- `inviteDefaults` (1 files, 2 KB): Invite Duration
- `moreAlts` (1 files, 1 KB): The amount of alts to allow.
- `moreGuildDiscoveryCategories` (1 files, 2 KB): Show all guild discovery categories in the sidebar
- `moreJumboEmoji` (1 files, 1 KB): Number of emojis that are allowed to be jumbo
- `moreReact` (1 files, 2 KB) [net, no-licence]: Max reactions
- `NameStyleChanger` (2 files, 46 KB) [net, dom]: Font style for your username and display name
- `noButtons` (1 files, 10 KB) [dom]: Hide the popout chat button
- `nocompress` (1 files, 1 KB): Disables the compression of attachments.
- `noDraftLengthLimit` (1 files, 1 KB): Removes the 4500 character saved draft message truncation
- `noEditedTimestamp` (1 files, 1 KB): Removes the
- `noTelemetry` (1 files, 7 KB): Block Discord from reporting which A/B experiments your account is enrolled in.
- `philsPluginLibrary` (62 files, 134 KB) [net, no-licence]: A library for phil
- `quickSnippet` (2 files, 4 KB): list of channel IDs to whitelist
- `realtimeTimestamps` (1 files, 8 KB): Seconds format displayed on every message timestamp
- `relationshipPruner` (6 files, 15 KB) [net]: Adds a way to easily prune your servers and friends. To open, right click the home button or friends tab butt…
- `ReorderAttachments` (2 files, 6 KB): Allows you to reorder attachments before sending them
- `RoundedVcPfp` (2 files, 20 KB) [net]: Profile picture corner rounding. 0 is a flat square like FullVCPFP; 50 and higher is a full circle.
- `rzengz` (1 files, 1 KB): Automatically takes you to the message when someone mentions you
- `ScreenshareKeybind` (1 files, 2 KB): Adds a keybind to instantly screenshare
- `selfForward` (1 files, 1 KB): Adds the current channel to the forward list popup
- `ServerPruner` (2 files, 9 KB) [net]: Adds a modal to easily prune your servers with information and stats. Right click the home button!
- `shytyping` (1 files, 2 KB): Always show you are typing in your current voice channel
- `simplifiedProfileNotes` (1 files, 3 KB): Hide the note box when no note is set for a user
- `SortReactions` (1 files, 1 KB): Sorts reactions by count in chat.
- `staffTag` (1 files, 7 KB): Show a crown instead of a text tag.
- `StreamQuality` (3 files, 18 KB): Override the encoded frame rate.
- `surfaceTranslate` (1 files, 16 KB) [net]: Target language code for surface translations.
- `TestcordCosmetics` (1 files, 9 KB): Primary username color (Hex, e.g. #8855FF)
- `teX` (3 files, 4 KB) [net, dom]: Typesets math in messages, written as
- `timelessclips` (1 files, 1 KB): Add clip length option in minutes
- `toneIndicators` (2 files, 5 KB): Adds descriptions when hovering over tone indicators.
- `TriggerWarning` (1 files, 3 KB): Strings in filenames that should be spoilered. Comma separated.
- `typingFriends` (1 files, 13 KB) [net, no-licence]: Show a Typing section in the Friends list
- `UnlimitedFavoriteGIFs` (1 files, 6 KB): Export local favorites to clipboard as JSON
- `vc-autocorrect` (1 files, 3 KB) [net, no-licence]: 
- `vc-betterActivities` (6 files, 25 KB) [net]: Show activity icons in the member list
- `vc-ignoreTerms` (1 files, 1 KB): Ignore Discord
- `vc-junkCleanup-main` (2 files, 12 KB): Enable all patches (intended for testing)
- `vc-NewlinesInCommands` (1 files, 1 KB): Allows shift+enter to create new lines in command inputs.
- `vcpanelsettings` (2 files, 8 KB): Show the controls expanded instead of behind a toggle
- `vencord-perf-main` (1 files, 2 KB): [RISKY]Collection of small performance improvements[RISKY]
- `versions` (1 files, 1 KB): Adds extra information to the version info
- `VoiceCount` (2 files, 3 KB): Show the user limit as well, for channels that have one.
- `voicehighquality` (1 files, 5 KB): Audio Bitrate (kbps) - 510kbps recommended for maximum quality
- `voiceSettings` (1 files, 2 KB): Voice chat encoding bitrate in kbps. Discord default is 64. Higher values improve call quality and use more b…
- `VoiceVUMeters` (2 files, 50 KB) [dom]: Bottom of the meter scale in dB. -60 matches SonoBus; raise it to make quiet talkers move the meter more.

### N1: one engine piece missing

**ContextMenu** (38):
AnonLi, AntiPing, autonickname, BoosterCount-main, bypassUpload, channelWallpaper, chromeTabs, closeAllDms, copyMediaLink, createTheme, customFolderIcons, customStream, Disguise, DMBomb, editUsers, followVoiceUser-advanced, guildCopier, leaveAllServers, localmessageedit, MetadataViewer, micquality, mutualServerMembers, orchestratorAPI, passwordProtect, ProfileMedia, PurgeDMs, rzblack, saveUserGifs, ServerToolkit, soloaudio, TestcordAI, tiktokTTS, vcNarratorCustom, vc-voiceChatUtilities, vencord-ExitSounds, viewRawVariant, waitForSlot, ZIPplus

**Commands** (31):
annoiler, antiNameChange, autoBanMenu, avatarGrabber, boldText, clapText, define, embedBuilder, femboyCommand, Freaky, IconExport, idlePage, leetText, mediaDownloader.desktop, pollMaker, profileCommand, serverBackup, shipCalc, smallCaps, spaceOut, starify, summarizeAI, testfetch, textScreenshot, userflags, vaporwaveText, vibeCheck, wikiLookup, yaoi, ytdownloader, yuri

**Notifications** (18):
antiGroup, antiStereo, audioCenter, audioLimiter, callrecorder, crashHandlerEnhanched, CustomDNS, MicSpamGuard, noDMWhileStreaming, obsRemoteControl, PanelLayout, ReactionLogger, socket.desktop, soundboardPro, stereoInstaller.desktop, stereoLoader.desktop, userpluginInstaller, VoiceFakeDetector

**Toasts** (17):
antiMod, antiSnitch, AutoLanguageBlock, cancelFriendRequest, copyStatusUrls, ctrlEnterSave, customreactionbuttons, FilePreview, forcemono, ghostPingAlert, gifCaptioner, identity.discordDesktop, recentBan, serverProfilesToolbox, soundTriggers, TestcordOptimizer, vencord-gpubinder-main

**HeaderBar** (12):
cacheResetButton, channelGallery, eventLogs, exportDM, floatingnotes, HyprTilesPremium, MultiInstance, tempMail, timeDelete, voiceChannelSearch, WebhookSend, wordBomb

**MessageEvents** (7):
autoVaporwave, Bookmarks, ChineseWhispers, grammar, grammarFix, longMsgTxt, ZeroWidthSanitizer

**MemberList** (5):
BetterUserTools, lastOnline, lyricsStatus, vencord-antirickroll, Wellbeing

**ChatButtons** (3):
aiTranslate.desktop, Backpack, quickmsg

**Badges** (1):
clientSideBadges

### N2: two or more pieces missing
abreviation (Notifications+MessageEvents), accroche (ContextMenu+Notifications), animstatus (HeaderBar+MemberList+Toasts), AntiFilter (ContextMenu+Commands+HeaderBar+ChatButtons+MessageEvents), antiMoveDeco (Commands+Notifications+Toasts), autoBan (ContextMenu+Toasts), autoCorrect (HeaderBar+ChatButtons), autoDeco (ContextMenu+Notifications), autoMute (ContextMenu+Toasts), autoResponder (HeaderBar+ChatButtons), betterFormattingRedux (HeaderBar+ChatButtons+MessageEvents), bigFileUpload (ContextMenu+Notifications), BigFileUploadEnhanced (ContextMenu+Toasts), calendar (HeaderBar+Notifications), chatButtonsPlus (HeaderBar+ChatButtons), chatGPT (Commands+Notifications), chatgptwriting (HeaderBar+ChatButtons+MessageEvents), chatsScrapper (HeaderBar+ChatButtons+Toasts), composeMode (ContextMenu+HeaderBar+ChatButtons), contextlarp (ContextMenu+Commands), customProfile (ContextMenu+HeaderBar+Badges), deepsearch (HeaderBar+Notifications), DirectMessageOpener (Commands+HeaderBar), encryptedMessage (ContextMenu+HeaderBar+ChatButtons+MessageEvents+Toasts), exporter (HeaderBar+ChatButtons+Toasts), fakeAccount (ContextMenu+HeaderBar), fakeMuteDeafen (ContextMenu+Commands+Toasts), fastPFP (ContextMenu+Toasts), FloeP2PService.desktop (ContextMenu+Commands), floodPanel (HeaderBar+ChatButtons), followMe (ContextMenu+HeaderBar+Toasts), friendsInVoice (ContextMenu+HeaderBar), friendsScrapper (HeaderBar+ChatButtons+Toasts), GhostTyping (Commands+ChatButtons), goofcordsec (HeaderBar+ChatButtons+MessageEvents), groupKicker (ContextMenu+Notifications), hyprTiles (ContextMenu+Commands+HeaderBar), IGP (Commands+HeaderBar+ChatButtons), laisse (ContextMenu+Notifications), leaveAllGroups (ContextMenu+Notifications), lockGroup (ContextMenu+Notifications), MessageFetchTimer (HeaderBar+ChatButtons), MessageReminders (ContextMenu+Notifications), messageScrapper (HeaderBar+ChatButtons+Toasts), messageStatistics (Commands+MessageEvents), MessageTags (ContextMenu+MessageEvents), miloplugin (ChatButtons+MessageEvents), MiniGames (ContextMenu+MessageEvents), Modes (Notifications+MemberList), MultiServerAutoban (ContextMenu+Toasts), muteAllServers (ContextMenu+Toasts), muteunmuteservers (ContextMenu+Toasts), nativeTranslate (ContextMenu+ChatButtons), newUserIndicator (Badges+MemberList), NoGifLimit (ContextMenu+Commands+ChatButtons+Notifications), nyaaa (Commands+HeaderBar), passcodeLock (HeaderBar+Notifications), PerformanceBoost (HeaderBar+Notifications+MemberList), profanityFilter (MessageEvents+Toasts), profileCopyButton (ContextMenu+MemberList), ProfileVisibility (HeaderBar+MemberList+Toasts), relationshipIndicators (Badges+MemberList), robloxfilter (Notifications+Toasts), roleDuplication (ContextMenu+MemberList), rznoone (ContextMenu+Toasts), safeNumbers (HeaderBar+MessageEvents), SearchUtility (ContextMenu+Commands+MemberList), SecurecordOpossum (Commands+HeaderBar+ChatButtons+MessageEvents+Toasts), selfDestruct (HeaderBar+ChatButtons), serverPinner (ContextMenu+Notifications), sharePerms (Commands+HeaderBar), Silentcall (ContextMenu+Commands+ChatButtons), SilentDelete (ContextMenu+Commands), staffScanner (Commands+Notifications+Toasts), stalker (ContextMenu+Notifications), statuscommand (Commands+MemberList), StreamEnhancer (ContextMenu+Toasts), streamProof (HeaderBar+ChatButtons), Surveillance (ContextMenu+Notifications+MessageEvents+Toasts), testcordToolbox (HeaderBar+Notifications), TranslatePremium (ContextMenu+Toasts), tsunderetalk (HeaderBar+MessageEvents), userNotes (ContextMenu+Toasts), vAnalyzer-main (ContextMenu+Toasts), vc-followUser (ContextMenu+Toasts), vc-notifyUserChanges (ContextMenu+Notifications), vcOwnerDetector (ContextMenu+Toasts), vcR (ContextMenu+Toasts), vc-showMessageEmbeds (ContextMenu+MessageEvents), vc-silentTypingEnhanced (Commands+HeaderBar+ChatButtons), voiceDictation (HeaderBar+ChatButtons), voiceGuard (ContextMenu+Toasts), voiceServerInfo (Commands+HeaderBar+Notifications)

## 6. Order I propose
1. **Wave 1 (from bucket A):** the smallest plugins with no `net`, no `dom`: styles-only and small logic ones, in groups of about 10, each group with manifest (credits, licence, permissions), tests with fakes, and a check on your Stable. After the first group I measure how much a plugin really costs and adjust.
2. **Engine pieces** by how many plugins each unlocks, each with its own analysis: ContextMenu (38 + part of N2), Commands (31), Notifications/Toasts (35), HeaderBar (12), MessageEvents (7), MemberList decorations (5), ChatButtons (3).
3. **Bucket A with `net`/`dom`**, then B and P one by one.
4. **Held back:** nothing until you answer section 4.
The adapter layer you asked for earlier (only ADD, never change the core) would live in a new folder; its name is still not agreed.

## 7. Plugins without a licence header (21)
Credit and licence cannot be taken from the file; they must be checked at the source before adapting: _kamidereCompat, autoDeleteDms, betterBios, betterMicrophone.desktop, betterScreenshare.desktop, crashHandlerEnhanched, CustomAppIcons, customStream, deleteMe, ForceRoleColor, getMyToken, moreReact, noOnboarding, philsPluginLibrary, purgeMessages, repeatMessage, runInConsole, testcordToolbox, typingFriends, vc-autocorrect, vc-silentTypingEnhanced.

## 8. Not verified
- The buckets come from text matching: a plugin that builds its patches in code, imports a helper through another path or lives in several files may be misplaced. The held-back list is a judgement from names and descriptions, not from reading each file.
- Nothing was tried against Amiricord's API; whether a bucket A plugin really works is only known after adapting and trying it in Discord.
- Many descriptions in the table are the first `description` text found; for plugins with several they may be an option text and not the plugin's.

## Appendix: all 468
| Folder | Name | Bucket | Missing pieces | Patches | Native | Net | Files |
|---|---|---|---|---|---|---|---|
| _kamidereCompat |  | H |  | 0 | 0 | 1 | 2 |
| 2FA HIder | 1FA | P |  | 1 | 0 | 0 | 1 |
| abreviation | Abbreviation | N2 | Notifications+MessageEvents | 0 | 0 | 0 | 1 |
| accroche | Hook | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| aiTranslate.desktop | AITranslate | N1 | ChatButtons | 0 | 1 | 1 | 6 |
| allConnectionsEnabled | AllConnectionsEnabled | P |  | 1 | 0 | 0 | 2 |
| amrpcStatusDisplayType.desktop | AMRPCStatusDisplayType | A |  | 0 | 0 | 0 | 1 |
| animalese | Animalese | A |  | 0 | 0 | 1 | 1 |
| animstatus | AnimatedStatus | N2 | HeaderBar+MemberList+Toasts | 0 | 0 | 1 | 2 |
| annoiler | Annoiler | N1 | Commands | 0 | 0 | 0 | 1 |
| AnonLi | AnonLi | N1 | ContextMenu | 0 | 1 | 1 | 2 |
| AntiAntilog | AntiAntilog | H |  | 1 | 0 | 0 | 1 |
| antiDeco | AntiDisconnect | A |  | 0 | 0 | 0 | 1 |
| antiDeleteMessage | AntiDeleteMessage | H | HeaderBar | 0 | 0 | 0 | 1 |
| AntiFilter | AntiFilter | N2 | ContextMenu+Commands+HeaderBar+ChatButtons+MessageEvents | 0 | 0 | 0 | 1 |
| antiGroup | AntiGroup | N1 | Notifications | 0 | 0 | 0 | 1 |
| AntilogPremium | AntilogPremium | H | ContextMenu+Commands | 0 | 0 | 0 | 1 |
| antiMod | AntiMod | N1 | Toasts | 0 | 0 | 1 | 1 |
| antiMoveDeco | AntiMoveDeco | N2 | Commands+Notifications+Toasts | 1 | 0 | 1 | 3 |
| antiNameChange | AntiNameChange | N1 | Commands | 0 | 0 | 0 | 1 |
| antiNickname | AntiNickname | A |  | 0 | 0 | 0 | 1 |
| AntiPing | AntiPing | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| antiSnitch | AntiSnitch | N1 | Toasts | 0 | 0 | 1 | 1 |
| antiStereo | AntiStereo | N1 | Notifications | 1 | 0 | 0 | 1 |
| apisniper | ApiSniper | H | Notifications+Toasts | 0 | 0 | 0 | 6 |
| askMeToMute | AskMeToMute | A |  | 0 | 0 | 0 | 1 |
| audioCenter | AudioCenter - Virtual Output | N1 | Notifications | 0 | 0 | 0 | 1 |
| audioLimiter | AudioLimiter | N1 | Notifications | 1 | 0 | 0 | 1 |
| auditLogChannel | AuditLogChannel | P |  | 1 | 0 | 0 | 5 |
| autoBan | AutoBan | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| autoBanMenu | AutoBanMenu | N1 | Commands | 0 | 0 | 1 | 1 |
| AutoBumpSelf | AutoBump | H |  | 0 | 0 | 0 | 1 |
| autoChannelReact | AutoChannelReact | H | ContextMenu | 0 | 0 | 1 | 1 |
| autoClaim | Clyde | H | ContextMenu+Toasts | 1 | 0 | 1 | 1 |
| autoCorrect | AutoCorrectNC | N2 | HeaderBar+ChatButtons | 0 | 0 | 1 | 1 |
| autoDeco | AutoDisconnect | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| autoDeleteDms | AutoDeleteDMs | H |  | 0 | 0 | 1 | 1 |
| autoDeleter | AutoDeleter | H | Notifications | 0 | 0 | 0 | 1 |
| AutoLanguageBlock | AutoLanguageBlock | N1 | Toasts | 0 | 0 | 0 | 1 |
| AutoMessageRepeater | AutoMessageRepeater | H | HeaderBar+ChatButtons | 0 | 0 | 0 | 1 |
| AutoMessageSender | AutoMessageSender | H | ContextMenu | 0 | 0 | 0 | 1 |
| autoMute | AutoMute | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| autonickname | AutoNickname | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| AutoReact | AutoReact | H | ContextMenu+Commands | 0 | 0 | 1 | 2 |
| autoRedeem | AutoRedeem | H | Notifications | 0 | 1 | 1 | 12 |
| autoReply | AutoReply | H | HeaderBar+ChatButtons | 0 | 0 | 1 | 1 |
| AutoReplyContent | AutoReplyContent | H |  | 0 | 0 | 0 | 1 |
| autoResponder | AutoResponder | N2 | HeaderBar+ChatButtons | 0 | 0 | 0 | 1 |
| AutoThemeSwitcher | AutoThemeSwitcher | A |  | 0 | 0 | 0 | 8 |
| autoTranslateNightcord | AutoTranslateTC | A |  | 0 | 0 | 0 | 1 |
| autoUnmute | AutoUnmute | A |  | 0 | 0 | 0 | 1 |
| autoVaporwave | AutoVaporwave | N1 | MessageEvents | 0 | 0 | 0 | 1 |
| avatarGrabber | AvatarGrabber | N1 | Commands | 0 | 0 | 0 | 1 |
| Backpack | Backpack | N1 | ChatButtons | 0 | 0 | 1 | 2 |
| BadgeSpoofer | BadgeSpoofer | H | Commands+Toasts | 0 | 0 | 1 | 7 |
| betterBios | BetterBios | P |  | 1 | 0 | 0 | 1 |
| betterFormattingRedux | BetterFormattingRedux | N2 | HeaderBar+ChatButtons+MessageEvents | 0 | 0 | 0 | 2 |
| betterforwardmeta | BetterForwardMeta | P |  | 1 | 0 | 1 | 4 |
| betterGifLoad | BetterGifLoad | P |  | 1 | 0 | 1 | 1 |
| BetterGodMode | BetterGodMode [Risky] | H | ContextMenu | 0 | 0 | 0 | 1 |
| betterJoinedDate | BetterJoinedDate | A |  | 0 | 0 | 0 | 1 |
| betterMicrophone.desktop | BetterMicrophone | P |  | 1 | 0 | 1 | 11 |
| betterplusreacts | BetterPlusReacts | P |  | 1 | 0 | 0 | 1 |
| betterScreenshare.desktop | BetterScreenshare | P |  | 1 | 0 | 1 | 17 |
| BetterUserTools | BetterUserTools | N1 | MemberList | 0 | 0 | 0 | 1 |
| bigFileUpload | BigFileUpload | N2 | ContextMenu+Notifications | 1 | 1 | 1 | 10 |
| BigFileUploadEnhanced | all | N2 | ContextMenu+Toasts | 0 | 1 | 1 | 2 |
| boldText | BoldText | N1 | Commands | 0 | 0 | 0 | 1 |
| Boo | Boo | P |  | 1 | 0 | 1 | 6 |
| Bookmarks | Bookmarks | N1 | MessageEvents | 0 | 0 | 0 | 1 |
| BoosterCount-main | BoostCounts | N1 | ContextMenu | 0 | 0 | 1 | 2 |
| bulkFriendRemove | BulkFriendRemove | H | HeaderBar | 0 | 0 | 1 | 2 |
| bypassAccounts | PBKDF2 | A |  | 0 | 0 | 0 | 1 |
| bypassBlockedOrIgnored | BypassBlockedOrIgnored | P |  | 1 | 0 | 0 | 4 |
| bypassUpload | BigFileUpload | N1 | ContextMenu | 0 | 1 | 1 | 2 |
| cacheResetButton | CacheResetButton | N1 | HeaderBar | 0 | 0 | 0 | 1 |
| calendar | Calendar | N2 | HeaderBar+Notifications | 0 | 0 | 1 | 2 |
| callrecorder | RecordUrMic | N1 | Notifications | 0 | 1 | 0 | 2 |
| cancelFriendRequest | CancelFriendRequestNC | N1 | Toasts | 0 | 0 | 0 | 1 |
| channelGallery | ChannelGallery | N1 | HeaderBar | 1 | 1 | 1 | 10 |
| channelWallpaper | ChannelWallpaper | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| chatButtonsPlus | ChatButtonsPlus | N2 | HeaderBar+ChatButtons | 0 | 0 | 1 | 2 |
| chatGPT | ChatGPT | N2 | Commands+Notifications | 0 | 0 | 1 | 1 |
| chatgptwriting | ChatGPTWriting | N2 | HeaderBar+ChatButtons+MessageEvents | 0 | 0 | 1 | 1 |
| chatsScrapper | ChatsScrapper | N2 | HeaderBar+ChatButtons+Toasts | 0 | 0 | 1 | 1 |
| ChineseWhispers | ChineseWhispers | N1 | MessageEvents | 0 | 0 | 1 | 1 |
| chromeTabs | ChromeTabs | N1 | ContextMenu | 1 | 0 | 0 | 13 |
| ClanSwitcher | Clan Switcher | A |  | 0 | 0 | 1 | 1 |
| clapText | ClapText | N1 | Commands | 0 | 0 | 0 | 1 |
| ClassHighlighter | ClassHighlighter | A |  | 0 | 0 | 0 | 2 |
| clickSparkles | ClickSparkles | A |  | 0 | 0 | 0 | 2 |
| ClickToUnmute | ClickToUnmute | P |  | 1 | 0 | 0 | 1 |
| clientSideBadges | ClientSideBadges | N1 | Badges | 0 | 0 | 1 | 1 |
| closeAllDms | CloseAllDms | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| compactCompose | CompactCompose | A |  | 0 | 0 | 0 | 2 |
| composeMode | ComposeMode | N2 | ContextMenu+HeaderBar+ChatButtons | 1 | 0 | 1 | 1 |
| contextlarp | ContextLarp | N2 | ContextMenu+Commands | 0 | 0 | 0 | 1 |
| contextMenuSelectFix | ContextMenuSelectFix | A |  | 0 | 0 | 0 | 1 |
| copyMediaLink | CopyMediaLink | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| copyStatusUrls | CopyStatusUrls | N1 | Toasts | 1 | 0 | 0 | 1 |
| crashHandlerEnhanched | CrashHandlerEnhanced | N1 | Notifications | 1 | 0 | 1 | 1 |
| createTheme | CreateTheme | N1 | ContextMenu | 1 | 0 | 1 | 7 |
| crtEffect | CRTEffect | A |  | 0 | 0 | 0 | 2 |
| ctrlEnterSave | CtrlEnterSave | N1 | Toasts | 1 | 0 | 0 | 1 |
| cursorMacOS | CursorMacOS | B |  | 0 | 1 | 0 | 3 |
| CustomAppIcons | CustomAppIcons | P |  | 1 | 0 | 1 | 2 |
| CustomDNS | CustomDNS | N1 | Notifications | 0 | 1 | 0 | 2 |
| customFolderIcons | CustomFolderIcons | N1 | ContextMenu | 1 | 0 | 1 | 4 |
| customProfile | Second Account? | N2 | ContextMenu+HeaderBar+Badges | 1 | 0 | 1 | 2 |
| customreactionbuttons | CustomReactionButtons | N1 | Toasts | 0 | 0 | 1 | 1 |
| customSounds | CustomSounds | P |  | 1 | 0 | 1 | 3 |
| customStream | Default | N1 | ContextMenu | 1 | 0 | 1 | 1 |
| CustomStreamPreview | CustomStreamPreview | A |  | 0 | 0 | 1 | 3 |
| DeadMembers | DeadMembers | P |  | 1 | 0 | 0 | 2 |
| DecibelLimiter | DecibelLimiter | A |  | 0 | 0 | 0 | 1 |
| deepsearch | DeepSearch | N2 | HeaderBar+Notifications | 0 | 0 | 0 | 4 |
| defaultStatusForever | DefaultStatusForever | P |  | 1 | 0 | 0 | 1 |
| define | Define | N1 | Commands | 0 | 0 | 1 | 1 |
| deleteMe |  | H |  | 0 | 0 | 0 | 1 |
| detectBlock | DetectBlock | A |  | 0 | 0 | 1 | 5 |
| DirectMessageOpener | DirectMessageOpener | N2 | Commands+HeaderBar | 1 | 0 | 0 | 2 |
| disconnect | DisconnectUser | H | ContextMenu+Toasts | 1 | 0 | 1 | 1 |
| DiscordLock | User | A |  | 0 | 0 | 1 | 1 |
| Disguise | Disguise | N1 | ContextMenu | 1 | 0 | 0 | 6 |
| dmAway | DMAway | H | HeaderBar+Toasts | 0 | 0 | 0 | 1 |
| DMBomb | DMBomb | N1 | ContextMenu | 0 | 0 | 1 | 2 |
| dmReadReceipt | DmReadReceipt | A |  | 0 | 0 | 0 | 1 |
| dontLimitMe | DontLimitMe | H |  | 1 | 0 | 0 | 1 |
| doubleEmoji | DoubleEmoji | A |  | 0 | 0 | 0 | 1 |
| DsaWarnings | DsaWarnings | B |  | 0 | 1 | 1 | 6 |
| DXTokenImporter | DXTokenImporter | H | Commands+HeaderBar | 0 | 1 | 0 | 4 |
| DynamicIslande | DynamicIslande | A |  | 0 | 0 | 0 | 2 |
| editUsers | EditUsers | N1 | ContextMenu | 1 | 0 | 0 | 4 |
| embedBuilder | EmbedBuilder | N1 | Commands | 0 | 0 | 1 | 1 |
| embeddedURLs | EmbeddedURLs | A |  | 0 | 0 | 1 | 1 |
| emojiOnMouseUp | EmojiOnMouseUp | P |  | 1 | 0 | 0 | 1 |
| encryptedMessage | EncryptedMessage | N2 | ContextMenu+HeaderBar+ChatButtons+MessageEvents+Toasts | 0 | 0 | 1 | 1 |
| eval | Eval | H | Commands | 0 | 1 | 0 | 3 |
| eventLogs | EventLogs | N1 | HeaderBar | 0 | 0 | 1 | 2 |
| ExpandedWidgets | ExpandedWidgets | P |  | 1 | 0 | 0 | 1 |
| exportDM | ExportDM | N1 | HeaderBar | 0 | 0 | 1 | 2 |
| exporter | Exporter | N2 | HeaderBar+ChatButtons+Toasts | 0 | 0 | 1 | 2 |
| fakeAccount | FakeSwitcher | N2 | ContextMenu+HeaderBar | 0 | 0 | 0 | 1 |
| FakeAccounts | Fake Accounts | H | Toasts | 1 | 0 | 1 | 1 |
| fakeConnections | FakeConnections | A |  | 0 | 0 | 1 | 2 |
| fakeDM | Caller | H | HeaderBar+ChatButtons | 0 | 1 | 1 | 3 |
| fakeFriends | FakeFriends | H | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| FakeIndicators | FakeIndicators | A |  | 0 | 0 | 0 | 1 |
| fakeMuteDeafen | FakeMuteDeafen | N2 | ContextMenu+Commands+Toasts | 0 | 0 | 0 | 1 |
| fakePerm | FakePerm | H | ContextMenu | 1 | 0 | 0 | 1 |
| FakeProfile | fakeProfile | H | Badges+MemberList+Toasts | 1 | 0 | 1 | 9 |
| fakeurl | FakeUrl | H | Commands+ChatButtons | 0 | 0 | 1 | 2 |
| fakeUserProfile | Seed | H | MessageEvents+Badges | 1 | 0 | 1 | 4 |
| FakeUserSwitcher | FakeUserSwitcher | H | ContextMenu+MessageEvents+Badges | 1 | 0 | 1 | 5 |
| FakeVoicePremium | FakeVoicePremium | H | ContextMenu+Commands | 1 | 0 | 1 | 4 |
| fastDiscord | FastDiscord | P |  | 1 | 0 | 0 | 1 |
| FastGifPicker | FastGifPicker | P |  | 1 | 0 | 1 | 1 |
| fastPFP | FastPFP | N2 | ContextMenu+Toasts | 0 | 0 | 1 | 2 |
| fastPing | FastPing | A |  | 0 | 0 | 0 | 2 |
| favoriteMedia | FavoriteMedia | P |  | 1 | 0 | 0 | 2 |
| femboyCommand | Danbooru | N1 | Commands | 0 | 0 | 1 | 1 |
| FilePreview | FileViewer | N1 | Toasts | 0 | 0 | 1 | 1 |
| fileSplitter | File Splitter | A |  | 0 | 0 | 0 | 2 |
| fixScreenshare | FixScreenshare | P |  | 1 | 0 | 0 | 1 |
| floatingnotes | FloatingNotes | N1 | HeaderBar | 0 | 0 | 0 | 2 |
| FloeP2PService.desktop | FloeP2PService | N2 | ContextMenu+Commands | 0 | 1 | 1 | 2 |
| floodPanel | FloodPanel | N2 | HeaderBar+ChatButtons | 0 | 0 | 1 | 5 |
| FollowMajority | FollowMajority | A |  | 0 | 0 | 0 | 1 |
| followMe | FollowMe | N2 | ContextMenu+HeaderBar+Toasts | 0 | 0 | 0 | 1 |
| followVoiceUser-advanced | FollowVoiceUser-Extand | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| forcemono | opus | N1 | Toasts | 0 | 0 | 0 | 1 |
| ForceRoleColor | ForceRoleColor | P |  | 1 | 0 | 1 | 1 |
| Freaky | Freaky | N1 | Commands | 0 | 0 | 0 | 1 |
| freezePresence | FreezePresence | P |  | 1 | 0 | 0 | 1 |
| FriendCodes | FriendCodes | P |  | 1 | 0 | 0 | 5 |
| friendsInVoice | FriendsInVoice | N2 | ContextMenu+HeaderBar | 0 | 0 | 0 | 2 |
| friendsScrapper | FriendsRemover | N2 | HeaderBar+ChatButtons+Toasts | 0 | 0 | 1 | 1 |
| gatewayLogger | GatewayLogger | P |  | 1 | 0 | 1 | 1 |
| gctrap | gctrap | H | HeaderBar+ChatButtons+Notifications | 0 | 0 | 0 | 13 |
| getMyToken | getMyToken | H | Commands | 0 | 0 | 1 | 1 |
| ghostClient | GhostClient | H | Toasts | 0 | 1 | 1 | 4 |
| ghostPingAlert | GhostPingAlert | N1 | Toasts | 0 | 0 | 0 | 1 |
| GhostSelfbot | GhostSelfbot | H | Commands+Notifications | 0 | 1 | 1 | 4 |
| GhostTyping | GhostTyping | N2 | Commands+ChatButtons | 0 | 0 | 1 | 1 |
| gifCaptioner | GifCaptioner | N1 | Toasts | 1 | 0 | 1 | 20 |
| gifSpammer | GifSpammer | H | Commands | 0 | 0 | 0 | 1 |
| gifTransfer | GifTransfer | P |  | 1 | 0 | 0 | 1 |
| glassPanels | GlassPanels | A |  | 0 | 0 | 0 | 2 |
| goofcordsec | RTCPeerConnection | N2 | HeaderBar+ChatButtons+MessageEvents | 0 | 1 | 1 | 2 |
| goofcordSettings | GoofcordSettings | P |  | 1 | 0 | 0 | 2 |
| grammar | Grammar | N1 | MessageEvents | 0 | 0 | 0 | 1 |
| grammarFix | GrammarFix | N1 | MessageEvents | 0 | 0 | 1 | 1 |
| greedcmds | GreedCmds | H | Commands | 0 | 0 | 0 | 1 |
| gridFloor | GridFloor | A |  | 0 | 0 | 0 | 2 |
| groupKicker | GroupKicker | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| guildCopier | bots-list | N1 | ContextMenu | 0 | 0 | 1 | 2 |
| HasStrip | HasStrip | A |  | 0 | 0 | 0 | 1 |
| hideSoap | AntiSoap (hideSoap) | P |  | 1 | 0 | 0 | 1 |
| HideSuggestedChannels | HideSuggestedChannels | A |  | 0 | 0 | 0 | 1 |
| huskbot | Huskbot | H |  | 0 | 0 | 0 | 1 |
| hyprTiles | HyprTiles | N2 | ContextMenu+Commands+HeaderBar | 1 | 1 | 0 | 17 |
| HyprTilesPremium | HyprTilesPremium | N1 | HeaderBar | 0 | 1 | 0 | 17 |
| IconExport | IconExport | N1 | Commands | 0 | 0 | 1 | 2 |
| identity.discordDesktop | Identity | N1 | Toasts | 1 | 1 | 1 | 2 |
| idlePage | IdlePage | N1 | Commands | 1 | 0 | 0 | 2 |
| idTranslater | ID Translater | P |  | 1 | 0 | 0 | 1 |
| IGP | IGP | N2 | Commands+HeaderBar+ChatButtons | 0 | 0 | 1 | 3 |
| impersonate | Impersonate | H | Commands | 0 | 0 | 0 | 1 |
| importMultiTokens | ImportMultiTokens | A |  | 0 | 0 | 0 | 1 |
| inviteDefaults | InviteDefaults | P |  | 1 | 0 | 0 | 1 |
| jstextreplace | JSTextReplace | A |  | 0 | 0 | 0 | 5 |
| KFOCleanupSuite | Smart Cleanup Suite | H | Commands | 0 | 0 | 0 | 1 |
| laisse | Leash | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| lastfmRichPresence | Last.fm | A |  | 0 | 0 | 1 | 1 |
| lastOnline | LastOnline | N1 | MemberList | 0 | 0 | 0 | 2 |
| lazyMessageRender | LazyMessageRender | A |  | 0 | 0 | 0 | 2 |
| leaveAllGroups | LeaveAllGroups | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| leaveAllServers | LeaveAllServers | N1 | ContextMenu | 0 | 0 | 1 | 2 |
| leetText | LeetText | N1 | Commands | 0 | 0 | 0 | 1 |
| liveWallpaper | LiveWallpaper | A |  | 0 | 0 | 1 | 1 |
| LivingAccent | LivingAccent | A |  | 0 | 0 | 1 | 2 |
| localmessageedit | LocalMessageEditor | N1 | ContextMenu | 1 | 0 | 0 | 1 |
| lockGroup | LockGroup | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| loginWithToken | LoginWithToken | A |  | 0 | 0 | 0 | 1 |
| longMsgTxt | LongMsgTxt | N1 | MessageEvents | 1 | 0 | 0 | 1 |
| lyricsStatus | LyricsStatus | N1 | MemberList | 0 | 0 | 1 | 1 |
| macOsButtons | MacOsButtons | B |  | 1 | 1 | 0 | 2 |
| MassDM | MassDM | H | Commands | 1 | 0 | 0 | 1 |
| mediaDownloader.desktop | ⚪ | N1 | Commands | 1 | 1 | 1 | 4 |
| MediaStatus | MediaStatus | A |  | 0 | 0 | 1 | 1 |
| messageCleaner | MessageCleaner | H | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| MessageFetchTimer | MessageFetchTimer | N2 | HeaderBar+ChatButtons | 0 | 0 | 0 | 1 |
| messageListeningCover | MessageListeningCover | A |  | 0 | 0 | 1 | 1 |
| messageLoggerTestcord | MessageLoggerTestcord | H | ContextMenu+Commands+HeaderBar+Notifications+Toasts | 1 | 1 | 1 | 19 |
| messageNitroBadge | MessageNitroBadge | A |  | 0 | 0 | 0 | 2 |
| MessageReminders | MessageReminders | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| messageScheduler | MessageScheduler | H | Commands+Notifications+Toasts | 0 | 0 | 0 | 1 |
| messageScrapper | MessagesScrapper | N2 | HeaderBar+ChatButtons+Toasts | 0 | 0 | 1 | 1 |
| messageStatistics | MessageStatistics | N2 | Commands+MessageEvents | 0 | 0 | 0 | 1 |
| MessageTags | MessageTags | N2 | ContextMenu+MessageEvents | 0 | 0 | 0 | 1 |
| MetadataViewer | MetadataScanner | N1 | ContextMenu | 0 | 1 | 1 | 6 |
| micquality | CustomMicQuality | N1 | ContextMenu | 1 | 0 | 0 | 1 |
| MicSpamGuard | MicSpamGuard | N1 | Notifications | 0 | 0 | 0 | 2 |
| miloplugin | Silly Kitten | N2 | ChatButtons+MessageEvents | 0 | 0 | 0 | 1 |
| mimicTroll | MimicTroll | H | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| MiniGames | MiniGames | N2 | ContextMenu+MessageEvents | 0 | 0 | 0 | 6 |
| Modes | Modes | N2 | Notifications+MemberList | 0 | 0 | 1 | 5 |
| moreAlts | MoreAlts | P |  | 1 | 0 | 0 | 1 |
| moreGuildDiscoveryCategories | MoreGuildDiscoveryCategories | P |  | 1 | 0 | 0 | 1 |
| moreJumboEmoji | MoreJumboEmoji | P |  | 1 | 0 | 0 | 1 |
| moreReact | MoreReact | P |  | 1 | 0 | 1 | 1 |
| MultiInstance | Secondary Discord | N1 | HeaderBar | 0 | 1 | 1 | 3 |
| MultiServerAutoban | Manual Entry Required | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| muteAllServers | MuteAllServers | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| muteunmuteservers | MuteUnmuteServers | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| mutualServerMembers | MutualServerMembers | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| NameStyleChanger | NameStyleChanger | P |  | 1 | 0 | 1 | 2 |
| nativeTranslate | NativeTranslate | N2 | ContextMenu+ChatButtons | 0 | 0 | 1 | 7 |
| navidromeRPC | NavidromeRPC | A |  | 0 | 0 | 1 | 4 |
| neonGlow | NeonGlow | A |  | 0 | 0 | 0 | 2 |
| newUserIndicator | NewUserIndicator | N2 | Badges+MemberList | 1 | 0 | 0 | 1 |
| NitroSniper | NitroSniper | H | Notifications | 0 | 0 | 0 | 1 |
| NoAgeVerif | TrustMeBro | H |  | 0 | 0 | 0 | 1 |
| noButtons | NoButtons | P |  | 1 | 0 | 0 | 1 |
| nocompress | Disable Compression | P |  | 1 | 0 | 0 | 1 |
| noDMWhileStreaming | NoDMWhileStreaming | N1 | Notifications | 1 | 0 | 0 | 2 |
| noDraftLengthLimit | NoDraftLengthLimit | P |  | 1 | 0 | 0 | 1 |
| noEditedTimestamp | NoEditedTimestamp | P |  | 1 | 0 | 0 | 1 |
| NoGifLimit | HeartGifs | N2 | ContextMenu+Commands+ChatButtons+Notifications | 0 | 0 | 1 | 1 |
| noOnboarding | NoOnboarding | H |  | 1 | 0 | 1 | 1 |
| noTelemetry | NoTelemetry | P |  | 1 | 0 | 0 | 1 |
| nsfwGateBypass | NSFWGateBypass | H |  | 0 | 0 | 0 | 1 |
| nyaaa | Nyaaa | N2 | Commands+HeaderBar | 0 | 0 | 0 | 1 |
| obsRemoteControl | OBS Remote Control | N1 | Notifications | 0 | 1 | 1 | 9 |
| openOptimizer | OpenOptimizer | A |  | 0 | 0 | 0 | 1 |
| OpSec-Illegalcord | OpSec | A |  | 0 | 0 | 0 | 1 |
| orchestratorAPI | OrchestratorAPI | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| osSpoofer | OSSpoofer | H | Commands | 1 | 0 | 0 | 1 |
| overlayFix | OverlayFix | H |  | 1 | 0 | 0 | 1 |
| owoself | OwoSelf | H | Commands+HeaderBar+Notifications | 0 | 0 | 1 | 5 |
| PanelLayout | PanelLayout | N1 | Notifications | 1 | 1 | 1 | 80 |
| passcodeLock | User | N2 | HeaderBar+Notifications | 0 | 0 | 1 | 2 |
| passwordManager | AES-GCM | A |  | 0 | 0 | 1 | 2 |
| passwordProtect | PasswordProtect | N1 | ContextMenu | 1 | 0 | 0 | 8 |
| pastelMentions | PastelMentions | A |  | 0 | 0 | 0 | 2 |
| pdf-viewer | PdfViewer | B |  | 0 | 1 | 1 | 3 |
| PerformanceBoost | PerformanceBoost | N2 | HeaderBar+Notifications+MemberList | 0 | 1 | 0 | 6 |
| philsPluginLibrary | PhilsPluginLibrary | P |  | 1 | 0 | 1 | 62 |
| PinterestProfiles | PinterestSearch | B |  | 1 | 1 | 1 | 5 |
| PinterestTool | Pinterest Tool | B |  | 0 | 1 | 1 | 10 |
| PlatformEmulator | PlatformEmulator | H | Commands | 1 | 0 | 0 | 1 |
| pluginManager | pluginManager | A |  | 0 | 0 | 0 | 1 |
| PluginsShortcutButton | Plugins Shortcut Button | A |  | 0 | 0 | 0 | 1 |
| PluginStars | PluginStars | A |  | 0 | 0 | 0 | 1 |
| pollMaker | PollMaker | N1 | Commands | 0 | 0 | 0 | 1 |
| profanityFilter | ProfanityFilter | N2 | MessageEvents+Toasts | 0 | 0 | 0 | 1 |
| profileCommand | ProfileCommand | N1 | Commands | 0 | 0 | 0 | 1 |
| profileCopyButton | ProfileCopyButton | N2 | ContextMenu+MemberList | 1 | 0 | 1 | 1 |
| ProfileMedia | ProfileMedia | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| ProfileVisibility | ProfileVisibility | N2 | HeaderBar+MemberList+Toasts | 0 | 0 | 0 | 1 |
| punishmentcommands | PunishmentCommands | H | ContextMenu | 0 | 0 | 0 | 2 |
| PurgeDMs | PurgeDMs | N1 | ContextMenu | 0 | 0 | 0 | 2 |
| purgeMessages | PurgeMessages | H | Commands | 0 | 0 | 1 | 2 |
| quickDelete | QuickDelete | A |  | 0 | 0 | 0 | 1 |
| quickmsg | QuickMsg | N1 | ChatButtons | 0 | 0 | 0 | 1 |
| quickSnippet | QuickSnippet | P |  | 1 | 0 | 0 | 2 |
| quietHours | QuietHours | A |  | 0 | 0 | 0 | 1 |
| ReactionLogger | ReactionLogger | N1 | Notifications | 0 | 0 | 0 | 1 |
| ReactionTracker | ReactionTracker | A |  | 0 | 0 | 0 | 2 |
| readableSpoilers | ReadableSpoilers | A |  | 0 | 0 | 0 | 2 |
| realtimeTimestamps | RealtimeTimestamps | P |  | 1 | 0 | 0 | 1 |
| recentBan | recentBan | N1 | Toasts | 0 | 0 | 0 | 1 |
| recentChannelSwitcher | RecentChannelSwitcher | A |  | 0 | 0 | 1 | 1 |
| relationshipIndicators | RelationshipIndicators | N2 | Badges+MemberList | 0 | 0 | 0 | 3 |
| relationshipPruner | RelationshipPruner | P |  | 1 | 0 | 1 | 6 |
| remoteControl | remoteControl | H | Commands+Notifications+MemberList | 0 | 0 | 0 | 7 |
| ReorderAttachments | ReorderAttachments | P |  | 1 | 0 | 0 | 2 |
| repeatMessage | RepeatMessage | H | ContextMenu | 0 | 0 | 1 | 1 |
| robloxfilter | RobloxFilter | N2 | Notifications+Toasts | 0 | 0 | 0 | 1 |
| roleDuplication | RoleDuplication | N2 | ContextMenu+MemberList | 0 | 0 | 1 | 4 |
| rotatorSuite | Rotator Suite | H | MemberList+Toasts | 0 | 0 | 1 | 1 |
| RoundedVcPfp | RoundedVCPFP | P |  | 1 | 0 | 1 | 2 |
| rpcMirror | RpcMirror | B |  | 0 | 1 | 0 | 2 |
| rPunisher | retardExterminator | H | Toasts | 0 | 0 | 0 | 1 |
| runInConsole | RunInConsole | H |  | 1 | 0 | 1 | 2 |
| rzblack | Voice Channel Blacklist | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| rzengz | AutoJumpToMention | P |  | 1 | 0 | 0 | 1 |
| rznoone | Pin to Voice Channel | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| safeNumbers | SafeNumbers | N2 | HeaderBar+MessageEvents | 0 | 0 | 0 | 1 |
| saveUserGifs | SaveUserGifs | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| ScreenshareKeybind | ScreenshareKeybind | P |  | 1 | 0 | 0 | 1 |
| SearchUtility | quick-search-channel | N2 | ContextMenu+Commands+MemberList | 1 | 0 | 1 | 4 |
| SecurecordOpossum | SecurecordOpossum | N2 | Commands+HeaderBar+ChatButtons+MessageEvents+Toasts | 0 | 0 | 0 | 1 |
| selfDestruct | SelfDestruct | N2 | HeaderBar+ChatButtons | 0 | 0 | 1 | 1 |
| selfForward | SelfForward | P |  | 1 | 0 | 0 | 1 |
| sendtoalldms | SendToAllDMs | H | Commands | 0 | 0 | 0 | 1 |
| sentfrommyuname | SentFromMyUname | B |  | 0 | 1 | 0 | 2 |
| serverBackup | ServerBackup | N1 | Commands | 0 | 0 | 0 | 1 |
| serverPinner | Server Pinner | N2 | ContextMenu+Notifications | 0 | 0 | 0 | 1 |
| serverProfilesToolbox | ServerProfilesToolbox | N1 | Toasts | 1 | 0 | 0 | 2 |
| ServerPruner | ServerPruner | P |  | 1 | 0 | 1 | 2 |
| ServerToolkit | ServerToolkit | N1 | ContextMenu | 0 | 0 | 1 | 12 |
| setAge | SetAge | H |  | 0 | 0 | 0 | 1 |
| settingsShortcuts | SettingsShortcuts | A |  | 0 | 0 | 0 | 1 |
| sharePerms | SharePerms | N2 | Commands+HeaderBar | 0 | 0 | 0 | 1 |
| shareVCBan | ShareBanPerm | H | ContextMenu+Toasts | 0 | 0 | 0 | 1 |
| shipCalc | ShipCalc | N1 | Commands | 0 | 0 | 0 | 1 |
| ShowOff | ShowOff | A |  | 0 | 0 | 0 | 1 |
| showTypingUsers | ShowTypingUsers | A |  | 0 | 0 | 0 | 1 |
| shytyping | ShyTyping | P |  | 1 | 0 | 0 | 1 |
| Silentcall | SilentCall | N2 | ContextMenu+Commands+ChatButtons | 0 | 0 | 0 | 1 |
| SilentDelete | SilentDelete | N2 | ContextMenu+Commands | 0 | 0 | 0 | 1 |
| SilentEdit | SilentEdit | H | ContextMenu | 0 | 0 | 0 | 1 |
| sillyMaxwell | Maxwell :3 | A |  | 0 | 0 | 1 | 2 |
| simplifiedProfileNotes | SimplifiedProfileNotes | P |  | 1 | 0 | 0 | 1 |
| smallCaps | SmallCaps | N1 | Commands | 0 | 0 | 0 | 1 |
| smoothmessages | SmoothMessages | A |  | 0 | 0 | 0 | 3 |
| socket.desktop | Socket | N1 | Notifications | 0 | 1 | 0 | 2 |
| soloaudio | Group 1 | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| SortReactions | SortReactions | P |  | 1 | 0 | 0 | 1 |
| soundboardPro | Bruh | N1 | Notifications | 1 | 0 | 1 | 2 |
| soundcloudRichPresence | SoundCloud | A |  | 0 | 0 | 1 | 1 |
| soundTriggers | SoundTriggers | N1 | Toasts | 0 | 0 | 0 | 10 |
| spaceOut | SpaceOut | N1 | Commands | 0 | 0 | 0 | 1 |
| spoofmsgv2 | Server Level | H | Commands | 0 | 0 | 1 | 1 |
| spotifyAddToQueue.desktop | SpotifyAddToQueue | B |  | 1 | 1 | 1 | 2 |
| staffScanner | StaffScanner | N2 | Commands+Notifications+Toasts | 1 | 0 | 1 | 1 |
| staffTag | StaffTag | P |  | 1 | 0 | 0 | 1 |
| stalker | Stalker | N2 | ContextMenu+Notifications | 0 | 1 | 0 | 7 |
| starfield | Starfield | A |  | 0 | 0 | 0 | 2 |
| starify | Starify | N1 | Commands | 0 | 0 | 0 | 1 |
| statuscommand | StatusCommand | N2 | Commands+MemberList | 0 | 0 | 0 | 1 |
| StereoGuard | StereoGuard | A |  | 0 | 0 | 0 | 2 |
| stereoInstaller.desktop | StereoInstaller | N1 | Notifications | 0 | 1 | 1 | 3 |
| stereoLoader.desktop | StereoLoader | N1 | Notifications | 0 | 1 | 1 | 3 |
| stereoScreenshareAudio | StereoScreenshareAudio | A |  | 0 | 0 | 1 | 1 |
| stickymessages | StickyMessages | H | HeaderBar | 0 | 0 | 0 | 1 |
| StreamEnhancer | StreamEnhancer | N2 | ContextMenu+Toasts | 0 | 0 | 1 | 18 |
| streamProof | StreamProof | N2 | HeaderBar+ChatButtons | 0 | 1 | 1 | 3 |
| StreamQuality | CustomStreamQuality | P |  | 1 | 0 | 0 | 3 |
| summarizeAI | SummarizeAI | N1 | Commands | 0 | 0 | 1 | 1 |
| sunsetChat | SunsetChat | A |  | 0 | 0 | 0 | 2 |
| surfaceTranslate | SurfaceTranslate | P |  | 1 | 0 | 1 | 1 |
| Surveillance | Unknown user | N2 | ContextMenu+Notifications+MessageEvents+Toasts | 0 | 0 | 0 | 6 |
| systemMessageSpoofer | SystemMessageSpoofer | H | Commands | 0 | 0 | 0 | 1 |
| tempMail | TempMail | N1 | HeaderBar | 0 | 1 | 1 | 7 |
| TestcordAI | TestcordAI | N1 | ContextMenu | 1 | 1 | 1 | 5 |
| TestcordCosmetics | Testcord | P |  | 1 | 0 | 0 | 1 |
| TestcordHelper | TestcordHelper | H | Commands+MessageEvents+MemberList | 1 | 1 | 1 | 5 |
| TestcordOptimizer | TestcordOptimizer | N1 | Toasts | 1 | 0 | 1 | 4 |
| testcordosinttoolkit | See-Know | H | ContextMenu+Commands+HeaderBar | 0 | 1 | 1 | 8 |
| testcordToolbox | TestcordToolbox | N2 | HeaderBar+Notifications | 0 | 0 | 1 | 3 |
| testfetch | testfetch | N1 | Commands | 0 | 1 | 0 | 2 |
| teX | TeX | P |  | 1 | 0 | 1 | 3 |
| textScreenshot | TextScreenshot | N1 | Commands | 0 | 0 | 1 | 2 |
| tiktokTTS | TiktokTTS | N1 | ContextMenu | 0 | 0 | 1 | 1 |
| timeAlog | timeAlog | H | HeaderBar | 0 | 0 | 0 | 1 |
| timeDelete | timeDelete | N1 | HeaderBar | 0 | 0 | 0 | 1 |
| timelessclips | TimelessClips | P |  | 1 | 0 | 0 | 1 |
| token | Token Display | H | Commands | 0 | 0 | 0 | 1 |
| tokenImporter | TokenImporter | H | HeaderBar | 0 | 1 | 1 | 3 |
| tokenLogin | TokenLoginManager | A |  | 0 | 0 | 1 | 2 |
| toneIndicators | ToneIndicators | P |  | 1 | 0 | 0 | 2 |
| TranslatePremium | TranslatePremium | N2 | ContextMenu+Toasts | 0 | 0 | 1 | 1 |
| TriggerWarning | TriggerWarning | P |  | 1 | 0 | 0 | 1 |
| tsunderetalk | TsundereTalk | N2 | HeaderBar+MessageEvents | 0 | 0 | 0 | 1 |
| typingFriends | TypingFriends | P |  | 1 | 0 | 1 | 1 |
| TypingSettings | TypingSettings | A |  | 0 | 0 | 0 | 1 |
| UniversalVolume | UniversalVolume | A |  | 0 | 0 | 0 | 1 |
| UnlimitedFavoriteGIFs | UnlimitedFavoriteGIFs | P |  | 1 | 0 | 0 | 1 |
| userAreaTweaks | UserAreaTweaks | A |  | 0 | 0 | 0 | 1 |
| userflags | UserFlags | N1 | Commands | 0 | 0 | 0 | 1 |
| userNotes | UserNotes | N2 | ContextMenu+Toasts | 1 | 0 | 1 | 9 |
| userpluginInstaller | UserpluginInstaller | N1 | Notifications | 0 | 1 | 0 | 4 |
| UserTools | UserTools | H | ContextMenu+HeaderBar+Toasts | 1 | 0 | 0 | 2 |
| vAnalyzer-main | vAnalyzer | N2 | ContextMenu+Toasts | 0 | 1 | 1 | 37 |
| vaporScrollbar | VaporScrollbar | A |  | 0 | 0 | 0 | 2 |
| vaporwaveText | VaporwaveText | N1 | Commands | 0 | 0 | 0 | 1 |
| vc-autocorrect | AutoCorrect | P |  | 1 | 0 | 1 | 1 |
| vc-betterActivities | BetterActivities | P |  | 1 | 0 | 1 | 6 |
| vc-blockKrisp | BlockKrisp | B |  | 1 | 1 | 0 | 2 |
| vc-followUser | FollowUser | N2 | ContextMenu+Toasts | 1 | 0 | 0 | 2 |
| vc-goodperson | GoodPerson | A |  | 0 | 0 | 0 | 1 |
| vc-ignoreTerms | IgnoreTerms | P |  | 1 | 0 | 0 | 1 |
| vc-junkCleanup-main | JunkCleanup | P |  | 1 | 0 | 0 | 2 |
| vcNarratorCustom | VcNarratorCustom | N1 | ContextMenu | 0 | 0 | 1 | 3 |
| vc-NewlinesInCommands | NewlinesInCommands | P |  | 1 | 0 | 0 | 1 |
| vc-notifyUserChanges | NotifyUserChanges | N2 | ContextMenu+Notifications | 0 | 0 | 1 | 3 |
| vcOwnerDetector | vcOwnerDetector | N2 | ContextMenu+Toasts | 1 | 0 | 0 | 2 |
| vcpanelsettings | VCPanelSettings | P |  | 1 | 0 | 0 | 2 |
| vcR | vcGrape | N2 | ContextMenu+Toasts | 0 | 0 | 1 | 1 |
| vc-showMessageEmbeds | ShowMessageEmbeds | N2 | ContextMenu+MessageEvents | 1 | 0 | 1 | 1 |
| vc-silentTypingEnhanced | SilentTyping | N2 | Commands+HeaderBar+ChatButtons | 1 | 0 | 1 | 1 |
| vc-voiceChatUtilities | VoiceChatUtilities | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| vencord-antirickroll | AntiRickroll | N1 | MemberList | 0 | 0 | 0 | 3 |
| vencord-ExitSounds | ExitSounds | N1 | ContextMenu | 1 | 0 | 0 | 1 |
| vencord-gpubinder-main | GpuBinder | N1 | Toasts | 0 | 1 | 0 | 2 |
| vencord-perf-main | perf | P |  | 1 | 0 | 0 | 1 |
| versions | Versions | P |  | 1 | 0 | 0 | 1 |
| vibeCheck | VibeCheck | N1 | Commands | 0 | 0 | 0 | 1 |
| videoStartNotifier | VideoStartNotifier | A |  | 0 | 0 | 1 | 1 |
| viewRawVariant | ViewRawVariant | N1 | ContextMenu | 0 | 0 | 0 | 1 |
| Vimium | Vimium | A |  | 0 | 0 | 0 | 3 |
| voiceChannelSearch | VoiceChannelSearch | N1 | HeaderBar | 0 | 0 | 1 | 3 |
| VoiceCount | VoiceCount | P |  | 1 | 0 | 0 | 2 |
| voiceDictation | VoiceDictation | N2 | HeaderBar+ChatButtons | 0 | 0 | 1 | 1 |
| VoiceFakeDetector | VoiceFakeDetector | N1 | Notifications | 1 | 0 | 0 | 2 |
| voiceGuard | VoiceGuard | N2 | ContextMenu+Toasts | 0 | 0 | 0 | 2 |
| voicehighquality | rzStudioAudio | P |  | 1 | 0 | 0 | 1 |
| voiceJoinMessages | Clyde | A |  | 0 | 0 | 0 | 1 |
| voiceServerInfo | VoiceServerInfo | N2 | Commands+HeaderBar+Notifications | 0 | 1 | 1 | 4 |
| voiceSettings | VoiceSettings | P |  | 1 | 0 | 0 | 1 |
| VoiceVUMeters | VoiceVUMeters | P |  | 1 | 0 | 0 | 2 |
| waitForSlot | WaitForSlot | N1 | ContextMenu | 1 | 0 | 1 | 1 |
| webcamStartNotifier | WebcamStartNotifier | A |  | 0 | 0 | 1 | 1 |
| WebCordHardened | RTCPeerConnection | A |  | 0 | 0 | 1 | 1 |
| WebhookSend | WebhookSend | N1 | HeaderBar | 0 | 1 | 1 | 3 |
| webRtcLeakPrevent | RTCPeerConnection | A |  | 0 | 0 | 0 | 1 |
| Wellbeing | Wellbeing | N1 | MemberList | 0 | 0 | 0 | 5 |
| wikiLookup | WikiLookup | N1 | Commands | 0 | 0 | 1 | 1 |
| wordBomb | WordBomb | N1 | HeaderBar | 0 | 0 | 1 | 3 |
| wordCount | WordCount | A |  | 0 | 0 | 0 | 1 |
| yaoi | PurrBot | N1 | Commands | 0 | 0 | 1 | 1 |
| yMusicSync.desktop | YMusicSync | B |  | 0 | 1 | 1 | 31 |
| ytdownloader | ⚪ | N1 | Commands | 1 | 1 | 1 | 4 |
| yuri | PurrBot | N1 | Commands | 0 | 0 | 1 | 1 |
| ZeroWidthSanitizer | ZeroWidthSanitizer | N1 | MessageEvents | 0 | 0 | 0 | 1 |
| ZIPplus | ZIP+ | N1 | ContextMenu | 1 | 0 | 1 | 6 |

## 9. Correction after wave 2 (2026-10-26)

Reading the plugins of bucket A one by one showed the bucket is too optimistic: the text matching looked for imports of TestCord's APIs, and missed several that plugins use through other names. These bucket A plugins turned out to need an engine piece that does not exist, so they belong in N1 or N2, not in A:
- `wordCount` (message accessories), `betterJoinedDate` (profile sections), `dmReadReceipt` (message decorations), `PluginStars` (hooks into the plugin list), `voiceJoinMessages` (fake bot messages in a DM), `vc-goodperson` (`onBeforeMessageSend`), `ReactionTracker` (settings panel component and stats UI).
- `showTypingUsers` registers event handlers but never mounts its badge anywhere (there is no patch or API call that draws it), so as written it shows nothing; not adapted.
- `openOptimizer` replaces `Element.prototype.appendChild` and `removeChild` for the whole page and delays some nodes by 100 ms; that can break Discord's own interface, so it is not adapted without a decision.
- `FakeIndicators` is an empty placeholder: nothing to adapt.
Moved to the held-back list (my proposal): `antiNickname` (removes a nickname a moderator forced on you, by writing to your profile), `antiDeco` (rejoins a voice channel after a forced disconnect), `askMeToMute` and `autoUnmute` (undo server mutes automatically), `FollowMajority` (joins voice channels on its own). The reason is the same as in section 4: they act on the account on their own, and several undo a moderation action. They are not technically hard; the owners decide.
Real count of what fits today from the part of bucket A that was read so far: LazyMessageRender, UniversalVolume, MessageNitroBadge and WebRTCLeakPrevent (wave 2), plus the ten of wave 1. The rest of bucket A (about 40 plugins with `net` or `dom` and the long tail) has not been read yet.
