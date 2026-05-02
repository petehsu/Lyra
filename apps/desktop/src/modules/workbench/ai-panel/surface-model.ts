import type { AiModelRuntimeMetadata, AiProviderProfile } from "../../../shared/ai";
import type { LyraClientRequestPayload } from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type { AiPanelEmptyGreetingTextLabels } from "./empty-greeting";
import type { AgentComposerModelOption, AgentPermissionMode } from "./agent-composer";
import type { ToolNameLabelMap } from "./runtime/feed-utils";
import type { RuntimeThreadOptions } from "./use-lyra-thread-runtime";

export type RuntimeModelOption = AgentComposerModelOption & {
  readonly model: string;
  readonly modelProvider: string | null;
  readonly profileId?: string;
  readonly runtimeMetadata?: AiModelRuntimeMetadata;
};

type Translator = ReturnType<typeof createTranslator>;

type JsonRecord = Record<string, unknown>;

export const MODEL_OPTION_DELIMITER = "\u001F";
export const EMPTY_THREAD_STYLE = {};

export const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

export const uniqueModelIds = (entries: readonly string[]): readonly string[] =>
  entries
    .map((entry) => entry.trim())
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);

export const permissionRuntimeOptions = (
  mode: AgentPermissionMode
): Pick<RuntimeThreadOptions, "approvalPolicy" | "approvalsReviewer" | "sandboxMode"> => {
  if (mode === "auto_review") {
    return {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxMode: "workspace-write"
    };
  }
  if (mode === "full_access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxMode: "danger-full-access"
    };
  }
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write"
  };
};

export const createRuntimeModelOptions = ({
  configuredProfiles,
  defaultModelNames,
  defaultProfileId,
  defaultProviderId
}: {
  readonly configuredProfiles: readonly AiProviderProfile[];
  readonly defaultModelNames: readonly string[];
  readonly defaultProfileId?: string | null | undefined;
  readonly defaultProviderId?: string | null | undefined;
}): readonly RuntimeModelOption[] => {
  const nextOptions: RuntimeModelOption[] = [];
  const multipleProfiles = configuredProfiles.filter((profile) => profile.runtimeSupported).length > 1;
  const orderedProfiles = [...configuredProfiles].sort((left, right) => {
    if (left.id === defaultProfileId) {
      return -1;
    }
    if (right.id === defaultProfileId) {
      return 1;
    }
    return 0;
  });
  for (const profile of orderedProfiles) {
    if (!profile.runtimeSupported) {
      continue;
    }
    const models = uniqueModelIds([
      profile.model,
      ...profile.customModels.map((entry) => entry.id),
      ...profile.discoveryState.models.map((entry) => entry.id)
    ]);
    const providerId = profile.runtimeProviderId.trim();
    if (providerId.length === 0) {
      continue;
    }
    for (const model of models) {
      const modelEntry =
        profile.customModels.find((entry) => entry.id === model)
        ?? profile.discoveryState.models.find((entry) => entry.id === model);
      const runtimeMetadata =
        modelEntry?.runtimeMetadata
        ?? (model === profile.model ? profile.modelRuntimeMetadata ?? undefined : undefined);
      nextOptions.push({
        value: `${profile.id}${MODEL_OPTION_DELIMITER}${model}`,
        label: multipleProfiles ? `${model} · ${profile.name}` : model,
        model,
        modelProvider: providerId,
        profileId: profile.id,
        ...(runtimeMetadata === undefined || runtimeMetadata === null ? {} : { runtimeMetadata })
      });
    }
  }
  if (nextOptions.length > 0) {
    return nextOptions;
  }
  return uniqueModelIds(defaultModelNames).map((model) => ({
    value: model,
    label: model,
    model,
    modelProvider: defaultProviderId ?? null
  }));
};

export const resolveSelectedRuntimeModelOption = (
  modelOptions: readonly RuntimeModelOption[],
  selectedModelOptionValue: string
): RuntimeModelOption | null =>
  modelOptions.find((option) => option.value === selectedModelOptionValue)
  ?? modelOptions[0]
  ?? null;

export const resolveDefaultRuntimeModelOptionValue = (
  modelOptions: readonly RuntimeModelOption[],
  defaultProfileId?: string | null | undefined
): string => {
  const normalizedDefaultProfileId = defaultProfileId?.trim() ?? "";
  const defaultProfileOption = normalizedDefaultProfileId.length === 0
    ? null
    : modelOptions.find((option) => option.profileId === normalizedDefaultProfileId) ?? null;
  return (defaultProfileOption ?? modelOptions[0] ?? null)?.value ?? "";
};

