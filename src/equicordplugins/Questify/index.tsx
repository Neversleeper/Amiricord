/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's Flux events carry untyped payloads */

// Adapted for Amiricord (2026) by szlcx404 from the plugin Questify (author Etorix) as found in Equicord. The plugin is now the `PluginCode` below;

import type { JSX } from "react";

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { playAudio } from "./amiricord/audio";
import { NavigationRouter } from "./amiricord/common";
import { ErrorBoundary } from "./amiricord/components";
import { bindContext } from "./amiricord/context";
import { adaptPatches, type VencordPatch } from "./amiricord/patches";
import { pluginModalCss, QuestifySettingsPanel } from "./amiricord/pluginModal";
import { addServerListElement, removeServerListElement, ServerListRenderPosition, ServerListWrapper } from "./amiricord/serverList";
import { PlainSettings, setPluginEnabled, Settings } from "./amiricord/settings";
import { findComponentByCodeLazy, onceReady } from "./amiricord/webpack";
import { disguiseHomeButton, QuestButton, showQuestButton } from "./components/questButton";
import type { Quest, QuestUserStatus } from "./discordTypes";
import { getQuestifySettings } from "./settings/access";
import { resetQuestsToResume, startAutoFetchingQuests, stopAutoFetchingQuests } from "./settings/fetching";
import { validateIgnoredQuests } from "./settings/ignoredQuests";
import { showPendingQuestifyNotice } from "./settings/notices";
import { rerenderQuests, useQuestRerender } from "./settings/rerender";
import { disposeRestartTracking, initializeRestartTracking, promptToRestartIfDirty, setRestartDirty } from "./settings/restartTracking";
import { settings } from "./settings/store";
import { getSettingsModalOpen, initialQuestDataFetched, setInitialQuestDataFetched, setSettingsModalOpen } from "./state";
import { QuestStore } from "./stores";
import { questifyCss, settingsCss } from "./styles";
import { canAutoCompleteQuest, getActiveAutoCompletes, getQuestAutoCompleteProgress, getQuestButtonProps, getQuestPanelSubtitleText, hasEnabledAutoCompleteQuestTypes, processQuestForAutoComplete, resetResumeAttempts, resumeInterruptedAutoCompletes, setHeartbeatStackTracePatchSucceeded, setVideoProgressStackTracePatchSucceeded, stopAllAutoCompletes, stopAutoCompletesForRunningGames, stopQuestAutoComplete } from "./utils/completion";
import { canOpenDevToolsWindow, fetchAndDispatchQuests, openDevToolsWindow, snakeToCamel } from "./utils/fetching";
import { normalizeQuestName } from "./utils/filtering";
import { notifyQuestCompletion, QL } from "./utils/logging";
import { getQuestEmbedProgress, getQuestPanelOverride, getQuestPanelPercentComplete, shouldForceQuestPanelVisible } from "./utils/questState";
import { getLastFilterChoices, getLastSortChoice, getQuestTileClasses, getQuestTileStyle, setLastFilterChoices, setLastSortChoice, shouldPreloadQuestAssets, sortQuests } from "./utils/questTiles";
import { formatLowerBadge, QUEST_PAGE } from "./utils/ui";

let isSwitchingAccount = false;
let didAttemptAutoCompleteResume = false;
const notifiedCompletedQuests = new Set<string>();
export const enabledOnStartup = PlainSettings.plugins.Questify?.enabled;

function setOnQuestsPage(force?: boolean): void {
    getQuestifySettings().isOnQuestsPage = force ?? (window.location.pathname === QUEST_PAGE);
}

function applyDefaultQuestSort(): void {
    try {
        const settings = getQuestifySettings();

        if (settings.disableQuestsEverything || window.location.pathname !== QUEST_PAGE || /[?&]sort=/.test(window.location.search)) {
            return;
        }

        if (getLastSortChoice() !== "questify") {
            return;
        }

        NavigationRouter.transitionTo(`${QUEST_PAGE}?sort=questify`);
    } catch (error) {
        QL.warn("DEFAULT_SORT_FAILED", { error: String(error) });
    }
}

