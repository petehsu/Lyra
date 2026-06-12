import type { AgentToolActivity } from "../../../../shared/agent";
import type { ToolActionTarget, ToolDetails, WebResult, WorkbenchTabSummary } from "../../ai-panel/lyra-agents/core/types";
import { asRecord, arrayField, isHttpUrl, stringField, toolInputRecord } from "./common";

type ParsedWorkbenchDetails = Extract<ToolDetails, { type: "workbench" }>;
type ParsedSoftwareDetails = Extract<ToolDetails, { type: "software" }>;

export const normalizeWorkbenchFlags = (flags: string | undefined): string[] => {
  if (flags === undefined) return [];
  return flags
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0 && flag !== "none");
};

export const workbenchActionLabel = (action: string): string => {
  switch (action) {
    case "list_tabs":
      return "Workbench tabs";
    case "read_tab":
      return "Workbench tab";
    case "read_workspace":
      return "Workbench workspace";
    case "extract_tab_text":
      return "Workbench text";
    default:
      return "Workbench";
  }
};

export const webResultsFromRaw = (raw: Record<string, unknown>): WebResult[] | undefined => {
  const rawResults = arrayField(raw, "results");
  if (rawResults === undefined) return undefined;
  const results = rawResults
    .map((item) => {
      const record = asRecord(item);
      const title = stringField(record, "title", "name") ?? "Untitled";
      const url = stringField(record, "url", "href");
      if (url === undefined || !isHttpUrl(url)) return null;
      const snippet = stringField(record, "snippet", "summary", "text");
      return {
        title,
        url,
        ...(snippet === undefined ? {} : { snippet })
      };
    })
    .filter((item): item is WebResult => item !== null);
  return results.length === 0 ? undefined : results;
};

const cleanMarkdownInline = (value: string): string =>
  value
    .replace(/^\s*[-*]\s+/u, "")
    .replace(/^\d+\.\s+/u, "")
    .replace(/^\*\*(.*)\*\*$/u, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();

const firstHttpUrl = (value: string): string | undefined => {
  const match = value.match(/https?:\/\/[^\s)]+/u);
  return match === null ? undefined : match[0];
};

export const webResultsFromText = (text: string): WebResult[] | undefined => {
  const lines = text.split("\n");
  const results: WebResult[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const numberedTitle = line.match(/^\d+\.\s+(.+)$/u);
    if (numberedTitle === null) continue;

    const title = cleanMarkdownInline(numberedTitle[1] ?? "");
    let url: string | undefined;
    let snippet: string | undefined;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]?.trim() ?? "";
      if (candidate.length === 0) continue;
      if (/^\d+\.\s+/u.test(candidate)) break;
      const candidateUrl = firstHttpUrl(candidate);
      if (candidateUrl !== undefined) {
        url = candidateUrl;
        continue;
      }
      if (url !== undefined && snippet === undefined) {
        snippet = cleanMarkdownInline(candidate);
      }
    }
    if (title.length > 0 && url !== undefined && isHttpUrl(url)) {
      results.push({
        title,
        url,
        ...(snippet === undefined ? {} : { snippet })
      });
    }
  }
  return results.length === 0 ? undefined : results;
};

export const webFetchFromText = (
  text: string
): {
  readonly url?: string;
  readonly title?: string;
  readonly fetchedBytes?: number;
  readonly summary?: string;
} => {
  const lines = text.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const fetchMatch = firstLine.match(/^Fetched\s+(https?:\/\/\S+)(?:\s+\((\d+)\s+bytes\))?/u);
  if (fetchMatch === null) return {};
  const url = fetchMatch[1];
  if (url === undefined) return {};

  const contentLines = lines.slice(1).filter((line) => line.trim().length > 0);
  const titleLine = contentLines.find((line) => line.trim().startsWith("- "));
  const summary = contentLines
    .map((line) => line.trim())
    .join("\n")
    .trim();
  const bytes = fetchMatch[2] === undefined ? undefined : Number.parseInt(fetchMatch[2], 10);
  return {
    url,
    ...(titleLine === undefined ? {} : { title: cleanMarkdownInline(titleLine) }),
    ...(bytes === undefined || !Number.isFinite(bytes) ? {} : { fetchedBytes: bytes }),
    ...(summary.length === 0 ? {} : { summary })
  };
};

