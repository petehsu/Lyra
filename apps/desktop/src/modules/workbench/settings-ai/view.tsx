import { Check, ExternalLink, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, DragEvent as ReactDragEvent } from "react";

import {
  AppButton,
  AppIconButton,
  AppInput,
  AppObjectRow,
  AppSearchField,
  AppStatusMessage,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import type {
  AgentInstalledSkill,
  AgentMcpServer,
  AgentModelEntry,
  AgentProviderRouteEntry,
  AgentSkillStoreEntry,
} from "../../../shared/desktop-bridge";
import { AgentProviderBrandIcon } from "../agent-provider-brand-icon";
import type { GlobalDialogModel } from "../global-dialog";
import { getDesktopApi } from "../shell/service";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

type SettingsAiModelsViewProps = SettingsAiViewProps & {
  readonly openDialog: GlobalDialogModel["openDialog"];
};

type SettingsAiSkillsViewProps = SettingsAiViewProps;
type SettingsAiMcpViewProps = SettingsAiViewProps;

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
const SKILL_PAGE_SIZE = 24;

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
  readonly promptDelivery?: {
    readonly mode?: string | null;
    readonly leanExperimental?: boolean;
    readonly openaiResponsesStatefulPromptContract?: boolean;
  };
};

const asAgentConfig = (value: unknown): AgentConfigShape =>
  (value ?? {}) as AgentConfigShape;

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
    match: (route) => route.providerId.includes("ollama") || route.id.includes("ollama"),
    values: ["ollama", "llama", "llama3", "llama.cpp", "羊驼", "本地羊驼", "奥拉马"],
  },
  {
    match: (route) => route.providerId.includes("llama") || route.id.includes("llama"),
    values: ["llama", "llama.cpp", "羊驼", "本地推理"],
  },
  {
    match: (route) => route.providerId.includes("lmstudio") || route.id.includes("lmstudio"),
    values: ["lmstudio", "lm studio", "studio", "工作室", "本地工作室"],
  },
  {
    match: (route) => route.providerId.includes("vllm") || route.id.includes("vllm"),
    values: ["vllm", "v llm", "本地部署", "推理服务"],
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
    match: (route) => route.providerId.includes("openrouter") || route.id.includes("openrouter"),
    values: ["openrouter", "open router", "router", "模型路由", "开放路由"],
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
    match: (route) => route.providerId.includes("zhipu") || route.label.toLocaleLowerCase().includes("glm"),
    values: ["glm", "zai", "z.ai", "zhipu", "bigmodel", "智谱", "智谱ai", "智谱 ai"],
  },
  {
    match: (route) => route.providerId.includes("moonshot") || route.label.toLocaleLowerCase().includes("kimi"),
    values: ["moonshot", "kimi", "月之暗面", "月之暗面 kimi"],
  },
  {
    match: (route) => route.providerId.includes("nvidia") || route.label.toLocaleLowerCase().includes("nvidia"),
    values: ["nvidia", "nim", "nvidia nim", "英伟达"],
  },
  {
    match: (route) => route.providerId.includes("bedrock") || route.label.toLocaleLowerCase().includes("bedrock"),
    values: ["bedrock", "aws", "amazon", "亚马逊", "云模型"],
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

type AgentProviderConfigShape = NonNullable<AgentConfigShape["providers"]>[string];

const configForModelEntry = (
  entry: SettingsAiRenderedModelEntry,
  config: AgentConfigShape
): AgentProviderConfigShape | null => {
  const providers = config.providers ?? {};
  return modelProviderKeys(entry)
    .map((key) => providers[key])
    .find((provider): provider is AgentProviderConfigShape => provider !== undefined)
    ?? null;
};

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

const skillSearchText = (skill: AgentInstalledSkill | AgentSkillStoreEntry): string =>
  [
    skill.id,
    skill.name,
    skill.version ?? "",
    skill.description ?? "",
    "sourceRegistry" in skill ? skill.sourceRegistry ?? "" : "",
    ...(skill.permissions ?? []),
    ...(skill.toolPaths ?? []),
  ].join(" ").toLocaleLowerCase();

const compareSkillName = (
  left: AgentInstalledSkill | AgentSkillStoreEntry,
  right: AgentInstalledSkill | AgentSkillStoreEntry,
): number => left.name.localeCompare(right.name);

const filterAndSortSkills = <T extends AgentInstalledSkill | AgentSkillStoreEntry>(
  skills: readonly T[],
  query: string,
): T[] => {
  if (query.length === 0) return [...skills];
  return skills
    .map((skill) => ({ skill, score: fuzzyScore(skillSearchText(skill), query) }))
    .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || compareSkillName(left.skill, right.skill))
    .map((entry) => entry.skill);
};

