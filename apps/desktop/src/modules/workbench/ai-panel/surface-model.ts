import type { AiModelRuntimeMetadata, AiProviderProfile } from "../../../shared/ai";
import type { createTranslator } from "../i18n";
import type { AiPanelEmptyGreetingTextLabels } from "./empty-greeting";
import type { AgentComposerModelOption } from "./agent-composer";
import type { RuntimeThreadOptions } from "./use-lyra-thread-runtime";

export type RuntimeModelOption = AgentComposerModelOption & {
  readonly model: string;
  readonly modelProvider: string | null;
  readonly profileId?: string;
  readonly runtimeMetadata?: AiModelRuntimeMetadata;
};

type Translator = ReturnType<typeof createTranslator>;

export const MODEL_OPTION_DELIMITER = "\u001F";

export const uniqueModelIds = (entries: readonly string[]): readonly string[] =>
  entries
    .map((entry) => entry.trim())
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);

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
  collaborationMode,
  effort,
  verbosity,
  followEnabled
}: {
  readonly selectedModelOption: RuntimeModelOption | null;
  readonly defaultProviderId?: string | null | undefined;
  readonly boundProjectRoot: string | null;
  readonly collaborationMode?: "default" | "plan" | undefined;
  readonly effort?: RuntimeThreadOptions["effort"] | null | undefined;
  readonly verbosity?: RuntimeThreadOptions["verbosity"] | null | undefined;
  readonly followEnabled?: boolean | undefined;
}): RuntimeThreadOptions => {
  const modelProvider = selectedModelOption?.modelProvider ?? defaultProviderId;
  return {
    ...(selectedModelOption?.profileId === undefined ? {} : { profileId: selectedModelOption.profileId }),
    ...(selectedModelOption?.model === undefined ? {} : { model: selectedModelOption.model }),
    ...(modelProvider === undefined ? {} : { modelProvider }),
    cwd: boundProjectRoot,
    ...(effort === null || effort === undefined ? {} : { effort }),
    ...(verbosity === null || verbosity === undefined ? {} : { verbosity }),
    ...(followEnabled === undefined ? {} : { followEnabled }),
    ...(collaborationMode === undefined
      ? {}
      : { collaborationMode })
  };
};

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

export type AiPanelSurfaceTextLabels = {
  readonly closeThread: string;
  readonly emptyGreeting: AiPanelEmptyGreetingTextLabels;
  readonly moreActions: string;
  readonly model: string;
  readonly planMode: string;
  readonly planModeArmed: string;
  readonly followMode: string;
  readonly steerTurn: string;
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
  moreActions: t("ai.moreActions"),
  model: t("ai.modelLabel"),
  planMode: t("ai.planMode"),
  planModeArmed: t("ai.planModeArmed"),
  followMode: t("ai.followMode"),
  steerTurn: t("ai.steerTurn")
});

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