export const resolveSyncedSelectedModelOptionValue = ({
  modelOptions,
  selectedModelOptionValue,
  defaultProfileId
}: {
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly selectedModelOptionValue: string;
  readonly defaultProfileId?: string | null | undefined;
}): string => {
  const fallbackValue = resolveDefaultRuntimeModelOptionValue(modelOptions, defaultProfileId);
  const selectedOption = modelOptions.find((option) => option.value === selectedModelOptionValue);
  if (selectedOption === undefined) {
    return fallbackValue;
  }

  const normalizedDefaultProfileId = defaultProfileId?.trim() ?? "";
  if (normalizedDefaultProfileId.length === 0) {
    return selectedOption.profileId === undefined ? selectedOption.value : fallbackValue;
  }
  return selectedOption.profileId === normalizedDefaultProfileId
    ? selectedOption.value
    : fallbackValue;
};

export const createRuntimeTurnOptions = ({
  selectedModelOption,
  defaultProviderId,
  boundProjectRoot,
  permissionMode,
  collaborationMode,
  effort,
  verbosity
}: {
  readonly selectedModelOption: RuntimeModelOption | null;
  readonly defaultProviderId?: string | null | undefined;
  readonly boundProjectRoot: string | null;
  readonly permissionMode: AgentPermissionMode;
  readonly collaborationMode?: "default" | "plan" | undefined;
  readonly effort?: RuntimeThreadOptions["effort"] | null | undefined;
  readonly verbosity?: RuntimeThreadOptions["verbosity"] | null | undefined;
}): RuntimeThreadOptions => ({
  model: selectedModelOption?.model,
  modelProvider: selectedModelOption?.modelProvider ?? defaultProviderId,
  cwd: boundProjectRoot,
  ...(effort === null || effort === undefined ? {} : { effort }),
  ...(verbosity === null || verbosity === undefined ? {} : { verbosity }),
  ...permissionRuntimeOptions(permissionMode),
  ...(collaborationMode === undefined || selectedModelOption?.model === undefined
    ? {}
    : { collaborationMode })
});

export const resolveBoundProjectRoot = ({
  activeThreadId,
  mappedRoots,
  pendingRoot,
  activeThread
}: {
  readonly activeThreadId: string | null;
  readonly mappedRoots: ReadonlyMap<string, string>;
  readonly pendingRoot: string | null;
  readonly activeThread: { readonly id: string; readonly boundProjectRoot?: string | null } | null;
}): string | null => {
  if (activeThreadId !== null) {
    const mapped = mappedRoots.get(activeThreadId);
    if (mapped !== undefined && mapped.length > 0) {
      return mapped;
    }
    const persisted = activeThread?.id === activeThreadId
      ? activeThread.boundProjectRoot
      : null;
    if (persisted !== null && persisted !== undefined && persisted.length > 0) {
      return persisted;
    }
  }
  if (pendingRoot !== null && pendingRoot.length > 0) {
    return pendingRoot;
  }
  return null;
};

const withoutTrailingSeparators = (value: string): string =>
  value.replace(/[\\/]+$/u, "");

const parentPathOf = (value: string): string | null => {
  const trimmed = withoutTrailingSeparators(value.trim());
  if (trimmed.length === 0 || trimmed === "/" || /^[A-Za-z]:$/u.test(trimmed)) {
    return null;
  }
  const match = /[\\/][^\\/]*$/u.exec(trimmed);
  if (match === null || match.index === 0) {
    return trimmed.startsWith("/") ? "/" : null;
  }
  const parent = trimmed.slice(0, match.index);
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
};

export const gitMetadataProbePaths = (projectRoot: string): readonly string[] => {
  const trimmed = withoutTrailingSeparators(projectRoot.trim());
  if (trimmed.length === 0) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  let current: string | null = trimmed;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const separator = current.endsWith("/") || current.endsWith("\\") ? "" : "/";
    paths.push(`${current}${separator}.git`);
    current = parentPathOf(current);
  }
  return paths;
};

export const canOpenReviewChanges = ({
  activeThreadId,
  boundProjectRoot,
  gitMetadataAvailable,
  isAgentAvailable,
  isBusy,
  isReviewStarting
}: {
  readonly activeThreadId: string | null;
  readonly boundProjectRoot: string | null;
  readonly gitMetadataAvailable: boolean;
  readonly isAgentAvailable: boolean;
  readonly isBusy: boolean;
  readonly isReviewStarting: boolean;
}): boolean =>
  activeThreadId !== null
  && boundProjectRoot !== null
  && boundProjectRoot.trim().length > 0
  && gitMetadataAvailable
  && isAgentAvailable
  && !isBusy
  && !isReviewStarting;

export type AiPanelSurfaceTextLabels = {
  readonly closeThread: string;
  readonly emptyGreeting: AiPanelEmptyGreetingTextLabels;
  readonly permissions: string;
  readonly advancedTools: string;
  readonly reviewChanges: string;
  readonly moreActions: string;
  readonly model: string;
  readonly planMode: string;
  readonly planModeArmed: string;
  readonly followMode: string;
  readonly steerTurn: string;
  readonly pendingInteractions: string;
  readonly navPrevious: string;
  readonly navNext: string;
  readonly copyMessage: string;
  readonly copiedMessage: string;
  readonly forkResponse: string;
  readonly regenerateResponse: string;
  readonly editMessage: string;
};