const installedStoreSkillIds = (skills: readonly AgentInstalledSkill[]): ReadonlySet<string> =>
  new Set(skills.flatMap((skill) => {
    if (skill.source.kind === "store") {
      return [skill.id, skill.source.skillId];
    }
    return [skill.id];
  }));

const shouldRefreshSkillSearch = (query: string): boolean => {
  const input = query.trim();
  if (input.length === 0) return true;
  if (input.length < 2) return false;
  return !(
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("file:") ||
    input.startsWith("git@") ||
    /^https?:\/\//iu.test(input)
  );
};

const renderSkillMeta = (
  labels: SettingsAiLabels,
  permissions: readonly string[],
  toolPaths: readonly string[]
) => (
  <div className="lyra-settings-ai-skill-meta">
    {permissions.length === 0 ? null : (
      <span>
        <strong>{labels.skillsPermissionsLabel}</strong>
        {permissions.join(", ")}
      </span>
    )}
    {toolPaths.length === 0 ? null : (
      <span>
        <strong>{labels.skillsToolsLabel}</strong>
        {toolPaths.join(", ")}
      </span>
    )}
  </div>
);

type ParsedSkillInstallInput =
  | {
    readonly kind: "git";
    readonly ref: string | null;
    readonly subdir: string | null;
    readonly url: string;
  }
  | {
    readonly kind: "local";
    readonly sourcePath: string;
  };

const decodeSkillPathPart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const trimNullable = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};

const skillUrlParam = (url: URL, key: string): string | null => {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = hash.includes("=") ? new URLSearchParams(hash) : null;
  return trimNullable(url.searchParams.get(key) ?? hashParams?.get(key) ?? null);
};

const stripSkillUrlMetadata = (url: URL): string => {
  const clone = new URL(url.href);
  clone.search = "";
  clone.hash = "";
  return clone.toString();
};