export const workbenchTabFromRaw = (value: unknown): WorkbenchTabSummary | null => {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const tabId = stringField(record, "tabId", "id");
  const title = stringField(record, "title", "label", "name") ?? "Untitled";
  const kind = stringField(record, "kind", "pageKind", "type") ?? "tab";
  const observationKind = stringField(record, "observationKind");
  const rawFlags = arrayField(record, "flags")
    ?.filter((flag): flag is string => typeof flag === "string")
    ?? normalizeWorkbenchFlags(stringField(record, "flags"));
  const url = stringField(record, "url", "displayAddress", "href");
  const excerpt = stringField(record, "excerpt", "summary", "text", "content");
  if (tabId === undefined && excerpt === undefined && url === undefined) return null;
  return {
    title,
    tabId: tabId ?? "-",
    kind,
    flags: rawFlags,
    ...(observationKind === undefined ? {} : { observationKind }),
    ...(url === undefined || !isHttpUrl(url) ? {} : { url }),
    ...(excerpt === undefined ? {} : { excerpt })
  };
};

export const workbenchTabsFromText = (text: string): WorkbenchTabSummary[] | null => {
  const tabs = text
    .split("\n")
    .map((line) => {
      const normalized = line.trim().replace(/^[-*]\s+/u, "");
      const [tabText, rawUrl] = normalized.split(/\s+\|\s+/u, 2);
      if (tabText === undefined) return null;
      const match = tabText.match(/^(.*?)\s+\[([^\]]+)\]\s+(\S+)(?:\s+\(([^)]+)\))?(?:\s+flags=(.*))?$/u);
      if (match === null) return null;
      const title = (match[1] ?? "").trim();
      const tabId = (match[2] ?? "").trim();
      const kind = (match[3] ?? "tab").trim();
      const observationKind = match[4]?.trim();
      const flags = normalizeWorkbenchFlags(match[5]);
      const url = rawUrl?.trim();
      if (title.length === 0 || tabId.length === 0) return null;
      return {
        title,
        tabId,
        kind,
        flags,
        ...(observationKind === undefined || observationKind.length === 0 ? {} : { observationKind }),
        ...(url === undefined || !isHttpUrl(url) ? {} : { url })
      };
    })
    .filter((tab): tab is WorkbenchTabSummary => tab !== null);
  return tabs.length === 0 ? null : tabs;
};

export const workbenchTabsFromRaw = (raw: Record<string, unknown>): WorkbenchTabSummary[] | null => {
  const rawTabs = arrayField(raw, "tabs", "observations", "pages");
  if (rawTabs === undefined) return null;
  const tabs = rawTabs
    .map(workbenchTabFromRaw)
    .filter((tab): tab is WorkbenchTabSummary => tab !== null);
  return tabs.length === 0 ? null : tabs;
};

export const softwareTitle = (tool: AgentToolActivity): string => {
  const input = toolInputRecord(tool);
  const actionId = stringField(input, "actionId", "capabilityId");
  if (actionId !== undefined) return actionId;
  const action = stringField(input, "action");
  if (action === "list_capabilities") return "Listed software capabilities";
  if (action === "inspect_capability") return "Inspected software capability";
  if (action === "read_state") return "Read software state";
  if (action === "invoke_capability") return "Invoked software capability";
  return "Software capability";
};

export const toWorkbenchDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedWorkbenchDetails => {
  const input = asRecord(tool.input);
  const action = stringField(input, "action") ?? "workbench";
  const label = workbenchActionLabel(action);

  if (action === "list_tabs") {
    const tabs = workbenchTabsFromRaw(raw) ?? workbenchTabsFromText(output);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_workspace") {
    const tabs = workbenchTabsFromRaw(raw) ?? workbenchTabsFromText(output);
    return {
      type: "workbench",
      action,
      label,
      ...(tabs === null ? { text: output } : { tabs })
    };
  }

  if (action === "read_tab") {
    const tab = workbenchTabFromRaw(raw.tab)
      ?? workbenchTabFromRaw(raw)
      ?? workbenchTabsFromText(output)?.[0]
      ?? null;
    return {
      type: "workbench",
      action,
      label,
      ...(tab === null
        ? { text: output }
        : {
            tab,
            ...(tab.excerpt === undefined ? {} : { excerpt: tab.excerpt })
          })
    };
  }

  return {
    type: "workbench",
    action,
    label,
    ...(output.trim().length === 0 ? {} : { text: output })
  };
};

export const toSoftwareDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>,
  targets: readonly ToolActionTarget[]
): ParsedSoftwareDetails => {
  const input = toolInputRecord(tool);
  const softwareId =
    stringField(raw, "softwareId")
    ?? stringField(input, "softwareId");
  const actionId =
    stringField(raw, "actionId", "capabilityId")
    ?? stringField(input, "actionId", "capabilityId");
  return {
    type: "software",
    action: stringField(input, "action") ?? "software",
    ...(softwareId === undefined ? {} : { softwareId }),
    ...(actionId === undefined ? {} : { actionId }),
    ...(output.trim().length === 0 ? {} : { text: output }),
    ...(targets.length === 0 ? {} : { targets: [...targets] })
  };
};
