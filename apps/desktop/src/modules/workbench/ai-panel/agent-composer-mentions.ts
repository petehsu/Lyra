import type {
  AgentComposerAiThreadMention,
  AgentComposerFileAttachment,
  AgentComposerFileMentionSearchResult,
  AgentComposerWorkbenchTabMention,
} from "./agent-composer-types";
import {
  createFileAttachment,
  fileNameFromPath,
} from "./agent-composer-attachments";

export type MentionPanelSessionState = {
  readonly fileSearchSessionId: string | null;
  readonly triggerStart: number;
  readonly triggerEnd: number;
  readonly query: string;
  readonly rootsKey: string;
};

export type AgentComposerMentionPanelSection =
  | "tabs"
  | "recommended_files"
  | "root"
  | "search_results";

export type AgentComposerMentionPanelResult = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "workbench_tab" | "ai_thread";
  readonly section: AgentComposerMentionPanelSection;
  readonly description?: string;
  readonly root?: string;
  readonly score?: number;
  readonly indices?: readonly number[] | null;
  readonly contextText?: string;
  readonly tabKind?: string;
  readonly appId?: string;
  readonly appIconKey?: string;
  readonly faviconUrl?: string;
};


export const createFileMentionSessionId = (): string =>
  `composer-file-mention-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const resolveFileMentionTrigger = (
  value: string,
  caret: number
): Pick<MentionPanelSessionState, "triggerStart" | "triggerEnd" | "query"> | null => {
  const prefix = value.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/u.exec(prefix);
  if (match === null) {
    return null;
  }
  const query = match[2] ?? "";
  return {
    triggerStart: caret - query.length - 1,
    triggerEnd: caret,
    query,
  };
};

export const encodeMentionPathSegment = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/giu, "%252F");

export const compactLines = (lines: readonly (string | null | undefined)[]): string =>
  lines
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0)
    .join("\n");

export const searchableText = (values: readonly (string | undefined)[]): string =>
  values
    .map((value) => value?.toLowerCase() ?? "")
    .filter((value) => value.length > 0)
    .join("\n");

export const isFuzzySubsequence = (query: string, value: string): boolean => {
  if (query.length <= 1) {
    return value.includes(query);
  }
  let valueIndex = 0;
  for (const queryChar of query) {
    valueIndex = value.indexOf(queryChar, valueIndex);
    if (valueIndex === -1) {
      return false;
    }
    valueIndex += 1;
  }
  return true;
};

export const matchesMentionQuery = (
  query: string,
  values: readonly (string | undefined)[]
): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }
  const haystack = searchableText(values);
  return normalizedQuery
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .every((token) =>
      haystack.includes(token)
      || values.some((value) => isFuzzySubsequence(token, value?.toLowerCase() ?? ""))
    );
};

export const normalizeMentionDisplayPath = (path: string): string =>
  path.trim().replace(/\\/gu, "/");

export const stripRootFromPath = (
  path: string,
  roots: readonly string[]
): string | null => {
  const normalizedPath = normalizeMentionDisplayPath(path);
  const matchingRoots = roots
    .map(normalizeMentionDisplayPath)
    .filter((root) => root.length > 0)
    .sort((left, right) => right.length - left.length);
  const normalizedPathLower = normalizedPath.toLowerCase();
  for (const root of matchingRoots) {
    const normalizedRoot = root.replace(/\/+$/u, "");
    const normalizedRootLower = normalizedRoot.toLowerCase();
    if (
      normalizedPathLower === normalizedRootLower ||
      normalizedPathLower.startsWith(`${normalizedRootLower}/`)
    ) {
      return normalizedPath.slice(normalizedRoot.length).replace(/^\/+/u, "") || fileNameFromPath(normalizedPath);
    }
  }
  return null;
};

export const compactAbsolutePathTail = (path: string, segmentCount = 4): string => {
  const normalizedPath = normalizeMentionDisplayPath(path);
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= segmentCount) {
    return normalizedPath;
  }
  return `.../${segments.slice(-segmentCount).join("/")}`;
};

export const queryMatchesHiddenPathPrefix = (
  query: string,
  fullPath: string,
  visiblePath: string
): boolean => {
  const normalizedQueryTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  if (normalizedQueryTokens.length === 0) {
    return false;
  }
  const normalizedFullPath = normalizeMentionDisplayPath(fullPath).toLowerCase();
  const normalizedVisiblePath = normalizeMentionDisplayPath(visiblePath)
    .replace(/^\.\.\//u, "")
    .toLowerCase();
  const visibleStart = normalizedFullPath.lastIndexOf(normalizedVisiblePath);
  const hiddenPrefix = visibleStart <= 0 ? "" : normalizedFullPath.slice(0, visibleStart);
  return normalizedQueryTokens.some((token) =>
    hiddenPrefix.includes(token) && !normalizedVisiblePath.includes(token)
  );
};

export const createFileMentionDisplayPath = (
  path: string,
  roots: readonly string[],
  query: string
): string => {
  const relativePath = stripRootFromPath(path, roots);
  const displayPath = relativePath ?? compactAbsolutePathTail(path);
  return queryMatchesHiddenPathPrefix(query, path, displayPath)
    ? normalizeMentionDisplayPath(path)
    : displayPath;
};

export const workspaceTabTypeLabel = (kind: string): string => {
  if (kind === "page") {
    return "Browser";
  }
  if (kind === "search" || kind === "results") {
    return "Search";
  }
  if (kind === "terminal") {
    return "Terminal";
  }
  if (kind === "settings") {
    return "Settings";
  }
  return kind === "app" ? "Workspace app" : "Workspace";
};

export const workbenchTabMentionToPanelResult = (
  tab: AgentComposerWorkbenchTabMention,
  query: string
): AgentComposerMentionPanelResult | null => {
  if (!matchesMentionQuery(query, [
    tab.title,
    tab.address,
    tab.inputValue,
    tab.query,
    tab.filePath,
    tab.appId,
    tab.appIconKey,
    tab.faviconUrl,
    tab.preview,
    tab.kind,
  ])) {
    return null;
  }
  const typeLabel = workspaceTabTypeLabel(tab.kind);
  const statusLabel = `${tab.active ? "active" : "inactive"}, ${tab.visible ? "visible" : "hidden"}`;
  const description = tab.address ?? tab.filePath ?? tab.query ?? tab.preview ?? typeLabel;
  const contextText = compactLines([
    `Title: ${tab.title}`,
    `Type: ${typeLabel}`,
    `State: ${statusLabel}`,
    tab.address === undefined ? undefined : `Address: ${tab.address}`,
    tab.inputValue === undefined ? undefined : `Input: ${tab.inputValue}`,
    tab.query === undefined ? undefined : `Query: ${tab.query}`,
    tab.filePath === undefined ? undefined : `File: ${tab.filePath}`,
    tab.appId === undefined ? undefined : `Workspace app: ${tab.appId}`,
    tab.terminalTabId === undefined ? undefined : `Terminal tab: ${tab.terminalTabId}`,
    tab.preview === undefined ? undefined : `Preview: ${tab.preview}`,
    "Reference: use workbench.tab.read or workbench.tab.extract_text with this tab id for more detail.",
  ]);
  return {
    id: `workbench-tab:${tab.tabId}`,
    name: tab.title,
    path: `app://workbench/tab/${encodeMentionPathSegment(tab.tabId)}`,
    kind: "workbench_tab",
    section: "tabs",
    description,
    tabKind: tab.kind,
    ...(tab.appId === undefined ? {} : { appId: tab.appId }),
    ...(tab.appIconKey === undefined ? {} : { appIconKey: tab.appIconKey }),
    ...(tab.faviconUrl === undefined ? {} : { faviconUrl: tab.faviconUrl }),
    contextText,
  };
};