function startPerAccountTasks(source: string): void {
    const startedAt = Date.now();

    setOnQuestsPage();
    applyDefaultQuestSort();
    startAutoFetchingQuests();
    resumeAutoCompletesIfReady();
    fetchAndDispatchQuests();

    QL.info(`START_TASKS-${source.toUpperCase()}`, { startedAt });
}

function stopPerAccountTasks(source: string, preserveResume: boolean = true): void {
    const stoppedAt = Date.now();

    setOnQuestsPage();
    stopAutoFetchingQuests();
    notifiedCompletedQuests.clear();
    stopAllAutoCompletes({ manual: false, preserveResume, terminalHeartbeat: true });

    QL.info(`STOP_TASKS-${source.toUpperCase()}`, { stoppedAt });
}

function resumeAutoCompletesIfReady(): void {
    if (didAttemptAutoCompleteResume || !initialQuestDataFetched) {
        return;
    }

    didAttemptAutoCompleteResume = resumeInterruptedAutoCompletes();
}

const Button = findComponentByCodeLazy("BUTTON_LOADING_STARTED_LABEL)),");

function enrolledIncompleteButton(args: { quest: Quest; size: string; }): JSX.Element | null {
    const props = getQuestButtonProps({ quest: args.quest });

    if (!props) {
        return null;
    }

    return (
        <ErrorBoundary noop>
            <Button
                size={args.size}
                variant="secondary"
                disabled={false}
                fullWidth={true}
                {...props}
            />
        </ErrorBoundary>
    );
}

function wrapOrbsBalance(balance: string): JSX.Element {
    return (<span style={{ fontSize: "90%" }}>{balance}</span>);
}

const renderQuestifyButton = ErrorBoundary.wrap(QuestButton, { noop: true });

