import type { AppMetaPayload } from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { AgentComposerWorkbenchTabMention } from "./agent-composer-types";

export type AiPanelEmptyGreetingTextLabels = {
  readonly fallbackName: string;
  readonly late: string;
  readonly morning: string;
  readonly day: string;
  readonly evening: string;
  readonly place: string;
  readonly project: string;
  readonly host: string;
  readonly file: string;
  readonly tab: string;
  readonly general: string;
};

type EmptyGreetingContext = {
  readonly locale: WorkbenchLocale;
  readonly appMeta?: AppMetaPayload | null | undefined;
  readonly boundProjectRoot?: string | null | undefined;
  readonly fileMentionSearchRoots: readonly string[];
  readonly workbenchTabMentions: readonly AgentComposerWorkbenchTabMention[];
  readonly fallbackLabel: string;
  readonly textLabels: AiPanelEmptyGreetingTextLabels;
};

const ZH_TIME_ZONE_LABELS: Readonly<Record<string, string>> = {
  "Asia/Shanghai": "上海",
  "Asia/Hong_Kong": "香港",
  "Asia/Taipei": "台北",
  "Asia/Tokyo": "东京",
  "Asia/Seoul": "首尔",
  "Europe/London": "伦敦",
  "Europe/Paris": "巴黎",
  "America/Los_Angeles": "洛杉矶",
  "America/New_York": "纽约",
  "America/Chicago": "芝加哥",
  "America/Denver": "丹佛"
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const rotateBySeed = (items: readonly string[], seed: string): readonly string[] => {
  if (items.length <= 1) {
    return items;
  }
  const start = hashString(seed) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
};

const cleanIdentity = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const emailName = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  const slashParts = emailName.split(/[\\/]/).filter((part) => part.length > 0);
  const normalized = (slashParts.at(-1) ?? emailName)
    .replace(/\s+/g, " ")
    .trim();
  if (
    normalized.length === 0
    || normalized.toLowerCase() === "unknown"
    || normalized.toLowerCase() === "localhost"
  ) {
    return null;
  }
  return normalized.length > 28 ? normalized.slice(0, 28) : normalized;
};

const basename = (path: string | null | undefined): string | null => {
  const trimmed = path?.replace(/\\/g, "/").trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const segments = trimmed.split("/").filter((part) => part.length > 0);
  return segments.at(-1) ?? trimmed;
};

const derivePlaceLabel = (
  timeZone: string | null | undefined,
  locale: WorkbenchLocale
): string | null => {
  const zone = timeZone?.trim() ?? "";
  if (zone.length === 0) {
    return null;
  }
  if (locale === "zh-CN") {
    return ZH_TIME_ZONE_LABELS[zone] ?? basename(zone.replace(/_/g, " "));
  }
  return basename(zone.replace(/_/g, " "));
};

const readUrlHost = (tab: AgentComposerWorkbenchTabMention | null): string | null => {
  const raw = tab?.address ?? tab?.inputValue ?? "";
  if (!/^https?:\/\//i.test(raw)) {
    return null;
  }
  try {
    return new URL(raw).host.replace(/^www\./i, "");
  } catch (_error) {
    return null;
  }
};

const resolveActiveContextTab = (
  tabs: readonly AgentComposerWorkbenchTabMention[]
): AgentComposerWorkbenchTabMention | null =>
  tabs.find((tab) => tab.active) ?? tabs.find((tab) => tab.visible) ?? tabs[0] ?? null;

const resolveTimeBucket = (hour: number): "late" | "morning" | "day" | "evening" => {
  if (hour < 5 || hour >= 23) {
    return "late";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 19) {
    return "day";
  }
  return "evening";
};

const splitTemplates = (value: string): readonly string[] =>
  value
    .split("||")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const formatTemplate = (
  template: string,
  values: Readonly<Record<string, string>>
): string =>
  template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");

const pushFormatted = (
  target: string[],
  templates: string,
  values: Readonly<Record<string, string>>
): void => {
  for (const template of splitTemplates(templates)) {
    const formatted = formatTemplate(template, values).trim();
    if (formatted.length > 0) {
      target.push(formatted);
    }
  }
};

export const resolveAiPanelEmptyGreetingCandidates = ({
  locale,
  appMeta,
  boundProjectRoot,
  fileMentionSearchRoots,
  workbenchTabMentions,
  fallbackLabel,
  textLabels
}: EmptyGreetingContext): readonly string[] => {
  const name =
    cleanIdentity(appMeta?.userName)
    ?? cleanIdentity(appMeta?.hostName)
    ?? textLabels.fallbackName;
  const timeZone =
    appMeta?.timeZone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    ?? null;
  const place = derivePlaceLabel(timeZone, locale);
  const activeTab = resolveActiveContextTab(workbenchTabMentions);
  const project = basename(boundProjectRoot ?? fileMentionSearchRoots[0] ?? null);
  const host = readUrlHost(activeTab);
  const file = basename(activeTab?.filePath ?? null);
  const tabTitle = activeTab?.title?.trim() ?? "";
  const cleanTabTitle =
    tabTitle.length > 0 && tabTitle !== project
      ? tabTitle.slice(0, 36)
      : null;
  const hour = new Date().getHours();
  const timeBucket = resolveTimeBucket(hour);
  const values = {
    name,
    place: place ?? "",
    project: project ?? "",
    host: host ?? "",
    file: file ?? "",
    tabTitle: cleanTabTitle ?? ""
  };
  const candidates: string[] = [];

  pushFormatted(candidates, textLabels[timeBucket], values);
  if (place !== null) {
    pushFormatted(candidates, textLabels.place, values);
  }
  if (project !== null) {
    pushFormatted(candidates, textLabels.project, values);
  }
  if (host !== null) {
    pushFormatted(candidates, textLabels.host, values);
  }
  if (file !== null) {
    pushFormatted(candidates, textLabels.file, values);
  }
  if (cleanTabTitle !== null) {
    pushFormatted(candidates, textLabels.tab, values);
  }
  pushFormatted(candidates, textLabels.general, values);

  const deduped = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  const seed = [
    locale,
    name,
    place ?? "",
    project ?? "",
    host ?? "",
    file ?? "",
    cleanTabTitle ?? "",
    timeBucket
  ].join("|");
  const rotated = rotateBySeed(deduped, seed);
  return rotated.length > 0 ? rotated : [fallbackLabel];
};