export const OPEN_FILE_MENTION_SCORE_BASE = 2_000_000;

export const workbenchTabMentionToOpenFilePanelResult = (
  tab: AgentComposerWorkbenchTabMention,
  query: string,
  roots: readonly string[]
): AgentComposerMentionPanelResult | null => {
  const filePath = tab.filePath?.trim();
  if (filePath === undefined || filePath.length === 0) {
    return null;
  }
  const name = fileNameFromPath(filePath);
  if (!matchesMentionQuery(query, [name, filePath, tab.title])) {
    return null;
  }
  const hasQuery = query.trim().length > 0;
  const stateBonus = tab.active ? 20_000 : tab.visible ? 10_000 : 0;
  return {
    id: `open-file:${tab.tabId}:${filePath}`,
    name,
    path: filePath,
    kind: "file",
    section: hasQuery ? "search_results" : "recommended_files",
    description: createFileMentionDisplayPath(filePath, roots, query),
    score: OPEN_FILE_MENTION_SCORE_BASE + stateBonus,
  };
};

export const aiThreadMentionToPanelResult = (
  thread: AgentComposerAiThreadMention,
  query: string
): AgentComposerMentionPanelResult | null => {
  if (!matchesMentionQuery(query, [
    thread.title,
    thread.threadId,
    thread.status,
    thread.preview,
    thread.projectRoot,
    ...(thread.recentMessages ?? []),
  ])) {
    return null;
  }
  const description = thread.preview ?? thread.projectRoot ?? thread.status;
  const contextText = compactLines([
    `Title: ${thread.title}`,
    `Type: AI session`,
    `Thread ID: ${thread.threadId}`,
    `State: ${thread.status}${thread.active ? ", active" : ""}`,
    thread.projectRoot === undefined ? undefined : `Project: ${thread.projectRoot}`,
    thread.preview === undefined ? undefined : `Preview: ${thread.preview}`,
    ...(thread.recentMessages ?? []).map((message, index) => `Recent ${String(index + 1)}: ${message}`),
  ]);
  return {
    id: `ai-thread:${thread.threadId}`,
    name: thread.title,
    path: `app://lyra/thread/${encodeMentionPathSegment(thread.threadId)}`,
    kind: "ai_thread",
    section: "tabs",
    description,
    contextText,
  };
};