const parseSkillInstallInput = (value: string): ParsedSkillInstallInput | null => {
  const input = value.trim().replace(/^['"]|['"]$/gu, "");
  if (input.length === 0) return null;

  if (/^[\w.-]+\/[\w.-]+$/u.test(input)) {
    const parts = input.split("/");
    const owner = parts[0] ?? "";
    const repo = parts[1] ?? "";
    return {
      kind: "git",
      url: `https://github.com/${owner}/${repo.replace(/\.git$/u, "")}.git`,
      ref: null,
      subdir: null,
    };
  }

  const urlInput = input.startsWith("github.com/") ? `https://${input}` : input;
  try {
    const url = new URL(urlInput);
    if (url.protocol === "file:") {
      return {
        kind: "local",
        sourcePath: decodeSkillPathPart(url.pathname),
      };
    }
    if (url.hostname === "github.com" || url.hostname.endsWith(".github.com")) {
      const parts = url.pathname.split("/").filter(Boolean).map(decodeSkillPathPart);
      const owner = parts[0] ?? "";
      const repo = (parts[1] ?? "").replace(/\.git$/u, "");
      if (owner.length > 0 && repo.length > 0) {
        const sourceIndex = parts.findIndex((part) => part === "tree" || part === "blob");
        const ref = sourceIndex >= 0
          ? trimNullable(parts[sourceIndex + 1])
          : skillUrlParam(url, "ref");
        const subdirParts = sourceIndex >= 0 ? parts.slice(sourceIndex + 2) : [];
        if (subdirParts.at(-1)?.toLocaleLowerCase() === "skill.md") {
          subdirParts.pop();
        }
        const subdir = sourceIndex >= 0
          ? trimNullable(subdirParts.join("/"))
          : skillUrlParam(url, "subdir") ?? skillUrlParam(url, "path");
        return {
          kind: "git",
          url: `https://github.com/${owner}/${repo}.git`,
          ref,
          subdir,
        };
      }
    }

    return {
      kind: "git",
      url: stripSkillUrlMetadata(url),
      ref: skillUrlParam(url, "ref"),
      subdir: skillUrlParam(url, "subdir") ?? skillUrlParam(url, "path"),
    };
  } catch {
    if (/^(git@|ssh:\/\/|git:\/\/)/iu.test(input) || /\.git(?:$|[?#/])/iu.test(input)) {
      return {
        kind: "git",
        url: input,
        ref: null,
        subdir: null,
      };
    }
  }

  return {
    kind: "local",
    sourcePath: input,
  };
};

type SettingsAiSkillCardProps = {
  readonly labels: SettingsAiLabels;
  readonly onToggle: (skill: AgentInstalledSkill, active: boolean) => void;
  readonly onUninstall: (skill: AgentInstalledSkill) => void;
  readonly pending: boolean;
  readonly skill: AgentInstalledSkill;
};

const SettingsAiSkillCard = ({
  labels,
  onToggle,
  onUninstall,
  pending,
  skill,
}: SettingsAiSkillCardProps) => (
  <div className="lyra-settings-ai-skill-card" data-pending={pending ? "true" : undefined}>
    <div className="lyra-settings-ai-skill-main">
      <div className="lyra-settings-ai-skill-title-row">
        <div>
          <h3>{skill.name}</h3>
          <p>{skill.id} · {skill.version}</p>
        </div>
      </div>
      {skill.description.length === 0 ? null : (
        <p className="lyra-settings-ai-skill-description">{skill.description}</p>
      )}
      {renderSkillMeta(labels, skill.permissions, skill.toolPaths)}
    </div>
    <div className="lyra-settings-ai-skill-actions">
      <AppSwitch
        checked={skill.active}
        aria-label={skill.name}
        onCheckedChange={(active) => {
          onToggle(skill, active);
        }}
      />
      <AppIconButton
        aria-label={`${labels.skillsUninstall}: ${skill.name}`}
        title={labels.skillsUninstall}
        tone="danger"
        className="lyra-settings-ai-row-delete"
        onClick={() => {
          onUninstall(skill);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </AppIconButton>
    </div>
  </div>
);

type SettingsAiStoreSkillCardProps = {
  readonly entry: AgentSkillStoreEntry;
  readonly labels: SettingsAiLabels;
  readonly onInstall: (entry: AgentSkillStoreEntry) => void;
  readonly pending: boolean;
};

const SettingsAiStoreSkillCard = ({
  entry,
  labels,
  onInstall,
  pending,
}: SettingsAiStoreSkillCardProps) => (
  <div className="lyra-settings-ai-skill-card" data-pending={pending ? "true" : undefined}>
    <div className="lyra-settings-ai-skill-main">
      <div className="lyra-settings-ai-skill-title-row">
        <div>
          <h3>{entry.name}</h3>
          <p>
            {[entry.sourceRegistry ?? entry.id, entry.version ?? ""].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {entry.description === undefined || entry.description.length === 0 ? null : (
        <p className="lyra-settings-ai-skill-description">{entry.description}</p>
      )}
      {renderSkillMeta(labels, entry.permissions ?? [], entry.toolPaths ?? [])}
    </div>
    <div className="lyra-settings-ai-skill-actions">
      <AppSwitch
        checked={false}
        aria-label={entry.name}
        onCheckedChange={(checked) => {
          if (!checked) return;
          onInstall(entry);
        }}
      />
    </div>
  </div>
);

const mcpTransportText = (server: AgentMcpServer): string =>
  server.transportSummary
  ?? (server.transport.kind === "stdio"
    ? [server.transport.command, ...server.transport.args].filter(Boolean).join(" ")
    : server.transport.url);

const mcpSearchText = (server: AgentMcpServer): string =>
  [
    server.id,
    server.name,
    server.state,
    mcpTransportText(server),
    ...(server.tools ?? []).flatMap((tool) => [tool.name, tool.description ?? ""]),
  ].join(" ").toLocaleLowerCase();

const mcpStateLabel = (labels: SettingsAiLabels, state: string): string => {
  if (state === "connected") return labels.mcpConnected;
  if (state === "failed") return labels.mcpFailed;
  return labels.mcpDisconnected;
};

type SettingsAiMcpServerCardProps = {
  readonly labels: SettingsAiLabels;
  readonly onRemove: (server: AgentMcpServer) => void;
  readonly onToggle: (server: AgentMcpServer, active: boolean) => void;
  readonly pending: boolean;
  readonly server: AgentMcpServer;
};

const SettingsAiMcpServerCard = ({
  labels,
  onRemove,
  onToggle,
  pending,
  server,
}: SettingsAiMcpServerCardProps) => {
  const active = server.enabled && server.state === "connected";
  const baseUrl = server.transport.kind === "stdio" ? null : server.transport.url;
  const toolCount = server.toolCount ?? server.tools?.length ?? 0;
  return (
    <div className="lyra-settings-ai-skill-card" data-pending={pending ? "true" : undefined}>
      <div className="lyra-settings-ai-skill-main">
        <div className="lyra-settings-ai-skill-title-row">
          <div className="lyra-settings-ai-mcp-title">
            <span className="lyra-settings-ai-mcp-icon" aria-hidden="true">
              <AgentProviderBrandIcon
                baseUrl={baseUrl}
                label={server.name}
                modelId={mcpTransportText(server)}
                provider={server.id}
                providerId={server.id}
                size={16}
              />
            </span>
            <span>
              <h3>{server.name}</h3>
              <p>{server.id} · {mcpStateLabel(labels, server.state)}</p>
            </span>
          </div>
        </div>
        <p className="lyra-settings-ai-skill-description">{mcpTransportText(server)}</p>
        <div className="lyra-settings-ai-skill-meta">
          <span><strong>{labels.mcpToolsLabel}</strong>{toolCount}</span>
          {server.lastError === undefined || server.lastError === null || server.lastError.length === 0 ? null : (
            <span>{server.lastError}</span>
          )}
        </div>
      </div>
      <div className="lyra-settings-ai-skill-actions">
        <AppSwitch
          checked={active}
          aria-label={server.name}
          onCheckedChange={(checked) => {
            onToggle(server, checked);
          }}
        />
        <AppIconButton
          aria-label={`${labels.mcpRemove}: ${server.name}`}
          title={labels.mcpRemove}
          tone="danger"
          className="lyra-settings-ai-row-delete"
          onClick={() => {
            onRemove(server);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </AppIconButton>
      </div>
    </div>
  );
};

export const SettingsAiMcpView = ({ labels, model }: SettingsAiMcpViewProps) => {
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const servers = model.agentMcpCatalog?.servers ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredServers = normalizedQuery.length === 0
    ? [...servers]
    : servers
      .map((server) => ({ server, score: fuzzyScore(mcpSearchText(server), normalizedQuery) }))
      .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.score - left.score || left.server.name.localeCompare(right.server.name))
      .map((entry) => entry.server);

  const runMcpOperation = useCallback(async (
    pendingId: string,
    operation: () => Promise<void> | void,
  ): Promise<void> => {
    setPendingIds((current) => new Set(current).add(pendingId));
    try {
      await operation();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(pendingId);
        return next;
      });
    }
  }, []);

  const addServer = useCallback((): void => {
    const input = query.trim();
    if (input.length === 0) return;
    void runMcpOperation("input", async () => {
      await model.upsertAgentMcpServer?.({ input });
      setQuery("");
    });
  }, [model.upsertAgentMcpServer, query, runMcpOperation]);

  const toggleServer = useCallback((server: AgentMcpServer, active: boolean): void => {
    void runMcpOperation(`server:${server.id}`, async () => {
      if (active) {
        await model.connectAgentMcpServer?.({ serverId: server.id });
      } else {
        await model.disconnectAgentMcpServer?.({ serverId: server.id });
      }
    });
  }, [model.connectAgentMcpServer, model.disconnectAgentMcpServer, runMcpOperation]);

  const removeServer = useCallback((server: AgentMcpServer): void => {
    void runMcpOperation(`server:${server.id}`, async () => {
      await model.removeAgentMcpServer?.({ serverId: server.id });
    });
  }, [model.removeAgentMcpServer, runMcpOperation]);

  return (
    <section className="lyra-settings-ai-stack lyra-settings-ai-skills-page">
      <div className="lyra-settings-ai-models-panel">
        <form
          className="lyra-settings-ai-page-header"
          onSubmit={(event) => {
            event.preventDefault();
            addServer();
          }}
        >
          <AppSearchField
            ariaLabel={labels.mcpTitle}
            className="lyra-settings-ai-model-search"
            placeholder={labels.mcpSearchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <AppButton
            type="submit"
            variant="default"
            size="sm"
            className="lyra-settings-ai-action lyra-settings-ai-action-primary"
            disabled={query.trim().length === 0}
          >
            <Plus size={14} aria-hidden="true" />
            {labels.mcpAddServer}
          </AppButton>
        </form>

        {model.errorMessage === null ? null : (
          <AppStatusMessage className="lyra-settings-ai-error" tone="error" role="alert">
            {model.errorMessage}
          </AppStatusMessage>
        )}

        {filteredServers.length === 0 ? (
          <div className="lyra-settings-ai-empty-panel" role="status">
            <strong>{servers.length === 0 ? labels.mcpEmptyTitle : labels.mcpDisconnected}</strong>
            <span>{labels.mcpEmptyDescription}</span>
          </div>
        ) : (
          <div className="lyra-settings-ai-skill-list">
            {filteredServers.map((server) => (
              <SettingsAiMcpServerCard
                key={server.id}
                labels={labels}
                onRemove={removeServer}
                onToggle={toggleServer}
                pending={pendingIds.has(`server:${server.id}`)}
                server={server}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export const SettingsAiSkillsView = ({ labels, model }: SettingsAiSkillsViewProps) => {
  const [query, setQuery] = useState("");
  const [visibleSkillLimit, setVisibleSkillLimit] = useState(SKILL_PAGE_SIZE);
  const [isSearchingSkills, setIsSearchingSkills] = useState(false);
  const [isLoadingMoreSkills, setIsLoadingMoreSkills] = useState(false);
  const [pendingSkillIds, setPendingSkillIds] = useState<ReadonlySet<string>>(() => new Set());
  const [skillDropActive, setSkillDropActive] = useState(false);
  const searchSequenceRef = useRef(0);
  const skillDropDepthRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const catalog = model.agentSkillCatalog ?? null;
  const skills = catalog?.skills ?? [];
  const store = catalog?.store ?? null;
  const installedSkillIds = useMemo(() => installedStoreSkillIds(skills), [skills]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const refreshSkillStore = model.refreshAgentSkillStore;

  const runSkillOperation = useCallback(async (
    pendingId: string,
    operation: () => Promise<void> | void,
  ): Promise<void> => {
    setPendingSkillIds((current) => new Set(current).add(pendingId));
    try {
      await operation();
    } finally {
      setPendingSkillIds((current) => {
        const next = new Set(current);
        next.delete(pendingId);
        return next;
      });
    }
  }, []);

  const installSkillValue = useCallback(async (value: string): Promise<void> => {
    const parsed = parseSkillInstallInput(value);
    if (parsed === null) return;
    setQuery(value);
    await runSkillOperation("input", async () => {
      if (parsed.kind === "git") {
        await model.installAgentSkillFromGit?.({
          url: parsed.url,
          ref: parsed.ref,
          subdir: parsed.subdir,
        });
      } else {
        await model.installAgentSkillFromLocal?.({ sourcePath: parsed.sourcePath });
      }
      setQuery("");
    });
  }, [
    model.installAgentSkillFromGit,
    model.installAgentSkillFromLocal,
    runSkillOperation,
  ]);

  useEffect(() => {
    setVisibleSkillLimit(SKILL_PAGE_SIZE);
    if (!shouldRefreshSkillSearch(query) || refreshSkillStore === undefined) {
      setIsSearchingSkills(false);
      return;
    }
    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    setIsSearchingSkills(true);
    const timer = window.setTimeout(() => {
      void refreshSkillStore({ query: query.trim(), offset: 0, append: false })
        .finally(() => {
          if (searchSequenceRef.current === sequence) {
            setIsSearchingSkills(false);
          }
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, refreshSkillStore]);

  const filteredSkills = filterAndSortSkills(skills, normalizedQuery);
  const storeSkills = store?.index?.skills ?? [];
  const filteredStoreSkills = filterAndSortSkills(storeSkills, normalizedQuery);
  const allVisibleStoreSkills = filteredStoreSkills.filter((entry) => !installedSkillIds.has(entry.id));
  const visibleStoreSkills = allVisibleStoreSkills.slice(0, visibleSkillLimit);
  const hasVisibleSkills = filteredSkills.length > 0 || visibleStoreSkills.length > 0;
  const hasMoreLocalStoreSkills = allVisibleStoreSkills.length > visibleStoreSkills.length;
  const hasMoreRemoteStoreSkills = store?.index?.hasMore === true;

  const loadMoreSkills = useCallback(async (): Promise<void> => {
    if (isLoadingMoreSkills) return;
    if (hasMoreLocalStoreSkills) {
      setVisibleSkillLimit((current) => current + SKILL_PAGE_SIZE);
      return;
    }
    if (!hasMoreRemoteStoreSkills || refreshSkillStore === undefined || !shouldRefreshSkillSearch(query)) {
      return;
    }
    setIsLoadingMoreSkills(true);
    try {
      await refreshSkillStore({
        query: query.trim(),
        offset: storeSkills.length,
        append: true,
      });
    } finally {
      setIsLoadingMoreSkills(false);
    }
  }, [
    hasMoreLocalStoreSkills,
    hasMoreRemoteStoreSkills,
    isLoadingMoreSkills,
    query,
    refreshSkillStore,
    storeSkills.length,
  ]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (target === null || !hasVisibleSkills || (!hasMoreLocalStoreSkills && !hasMoreRemoteStoreSkills)) {
      return;
    }
    if (typeof window.IntersectionObserver !== "function") {
      return;
    }
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreSkills();
      }
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreLocalStoreSkills, hasMoreRemoteStoreSkills, hasVisibleSkills, loadMoreSkills]);

  const installSkillInput = (): void => {
    void installSkillValue(query);
  };

  const toggleInstalledSkill = useCallback((skill: AgentInstalledSkill, active: boolean): void => {
    void runSkillOperation(`skill:${skill.id}`, async () => {
      if (active) {
        await model.activateAgentSkill?.({ skillId: skill.id });
      } else {
        await model.deactivateAgentSkill?.({ skillId: skill.id });
      }
    });
  }, [model.activateAgentSkill, model.deactivateAgentSkill, runSkillOperation]);

  const uninstallInstalledSkill = useCallback((skill: AgentInstalledSkill): void => {
    void runSkillOperation(`skill:${skill.id}`, async () => {
      await model.uninstallAgentSkill?.({ skillId: skill.id });
    });
  }, [model.uninstallAgentSkill, runSkillOperation]);

  const installStoreSkill = useCallback((entry: AgentSkillStoreEntry): void => {
    void runSkillOperation(`store:${entry.id}`, async () => {
      await model.installAgentSkillFromStore?.({ skillId: entry.id });
    });
  }, [model.installAgentSkillFromStore, runSkillOperation]);

  const resolveDroppedSkillInput = (event: ReactDragEvent<HTMLElement>): string | null => {
    for (const file of Array.from(event.dataTransfer.files)) {
      const fromBridge = getDesktopApi()?.files.getPathForFile?.(file)?.trim();
      if (fromBridge !== undefined && fromBridge.length > 0) return fromBridge;
      const legacy = (file as File & { readonly path?: string }).path?.trim();
      if (legacy !== undefined && legacy.length > 0) return legacy;
    }
    return (event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain")).trim() || null;
  };

  const skillDragLooksInstallable = (event: ReactDragEvent<HTMLElement>): boolean =>
    event.dataTransfer.files.length > 0
    || Array.from(event.dataTransfer.types).includes("text/uri-list")
    || Array.from(event.dataTransfer.types).includes("text/plain");

  const handleSkillDragEnter = (event: ReactDragEvent<HTMLFormElement>): void => {
    if (!skillDragLooksInstallable(event)) return;
    event.preventDefault();
    skillDropDepthRef.current += 1;
    setSkillDropActive(true);
  };

  const handleSkillDragOver = (event: ReactDragEvent<HTMLFormElement>): void => {
    if (!skillDragLooksInstallable(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setSkillDropActive(true);
  };

  const handleSkillDragLeave = (event: ReactDragEvent<HTMLFormElement>): void => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    skillDropDepthRef.current = Math.max(0, skillDropDepthRef.current - 1);
    if (skillDropDepthRef.current === 0) {
      setSkillDropActive(false);
    }
  };

  const handleSkillDrop = (event: ReactDragEvent<HTMLFormElement>): void => {
    if (!skillDragLooksInstallable(event)) return;
    event.preventDefault();
    skillDropDepthRef.current = 0;
    setSkillDropActive(false);
    const input = resolveDroppedSkillInput(event);
    if (input !== null) {
      void installSkillValue(input);
    }
  };

  return (
    <section className="lyra-settings-ai-stack lyra-settings-ai-skills-page">
      <div className="lyra-settings-ai-models-panel">
        <form
          className="lyra-settings-ai-page-header"
          data-drop-active={skillDropActive ? "true" : undefined}
          onDragEnter={handleSkillDragEnter}
          onDragOver={handleSkillDragOver}
          onDragLeave={handleSkillDragLeave}
          onDrop={handleSkillDrop}
          onSubmit={(event) => {
            event.preventDefault();
            installSkillInput();
          }}
        >
          <AppSearchField
            ariaLabel={labels.skillsTitle}
            className="lyra-settings-ai-model-search"
            placeholder={labels.skillsSearchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <AppButton
            type="submit"
            variant="default"
            size="sm"
            className="lyra-settings-ai-action lyra-settings-ai-action-primary"
            disabled={query.trim().length === 0 || pendingSkillIds.has("input")}
          >
            <Plus size={14} aria-hidden="true" />
            {labels.skillsAddSkill}
          </AppButton>
        </form>

        {model.errorMessage === null ? null : (
          <AppStatusMessage className="lyra-settings-ai-error" tone="error" role="alert">
            {model.errorMessage}
          </AppStatusMessage>
        )}

        {isSearchingSkills && !hasVisibleSkills ? (
          <div className="lyra-settings-ai-empty-panel" role="status">
            <strong>{labels.skillsSearching}</strong>
            <span>{labels.skillsEmptyDescription}</span>
          </div>
        ) : !hasVisibleSkills ? (
          <div className="lyra-settings-ai-empty-panel" role="status">
            <strong>{labels.skillsEmptyTitle}</strong>
            <span>{store?.lastError ?? labels.skillsEmptyDescription}</span>
          </div>
        ) : (
          <div className="lyra-settings-ai-skill-list">
            {isSearchingSkills ? (
              <div className="lyra-settings-ai-skill-status" role="status">
                {labels.skillsSearching}
              </div>
            ) : null}
            {filteredSkills.map((skill) => (
              <SettingsAiSkillCard
                key={skill.id}
                labels={labels}
                onToggle={toggleInstalledSkill}
                onUninstall={uninstallInstalledSkill}
                pending={pendingSkillIds.has(`skill:${skill.id}`)}
                skill={skill}
              />
            ))}
            {visibleStoreSkills.map((entry) => (
              <SettingsAiStoreSkillCard
                key={entry.id}
                entry={entry}
                labels={labels}
                onInstall={installStoreSkill}
                pending={pendingSkillIds.has(`store:${entry.id}`)}
              />
            ))}
            <div ref={loadMoreRef} className="lyra-settings-ai-skill-load-more" aria-hidden="true" />
            {isLoadingMoreSkills ? (
              <div className="lyra-settings-ai-skill-status" role="status">
                {labels.skillsLoadingMore}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
};

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
  const hasSelectedProviderRoute = selectedProviderRoute !== null;
  const selectedProviderRouteDefaultBaseUrl = selectedProviderRoute?.defaultBaseUrl ?? null;
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
      baseUrl={providerBaseUrl || selectedProviderRoute.defaultBaseUrl}
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
    if (!hasSelectedProviderRoute) {
      return;
    }
    setProviderBaseUrl(
      selectedProviderProfile?.baseUrl
      ?? selectedProviderConfig?.baseUrl
      ?? selectedProviderRouteDefaultBaseUrl
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
    hasSelectedProviderRoute,
    selectedProviderConfig?.baseUrl,
    selectedProviderProfile?.baseUrl,
    selectedProviderRouteDefaultBaseUrl,
    selectedProviderRouteId,
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
                              baseUrl={providerBaseUrl || selectedProviderRoute.defaultBaseUrl}
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
                const providerConfig = configForModelEntry(entry, config);
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
                        baseUrl={providerConfig?.baseUrl ?? null}
                        label={entry.providerLabel ?? entry.label}
                        modelId={entry.model}
                        provider={entry.provider}
                        providerId={entry.providerId}
                        routeId={entry.routeId}
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
  const oauthLoginProviders = loginProviders.filter((provider) => provider.requiresCallback);
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
    </section>
  );
};
