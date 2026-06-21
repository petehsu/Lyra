import { Check, ExternalLink, LogIn, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";

import {
  AppButton,
  AppIconButton,
  AppInput,
  AppObjectRow,
  AppSearchField,
  AppSelect,
  AppStatusMessage,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import type { AgentModelEntry, AgentProviderRouteEntry } from "../../../shared/desktop-bridge";
import { AgentProviderBrandIcon } from "../agent-provider-brand-icon";
import type { GlobalDialogModel } from "../global-dialog";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

type SettingsAiModelsViewProps = SettingsAiViewProps & {
  readonly openDialog: GlobalDialogModel["openDialog"];
};

type SettingsAiRenderedModelEntry = Pick<
  AgentModelEntry,
  | "available"
  | "detail"
  | "id"
  | "label"
  | "model"
  | "provider"
  | "providerId"
  | "providerKey"
  | "providerLabel"
  | "routeId"
  | "protocolId"
  | "protocolFamily"
  | "enabled"
>;

const MODEL_PREVIEW_LIMIT = 9;

type AgentConfigShape = {
  readonly provider?: {
    readonly defaultProvider?: string | null;
    readonly defaultModel?: string | null;
  };
  readonly providers?: Record<string, {
    readonly label?: string | null;
    readonly routeId?: string | null;
    readonly protocolId?: string | null;
    readonly protocolFamily?: string | null;
    readonly baseUrl?: string | null;
    readonly authHeader?: string | null;
    readonly defaultModel?: string | null;
    readonly models?: readonly {
      readonly id?: string;
      readonly supportsImageInput?: boolean;
      readonly supportsToolCalling?: boolean;
      readonly supportsStreaming?: boolean;
      readonly enabled?: boolean;
    }[];
  }>;
  readonly roles?: {
    readonly swarmModel?: string | null;
    readonly reviewModel?: string | null;
    readonly judgeModel?: string | null;
    readonly memoryModel?: string | null;
    readonly ambientModel?: string | null;
  };
  readonly promptDelivery?: {
    readonly mode?: string | null;
    readonly leanExperimental?: boolean;
    readonly openaiResponsesStatefulPromptContract?: boolean;
  };
  readonly notifications?: {
    readonly ntfyTopic?: string | null;
    readonly ntfyServer?: string | null;
    readonly desktopNotifications?: boolean;
    readonly emailEnabled?: boolean;
    readonly emailTo?: string | null;
    readonly emailSmtpHost?: string | null;
    readonly emailSmtpPort?: number;
    readonly emailFrom?: string | null;
    readonly emailPassword?: string | null;
    readonly emailImapHost?: string | null;
    readonly emailImapPort?: number;
    readonly emailReplyEnabled?: boolean;
    readonly telegramEnabled?: boolean;
    readonly telegramBotToken?: string | null;
    readonly telegramChatId?: string | null;
    readonly telegramReplyEnabled?: boolean;
    readonly discordEnabled?: boolean;
    readonly discordBotToken?: string | null;
    readonly discordChannelId?: string | null;
    readonly discordBotUserId?: string | null;
    readonly discordReplyEnabled?: boolean;
  };
};

const asAgentConfig = (value: unknown): AgentConfigShape =>
  (value ?? {}) as AgentConfigShape;

const nullableTrimmed = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const optionalSecret = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalPort = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : undefined;
};

const uniqueModelIds = (...groups: readonly string[][]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
  }
  return result;
};

type SettingsAiSwitchRowProps = {
  readonly checked: boolean;
  readonly className?: string;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
};