export const relativePathDepth = (path: string): number =>
  path.replace(/\\/gu, "/").split("/").filter((part) => part.length > 0).length;

export const isCommonProjectEntry = (path: string): boolean => {
  const fileName = fileNameFromPath(path).toLowerCase();
  return [
    ".env",
    ".env.example",
    ".gitignore",
    "cargo.toml",
    "go.mod",
    "makefile",
    "package.json",
    "pnpm-workspace.yaml",
    "pom.xml",
    "pyproject.toml",
    "readme",
    "readme.md",
    "requirements.txt",
    "settings.gradle",
    "tsconfig.json",
  ].includes(fileName) || fileName.startsWith("readme.");
};

export const fileMentionResultSection = (
  result: AgentComposerFileMentionSearchResult,
  query: string
): AgentComposerMentionPanelSection => {
  if (query.trim().length > 0) {
    return "search_results";
  }
  const relativePath = result.root !== undefined && result.path.startsWith(result.root)
    ? result.path.slice(result.root.length).replace(/^[\\/]+/u, "")
    : result.path;
  if (isCommonProjectEntry(relativePath)) {
    return "recommended_files";
  }
  return relativePathDepth(relativePath) <= 1 ? "root" : "recommended_files";
};

export const fileMentionResultToPanelResult = (
  result: AgentComposerFileMentionSearchResult,
  query: string,
  roots: readonly string[]
): AgentComposerMentionPanelResult => ({
  id: `file:${result.id}`,
  name: result.name,
  path: result.path,
  kind: result.kind,
  section: fileMentionResultSection(result, query),
  description: createFileMentionDisplayPath(
    result.path,
    result.root === undefined ? roots : [result.root, ...roots],
    query
  ),
  ...(result.root === undefined ? {} : { root: result.root }),
  ...(result.score === undefined ? {} : { score: result.score }),
  ...(result.indices === undefined ? {} : { indices: result.indices }),
});

export const compareMentionPanelResults = (
  sectionRank: Record<AgentComposerMentionPanelSection, number>,
  left: AgentComposerMentionPanelResult,
  right: AgentComposerMentionPanelResult
): number => {
  const sectionDelta = sectionRank[left.section] - sectionRank[right.section];
  if (sectionDelta !== 0) {
    return sectionDelta;
  }
  if (left.score !== undefined || right.score !== undefined) {
    return (right.score ?? 0) - (left.score ?? 0)
      || left.name.localeCompare(right.name)
      || left.path.localeCompare(right.path);
  }
  return left.name.localeCompare(right.name)
    || left.path.localeCompare(right.path);
};

export const mentionResultToAttachment = (
  result: AgentComposerMentionPanelResult
): AgentComposerFileAttachment =>
  createFileAttachment({
    name: result.name,
    path: result.path,
    kind: result.kind,
    source: result.kind === "file" || result.kind === "directory"
      ? "fuzzy-mention"
      : "mention-panel",
    ...(result.contextText === undefined ? {} : { contextText: result.contextText }),
  });