export const createSurfaceTextLabels = (t: Translator): AiPanelSurfaceTextLabels => ({
  closeThread: t("menu.close"),
  emptyGreeting: {
    fallbackName: t("ai.emptyGreetingFallbackName"),
    late: t("ai.emptyGreetingLate"),
    morning: t("ai.emptyGreetingMorning"),
    day: t("ai.emptyGreetingDay"),
    evening: t("ai.emptyGreetingEvening"),
    place: t("ai.emptyGreetingPlace"),
    project: t("ai.emptyGreetingProject"),
    host: t("ai.emptyGreetingHost"),
    file: t("ai.emptyGreetingFile"),
    tab: t("ai.emptyGreetingTab"),
    general: t("ai.emptyGreetingGeneral")
  },
  permissions: t("ai.permissionsLabel"),
  advancedTools: t("ai.advancedTools"),
  reviewChanges: t("ai.reviewChanges"),
  moreActions: t("ai.moreActions"),
  model: t("ai.modelLabel"),
  planMode: t("ai.planMode"),
  planModeArmed: t("ai.planModeArmed"),
  followMode: t("ai.followMode"),
  steerTurn: t("ai.steerTurn"),
  pendingInteractions: t("ai.pendingInteractions"),
  navPrevious: t("ai.navPrevious"),
  navNext: t("ai.navNext"),
  copyMessage: t("ai.actionCopy"),
  copiedMessage: t("dialog.copiedAction"),
  forkResponse: t("ai.forkFromResponse"),
  regenerateResponse: t("ai.regenerateResponse"),
  editMessage: t("ai.editMessage")
});

export const createInteractionTextLabels = (
  t: Translator
) => ({
  toolTerminalSession: t("ai.toolNameTerminalSession"),
  toolTerminalInput: t("ai.toolNameTerminalInput"),
  toolTerminalExec: t("ai.toolNameTerminalExec"),
  commandNeedsApproval: t("ai.commandNeedsApproval"),
  proposedPlanSummaryFallback: t("ai.proposedPlanSummaryFallback")
});

export const createToolNameLabels = ({
  t,
  toolNameSearchLabel,
  toolNameReadRangeLabel,
  toolNameListLabel,
  toolNameGlobLabel,
  toolNameWriteLabel,
  toolNameEditLabel,
  toolNameMultiEditLabel
}: {
  readonly t: Translator;
  readonly toolNameSearchLabel: string;
  readonly toolNameReadRangeLabel: string;
  readonly toolNameListLabel: string;
  readonly toolNameGlobLabel: string;
  readonly toolNameWriteLabel: string;
  readonly toolNameEditLabel: string;
  readonly toolNameMultiEditLabel: string;
}): ToolNameLabelMap => ({
  search: toolNameSearchLabel,
  readRange: toolNameReadRangeLabel,
  list: toolNameListLabel,
  glob: toolNameGlobLabel,
  write: toolNameWriteLabel,
  edit: toolNameEditLabel,
  multiEdit: toolNameMultiEditLabel,
  terminalSession: t("ai.toolNameTerminalSession"),
  terminalRead: t("ai.toolNameTerminalRead"),
  terminalInput: t("ai.toolNameTerminalInput"),
  terminalClose: t("ai.toolNameTerminalClose"),
  terminalExec: t("ai.toolNameTerminalExec"),
  collabSpawnAgent: t("ai.toolNameCollabSpawnAgent"),
  collabSendInput: t("ai.toolNameCollabSendInput"),
  collabResumeAgent: t("ai.toolNameCollabResumeAgent"),
  collabWait: t("ai.toolNameCollabWait"),
  collabCloseAgent: t("ai.toolNameCollabCloseAgent"),
  collabAgent: t("ai.toolNameCollabAgent")
});

export const shouldShowEmptySessionScene = ({
  messageCount,
  optimisticMessageCount,
  streamingAssistantText,
  isStreamActive
}: {
  readonly messageCount: number;
  readonly optimisticMessageCount: number;
  readonly streamingAssistantText: string;
  readonly isStreamActive: boolean;
}): boolean =>
  messageCount === 0 &&
  optimisticMessageCount === 0 &&
  streamingAssistantText.length === 0 &&
  !isStreamActive;

export const isAiRuntimeBusy = ({
  isSending,
  isStreamActive
}: {
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
}): boolean => isSending || isStreamActive;

export const createComposerReserveStyle = (
  composerHeight: number
): Record<"--lyra-ai-composer-reserve", string> => ({
  "--lyra-ai-composer-reserve": `${String(Math.max(96, Math.ceil(composerHeight)))}px`
});