const questifyPatches: VencordPatch[] = [
    {
        find: ",NodeFilter.SHOW_ELEMENT,{acceptNode:function(",
        replacement: {
            match: /\.focus\(\)/g,
            replace: ".focus({preventScroll:$self.getSettingsModalOpen()?!0:undefined})"
        }
    },
    {
        find: '="DOWNLOAD_APPS";function',
        replacement: {
            match: /(?<=\i\.\i\(\i,\{)(?=\i:\(\)=>\i.{0,30000}?let (\i)=function\(\i\)\{let\{ref:)/,
            replace: "GuildlessServerListItemComponent:()=>$1,"
        }
    },
    {
        find: "GLOBAL_DISCOVERY),",
        predicate: () => !getQuestifySettings().disableQuestsEverything && showQuestButton(getQuestifySettings().questButtonDisplay, 1, true),
        replacement: {
            match: /(pathname:(\i)}.{0,400}?return )/,
            replace: "$1$self.disguiseHomeButton($2)?false:"
        }
    },
    {
        find: '("ActivityStatus"),',
        predicate: () => getQuestifySettings().disableQuestsEverything || getQuestifySettings().disableMembersListPromo,
        replacement: {
            match: /,hasQuest:(?=\i=!1)/,
            replace: ",questifyInvalid1:"
        }
    },
    {
        find: "`application-stream-",
        predicate: () => getQuestifySettings().disableQuestsEverything || getQuestifySettings().disableFriendsListPromo,
        replacement: [
            {
                match: /(?<=let{party:\i,onChannelContextMenu:\i,)quest:(\i)/,
                replace: "questifyInvalid2:$1=null"
            }
        ]
    },
    {
        find: "GLOBAL_DISCOVERY_SIDEBAR},",
        predicate: () => getQuestifySettings().disableQuestsEverything || getQuestifySettings().disableRelocationNotices,
        replacement: [
            {
                match: /GLOBAL_DISCOVERY_TABS/g,
                replace: '$&.filter(tab=>tab!=="quests")'
            }
        ]
    },
    {
        find: '.QUEST_HOME)},"quests")',
        predicate: () => getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(?<="family-center"\)(?:&&undefined)?:null,)/,
                replace: "null&&"
            }
        ]
    },
    {
        find: "QUEST_HOME)},[]),",
        predicate: () => !getQuestifySettings().disableQuestsEverything && getQuestifySettings().disableSponsoredBanner,
        replacement: {
            match: /(?<=,{questHomeHero:(\i),isLoading:(\i),confirmedEmpty:(\i)}=.{0,300}?ORBS_BALANCE_MENU}\)},\[\]\);)/,
            replace: "$1=null;$2=false;$3=true;"
        }
    },
    {
        find: ".MODAL]:26",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything && getQuestifySettings().disableOrbsAndQuestsBadges,
        replacement: [
            {
                match: /(,{badges:\i)(?=,overflowCount:\i,displayProfile:\i)/,
                replace: '$1.filter(badge=>!["quest_completed","orb_profile_badge"].includes(badge.id))'
            }
        ]
    },
    {
        find: "collapsed-with-rewards\":\"collapsed-without-rewards",
        predicate: () => getQuestifySettings().disableAccountPanelPromo || !getQuestifySettings().disableAccountPanelQuestProgress,
        replacement: {
            match: /(?<=function\(\)\{)(let (\i)=\(0,\i\.\i\)\(\),\i=\(0,\i\.\i\)\(.{0,55}?\);)(?=switch\(\2\.type\)\{case (\i\.\i\.QUEST):)/,
            replace: "void $self.useQuestRerender();$1$2=$self.getQuestPanelOverride($2,$3);if(null==$2)return null;"
        }
    },
    {
        find: 'type:"QUESTS_FETCH_CURRENT_QUESTS_BEGIN"',
        group: true,
        predicate: () => getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(?<=if\(\i.\i.isFetchingCurrentQuests)/,
                replace: "||true"
            },
            {
                match: /(?=let \i=Date.now\(\);\i.recordQuestRequestAttempt.{0,50}QUESTS_FETCH_QUEST_TO_DELIVER_BEGIN)/,
                replace: "return;"
            }
        ]
    },
    {
        find: ",{progressTextAnimation:",
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: {
            match: /(let{percentComplete:[^}]+}=)(\i)/,
            replace: "const questifyProgress=$self.getQuestPanelPercentComplete({...$2,quest:$2.children?.props?.quest});$1Object.assign({},$2,questifyProgress??{})"
        }
    },
    {
        find: '"progress-title"',
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: {
            match: /(?<={quest:(\i).{0,250}?return.{0,150}?,percentComplete:\i.{0,280}?"progress-title",children.{0,115}?children:)(\i.{0,50}"progress-subtitle",isTextTransition:!0,children.{0,115}?children:)/,
            replace: "$self.normalizeQuestName($1)??$2$self.getQuestPanelSubtitleText($1)??"
        }
    },
    {
        find: '("BalanceCounter")',
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(`\${(\i).toFixed\(0\)}`.length)/,
                replace: "$1+($2>=1e6?0.8:$2>=1e3?0.4:0)"
            },
            {
                match: /(?<=children:\i.to\(\i=>`\${\i).toFixed\(0\)/,
                replace: ".toLocaleString(undefined,{maximumFractionDigits:0})"
            }
        ]
    },
    {
        find: 'location:"BalanceWidgetMenu"',
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(?<=children:)(\i\?\?0)/,
                replace: "$self.wrapOrbsBalance(($1).toLocaleString(undefined,{maximumFractionDigits:0}))"
            }
        ]
    },
    {
        find: "NetworkActionNames.QUEST_VIDEO_PROGRESS,",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything && hasEnabledAutoCompleteQuestTypes(),
        replacement: [
            {
                match: /(async function \i\(\i,\i\)\{await \i\.\i\.post\(\{url:\i\.\i\.QUESTS_VIDEO_PROGRESS.{0,250}?stack_trace:)Error\(\)\.stack\?\?""/,
                replace: '$self.setVideoProgressStackTracePatchSucceeded();$1""'
            },
            {
                match: /(async function \i\(\i\)\{let\{questId:\i,streamKey:\i.{0,450}?stack_trace:)Error\(\)\.stack\?\?""/,
                replace: '$self.setHeartbeatStackTracePatchSucceeded();$1""'
            }
        ]
    },
    {
        find: "[QV] | Pausing video | playerState:",
        predicate: () => !getQuestifySettings().disableQuestsEverything && getQuestifySettings().preventVideoQuestsPausing,
        replacement: {
            match: /(?<=setCaptionEnabled\),)({focused:)(\i)/,
            replace: "$2=true,$1questifyFocused"
        }
    },
    {
        find: ",listenForHlsErrors:!1",
        predicate: () => !getQuestifySettings().disableQuestsEverything && getQuestifySettings().preventVideoQuestsPausing,
        replacement: {
            match: /(?<=pauseOnLostVisibility:)!\i/,
            replace: "false"
        }
    },
    {
        find: "QUEST_HOME)},[]),",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(\{ref:\i,\.\.\.\i\}=\i,\i=\i\.useRef\(null\),)(?=\[\i,\i\]=)/,
                replace: "$1questRerenderTrigger=$self.useQuestRerender(),"
            },
            {
                match: /(\i.\i.SUGGESTED)/,
                replace: "$self.getLastSortChoice()??$1"
            },
            {
                match: /(get\(\i\)\)\?\?)(\i,\[)(\i)(\]\),\i=\i.useCallback\((\i)=>{)(.{0,60}?useCallback\((\i)=>{)/,
                replace: "$1$self.getLastFilterChoices()??$2$3,questRerenderTrigger$4$self.setLastSortChoice($5);$6$self.setLastFilterChoices($7);$self.rerenderQuests();"
            },
            {
                match: /(?<=ALL,\i.useMemo\(\(\)=>\()({sortMethod:(\i),filters:(\i))/,
                replace: "$self.setLastSortChoice($2),$self.setLastFilterChoices($3),$1"
            }
        ]
    },
    {
        find: "config.taskConfigV2.tasks).length)return",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything && hasEnabledAutoCompleteQuestTypes(),
        replacement: [
            {
                match: /(?<=,text:\i,icon:\i,iconPosition:\i,fullWidth:!0)(?=,"aria-disabled":\i\|\|void 0)/,
                replace: ",...($self.getQuestButtonProps(arguments[0])??{})"
            },
            {
                match: /(case \i\.\i\.(?:ENROLLED|INCOMPLETE):return)(?=\(0,\i\.jsx\)\(\i,\{quest:(\i),taskType:\i(?:\.type)?,size:(\i),)/g,
                replace: "$1 $self.enrolledIncompleteButton({quest:$2,size:$3})||"
            }
        ]
    },
    {
        find: "collapsed-with-rewards\":\"collapsed-without-rewards",
        predicate: () => !getQuestifySettings().disableQuestsEverything && hasEnabledAutoCompleteQuestTypes(),
        replacement: {
            match: /(?<=SELECT&&!\i&&!\i,(\i)=null;)(return )(\i\?\i=\(0,\i.\i\)\(\i,{quest:(\i))/,
            replace: "const questifyButton=$self.enrolledIncompleteButton({quest:$4,size:\"sm\"});$2questifyButton?$1=questifyButton:$3"
        }
    },
    {
        find: "prevIsQuestAccepted:",
        predicate: () => !getQuestifySettings().disableQuestsEverything && !getQuestifySettings().disableAccountPanelQuestProgress,
        replacement: {
            match: /(?<=isLoading:\i}=\(0,\i\.\i\)\(\),\i=\i\.useContext\(\i\.\i\),\i=\i\|\|\i&&)(\i)/,
            replace: "($1||$self.shouldForceQuestPanelVisible(arguments[0].quest))"
        }
    },
    {
        find: "questNameHeadingId",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(\i===\i\.\i\.ENROLLED&&)(?=\(0,\i\.\i\)\((\i)\))/,
                replace: "$1!$self.canAutoCompleteQuest($2)&&"
            },
            {
                match: /(\(\i===\i\.\i\.ENROLLED\|\|\i===\i\.\i\.INCOMPLETE\)&&)(?=\(0,\i\.\i\)\((\i)\))/,
                replace: "$1!$self.canAutoCompleteQuest($2)&&"
            },
            {
                match: /(\(\i===\i\.\i\.COMPLETED\|\|\i===\i\.\i\.CLAIMED\)&&)(?=\(0,\i\.\i\)\((\i)\))/,
                replace: "$1!$2.config.ctaConfig&&"
            },
            {
                match: /(?<=wrap:!1,children:\[)(\i)(?=&&\(0,\i\.jsx\)\(\i,\{quest:(\i))/,
                replace: "($2.config.ctaConfig||$1)"
            }
        ]
    },
    {
        find: 'STEP_2_CLICKED_INTERNAL,"quest_embed_card_footer',
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(?<=function \i\(\i\){)(?=let\{quest:\i,location:\i,questContentPosition:\i,sourceQuestContent:)/,
                replace: "void $self.useQuestRerender();"
            },
            {
                match: /(?<=\{completedRatio:\i,completedRatioDisplay:\i\}=)(\(0,\i\.\i\)\((\i)\))/,
                replace: "Object.assign({},$1,$self.getQuestEmbedProgress($2)??{})"
            },
            {
                match: /(?<=className:)(\i\(\)\(\i.\i,\i.\i\)(?=,onMouseEnter:\i))/,
                replace: "$self.getQuestTileClasses($1,arguments[0].quest),style:$self.getQuestTileStyle(arguments[0].quest)"
            }
        ]
    },
    {
        find: "questNameHeadingId",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(?=return\(0,\i\.\i\)\("article",\{id:)/,
                replace: "void $self.useQuestRerender();"
            },
            {
                match: /(?<=className:)(\i\(\)\(\i\.\i,\i\))(?=,onMouseEnter)/,
                replace: "$self.getQuestTileClasses($1,arguments[0].quest),style:$self.getQuestTileStyle(arguments[0].quest)"
            },
            {
                match: /(?<=showPlaceholder:)(!\i)(?=,width)/g,
                replace: "$self.shouldPreloadQuestAssets()?!1:$1"
            },
            {
                match: /(?<=onLoadComplete:\i,lazyLoad:)!0/g,
                replace: "$self.shouldPreloadQuestAssets()?!1:!0"
            },
            {
                match: /(?<=isVisibleInViewport:)(\i)(?=,sourceQuestContent:\i\}\))/g,
                replace: "$self.shouldPreloadQuestAssets()?true:$1"
            }
        ]
    },
    {
        find: "EXPIRING_SOON=\"expiring_soon\"",
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: {
            match: /(?<=\(\((\i)=\(?\{\}\)?\))(?=\.SUGGESTED="suggested",)/,
            replace: ".QUESTIFY=\"questify\",$1"
        }
    },
    {
        find: "has no rewards configured`",
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: {
            match: /(?=case (\i\.\i)\.SUGGESTED)/,
            replace: "case $1.QUESTIFY:return\"Questify\";"
        }
    },
    {
        find: "CLAIMED=\"claimed\",",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /,(\i)=new Map\((\i)\.map/,
                replace: ";const questRerenderTrigger=$self.useQuestRerender();const questifySorted=$self.sortQuests($2,arguments[1]?.sortMethod!==\"questify\");const questifyListChanged=questifySorted!==$2;$2=questifySorted;let $1=new Map($2.map"
            },
            {
                match: /(?<=if\()(?=\i\.current\.length>0&&\i\.current===)/,
                replace: "!questifyListChanged&&"
            },
            {
                match: /(?<=if\()(?=\i\.current\.length>0&&\i\.current\.length===)/,
                replace: "!questifyListChanged&&"
            },
            {
                match: /(?<=\{sortMethod:(\i).{0,800}?return )((\i).sort)/,
                replace: "$1===\"questify\"?$3:$2"
            },
            {
                match: /(?=]\)\),\i=\(\i=\i.useMemo\(\(\)=>\i.filter)/,
                replace: ",questRerenderTrigger,questifySorted"
            }
        ]
    },
    {
        find: ".ALL)}):(",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: [
            {
                match: /(return \i&&0===\i.length.{0,150}?children:)\[\.\.\.(\i).{0,100}?claimedAt\?\?""\)\)/,
                replace: "const questifySorted=$self.sortQuests($2);$1questifySorted"
            }
        ]
    },
    {
        find: "NOT_SHAREABLE}function",
        group: true,
        predicate: () => !getQuestifySettings().disableQuestsEverything,
        replacement: {
            match: /(?<=return )(?=\i.sharePolicy!==\i.\i.NOT_SHAREABLE)/,
            replace: "true||"
        }
    },
    {
        find: ".BADGE_NOTIFICATION_BACKGROUND.css,disableColor",
        group: true,
        replacement: [
            {
                match: /(\(\i\){let{count:\i,)/,
                replace: "$1maxDigits,"
            },
            {
                match: /(children:\i\(\i)/,
                replace: "$1,maxDigits"
            },
            {
                match: /(?<=function \i\((\i))(\){return )(\i<1e3.{0,60}?k\+`)/,
                replace: ",maxDigits$2maxDigits===undefined?($3):$self.formatLowerBadge($1,maxDigits)[0]"
            }
        ]
    },
    {
        // Amiricord only (not in Equicord's Questify): Vencord's server list API is not in Amiricord's engine, so this patch does its job. It puts
        find: /\i,\{guildDiscoveryButton:/,
        replacement: {
            match: /(\i(?:\.\i)*),\{(?=guildDiscoveryButton:)/,
            replace: "$self.ServerListWrapper,{__amiricordOriginal:$1,"
        }
    }
];

const plugin: PluginCode & Record<string, unknown> = {
    settings,

    get patches() {
        return adaptPatches(questifyPatches);
    },

    canOpenDevToolsWindow,
    canAutoCompleteQuest,
    disguiseHomeButton,
    enrolledIncompleteButton,
    formatLowerBadge,
    getActiveAutoCompletes,
    getLastFilterChoices,
    getLastSortChoice,
    getQuestAutoCompleteProgress,
    getQuestEmbedProgress,
    getQuestButtonProps,
    getQuestPanelOverride,
    getQuestPanelPercentComplete,
    getQuestPanelSubtitleText,
    getQuestTileClasses,
    getQuestTileStyle,
    getSettingsModalOpen,
    hasEnabledAutoCompleteQuestTypes,
    normalizeQuestName,
    openDevToolsWindow,
    processQuestForAutoComplete,
    rerenderQuests,
    setHeartbeatStackTracePatchSucceeded,
    setLastFilterChoices,
    setLastSortChoice,
    setVideoProgressStackTracePatchSucceeded,
    shouldForceQuestPanelVisible,
    shouldPreloadQuestAssets,
    sortQuests,
    stopQuestAutoComplete,
    useQuestRerender,
    wrapOrbsBalance,

    flux: {
        CHANNEL_SELECT() {
            setOnQuestsPage();
            applyDefaultQuestSort();
        },

        QUESTS_FETCH_CURRENT_QUESTS_SUCCESS(data: { quests: Quest[]; }): void {
            setInitialQuestDataFetched(true);
            QL.log("QUESTS_FETCH_CURRENT_QUESTS_SUCCESS", data);
            validateIgnoredQuests(data.quests);
            resumeAutoCompletesIfReady();
        },

        QUESTS_ENROLL_SUCCESS(data: any): void {
            QL.log("QUESTS_ENROLL_SUCCESS", data);
            validateIgnoredQuests();
        },

        QUESTS_CLAIM_REWARD_SUCCESS(data: any): void {
            QL.log("QUESTS_CLAIM_REWARD_SUCCESS", data);
            validateIgnoredQuests();
        },

        QUESTS_USER_STATUS_UPDATE(data: any): void {
            QL.log("QUESTS_USER_STATUS_UPDATE", data);

            const userStatus = snakeToCamel(data).userStatus as QuestUserStatus | undefined;
            const claimedAt = !!userStatus?.claimedAt;
            const completedRecently = userStatus?.completedAt
                ? Date.now() - new Date(userStatus.completedAt).getTime() <= 5000
                : false;

            validateIgnoredQuests();

            if (completedRecently && !claimedAt && !notifiedCompletedQuests.has(userStatus!.questId)) {
                notifiedCompletedQuests.add(userStatus!.questId);

                if (getQuestifySettings().notifyOnQuestComplete) {
                    notifyQuestCompletion(QuestStore.getQuest(userStatus!.questId));
                }

                if (getQuestifySettings().questCompletedAlertSound) {
                    playAudio(
                        getQuestifySettings().questCompletedAlertSound,
                        { volume: Math.max(0, Math.min(100, getQuestifySettings().questCompletedAlertVolume)) }
                    );
                }
            }
        },

        USER_SETTINGS_MODAL_OPEN(): void {
            setSettingsModalOpen(true);
        },

        USER_SETTINGS_MODAL_CLOSE(): void {
            setSettingsModalOpen(false);
            promptToRestartIfDirty();
        },

        LOGIN_SUCCESS(): void {
            if (!isSwitchingAccount || getQuestifySettings().disableQuestsEverything) {
                return;
            } else {
                isSwitchingAccount = false;
            }

            setInitialQuestDataFetched(false);
            didAttemptAutoCompleteResume = false;
            resetResumeAttempts();
            startPerAccountTasks("LOGIN_SUCCESS");
        },

        LOGOUT(data: { isSwitchingAccount?: boolean; }): void {
            if (!data.isSwitchingAccount) {
                return;
            } else {
                isSwitchingAccount = true;
            }

            setInitialQuestDataFetched(false);
            stopPerAccountTasks("LOGOUT");
        },

        RUNNING_GAMES_CHANGE(data: { games: { id: string; }[]; }): void {
            stopAutoCompletesForRunningGames(data.games.map(game => game.id));
        }
    },

    renderQuestifyButton,
    ServerListWrapper,
    settingsComponent: QuestifySettingsPanel,

    start(ctx: EnginePluginContext) {
        bindContext(ctx);
        setPluginEnabled(true);
        ctx.addStyle(questifyCss, "questify");
        ctx.addStyle(settingsCss, "questify-settings");
        ctx.addStyle(pluginModalCss, "questify-window");

        if (!enabledOnStartup && PlainSettings.plugins.Questify?.enabled) {
            setRestartDirty(true);
        }

        initializeRestartTracking(settings);

        if (enabledOnStartup) {
            addServerListElement(ServerListRenderPosition.Above, renderQuestifyButton);
        }

        onceReady.then(() => {
            showPendingQuestifyNotice();

            if (!getQuestifySettings().disableQuestsEverything) {
                startPerAccountTasks("PLUGIN_START");
            } else {
                removeServerListElement(ServerListRenderPosition.Above, renderQuestifyButton);
            }
        });
    },

    stop() {
        setPluginEnabled(false);
        const pluginEnabled = Settings.plugins.Questify?.enabled;

        disposeRestartTracking();
        removeServerListElement(ServerListRenderPosition.Above, renderQuestifyButton);
        stopPerAccountTasks("PLUGIN_STOP", pluginEnabled);

        if (!pluginEnabled) {
            resetQuestsToResume();
        }
    }
};

export default plugin;