const SettingsAiSwitchRow = ({
  checked,
  className,
  label,
  onCheckedChange
}: SettingsAiSwitchRowProps) => (
  <div className={["lyra-settings-ai-switch-row", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppSwitch
      checked={checked}
      aria-label={label}
      onCheckedChange={onCheckedChange}
    />
  </div>
);

type SettingsAiInputFieldProps = Omit<ComponentPropsWithoutRef<typeof AppInput>, "className" | "onChange" | "value"> & {
  readonly className?: string;
  readonly inputClassName?: string;
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly value: string;
};

const SettingsAiInputField = ({
  className,
  inputClassName,
  label,
  onValueChange,
  value,
  ...inputProps
}: SettingsAiInputFieldProps) => (
  <label className={["lyra-settings-ai-field", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppInput
      className={["lyra-settings-ai-input", inputClassName ?? ""].filter(Boolean).join(" ")}
      value={value}
      onChange={(event) => setValueFromEvent(event.target.value, onValueChange)}
      {...inputProps}
    />
  </label>
);

type SettingsAiTextareaFieldProps = Omit<ComponentPropsWithoutRef<typeof AppTextarea>, "className" | "onChange" | "value"> & {
  readonly className?: string;
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly textareaClassName?: string;
  readonly value: string;
};

const SettingsAiTextareaField = ({
  className,
  label,
  onValueChange,
  textareaClassName,
  value,
  ...textareaProps
}: SettingsAiTextareaFieldProps) => (
  <label className={["lyra-settings-ai-field", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppTextarea
      className={["lyra-settings-ai-input lyra-settings-ai-input-multiline", textareaClassName ?? ""].filter(Boolean).join(" ")}
      value={value}
      onChange={(event) => setValueFromEvent(event.target.value, onValueChange)}
      {...textareaProps}
    />
  </label>
);

const setValueFromEvent = (
  value: string,
  onValueChange: (value: string) => void
): void => {
  onValueChange(value);
};

const normalizeProviderSearchText = (value: string): string =>
  value.trim().toLocaleLowerCase().replaceAll(/[\s._:/-]+/gu, "");

const PROVIDER_ROUTE_ALIASES: readonly {
  readonly match: (route: AgentProviderRouteEntry) => boolean;
  readonly values: readonly string[];
}[] = [
  {
    match: (route) => route.catalogSection === "custom" || route.id.includes("custom"),
    values: [
      "custom",
      "custom provider",
      "custom openai compatible",
      "openai compatible",
      "compatible",
      "manual endpoint",
      "自定义",
      "自定义服务商",
      "自定义提供方",
      "自定义模型",
      "自定义搜索",
      "自定义接口",
      "自定义端点",
      "兼容",
      "兼容 openai",
      "openai 兼容",
      "手动",
      "手动端点",
      "手动添加",
    ],
  },
  {
    match: (route) => route.catalogSection === "local" || route.localBackend !== null,
    values: [
      "local",
      "local model",
      "local provider",
      "本地",
      "本地模型",
      "本地服务",
      "本地服务商",
      "本地接口",
      "局域网",
    ],
  },
  {
    match: (route) => route.providerId === "mimo" || route.id.includes("mimo"),
    values: [
      "mimo",
      "xiaomi",
      "xiaomi mimo",
      "xiaomimimo",
      "mi mo",
      "小米",
      "小米 mimo",
      "小米模型",
      "小米妙想",
    ],
  },
  {
    match: (route) => route.providerId === "openai" || route.id.includes("openai"),
    values: ["openai", "chatgpt", "gpt", "开放人工智能", "开放ai"],
  },
  {
    match: (route) => route.providerId.includes("google") || route.label.toLocaleLowerCase().includes("gemini"),
    values: ["google", "gemini", "谷歌", "双子", "谷歌模型"],
  },
  {
    match: (route) => route.providerId.includes("anthropic") || route.label.toLocaleLowerCase().includes("claude"),
    values: ["anthropic", "claude", "克劳德"],
  },
  {
    match: (route) => route.providerId.includes("qwen") || route.label.toLocaleLowerCase().includes("qwen"),
    values: ["qwen", "tongyi", "通义", "千问", "阿里"],
  },
  {
    match: (route) => route.providerId.includes("deepseek") || route.label.toLocaleLowerCase().includes("deepseek"),
    values: ["deepseek", "deep seek", "深度求索", "深度搜索"],
  },
  {
    match: (route) => route.providerId.includes("moonshot") || route.label.toLocaleLowerCase().includes("kimi"),
    values: ["moonshot", "kimi", "月之暗面", "月之暗面 kimi"],
  },
  {
    match: (route) => route.providerId.includes("baidu") || route.label.toLocaleLowerCase().includes("wenxin"),
    values: ["baidu", "wenxin", "文心", "百度", "百度文心"],
  },
  {
    match: (route) => route.providerId.includes("doubao") || route.providerId.includes("volcengine"),
    values: ["doubao", "volcengine", "豆包", "火山", "火山引擎"],
  },
  {
    match: (route) => route.providerId.includes("spark") || route.providerId.includes("iflytek"),
    values: ["spark", "iflytek", "讯飞", "星火", "讯飞星火"],
  },
  {
    match: (route) => route.providerId.includes("stepfun") || route.label.toLocaleLowerCase().includes("stepfun"),
    values: ["stepfun", "step", "阶跃", "阶跃星辰"],
  },
  {
    match: (route) => route.providerId.includes("sensenova") || route.label.toLocaleLowerCase().includes("sensenova"),
    values: ["sensenova", "sense nova", "商汤", "商汤日日新"],
  },
  {
    match: (route) => route.providerId.includes("yi") || route.label.toLocaleLowerCase().includes("01.ai"),
    values: ["yi", "01ai", "01.ai", "零一", "零一万物"],
  },
  {
    match: (route) => route.providerId.includes("xuanyuan") || route.label.toLocaleLowerCase().includes("xuanyuan"),
    values: ["xuanyuan", "轩辕", "度小满"],
  },
];

const fuzzyScore = (text: string, query: string): number => {
  if (query.length === 0) {
    return 0;
  }
  let textIndex = 0;
  let score = 0;
  let streak = 0;
  for (const queryChar of query) {
    const foundIndex = text.indexOf(queryChar, textIndex);
    if (foundIndex < 0) {
      return Number.NEGATIVE_INFINITY;
    }
    streak = foundIndex === textIndex ? streak + 1 : 1;
    score += 4 + streak * 3 - Math.min(foundIndex - textIndex, 8);
    textIndex = foundIndex + 1;
  }
  return score;
};

const providerRouteSearchValues = (route: AgentProviderRouteEntry): readonly string[] =>
  [
    route.label,
    route.description,
    route.providerId,
    route.id,
    route.protocolId,
    route.protocolFamily,
    route.catalogSection,
    route.defaultBaseUrl,
    ...PROVIDER_ROUTE_ALIASES.flatMap((entry) => entry.match(route) ? entry.values : []),
  ].flatMap((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length === 0 ? [] : [trimmed];
  });

const providerRouteScore = (route: AgentProviderRouteEntry, query: string, index: number): number => {
  const normalizedQuery = normalizeProviderSearchText(query);
  if (normalizedQuery.length === 0) {
    return 120 - index;
  }

  return providerRouteSearchValues(route).reduce((bestScore, value) => {
    const normalizedValue = normalizeProviderSearchText(value);
    if (normalizedValue.length === 0) {
      return bestScore;
    }
    let score = fuzzyScore(normalizedValue, normalizedQuery);
    if (normalizedValue === normalizedQuery) {
      score += 1000;
    } else if (normalizedValue.startsWith(normalizedQuery)) {
      score += 760;
    } else {
      const containsAt = normalizedValue.indexOf(normalizedQuery);
      if (containsAt >= 0) {
        score += 520 - Math.min(containsAt, 80);
      }
      const queryContainsAt = normalizedQuery.indexOf(normalizedValue);
      if (normalizedValue.length >= 2 && queryContainsAt >= 0) {
        score += 420 - Math.min(queryContainsAt, 80);
      }
    }
    return Math.max(bestScore, score);
  }, Number.NEGATIVE_INFINITY);
};

const modelProviderKeys = (entry: SettingsAiRenderedModelEntry): readonly string[] =>
  [
    entry.providerKey,
    entry.provider,
    entry.providerId,
  ].flatMap((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length === 0 ? [] : [trimmed];
  });

const modelMatchesSelectedProvider = (
  entry: AgentModelEntry,
  profileName: string,
  route: AgentProviderRouteEntry
): boolean => {
  const providerKeys = [
    entry.providerKey,
    entry.provider,
    entry.providerId,
    entry.routeId,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const profileMatched = providerKeys.some((value) =>
    value === profileName
    || value === route.id
    || value === route.providerId
  );
  const labelMatched = entry.providerLabel?.trim() === route.label;
  const baseUrlMatched =
    route.defaultBaseUrl !== null
    && route.defaultBaseUrl !== undefined
    && entry.detail?.trim() === route.defaultBaseUrl;
  return profileMatched || labelMatched || baseUrlMatched;
};

const modelEntryIdentity = (entry: AgentModelEntry): string =>
  [
    entry.providerKey,
    entry.provider,
    entry.providerId,
    entry.routeId,
    entry.model,
  ].map((value) => value?.trim() ?? "").join("\u0000");

const modelIdsFromEntries = (entries: readonly AgentModelEntry[]): string[] =>
  uniqueModelIds([
    ...entries
      .map((entry) => entry.model.trim())
      .filter((id) => id.length > 0),
  ]);

const discoveredModelIdsFromCatalog = (
  entries: readonly AgentModelEntry[],
  profileName: string,
  route: AgentProviderRouteEntry,
  previousEntries: readonly AgentModelEntry[]
): string[] => {
  const matchedEntries = entries.filter((entry) =>
    modelMatchesSelectedProvider(entry, profileName, route)
  );
  if (matchedEntries.length > 0) {
    return modelIdsFromEntries(matchedEntries);
  }

  const previousKeys = new Set(previousEntries.map(modelEntryIdentity));
  return modelIdsFromEntries(
    entries.filter((entry) => !previousKeys.has(modelEntryIdentity(entry)))
  );
};

const isCurrentModelEntry = (
  entry: SettingsAiRenderedModelEntry,
  model: SettingsAiModel,
  config: AgentConfigShape
): boolean => {
  const catalog = model.agentModelCatalog ?? null;
  const currentModel =
    catalog?.currentModel
    ?? catalog?.defaultModel
    ?? config.provider?.defaultModel
    ?? "";
  if (entry.model !== currentModel) {
    return false;
  }

  const currentProvider =
    catalog?.currentProvider
    ?? catalog?.defaultProvider
    ?? model.defaultProfileId
    ?? config.provider?.defaultProvider
    ?? "";
  if (currentProvider.length === 0) {
    return true;
  }
  return modelProviderKeys(entry).includes(currentProvider);
};

const formatSettingsAiLabel = (
  template: string,
  replacements: Record<string, string>
): string =>
  Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template
  );

export const SettingsAiModelsView = ({ labels, model, openDialog }: SettingsAiModelsViewProps) => {
  const [query, setQuery] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [selectedProviderRouteId, setSelectedProviderRouteId] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [discoveredModelIds, setDiscoveredModelIds] = useState<readonly string[]>([]);
  const [isAddingCustomModel, setIsAddingCustomModel] = useState(false);
  const [customModelId, setCustomModelId] = useState("");
  const [disabledDiscoveredModelIds, setDisabledDiscoveredModelIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false);
  const [discoveryReturnedEmpty, setDiscoveryReturnedEmpty] = useState(false);
  const config = asAgentConfig(model.agentConfig?.config);
  const providerRoutes = useMemo<readonly AgentProviderRouteEntry[]>(() => {
    const sourceRoutes = model.agentProviderCatalog?.routes ?? [
      ...model.quickSetupRoutes,
      ...model.localRoutes,
    ];
    const seen = new Set<string>();
    return sourceRoutes.filter((route) => {
      if (!route.runtimeSupported || seen.has(route.id)) {
        return false;
      }
      seen.add(route.id);
      return true;
    });
  }, [
    model.agentProviderCatalog?.routes,
    model.localRoutes,
    model.quickSetupRoutes,
  ]);
  const selectedProviderRoute =
    providerRoutes.find((route) => route.id === selectedProviderRouteId)
    ?? null;
  const selectedProviderProfile = selectedProviderRoute === null
    ? null
    : model.profiles.find((profile) => profile.routeId === selectedProviderRoute.id) ?? null;
  const selectedProviderProfileId = selectedProviderProfile?.id ?? selectedProviderRoute?.id ?? "";
  const selectedProviderConfig = selectedProviderProfileId.length === 0
    ? null
    : config.providers?.[selectedProviderProfileId] ?? null;
  const selectedRouteNeedsUrl = selectedProviderRoute === null
    ? false
    : selectedProviderRoute.defaultBaseUrl === null
      || selectedProviderRoute.catalogSection === "custom"
      || selectedProviderRoute.localBackend !== null;
  const selectedRouteAllowsAuth = selectedProviderRoute === null
    ? false
    : !selectedProviderRoute.authKind.startsWith("none");
  const renderedModels = useMemo<readonly SettingsAiRenderedModelEntry[]>(() =>
    (model.agentModelCatalog?.models ?? []).filter((entry) => entry.available),
  [model.agentModelCatalog?.models]);
  const hasConfiguredModels = renderedModels.length > 0;
  const isProviderSearchMode = isAddingModel || !hasConfiguredModels;
  const activeSearchValue = isProviderSearchMode ? providerQuery : query;
  const activeSearchLabel = isProviderSearchMode ? labels.selectProviderLabel : labels.modelsTitle;
  const activeSearchPlaceholder = isProviderSearchMode ? labels.selectProviderLabel : labels.modelsSearchPlaceholder;
  const activeSearchLeading = isProviderSearchMode && selectedProviderRoute !== null ? (
    <AgentProviderBrandIcon
      label={selectedProviderRoute.label}
      providerId={selectedProviderRoute.providerId}
      routeId={selectedProviderRoute.id}
    />
  ) : undefined;
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
      return renderedModels;
    }
    return renderedModels.filter((entry) =>
      [
        entry.label,
        entry.model,
        entry.providerLabel ?? "",
        entry.providerKey ?? "",
        entry.detail ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    );
  }, [query, renderedModels]);
  const visibleModels = showAllModels
    ? filteredModels
    : filteredModels.slice(0, MODEL_PREVIEW_LIMIT);
  const canShowAllModels = !showAllModels && filteredModels.length > MODEL_PREVIEW_LIMIT;
  const providerRouteMatches = useMemo(() => {
    if (providerQuery.trim().length === 0) {
      return [];
    }
    const ranked = providerRoutes
      .map((route, index) => ({
        route,
        score: providerRouteScore(route, providerQuery, index),
      }))
      .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score || a.route.label.localeCompare(b.route.label));
    return ranked.map((entry) => entry.route);
  }, [providerQuery, providerRoutes]);
  const updateActiveSearch = (nextValue: string): void => {
    if (isProviderSearchMode) {
      setProviderQuery(nextValue);
      if (selectedProviderRoute !== null) {
        setSelectedProviderRouteId("");
        setDiscoveredModelIds([]);
        setIsAddingCustomModel(false);
        setCustomModelId("");
        setDisabledDiscoveredModelIds(new Set());
        setIsDiscoveringModels(false);
        setDiscoveryReturnedEmpty(false);
      }
      return;
    }
    setQuery(nextValue);
  };
  const discoveredModelEntries = useMemo(() =>
    discoveredModelIds.map((id) => ({
      id,
      enabled: !disabledDiscoveredModelIds.has(id),
    })),
  [disabledDiscoveredModelIds, discoveredModelIds]);
  const shouldShowDisableAllDiscoveredModels = discoveredModelIds.length > 3;
  const allDiscoveredModelsDisabled =
    discoveredModelIds.length > 0
    && discoveredModelIds.every((id) => disabledDiscoveredModelIds.has(id));

  useEffect(() => {
    if (selectedProviderRoute === null) {
      return;
    }
    setProviderBaseUrl(
      selectedProviderProfile?.baseUrl
      ?? selectedProviderConfig?.baseUrl
      ?? selectedProviderRoute.defaultBaseUrl
      ?? ""
    );
    setProviderApiKey("");
    setDiscoveredModelIds([]);
    setIsAddingCustomModel(false);
    setCustomModelId("");
    setDisabledDiscoveredModelIds(new Set());
    setIsDiscoveringModels(false);
    setDiscoveryReturnedEmpty(false);
  }, [
    selectedProviderConfig?.baseUrl,
    selectedProviderProfile?.baseUrl,
    selectedProviderRoute,
  ]);

  const setModelEnabled = (entry: SettingsAiRenderedModelEntry, enabled: boolean): void => {
    const provider = modelProviderKeys(entry)[0] ?? "";
    if (provider.length === 0) {
      return;
    }
    void model.setAgentModelEnabled?.({
      provider,
      model: entry.model,
      enabled,
    });
  };
  const confirmDeleteModel = (entry: SettingsAiRenderedModelEntry): void => {
    const provider = modelProviderKeys(entry)[0] ?? "";
    if (provider.length === 0) {
      return;
    }
    openDialog({
      title: labels.modelsDeleteConfirmTitle,
      description: formatSettingsAiLabel(labels.modelsDeleteConfirmDescription, {
        model: entry.label,
      }),
      source: {
        title: entry.label,
        subtitle: [
          entry.providerLabel ?? provider,
          entry.detail ?? "",
        ].filter((value) => value.length > 0).join(" · "),
        iconLabel: "AI",
        iconTone: "danger",
      },
      actions: [
        {
          id: "cancel",
          label: labels.cancel,
        },
        {
          id: "delete",
          label: labels.modelsDeleteConfirmAction,
          tone: "danger",
          onSelect: () => {
            void model.deleteAgentModel?.({
              provider,
              model: entry.model,
            });
          },
        },
      ],
    });
  };
  const getProviderProfileName = (): string => {
    if (selectedProviderRoute === null) {
      return "";
    }
    return selectedProviderProfileId.length === 0
      ? selectedProviderRoute.id
      : selectedProviderProfileId;
  };
  const buildProviderSaveRequest = (
    models?: readonly { readonly id: string; readonly enabled: boolean }[]
  ) => {
    if (selectedProviderRoute === null) {
      return null;
    }
    const profileName = getProviderProfileName();
    const baseUrl = selectedRouteNeedsUrl
      ? providerBaseUrl.trim()
      : selectedProviderRoute.defaultBaseUrl ?? providerBaseUrl.trim();
    const apiKey = providerApiKey.trim();
    const hasNewSecret = apiKey.length > 0;

    return {
      profileName,
      routeId: selectedProviderRoute.id,
      baseUrl,
      ...(hasNewSecret ? { apiKey } : {}),
      defaultModel:
        models?.find((entry) => entry.enabled)?.id
        ?? models?.[0]?.id
        ?? selectedProviderConfig?.defaultModel
        ?? null,
      auth: hasNewSecret ? "bearer" : "none",
      authHeader: null,
      setDefault: (model.agentModelCatalog?.models.length ?? 0) === 0,
      ...(models === undefined ? {} : { models }),
    } as const;
  };
  const discoverProviderModels = (): void => {
    const saveRequest = buildProviderSaveRequest();
    if (selectedProviderRoute === null || saveRequest === null) {
      return;
    }
    const profileName = getProviderProfileName();
    const previousModelEntries = [...(model.agentModelCatalog?.models ?? [])];
    setIsDiscoveringModels(true);
    setDiscoveryReturnedEmpty(false);
    void (async () => {
      try {
        await model.saveAgentProviderProfile?.(saveRequest);
        const catalog = await model.refreshAgentModels?.(profileName);
        const discoveredIds = discoveredModelIdsFromCatalog(
          catalog?.models ?? [],
          profileName,
          selectedProviderRoute,
          previousModelEntries
        );
        setDiscoveredModelIds(discoveredIds);
        setDisabledDiscoveredModelIds(new Set());
        setDiscoveryReturnedEmpty(discoveredIds.length === 0);
      } finally {
        setIsDiscoveringModels(false);
      }
    })();
  };
  const saveDiscoveredProvider = (): void => {
    if (discoveredModelEntries.length === 0) {
      discoverProviderModels();
      return;
    }
    const saveRequest = buildProviderSaveRequest(discoveredModelEntries);
    if (saveRequest === null) {
      return;
    }
    void (async () => {
      await model.saveAgentProviderProfile?.(saveRequest);
      await model.refreshAgentModelCatalog?.();
      setIsAddingModel(false);
      setSelectedProviderRouteId("");
      setProviderQuery("");
      setDiscoveredModelIds([]);
      setIsAddingCustomModel(false);
      setCustomModelId("");
      setDisabledDiscoveredModelIds(new Set());
    })();
  };
  const addCustomModel = (): void => {
    const id = customModelId.trim();
    if (id.length === 0) {
      return;
    }
    setDiscoveredModelIds((current) => uniqueModelIds([...current, id]));
    setDisabledDiscoveredModelIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setCustomModelId("");
    setIsAddingCustomModel(false);
    setDiscoveryReturnedEmpty(false);
  };
  const toggleDiscoveredModel = (id: string, enabled: boolean): void => {
    setDisabledDiscoveredModelIds((current) => {
      const next = new Set(current);
      if (enabled) {
        next.delete(id);
        return next;
      }
      next.add(id);
      return next;
    });
  };
  const toggleAllDiscoveredModels = (): void => {
    setDisabledDiscoveredModelIds(
      allDiscoveredModelsDisabled
        ? new Set()
        : new Set(discoveredModelIds)
    );
  };

  return (
    <section className="lyra-settings-ai-stack lyra-settings-ai-models-page">
      <div className="lyra-settings-ai-models-panel">
        <div className="lyra-settings-ai-page-header">
          <AppSearchField
            ariaLabel={activeSearchLabel}
            className="lyra-settings-ai-model-search"
            leading={activeSearchLeading}
            placeholder={activeSearchPlaceholder}
            value={activeSearchValue}
            onValueChange={updateActiveSearch}
          />
          <AppButton
            variant="outline"
            size="sm"
            className="lyra-settings-ai-action"
            disabled={model.isSaving}
            onClick={() => {
              void model.refreshAgentModelCatalog?.();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {labels.refreshAgent}
          </AppButton>
          <AppButton
            variant={isAddingModel ? "outline" : "default"}
            size="sm"
            className={[
              "lyra-settings-ai-action",
              isAddingModel ? "" : "lyra-settings-ai-action-primary",
            ].filter(Boolean).join(" ")}
            disabled={model.isSaving || providerRoutes.length === 0}
            onClick={() => {
              setIsAddingModel((value) => {
                const nextValue = !value;
                setProviderQuery("");
                setSelectedProviderRouteId("");
                if (!nextValue && !hasConfiguredModels) {
                  setQuery("");
                }
                setDiscoveredModelIds([]);
                setIsAddingCustomModel(false);
                setCustomModelId("");
                setDisabledDiscoveredModelIds(new Set());
                setIsDiscoveringModels(false);
                setDiscoveryReturnedEmpty(false);
                return nextValue;
              });
            }}
          >
            {isAddingModel ? null : <Plus size={14} aria-hidden="true" />}
            {isAddingModel ? labels.cancel : labels.modelsAddModel}
          </AppButton>
        </div>

        {model.errorMessage === null ? null : (
          <AppStatusMessage className="lyra-settings-ai-error" tone="error" role="alert">
            {model.errorMessage}
          </AppStatusMessage>
        )}

        {isProviderSearchMode && (providerRouteMatches.length > 0 || selectedProviderRoute !== null) ? (
          <div className="lyra-settings-ai-model-flow lyra-settings-ai-add-model">
            <div className="lyra-settings-ai-provider-search-step">
              {selectedProviderRoute !== null || providerRouteMatches.length === 0 ? null : (
                <div className="lyra-settings-ai-provider-search-results">
                  {providerRouteMatches.map((route) => (
                    <AppObjectRow
                      key={route.id}
                      className={[
                        "lyra-settings-ai-provider-tab",
                        selectedProviderRouteId === route.id ? "lyra-settings-ai-provider-tab-active" : "",
                      ].filter(Boolean).join(" ")}
                      active={selectedProviderRouteId === route.id}
                      disabled={model.isSaving}
                      icon={(
                        <AgentProviderBrandIcon
                          label={route.label}
                          providerId={route.providerId}
                          routeId={route.id}
                        />
                      )}
                      title={route.label}
                      description={route.description}
                      onClick={() => {
                        setSelectedProviderRouteId(route.id);
                        setProviderQuery(route.label);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {selectedProviderRoute === null ? null : (
              <>
                <div className="lyra-settings-ai-form lyra-settings-ai-model-provider-form">
                  {selectedRouteNeedsUrl ? (
                    <SettingsAiInputField
                      label={labels.urlLabel}
                      type="text"
                      placeholder={selectedProviderRoute.defaultBaseUrl ?? labels.urlPlaceholder}
                      value={providerBaseUrl}
                      onValueChange={setProviderBaseUrl}
                    />
                  ) : null}
                  {selectedRouteAllowsAuth ? (
                    <SettingsAiInputField
                      label={labels.keyLabel}
                      type="password"
                      autoComplete="off"
                      placeholder={labels.keyPlaceholder}
                      value={providerApiKey}
                      onValueChange={setProviderApiKey}
                    />
                  ) : null}
                  <div className="lyra-settings-ai-field lyra-settings-ai-field-action lyra-settings-ai-model-discovery-actions">
                    <span aria-hidden="true">&nbsp;</span>
                    <span className="lyra-settings-ai-model-discovery-action-row">
                      <AppButton
                        variant="default"
                        size="sm"
                        className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                        disabled={model.isSaving || isDiscoveringModels}
                        onClick={discoveredModelIds.length === 0
                          ? discoverProviderModels
                          : saveDiscoveredProvider}
                      >
                        {discoveredModelIds.length === 0
                          ? <RefreshCw size={14} aria-hidden="true" />
                          : <Save size={14} aria-hidden="true" />}
                        {isDiscoveringModels
                          ? labels.modelsDiscoverModels
                          : discoveredModelIds.length === 0 ? labels.modelsDiscoverModels : labels.saveProfile}
                      </AppButton>
                      <AppButton
                        variant="ghost"
                        size="sm"
                        className="lyra-settings-ai-action"
                        disabled={model.isSaving || isDiscoveringModels}
                        onClick={() => {
                          setIsAddingCustomModel((value) => !value);
                          setCustomModelId("");
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                        {labels.modelsCustomModel}
                      </AppButton>
                    </span>
                  </div>
                </div>

                {discoveryReturnedEmpty ? (
                  <AppStatusMessage className="lyra-settings-ai-error" tone="neutral">
                    {labels.modelsDiscoverEmptyDescription}
                  </AppStatusMessage>
                ) : null}

                {isAddingCustomModel ? (
                  <div className="lyra-settings-ai-custom-model-row">
                    <AppInput
                      className="lyra-settings-ai-input"
                      aria-label={labels.modelsCustomModel}
                      placeholder={labels.modelsCustomModelPlaceholder}
                      value={customModelId}
                      onChange={(event) => {
                        setCustomModelId(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCustomModel();
                        }
                      }}
                    />
                    <AppButton
                      variant="outline"
                      size="sm"
                      className="lyra-settings-ai-action"
                      disabled={customModelId.trim().length === 0}
                      onClick={addCustomModel}
                    >
                      {labels.modelsAddCustomModel}
                    </AppButton>
                  </div>
                ) : null}

                {discoveredModelIds.length === 0 ? null : (
                  <div className="lyra-settings-ai-discovered-models">
                    {shouldShowDisableAllDiscoveredModels ? (
                      <div className="lyra-settings-ai-discovered-models-toolbar">
                        <AppButton
                          variant="ghost"
                          size="sm"
                          className="lyra-settings-ai-view-all-models"
                          disabled={model.isSaving}
                          onClick={toggleAllDiscoveredModels}
                        >
                          {allDiscoveredModelsDisabled ? labels.modelsEnableAll : labels.modelsDisableAll}
                        </AppButton>
                      </div>
                    ) : null}
                    <div className="lyra-settings-ai-model-list-surface lyra-settings-ai-model-list-rows">
                      {discoveredModelIds.map((id) => (
                        <AppObjectRow
                          key={id}
                          as="div"
                          role="listitem"
                          active={false}
                          className="lyra-settings-ai-model-option lyra-settings-ai-model-option-static"
                          icon={(
                            <AgentProviderBrandIcon
                              label={selectedProviderRoute.label}
                              modelId={id}
                              providerId={selectedProviderRoute.providerId}
                              routeId={selectedProviderRoute.id}
                            />
                          )}
                          title={id}
                          description={selectedProviderRoute.label}
                          actions={(
                            <AppSwitch
                              checked={!disabledDiscoveredModelIds.has(id)}
                              disabled={model.isSaving}
                              aria-label={id}
                              onCheckedChange={(checked) => {
                                toggleDiscoveredModel(id, checked);
                              }}
                            />
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {hasConfiguredModels && !isProviderSearchMode && filteredModels.length > 0 ? (
          <div className="lyra-settings-ai-model-flow lyra-settings-ai-models-surface">
            <div className="lyra-settings-ai-model-list-surface lyra-settings-ai-model-list-rows">
              {visibleModels.map((entry) => {
                const active = isCurrentModelEntry(entry, model, config);
                const disabled = model.isSaving || !entry.available;
                const description = [
                  entry.providerLabel ?? entry.providerKey ?? entry.provider ?? labels.noDefaultProvider,
                  entry.detail ?? "",
                ].filter((value) => value.length > 0).join(" · ");

                return (
                  <AppObjectRow
                    key={entry.id}
                    as="div"
                    role="listitem"
                    active={false}
                    aria-disabled={disabled ? "true" : undefined}
                    className={[
                      "lyra-settings-ai-model-option",
                      active ? "lyra-settings-ai-model-option-current" : "",
                    ].filter(Boolean).join(" ")}
                    icon={(
                      <AgentProviderBrandIcon
                        label={entry.providerLabel ?? entry.label}
                        modelId={entry.model}
                        provider={entry.provider}
                        providerId={entry.providerId}
                      />
                    )}
                    title={entry.label}
                    description={description}
                    meta={active ? labels.modelsCurrentLabel : undefined}
                    actions={(
                      <span className="lyra-settings-ai-model-actions">
                        <AppIconButton
                          aria-label={`${labels.modelsDeleteLabel}: ${entry.label}`}
                          title={labels.modelsDeleteLabel}
                          tone="danger"
                          className="lyra-settings-ai-row-delete"
                          disabled={disabled}
                          onClick={() => {
                            confirmDeleteModel(entry);
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </AppIconButton>
                        <AppSwitch
                          checked={entry.enabled}
                          disabled={disabled}
                          aria-label={entry.label}
                          onCheckedChange={(checked) => {
                            setModelEnabled(entry, checked);
                          }}
                        />
                      </span>
                    )}
                  />
                );
              })}
              {canShowAllModels ? (
                <AppButton
                  variant="ghost"
                  size="sm"
                  className="lyra-settings-ai-view-all-models"
                  onClick={() => {
                    setShowAllModels(true);
                  }}
                >
                  {labels.modelsViewAll}
                </AppButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const config = asAgentConfig(model.agentConfig?.config);
  const loginProviders = model.agentLoginProviders?.providers ?? [];
  const googleLoginProvider = loginProviders.find((provider) => provider.id === "google");
  const oauthLoginProviders = loginProviders.filter((provider) =>
    provider.requiresCallback && provider.id !== "google"
  );
  const leanPromptDeliveryEnabled =
    config.promptDelivery?.mode === "lean-experimental"
    || config.promptDelivery?.leanExperimental === true;
  const statefulPromptContractEnabled =
    config.promptDelivery?.openaiResponsesStatefulPromptContract === true;
  const [pendingLogin, setPendingLogin] = useState<{
    readonly provider: string;
    readonly label?: string | null;
    readonly flowId: string;
    readonly callbackHint?: string | null;
    readonly instructions: string;
  } | null>(null);
  const [callbackInput, setCallbackInput] = useState("");
  const [swarmModel, setSwarmModel] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [memoryModel, setMemoryModel] = useState("");
  const [ambientModel, setAmbientModel] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [gmailAccessTier, setGmailAccessTier] = useState<"readonly" | "full">("readonly");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [ntfyServer, setNtfyServer] = useState("https://ntfy.sh");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSmtpHost, setEmailSmtpHost] = useState("");
  const [emailSmtpPort, setEmailSmtpPort] = useState("587");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailImapHost, setEmailImapHost] = useState("");
  const [emailImapPort, setEmailImapPort] = useState("993");
  const [emailReplyEnabled, setEmailReplyEnabled] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramReplyEnabled, setTelegramReplyEnabled] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [discordBotUserId, setDiscordBotUserId] = useState("");
  const [discordReplyEnabled, setDiscordReplyEnabled] = useState(false);

  useEffect(() => {
    setSwarmModel(config.roles?.swarmModel ?? "");
    setReviewModel(config.roles?.reviewModel ?? "");
    setJudgeModel(config.roles?.judgeModel ?? "");
    setMemoryModel(config.roles?.memoryModel ?? "");
    setAmbientModel(config.roles?.ambientModel ?? "");
    setDesktopNotifications(config.notifications?.desktopNotifications ?? true);
    setNtfyTopic(config.notifications?.ntfyTopic ?? "");
    setNtfyServer(config.notifications?.ntfyServer ?? "https://ntfy.sh");
    setEmailEnabled(config.notifications?.emailEnabled ?? false);
    setEmailTo(config.notifications?.emailTo ?? "");
    setEmailSmtpHost(config.notifications?.emailSmtpHost ?? "");
    setEmailSmtpPort(String(config.notifications?.emailSmtpPort ?? 587));
    setEmailFrom(config.notifications?.emailFrom ?? "");
    setEmailPassword("");
    setEmailImapHost(config.notifications?.emailImapHost ?? "");
    setEmailImapPort(String(config.notifications?.emailImapPort ?? 993));
    setEmailReplyEnabled(config.notifications?.emailReplyEnabled ?? false);
    setTelegramEnabled(config.notifications?.telegramEnabled ?? false);
    setTelegramBotToken("");
    setTelegramChatId(config.notifications?.telegramChatId ?? "");
    setTelegramReplyEnabled(config.notifications?.telegramReplyEnabled ?? false);
    setDiscordEnabled(config.notifications?.discordEnabled ?? false);
    setDiscordBotToken("");
    setDiscordChannelId(config.notifications?.discordChannelId ?? "");
    setDiscordBotUserId(config.notifications?.discordBotUserId ?? "");
    setDiscordReplyEnabled(config.notifications?.discordReplyEnabled ?? false);
  }, [
    config.notifications?.desktopNotifications,
    config.notifications?.discordBotUserId,
    config.notifications?.discordChannelId,
    config.notifications?.discordEnabled,
    config.notifications?.discordReplyEnabled,
    config.notifications?.emailEnabled,
    config.notifications?.emailFrom,
    config.notifications?.emailImapHost,
    config.notifications?.emailImapPort,
    config.notifications?.emailReplyEnabled,
    config.notifications?.emailSmtpHost,
    config.notifications?.emailSmtpPort,
    config.notifications?.emailTo,
    config.notifications?.ntfyServer,
    config.notifications?.ntfyTopic,
    config.notifications?.telegramChatId,
    config.notifications?.telegramEnabled,
    config.notifications?.telegramReplyEnabled,
    config.roles?.ambientModel,
    config.roles?.judgeModel,
    config.roles?.memoryModel,
    config.roles?.reviewModel,
    config.roles?.swarmModel,
  ]);

  return (
    <section className="lyra-settings-ai-stack">
      {model.errorMessage === null ? null : (
        <AppStatusMessage className="lyra-settings-ai-error" tone="error" role="alert">
          {model.errorMessage}
        </AppStatusMessage>
      )}

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.loginProvidersTitle}</h3>
            <small>{labels.loginProvidersDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-login-provider-grid">
          {oauthLoginProviders.map((provider) => (
            <AppObjectRow
              key={provider.id}
              className={[
                "lyra-settings-ai-login-provider",
                provider.configured ? "lyra-settings-ai-login-provider-configured" : "",
              ].filter(Boolean).join(" ")}
              disabled={model.isSaving}
              icon={(
                <AgentProviderBrandIcon
                  label={provider.displayName}
                  provider={provider.id}
                  providerId={provider.id}
                />
              )}
              title={provider.displayName}
              description={`${provider.authKind} · ${provider.configured ? labels.accountConfigured : labels.accountNotConfigured}`}
              meta={<ExternalLink size={13} aria-hidden="true" />}
              onClick={() => {
                void model.startAgentAccountLogin?.({ provider: provider.id }).then((response) => {
                  if (response === null) return;
                  setPendingLogin({
                    provider: response.provider,
                    label: response.label ?? null,
                    flowId: response.flowId,
                    callbackHint: response.callbackHint ?? null,
                    instructions: response.instructions,
                  });
                  setCallbackInput("");
                });
              }}
            />
          ))}
        </div>

        {googleLoginProvider === undefined ? null : (
          <div className="lyra-settings-ai-oauth-panel">
            <span className="lyra-settings-ai-inline-editor-title-copy">
              <strong>{labels.gmailLoginTitle}</strong>
              <small>{labels.gmailLoginDescription}</small>
              <small>
                {googleLoginProvider.authKind} · {googleLoginProvider.configured ? labels.accountConfigured : labels.accountNotConfigured}
              </small>
            </span>
            <div className="lyra-settings-ai-form">
              <SettingsAiInputField
                label={labels.gmailClientIdLabel}
                type="text"
                value={googleClientId}
                onValueChange={setGoogleClientId}
              />
              <SettingsAiInputField
                label={labels.gmailClientSecretLabel}
                type="password"
                autoComplete="off"
                value={googleClientSecret}
                onValueChange={setGoogleClientSecret}
              />
              <label className="lyra-settings-ai-field">
                <span>{labels.gmailAccessTierLabel}</span>
                <AppSelect
                  ariaLabel={labels.gmailAccessTierLabel}
                  className="lyra-settings-ai-select"
                  value={gmailAccessTier}
                  options={[
                    { value: "readonly", label: labels.gmailAccessReadOnly },
                    { value: "full", label: labels.gmailAccessFull }
                  ]}
                  onValueChange={(nextValue) => {
                    setGmailAccessTier(nextValue === "full" ? "full" : "readonly");
                  }}
                />
              </label>
            </div>
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <AppButton
                  variant="default"
                  size="sm"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving}
                  onClick={() => {
                    void model.startAgentAccountLogin?.({
                      provider: "google",
                      googleClientId: nullableTrimmed(googleClientId),
                      googleClientSecret: nullableTrimmed(googleClientSecret),
                      gmailAccessTier,
                    }).then((response) => {
                      if (response === null) return;
                      setPendingLogin({
                        provider: response.provider,
                        label: response.label ?? null,
                        flowId: response.flowId,
                        callbackHint: response.callbackHint ?? null,
                        instructions: response.instructions,
                      });
                      setCallbackInput("");
                      setGoogleClientSecret("");
                    });
                  }}
                >
                  <LogIn size={14} aria-hidden="true" />
                  {labels.startLogin}
                </AppButton>
              </span>
            </footer>
          </div>
        )}

        {pendingLogin === null ? null : (
          <div className="lyra-settings-ai-oauth-panel">
            <span className="lyra-settings-ai-inline-editor-title-copy">
              <strong>{pendingLogin.label ?? pendingLogin.provider}</strong>
              <small>{pendingLogin.instructions}</small>
              <small>{labels.loginCallbackDescription}</small>
            </span>
            <SettingsAiTextareaField
              className="lyra-settings-ai-field-span-2"
              label={labels.callbackInputLabel}
              placeholder={pendingLogin.callbackHint ?? labels.callbackInputPlaceholder}
              value={callbackInput}
              onValueChange={setCallbackInput}
            />
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <AppButton
                  variant="outline"
                  size="sm"
                  className="lyra-settings-ai-action"
                  disabled={model.isSaving}
                  onClick={() => {
                    setPendingLogin(null);
                    setCallbackInput("");
                  }}
                >
                  {labels.cancel}
                </AppButton>
                <AppButton
                  variant="default"
                  size="sm"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving || callbackInput.trim().length === 0}
                  onClick={() => {
                    void model.completeAgentAccountLogin?.({
                      provider: pendingLogin.provider,
                      flowId: pendingLogin.flowId,
                      label: pendingLogin.label ?? null,
                      callbackInput,
                      setDefault: true,
                    }).then((response) => {
                      if (response === null) return;
                      setPendingLogin(null);
                      setCallbackInput("");
                    });
                  }}
                >
                  <Check size={14} aria-hidden="true" />
                  {labels.completeLogin}
                </AppButton>
              </span>
            </footer>
          </div>
        )}
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.promptExperimentsTitle}</h3>
            <small>{labels.promptExperimentsDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <SettingsAiSwitchRow
            checked={leanPromptDeliveryEnabled}
            label={labels.leanPromptDeliveryLabel}
            onCheckedChange={(checked) => {
              void model.updateAgentConfig?.({
                promptDeliveryMode: checked ? "lean-experimental" : "full",
              });
            }}
          />
          <SettingsAiSwitchRow
            checked={statefulPromptContractEnabled}
            label={labels.statefulPromptContractLabel}
            onCheckedChange={(checked) => {
              void model.updateAgentConfig?.({
                openaiResponsesStatefulPromptContract: checked,
              });
            }}
          />
        </div>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.roleModelsTitle}</h3>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <SettingsAiInputField
            label={labels.roleSwarmSubagentLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={swarmModel}
            onValueChange={setSwarmModel}
          />
          <SettingsAiInputField
            label={labels.roleReviewLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={reviewModel}
            onValueChange={setReviewModel}
          />
          <SettingsAiInputField
            label={labels.roleJudgeLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={judgeModel}
            onValueChange={setJudgeModel}
          />
          <SettingsAiInputField
            label={labels.roleMemoryLabel}
            type="text"
            placeholder={labels.roleMemoryDefaultPlaceholder}
            value={memoryModel}
            onValueChange={setMemoryModel}
          />
          <SettingsAiInputField
            label={labels.roleAmbientLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={ambientModel}
            onValueChange={setAmbientModel}
          />
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <AppButton
              variant="default"
              size="sm"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                void model.updateAgentRoles?.({
                  swarmModel,
                  reviewModel,
                  judgeModel,
                  memoryModel,
                  ambientModel,
                });
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveRoleModels}
            </AppButton>
          </span>
        </footer>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.notificationsTitle}</h3>
            <small>{labels.notificationsDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <SettingsAiSwitchRow
            checked={desktopNotifications}
            label={labels.desktopNotificationsLabel}
            onCheckedChange={setDesktopNotifications}
          />
          <label className="lyra-settings-ai-field">
            <span>{labels.ntfyTopicLabel}</span>
            <AppInput
              className="lyra-settings-ai-input"
              type="text"
              value={ntfyTopic}
              onChange={(event) => setNtfyTopic(event.target.value)}
            />
          </label>
          <SettingsAiInputField
            label={labels.ntfyServerLabel}
            type="text"
            value={ntfyServer}
            onValueChange={setNtfyServer}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={emailEnabled}
            label={labels.emailNotificationsLabel}
            onCheckedChange={setEmailEnabled}
          />
          <SettingsAiInputField
            label={labels.emailToLabel}
            type="email"
            value={emailTo}
            onValueChange={setEmailTo}
          />
          <SettingsAiInputField
            label={labels.emailFromLabel}
            type="email"
            value={emailFrom}
            onValueChange={setEmailFrom}
          />
          <SettingsAiInputField
            label={labels.emailSmtpHostLabel}
            type="text"
            value={emailSmtpHost}
            onValueChange={setEmailSmtpHost}
          />
          <SettingsAiInputField
            label={labels.emailSmtpPortLabel}
            type="number"
            min="0"
            max="65535"
            value={emailSmtpPort}
            onValueChange={setEmailSmtpPort}
          />
          <SettingsAiInputField
            label={labels.emailPasswordLabel}
            type="password"
            autoComplete="off"
            value={emailPassword}
            onValueChange={setEmailPassword}
          />
          <SettingsAiInputField
            label={labels.emailImapHostLabel}
            type="text"
            value={emailImapHost}
            onValueChange={setEmailImapHost}
          />
          <SettingsAiInputField
            label={labels.emailImapPortLabel}
            type="number"
            min="0"
            max="65535"
            value={emailImapPort}
            onValueChange={setEmailImapPort}
          />
          <SettingsAiSwitchRow
            checked={emailReplyEnabled}
            label={labels.emailReplyLabel}
            onCheckedChange={setEmailReplyEnabled}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={telegramEnabled}
            label={labels.telegramNotificationsLabel}
            onCheckedChange={setTelegramEnabled}
          />
          <SettingsAiInputField
            label={labels.telegramBotTokenLabel}
            type="password"
            autoComplete="off"
            value={telegramBotToken}
            onValueChange={setTelegramBotToken}
          />
          <SettingsAiInputField
            label={labels.telegramChatIdLabel}
            type="text"
            value={telegramChatId}
            onValueChange={setTelegramChatId}
          />
          <SettingsAiSwitchRow
            checked={telegramReplyEnabled}
            label={labels.telegramReplyLabel}
            onCheckedChange={setTelegramReplyEnabled}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={discordEnabled}
            label={labels.discordNotificationsLabel}
            onCheckedChange={setDiscordEnabled}
          />
          <SettingsAiInputField
            label={labels.discordBotTokenLabel}
            type="password"
            autoComplete="off"
            value={discordBotToken}
            onValueChange={setDiscordBotToken}
          />
          <SettingsAiInputField
            label={labels.discordChannelIdLabel}
            type="text"
            value={discordChannelId}
            onValueChange={setDiscordChannelId}
          />
          <SettingsAiInputField
            label={labels.discordBotUserIdLabel}
            type="text"
            value={discordBotUserId}
            onValueChange={setDiscordBotUserId}
          />
          <SettingsAiSwitchRow
            checked={discordReplyEnabled}
            label={labels.discordReplyLabel}
            onCheckedChange={setDiscordReplyEnabled}
          />
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <AppButton
              variant="default"
              size="sm"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                const smtpPort = optionalPort(emailSmtpPort);
                const imapPort = optionalPort(emailImapPort);
                const smtpPassword = optionalSecret(emailPassword);
                const telegramToken = optionalSecret(telegramBotToken);
                const discordToken = optionalSecret(discordBotToken);
                void model.updateAgentConfig?.({
                  desktopNotifications,
                  ntfyTopic: nullableTrimmed(ntfyTopic),
                  ntfyServer: nullableTrimmed(ntfyServer),
                  emailEnabled,
                  emailTo: nullableTrimmed(emailTo),
                  emailSmtpHost: nullableTrimmed(emailSmtpHost),
                  ...(smtpPort === undefined ? {} : { emailSmtpPort: smtpPort }),
                  emailFrom: nullableTrimmed(emailFrom),
                  ...(smtpPassword === undefined ? {} : { emailPassword: smtpPassword }),
                  emailImapHost: nullableTrimmed(emailImapHost),
                  ...(imapPort === undefined ? {} : { emailImapPort: imapPort }),
                  emailReplyEnabled,
                  telegramEnabled,
                  ...(telegramToken === undefined ? {} : { telegramBotToken: telegramToken }),
                  telegramChatId: nullableTrimmed(telegramChatId),
                  telegramReplyEnabled,
                  discordEnabled,
                  ...(discordToken === undefined ? {} : { discordBotToken: discordToken }),
                  discordChannelId: nullableTrimmed(discordChannelId),
                  discordBotUserId: nullableTrimmed(discordBotUserId),
                  discordReplyEnabled,
                });
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveNotifications}
            </AppButton>
          </span>
        </footer>
      </div>
    </section>
  );
};
