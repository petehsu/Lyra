import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";

import {
  clearFileManagerEntryDragPayload,
  hasFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload
} from "../file-manager/drag-transfer";
import {
  AGENT_COMPOSER_MAX_HEIGHT,
  AGENT_COMPOSER_MIN_HEIGHT
} from "./agent-composer-model";
import type {
  AgentComposerAppendRequest,
  AgentComposerContentPart,
  AgentComposerAiThreadMention,
  AgentComposerFileAttachment,
  AgentComposerFileMentionSearchResult,
  AgentComposerInlineAttachment,
  AgentComposerSubmitAction,
  AgentComposerSubmitPayload,
  AgentComposerWorkbenchTabMention,
} from "./agent-composer-types";

type UseAgentComposerRuntimeInput = {
  readonly currentThreadId: string | null;
  readonly initialValue: string;
  readonly appendRequest: AgentComposerAppendRequest | null;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly onHeightChange?: ((height: number) => void) | undefined;
  readonly onSend: (payload: AgentComposerSubmitPayload) => void | Promise<void>;
  readonly onSendWithFollow?: (() => void) | undefined;
  readonly onSteer?: ((payload: AgentComposerSubmitPayload) => void | Promise<void>) | undefined;
  readonly fileMentionSearchRoots?: readonly string[] | undefined;
  readonly fileMentionSearchResults?: readonly AgentComposerFileMentionSearchResult[] | undefined;
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[] | undefined;
  readonly aiThreadMentions?: readonly AgentComposerAiThreadMention[] | undefined;
  readonly onFileMentionSearchStart?: ((
    sessionId: string,
    roots: readonly string[]
  ) => void | Promise<void>) | undefined;
  readonly onFileMentionSearchUpdate?: ((
    sessionId: string,
    query: string
  ) => void | Promise<void>) | undefined;
  readonly onFileMentionSearchStop?: ((sessionId: string) => void | Promise<void>) | undefined;
};

export type AgentComposerRuntime = {
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly toolsMenuRef: RefObject<HTMLDivElement>;
  readonly toolsMenuPortalRef: RefObject<HTMLDivElement>;
  readonly toolsMenuStyle: CSSProperties;
  readonly submenuStyle: CSSProperties;
  readonly inputRef: RefObject<HTMLTextAreaElement>;
  readonly draftValue: string;
  readonly hasContent: boolean;
  readonly inputFocused: boolean;
  readonly toolsMenuOpen: boolean;
  readonly modelSubmenuOpen: boolean;
  readonly attachments: readonly AgentComposerInlineAttachment[];
  readonly draftParts: readonly AgentComposerContentPart[];
  readonly inputScrollTop: number;
  readonly attachmentDragActive: boolean;
  readonly mentionPanelOpen: boolean;
  readonly mentionPanelStyle: CSSProperties;
  readonly mentionPanelResults: readonly AgentComposerMentionPanelResult[];
  readonly mentionPanelSelectedIndex: number;
  readonly setDraftValue: (value: string) => void;
  readonly removeAttachment: (id: string) => void;
  readonly selectMentionPanelResult: (result: AgentComposerMentionPanelResult) => void;
  readonly requestFileAttachments: (
    requestAttachments: (() => Promise<readonly AgentComposerFileAttachment[]>) | undefined
  ) => Promise<void>;
  readonly submit: (action: AgentComposerSubmitAction) => Promise<void>;
  readonly toggleToolsMenu: () => void;
  readonly toggleModelSubmenu: () => void;
  readonly closeMenus: () => void;
  readonly selectModel: (
    value: string,
    onModelSelect: ((modelName: string) => void) | undefined
  ) => void;
  readonly onTextareaCompositionStart: () => void;
  readonly onTextareaCompositionEnd: () => void;
  readonly onTextareaFocus: () => void;
  readonly onTextareaBlur: () => void;
  readonly onTextareaScroll: () => void;
  readonly onTextareaInput: () => void;
  readonly onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onTextareaKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onTextareaPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  readonly onInputShellDragEnter: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onInputShellDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onInputShellDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onInputShellDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
};

type FileWithPath = File & {
  readonly path?: unknown;
};

type MentionPanelSessionState = {
  readonly fileSearchSessionId: string | null;
  readonly triggerStart: number;
  readonly triggerEnd: number;
  readonly query: string;
  readonly rootsKey: string;
};

type AgentComposerMentionPanelSection =
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

const attachmentKey = (attachment: AgentComposerFileAttachment): string =>
  `${attachment.kind}:${attachment.path}`;

const submitAttachment = (
  attachment: AgentComposerInlineAttachment
): AgentComposerFileAttachment => ({
  id: attachment.id,
  name: attachment.name,
  path: attachment.path,
  kind: attachment.kind,
  source: attachment.source,
  ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
});

const trimNonEmpty = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const fileNameFromPath = (path: string): string => {
  if (/^data:image\//iu.test(path)) {
    return "image";
  }
  const normalized = path.replace(/\\/gu, "/");
  const last = normalized.split("/").filter(Boolean).pop();
  return last === undefined || last.trim().length === 0 ? path : last;
};

const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif)$/iu;

const isLocalImagePath = (path: string): boolean =>
  IMAGE_FILE_EXTENSION_PATTERN.test(path.split(/[?#]/u)[0] ?? path);

const isRemoteImageReference = (value: string): boolean => {
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/iu.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalImagePath(url.pathname);
  } catch (_error) {
    return false;
  }
};

const attachmentKindForPath = (
  path: string,
  kind: AgentComposerFileAttachment["kind"]
): AgentComposerFileAttachment["kind"] => {
  if (kind === "directory" || kind === "image" || kind === "local_image") {
    return kind;
  }
  if (kind === "workbench_tab" || kind === "ai_thread") {
    return kind;
  }
  if (isRemoteImageReference(path)) {
    return "image";
  }
  return isLocalImagePath(path) ? "local_image" : "file";
};

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const fileUrlToPath = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return null;
    }
    const decoded = decodeURIComponent(url.pathname);
    return decoded.match(/^\/[a-z]:\//iu) !== null ? decoded.slice(1) : decoded;
  } catch (_error) {
    return null;
  }
};

const isLikelyAbsolutePath = (value: string): boolean => {
  if (value.length <= 1) {
    return false;
  }
  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[a-z]:[\\/]/iu.test(value)
  );
};

const createFileAttachment = ({
  name,
  path,
  kind,
  source,
  contextText
}: Omit<AgentComposerFileAttachment, "id">): AgentComposerFileAttachment => {
  const normalizedPath = path.trim();
  const normalizedName = name.trim().length > 0 ? name.trim() : fileNameFromPath(normalizedPath);
  const normalizedKind = attachmentKindForPath(normalizedPath, kind);
  const normalizedContextText = contextText?.trim();
  return {
    id: `${source}:${normalizedKind}:${normalizedPath}`,
    name: normalizedName,
    path: normalizedPath,
    kind: normalizedKind,
    source,
    ...(normalizedContextText === undefined || normalizedContextText.length === 0
      ? {}
      : { contextText: normalizedContextText })
  };
};

const sanitizeAttachmentPlaceholderLabel = (name: string): string =>
  name.replace(/[\r\n[\]]/gu, " ").replace(/\s+/gu, " ").trim() || "file";

const createAttachmentPlaceholder = (
  attachment: Pick<AgentComposerFileAttachment, "name" | "kind">,
  usedPlaceholders: ReadonlySet<string>
): string => {
  const base = sanitizeAttachmentPlaceholderLabel(attachment.name);
  const placeholderKind = attachment.kind === "directory" ? "directory"
    : attachment.kind === "local_image" ? "local_image"
      : attachment.kind === "image" ? "image"
        : attachment.kind === "workbench_tab" ? "workbench_tab"
          : attachment.kind === "ai_thread" ? "ai_thread"
            : "file";
  let index = 1;
  let candidate = `[[${placeholderKind}:${base}]]`;
  while (usedPlaceholders.has(candidate)) {
    index += 1;
    candidate = `[[${placeholderKind}:${base} ${String(index)}]]`;
  }
  return candidate;
};

const normalizeInlineAttachment = (
  attachment: AgentComposerFileAttachment,
  usedPlaceholders: ReadonlySet<string>
): AgentComposerInlineAttachment => ({
  ...attachment,
  placeholder: createAttachmentPlaceholder(attachment, usedPlaceholders),
});

const trimSubmitParts = (
  parts: readonly AgentComposerContentPart[]
): readonly AgentComposerContentPart[] => {
  const mutable = [...parts];
  while (mutable.length > 0) {
    const first = mutable[0];
    if (first?.type !== "text") {
      break;
    }
    const trimmed = first.text.replace(/^\s+/u, "");
    if (trimmed.length > 0) {
      mutable[0] = { type: "text", text: trimmed };
      break;
    }
    mutable.shift();
  }
  while (mutable.length > 0) {
    const last = mutable[mutable.length - 1];
    if (last?.type !== "text") {
      break;
    }
    const trimmed = last.text.replace(/\s+$/u, "");
    if (trimmed.length > 0) {
      mutable[mutable.length - 1] = { type: "text", text: trimmed };
      break;
    }
    mutable.pop();
  }
  return mutable;
};

const buildContentParts = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): readonly AgentComposerContentPart[] => {
  if (attachments.length === 0) {
    return value.length === 0 ? [] : [{ type: "text", text: value }];
  }
  const positions = attachments
    .map((attachment) => ({
      attachment,
      index: value.indexOf(attachment.placeholder),
    }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  const parts: AgentComposerContentPart[] = [];
  let offset = 0;
  for (const { attachment, index } of positions) {
    if (index < offset) {
      continue;
    }
    const before = value.slice(offset, index);
    if (before.length > 0) {
      parts.push({ type: "text", text: before });
    }
    parts.push({ type: "attachment", attachment: submitAttachment(attachment) });
    offset = index + attachment.placeholder.length;
  }
  const tail = value.slice(offset);
  if (tail.length > 0) {
    parts.push({ type: "text", text: tail });
  }
  return parts;
};

const stripAttachmentPlaceholders = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): string => buildContentParts(value, attachments)
  .map((part) => part.type === "text" ? part.text : "")
  .join("");

type AttachmentTextRange = {
  readonly attachment: AgentComposerInlineAttachment;
  readonly start: number;
  readonly end: number;
};

const attachmentTextRanges = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): readonly AttachmentTextRange[] =>
  attachments
    .map((attachment) => {
      const start = value.indexOf(attachment.placeholder);
      return start < 0
        ? null
        : {
            attachment,
            start,
            end: start + attachment.placeholder.length,
          };
    })
    .filter((range): range is AttachmentTextRange => range !== null)
    .sort((left, right) => left.start - right.start);

const rangeInsideCaret = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position > range.start && position < range.end) ?? null;

const rangeForBackspace = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position > range.start && position <= range.end) ?? null;

const rangeForDelete = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position >= range.start && position < range.end) ?? null;

const snapCollapsedSelection = (
  range: AttachmentTextRange,
  position: number
): number => {
  const midpoint = range.start + Math.floor((range.end - range.start) / 2);
  return position <= midpoint ? range.start : range.end;
};

const snapSelectionIndex = (
  ranges: readonly AttachmentTextRange[],
  position: number,
  direction: "start" | "end"
): number => {
  const range = rangeInsideCaret(ranges, position);
  if (range === null) {
    return position;
  }
  return direction === "start" ? range.start : range.end;
};

const createFileMentionSessionId = (): string =>
  `composer-file-mention-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const resolveFileMentionTrigger = (
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

const encodeMentionPathSegment = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/giu, "%252F");

const compactLines = (lines: readonly (string | null | undefined)[]): string =>
  lines
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0)
    .join("\n");

const searchableText = (values: readonly (string | undefined)[]): string =>
  values
    .map((value) => value?.toLowerCase() ?? "")
    .filter((value) => value.length > 0)
    .join("\n");

const isFuzzySubsequence = (query: string, value: string): boolean => {
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

const matchesMentionQuery = (
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

const normalizeMentionDisplayPath = (path: string): string =>
  path.trim().replace(/\\/gu, "/");

const stripRootFromPath = (
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

const compactAbsolutePathTail = (path: string, segmentCount = 4): string => {
  const normalizedPath = normalizeMentionDisplayPath(path);
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= segmentCount) {
    return normalizedPath;
  }
  return `.../${segments.slice(-segmentCount).join("/")}`;
};

const queryMatchesHiddenPathPrefix = (
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

const createFileMentionDisplayPath = (
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

const workspaceTabTypeLabel = (kind: string): string => {
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

const workbenchTabMentionToPanelResult = (
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

const OPEN_FILE_MENTION_SCORE_BASE = 2_000_000;

const workbenchTabMentionToOpenFilePanelResult = (
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

const aiThreadMentionToPanelResult = (
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

const relativePathDepth = (path: string): number =>
  path.replace(/\\/gu, "/").split("/").filter((part) => part.length > 0).length;

const isCommonProjectEntry = (path: string): boolean => {
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

const fileMentionResultSection = (
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

const fileMentionResultToPanelResult = (
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

const compareMentionPanelResults = (
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

const mentionResultToAttachment = (
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

const attachmentsFromFiles = (
  files: FileList | readonly File[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  Array.from(files)
    .map((file) => {
      const path = trimNonEmpty((file as FileWithPath).path);
      if (path === null) {
        return null;
      }
      return createFileAttachment({
        name: file.name,
        path,
        kind: typeof file.type === "string" && file.type.startsWith("image/")
          ? "local_image"
          : "file",
        source
      });
    })
    .filter((attachment): attachment is AgentComposerFileAttachment => attachment !== null);

const fileToDataUrl = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => {
      resolve(null);
    };
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  });

const imageAttachmentsFromClipboardFiles = async (
  files: readonly File[]
): Promise<readonly AgentComposerFileAttachment[]> => {
  const attachments: AgentComposerFileAttachment[] = [];
  for (const file of files) {
    if (typeof file.type !== "string" || !file.type.startsWith("image/")) {
      continue;
    }
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl === null) {
      continue;
    }
    attachments.push(createFileAttachment({
      name: file.name.trim().length > 0 ? file.name : "pasted-image",
      path: dataUrl,
      kind: "image",
      source: "clipboard",
    }));
  }
  return attachments;
};

const attachmentsFromPaths = (
  paths: readonly string[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  paths
    .map((rawPath) => stripWrappingQuotes(rawPath))
    .filter((path) => isLikelyAbsolutePath(path))
    .map((path) => createFileAttachment({
      name: fileNameFromPath(path),
      path,
      kind: "file",
      source
    }));

const attachmentsFromImageReferences = (
  values: readonly string[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  values
    .map(stripWrappingQuotes)
    .filter((value) => isRemoteImageReference(value))
    .map((value) => createFileAttachment({
      name: fileNameFromPath(value),
      path: value,
      kind: "image",
      source
    }));

const attachmentsFromUriList = (
  uriList: string,
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] => {
  const entries = uriList
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => fileUrlToPath(line) ?? stripWrappingQuotes(line));
  return [
    ...attachmentsFromPaths(entries, source),
    ...attachmentsFromImageReferences(entries, source),
  ];
};

const attachmentsFromPlainPathText = (
  text: string,
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] => {
  const paths = text
    .split(/\r?\n/u)
    .map(stripWrappingQuotes)
    .filter((line) => line.length > 0);
  if (paths.length === 0 || paths.some((path) => !isLikelyAbsolutePath(path))) {
    return attachmentsFromImageReferences(paths, source);
  }
  return attachmentsFromPaths(paths, source);
};

const hasNativeFiles = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.files.length > 0 ||
  Array.from(dataTransfer.types).includes("Files") ||
  Array.from(dataTransfer.types).includes("text/uri-list");

const hasAttachmentDataTransfer = (dataTransfer: DataTransfer): boolean =>
  hasFileManagerEntryDragPayload(dataTransfer) || hasNativeFiles(dataTransfer);

const attachmentsFromDrop = (
  dataTransfer: DataTransfer
): readonly AgentComposerFileAttachment[] => {
  const fileManagerPayload = readFileManagerEntryDragPayload(dataTransfer);
  const fileManagerPath = trimNonEmpty(fileManagerPayload?.path);
  if (fileManagerPayload !== null && fileManagerPath !== null) {
    return [
      createFileAttachment({
        name: fileManagerPayload.name,
        path: fileManagerPath,
        kind: fileManagerPayload.kind,
        source: "lyra-file-manager"
      })
    ];
  }
  const files = attachmentsFromFiles(dataTransfer.files, "system-drag");
  if (files.length > 0) {
    return files;
  }
  return attachmentsFromUriList(dataTransfer.getData("text/uri-list"), "system-drag");
};

const attachmentsFromPaste = async (
  dataTransfer: DataTransfer
): Promise<readonly AgentComposerFileAttachment[]> => {
  const clipboardFiles = Array.from(dataTransfer.files);
  const uriListText = dataTransfer.getData("text/uri-list");
  const plainText = dataTransfer.getData("text/plain");
  const files = attachmentsFromFiles(clipboardFiles, "clipboard");
  if (files.length > 0) {
    return files;
  }
  const imageFiles = await imageAttachmentsFromClipboardFiles(clipboardFiles);
  if (imageFiles.length > 0) {
    return imageFiles;
  }
  const uriList = attachmentsFromUriList(uriListText, "clipboard");
  if (uriList.length > 0) {
    return uriList;
  }
  return attachmentsFromPlainPathText(plainText, "clipboard");
};

const MENU_VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;
const DEFAULT_MENU_WIDTH = 224;
const DEFAULT_MENU_HEIGHT = 148;
const DEFAULT_SUBMENU_WIDTH = 268;
const DEFAULT_SUBMENU_HEIGHT = 320;

type MenuPlacement = {
  readonly menuLeft: number;
  readonly menuTop: number;
  readonly submenuLeft: number;
  readonly submenuTop: number;
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const measureElementSize = (
  element: HTMLElement | null,
  fallbackWidth: number,
  fallbackHeight: number
): { readonly width: number; readonly height: number } => ({
  width: element?.offsetWidth && element.offsetWidth > 0 ? element.offsetWidth : fallbackWidth,
  height: element?.offsetHeight && element.offsetHeight > 0 ? element.offsetHeight : fallbackHeight,
});

const createMenuPlacement = (
  anchor: HTMLElement,
  portal: HTMLElement | null
): MenuPlacement => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const anchorRect = anchor.getBoundingClientRect();
  const menuElement = portal?.querySelector<HTMLElement>(".lyra-ai-agent-composer-menu") ?? null;
  const submenuElement = portal?.querySelector<HTMLElement>(".lyra-ai-agent-composer-submenu") ?? null;
  const menuSize = measureElementSize(menuElement, DEFAULT_MENU_WIDTH, DEFAULT_MENU_HEIGHT);
  const submenuSize = measureElementSize(submenuElement, DEFAULT_SUBMENU_WIDTH, DEFAULT_SUBMENU_HEIGHT);
  const menuLeft = clampNumber(
    anchorRect.left,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportWidth - menuSize.width - MENU_VIEWPORT_MARGIN)
  );
  const menuTop = clampNumber(
    anchorRect.top - menuSize.height - MENU_GAP >= MENU_VIEWPORT_MARGIN
      ? anchorRect.top - menuSize.height - MENU_GAP
      : anchorRect.bottom + MENU_GAP,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportHeight - menuSize.height - MENU_VIEWPORT_MARGIN)
  );
  const opensRight = menuLeft + menuSize.width + MENU_GAP + submenuSize.width <= viewportWidth - MENU_VIEWPORT_MARGIN;
  const submenuLeft = opensRight
    ? menuLeft + menuSize.width + MENU_GAP
    : clampNumber(
        menuLeft - submenuSize.width - MENU_GAP,
        MENU_VIEWPORT_MARGIN,
        Math.max(MENU_VIEWPORT_MARGIN, viewportWidth - submenuSize.width - MENU_VIEWPORT_MARGIN)
      );
  const submenuTop = clampNumber(
    menuTop,
    MENU_VIEWPORT_MARGIN,
    Math.max(MENU_VIEWPORT_MARGIN, viewportHeight - submenuSize.height - MENU_VIEWPORT_MARGIN)
  );

  return {
    menuLeft,
    menuTop,
    submenuLeft,
    submenuTop,
  };
};

export const useAgentComposerRuntime = ({
  currentThreadId,
  initialValue,
  appendRequest,
  inputDisabled,
  sendDisabled,
  sending,
  onHeightChange,
  onSend,
  onSendWithFollow,
  onSteer,
  fileMentionSearchRoots,
  fileMentionSearchResults,
  workbenchTabMentions,
  aiThreadMentions,
  onFileMentionSearchStart,
  onFileMentionSearchUpdate,
  onFileMentionSearchStop
}: UseAgentComposerRuntimeInput): AgentComposerRuntime => {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const toolsMenuPortalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousExternalDraftRef = useRef({
    currentThreadId,
    initialValue
  });
  const lastAppendRequestIdRef = useRef<number | null>(null);
  const attachmentDragDepthRef = useRef(0);
  const mentionPanelSessionRef = useRef<MentionPanelSessionState | null>(null);
  const lastReportedHeightRef = useRef<number | null>(null);
  const [draftValue, setDraftValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<readonly AgentComposerInlineAttachment[]>([]);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [modelSubmenuOpen, setModelSubmenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>({
    menuLeft: MENU_VIEWPORT_MARGIN,
    menuTop: MENU_VIEWPORT_MARGIN,
    submenuLeft: MENU_VIEWPORT_MARGIN + DEFAULT_MENU_WIDTH + MENU_GAP,
    submenuTop: MENU_VIEWPORT_MARGIN,
  });
  const [mentionPanelOpen, setMentionPanelOpen] = useState(false);
  const [mentionPanelQuery, setMentionPanelQuery] = useState("");
  const [mentionPanelSelectedIndex, setMentionPanelSelectedIndex] = useState(0);
  const [mentionPanelStyle, setMentionPanelStyle] = useState<CSSProperties>({});
  const draftParts = buildContentParts(draftValue, attachments);
  const submitParts = trimSubmitParts(draftParts);
  const hasContent = submitParts.length > 0;
  const normalizedFileMentionRoots = useMemo(
    () => (fileMentionSearchRoots ?? [])
      .map((root) => root.trim())
      .filter((root, index, roots) => root.length > 0 && roots.indexOf(root) === index),
    [fileMentionSearchRoots]
  );
  const normalizedFileMentionResults = fileMentionSearchResults ?? [];
  const normalizedWorkbenchTabMentions = workbenchTabMentions ?? [];
  const normalizedAiThreadMentions = aiThreadMentions ?? [];
  const normalizedMentionPanelResults = useMemo(() => {
    const results: AgentComposerMentionPanelResult[] = [];
    for (const tab of normalizedWorkbenchTabMentions) {
      const result = workbenchTabMentionToPanelResult(tab, mentionPanelQuery);
      if (result !== null) {
        results.push(result);
      }
      const openFileResult = workbenchTabMentionToOpenFilePanelResult(
        tab,
        mentionPanelQuery,
        normalizedFileMentionRoots
      );
      if (openFileResult !== null) {
        results.push(openFileResult);
      }
    }
    for (const thread of normalizedAiThreadMentions) {
      const result = aiThreadMentionToPanelResult(thread, mentionPanelQuery);
      if (result !== null) {
        results.push(result);
      }
    }
    for (const result of normalizedFileMentionResults) {
      results.push(fileMentionResultToPanelResult(
        result,
        mentionPanelQuery,
        normalizedFileMentionRoots
      ));
    }

    const hasQuery = mentionPanelQuery.trim().length > 0;
    const sectionRank: Record<AgentComposerMentionPanelSection, number> = hasQuery
      ? {
          search_results: 0,
          tabs: 1,
          recommended_files: 2,
          root: 3,
        }
      : {
          tabs: 0,
          recommended_files: 1,
          root: 2,
          search_results: 3,
        };
    const seen = new Set<string>();
    return results
      .filter((result) => {
        const key = `${result.kind}:${result.path}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((left, right) => compareMentionPanelResults(sectionRank, left, right));
  }, [
    mentionPanelQuery,
    normalizedAiThreadMentions,
    normalizedFileMentionRoots,
    normalizedFileMentionResults,
    normalizedWorkbenchTabMentions
  ]);

  useEffect(() => {
    setMentionPanelSelectedIndex((current) =>
      normalizedMentionPanelResults.length === 0
        ? 0
        : Math.min(current, normalizedMentionPanelResults.length - 1)
    );
  }, [normalizedMentionPanelResults.length]);

  const smartResize = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.style.height = "auto";
    const nextHeight = Math.max(
      AGENT_COMPOSER_MIN_HEIGHT,
      Math.min(input.scrollHeight, AGENT_COMPOSER_MAX_HEIGHT)
    );
    input.style.height = `${String(nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > AGENT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  const stopMentionPanel = useCallback((): void => {
    const session = mentionPanelSessionRef.current;
    mentionPanelSessionRef.current = null;
    setMentionPanelOpen(false);
    setMentionPanelSelectedIndex(0);
    setMentionPanelQuery("");
    if (session?.fileSearchSessionId !== null && session?.fileSearchSessionId !== undefined) {
      void onFileMentionSearchStop?.(session.fileSearchSessionId);
    }
  }, [onFileMentionSearchStop]);

  const syncMentionPanel = useCallback((): void => {
    const input = inputRef.current;
    if (
      input === null ||
      inputDisabled ||
      input.ownerDocument.activeElement !== input ||
      input.selectionStart !== input.selectionEnd
    ) {
      stopMentionPanel();
      return;
    }

    const trigger = resolveFileMentionTrigger(draftValue, input.selectionStart);
    if (trigger === null) {
      stopMentionPanel();
      return;
    }

    const rootsKey = normalizedFileMentionRoots.join("\n");
    const startFileSearch = onFileMentionSearchStart;
    const updateFileSearch = onFileMentionSearchUpdate;
    const canSearchFiles =
      normalizedFileMentionRoots.length > 0 &&
      startFileSearch !== undefined &&
      updateFileSearch !== undefined;
    const existing = mentionPanelSessionRef.current;
    if (existing === null) {
      const fileSearchSessionId = canSearchFiles ? createFileMentionSessionId() : null;
      const nextSession: MentionPanelSessionState = {
        fileSearchSessionId,
        rootsKey,
        ...trigger,
      };
      mentionPanelSessionRef.current = nextSession;
      setMentionPanelOpen(true);
      setMentionPanelQuery(trigger.query);
      setMentionPanelSelectedIndex(0);
      if (fileSearchSessionId !== null) {
        void startFileSearch?.(fileSearchSessionId, normalizedFileMentionRoots);
        void updateFileSearch?.(fileSearchSessionId, trigger.query);
      }
      return;
    }

    let fileSearchSessionId = existing.fileSearchSessionId;
    if (fileSearchSessionId !== null && (!canSearchFiles || existing.rootsKey !== rootsKey)) {
      void onFileMentionSearchStop?.(fileSearchSessionId);
      fileSearchSessionId = null;
    }
    if (fileSearchSessionId === null && canSearchFiles) {
      fileSearchSessionId = createFileMentionSessionId();
      void startFileSearch?.(fileSearchSessionId, normalizedFileMentionRoots);
      void updateFileSearch?.(fileSearchSessionId, trigger.query);
    }

    const nextSession: MentionPanelSessionState = {
      ...existing,
      ...trigger,
      rootsKey,
      fileSearchSessionId,
    };
    mentionPanelSessionRef.current = nextSession;
    setMentionPanelOpen(true);
    setMentionPanelQuery(trigger.query);
    if (existing.query !== trigger.query) {
      setMentionPanelSelectedIndex(0);
      if (fileSearchSessionId !== null) {
        void updateFileSearch?.(fileSearchSessionId, trigger.query);
      }
    }
  }, [
    draftValue,
    inputDisabled,
    normalizedFileMentionRoots,
    onFileMentionSearchStart,
    onFileMentionSearchStop,
    onFileMentionSearchUpdate,
    stopMentionPanel
  ]);

  const setDraftValueAndSyncAttachments = useCallback((value: string): void => {
    setDraftValue(value);
    setAttachments((current) => current.filter((attachment) => value.includes(attachment.placeholder)));
  }, []);

  const replaceDraftRange = useCallback((
    start: number,
    end: number,
    replacement: string
  ): void => {
    const nextValue = `${draftValue.slice(0, start)}${replacement}${draftValue.slice(end)}`;
    const nextCursor = start + replacement.length;
    setDraftValueAndSyncAttachments(nextValue);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.setSelectionRange(nextCursor, nextCursor);
      smartResize();
    });
  }, [draftValue, setDraftValueAndSyncAttachments, smartResize]);

  const normalizeAttachmentSelection = useCallback((): boolean => {
    const input = inputRef.current;
    if (input === null || attachments.length === 0) {
      return false;
    }
    const ranges = attachmentTextRanges(draftValue, attachments);
    if (ranges.length === 0) {
      return false;
    }
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    if (selectionStart === selectionEnd) {
      const range = rangeInsideCaret(ranges, selectionStart);
      if (range === null) {
        return false;
      }
      const snapped = snapCollapsedSelection(range, selectionStart);
      input.setSelectionRange(snapped, snapped);
      return true;
    }
    const snappedStart = snapSelectionIndex(ranges, selectionStart, "start");
    const snappedEnd = snapSelectionIndex(ranges, selectionEnd, "end");
    if (snappedStart === selectionStart && snappedEnd === selectionEnd) {
      return false;
    }
    input.setSelectionRange(snappedStart, snappedEnd);
    return true;
  }, [attachments, draftValue]);

  const insertAttachments = useCallback((
    nextAttachments: readonly AgentComposerFileAttachment[],
    range?: { readonly start: number; readonly end: number }
  ): void => {
    if (nextAttachments.length === 0) {
      return;
    }
    const seen = new Set(attachments.map(attachmentKey));
    const usedPlaceholders = new Set([
      ...attachments.map((attachment) => attachment.placeholder),
      ...Array.from(draftValue.matchAll(/\[\[(?:file|directory|local_image|image|workbench_tab|ai_thread):[^\]]+\]\]/gu), (match) => match[0] ?? ""),
    ]);
    const normalizedAttachments: AgentComposerInlineAttachment[] = [];
    for (const attachment of nextAttachments) {
      const path = attachment.path.trim();
      const name = attachment.name.trim();
      if (path.length === 0 || name.length === 0) {
        continue;
      }
      const normalized = createFileAttachment({
        name,
        path,
        kind: attachment.kind,
        source: attachment.source,
        ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText })
      });
      const key = attachmentKey(normalized);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const inlineAttachment = normalizeInlineAttachment(normalized, usedPlaceholders);
      usedPlaceholders.add(inlineAttachment.placeholder);
      normalizedAttachments.push(inlineAttachment);
    }
    if (normalizedAttachments.length === 0) {
      return;
    }

    const input = inputRef.current;
    const selectionStart = range?.start ?? input?.selectionStart ?? draftValue.length;
    const selectionEnd = range?.end ?? input?.selectionEnd ?? selectionStart;
    const before = draftValue.slice(0, selectionStart);
    const after = draftValue.slice(selectionEnd);
    const insertion = normalizedAttachments
      .map((attachment) => attachment.placeholder)
      .join(" ");
    const needsLeadingSpace = before.length > 0 && !/\s$/u.test(before);
    const needsTrailingSpace = after.length > 0 && !/^\s/u.test(after);
    const insertedText = `${needsLeadingSpace ? " " : ""}${insertion}${needsTrailingSpace ? " " : ""}`;
    const nextValue = `${before}${insertedText}${after}`;
    const nextCursor = before.length + insertedText.length;

    setAttachments((current) => [...current, ...normalizedAttachments]);
    setDraftValue(nextValue);
    window.requestAnimationFrame(() => {
      const target = inputRef.current;
      target?.focus();
      target?.setSelectionRange(nextCursor, nextCursor);
      smartResize();
    });
  }, [attachments, draftValue, smartResize]);

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target !== undefined) {
        setDraftValue((value) => value.replace(target.placeholder, ""));
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const selectMentionPanelResult = useCallback((
    result: AgentComposerMentionPanelResult
  ): void => {
    const session = mentionPanelSessionRef.current;
    if (session === null) {
      return;
    }
    insertAttachments(
      [mentionResultToAttachment(result)],
      { start: session.triggerStart, end: session.triggerEnd }
    );
    stopMentionPanel();
  }, [insertAttachments, stopMentionPanel]);

  useEffect(() => {
    smartResize();
  }, [draftValue, smartResize]);

  useLayoutEffect(() => {
    const previousExternalDraft = previousExternalDraftRef.current;
    if (
      previousExternalDraft.currentThreadId === currentThreadId &&
      previousExternalDraft.initialValue === initialValue
    ) {
      return;
    }

    previousExternalDraftRef.current = {
      currentThreadId,
      initialValue
    };
    setDraftValue(initialValue);
    setAttachments([]);
  }, [currentThreadId, initialValue]);

  useLayoutEffect(() => {
    if (appendRequest === null || lastAppendRequestIdRef.current === appendRequest.id) {
      return;
    }
    const text = appendRequest.text.trim();
    lastAppendRequestIdRef.current = appendRequest.id;
    if (text.length === 0) {
      return;
    }
    setDraftValue((current) => (
      current.trim().length === 0
        ? text
        : `${current.trimEnd()}\n\n${text}`
    ));
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      smartResize();
    });
  }, [appendRequest, smartResize]);

  useEffect(() => {
    if (!inputFocused) {
      return;
    }

    const ownerDocument = inputRef.current?.ownerDocument ?? document;
    const handleSelectionChange = (): void => {
      if (ownerDocument.activeElement === inputRef.current) {
        normalizeAttachmentSelection();
        syncMentionPanel();
      }
    };

    ownerDocument.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [inputFocused, normalizeAttachmentSelection, syncMentionPanel]);

  useEffect(() => {
    if (inputFocused) {
      syncMentionPanel();
    } else {
      stopMentionPanel();
    }
  }, [draftValue, inputFocused, stopMentionPanel, syncMentionPanel]);

  const submit = useCallback(async (
    action: AgentComposerSubmitAction
  ): Promise<void> => {
    const parts = trimSubmitParts(buildContentParts(draftValue, attachments));
    if (parts.length === 0) {
      return;
    }
    const text = stripAttachmentPlaceholders(draftValue, attachments).trim();
    const submittedInlineAttachments = attachments;
    const submittedAttachments = parts
      .filter((part): part is Extract<AgentComposerContentPart, { readonly type: "attachment" }> =>
        part.type === "attachment"
      )
      .map((part) => part.attachment);
    const payload: AgentComposerSubmitPayload = {
      text,
      attachments: submittedAttachments,
      parts
    };
    setDraftValue("");
    setAttachments([]);
    stopMentionPanel();
    setInputScrollTop(0);
    try {
      if (action === "steer") {
        await onSteer?.(payload);
        return;
      }
      await onSend(payload);
    } catch {
      setDraftValue(draftValue);
      setAttachments(submittedInlineAttachments);
    }
  }, [attachments, draftValue, onSend, onSteer, stopMentionPanel]);

  useEffect(() => {
    if (onHeightChange === undefined) {
      return;
    }
    const node = containerRef.current;
    if (node === null) {
      return;
    }

    const reportHeight = (): void => {
      const nextHeight = node.offsetHeight;
      if (lastReportedHeightRef.current === nextHeight) {
        return;
      }
      lastReportedHeightRef.current = nextHeight;
      onHeightChange(nextHeight);
    };
    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [onHeightChange]);

  const closeMenus = useCallback((): void => {
    setToolsMenuOpen(false);
    setModelSubmenuOpen(false);
  }, []);

  useEffect(() => {
    if (!toolsMenuOpen) {
      return;
    }
    const ownerDocument = toolsMenuRef.current?.ownerDocument ?? document;
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && toolsMenuRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Node && toolsMenuPortalRef.current?.contains(target)) {
        return;
      }
      closeMenus();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenus, toolsMenuOpen]);

  const updateMenuPlacement = useCallback((): void => {
    const anchor = toolsMenuRef.current;
    if (anchor === null) {
      return;
    }
    setMenuPlacement(createMenuPlacement(anchor, toolsMenuPortalRef.current));
  }, []);

  const updateMentionPanelPlacement = useCallback((): void => {
    const input = inputRef.current;
    const viewport = input?.ownerDocument.defaultView;
    if (input === null || viewport === undefined || viewport === null) {
      return;
    }
    const rect = input.getBoundingClientRect();
    const inset = 8;
    setMentionPanelStyle({
      left: Math.max(inset, rect.left + inset),
      right: Math.max(inset, viewport.innerWidth - rect.right + inset),
      bottom: Math.max(inset, viewport.innerHeight - rect.top + inset),
    });
  }, []);

  useLayoutEffect(() => {
    if (!toolsMenuOpen) {
      return;
    }
    updateMenuPlacement();
    const animationFrame = window.requestAnimationFrame(updateMenuPlacement);
    const handleViewportChange = (): void => {
      updateMenuPlacement();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [modelSubmenuOpen, toolsMenuOpen, updateMenuPlacement]);

  useLayoutEffect(() => {
    if (!mentionPanelOpen) {
      return;
    }
    const viewport = inputRef.current?.ownerDocument.defaultView;
    if (viewport === undefined || viewport === null) {
      return;
    }
    const handleViewportChange = (): void => {
      updateMentionPanelPlacement();
    };
    updateMentionPanelPlacement();
    const animationFrame = viewport.requestAnimationFrame(updateMentionPanelPlacement);
    viewport.addEventListener("resize", handleViewportChange);
    viewport.addEventListener("scroll", handleViewportChange, true);
    viewport.visualViewport?.addEventListener("resize", handleViewportChange);
    viewport.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      viewport.cancelAnimationFrame(animationFrame);
      viewport.removeEventListener("resize", handleViewportChange);
      viewport.removeEventListener("scroll", handleViewportChange, true);
      viewport.visualViewport?.removeEventListener("resize", handleViewportChange);
      viewport.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [draftValue, inputScrollTop, mentionPanelOpen, updateMentionPanelPlacement]);

  useEffect(() => {
    return () => {
      const session = mentionPanelSessionRef.current;
      if (session?.fileSearchSessionId !== null && session?.fileSearchSessionId !== undefined) {
        void onFileMentionSearchStop?.(session.fileSearchSessionId);
      }
    };
  }, [onFileMentionSearchStop]);

  const toggleToolsMenu = useCallback((): void => {
    setToolsMenuOpen((current) => !current);
    setModelSubmenuOpen(false);
  }, []);

  const toggleModelSubmenu = useCallback((): void => {
    setModelSubmenuOpen((current) => !current);
  }, []);

  const selectModel = useCallback((
    value: string,
    onModelSelect: ((modelName: string) => void) | undefined
  ): void => {
    onModelSelect?.(value);
    closeMenus();
  }, [closeMenus]);

  const requestFileAttachments = useCallback(async (
    requestAttachments: (() => Promise<readonly AgentComposerFileAttachment[]>) | undefined
  ): Promise<void> => {
    if (requestAttachments === undefined) {
      return;
    }
    const selectedAttachments = await requestAttachments();
    insertAttachments(selectedAttachments);
    closeMenus();
  }, [closeMenus, insertAttachments]);

  const onTextareaCompositionStart = useCallback((): void => {}, []);

  const onTextareaCompositionEnd = useCallback((): void => {}, []);

  const onTextareaFocus = useCallback((): void => {
    setInputFocused(true);
  }, []);

  const onTextareaBlur = useCallback((): void => {
    setInputFocused(false);
  }, []);

  const onTextareaScroll = useCallback((): void => {
    setInputScrollTop(inputRef.current?.scrollTop ?? 0);
  }, []);

  const onTextareaInput = useCallback((): void => {
    setInputScrollTop(inputRef.current?.scrollTop ?? 0);
    smartResize();
    window.requestAnimationFrame(() => {
      normalizeAttachmentSelection();
      syncMentionPanel();
    });
  }, [normalizeAttachmentSelection, smartResize, syncMentionPanel]);

  const onTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const input = event.currentTarget;
    if (mentionPanelOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        stopMentionPanel();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionPanelSelectedIndex((current) =>
          normalizedMentionPanelResults.length === 0
            ? 0
            : (current + 1) % normalizedMentionPanelResults.length
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionPanelSelectedIndex((current) =>
          normalizedMentionPanelResults.length === 0
            ? 0
            : (current + normalizedMentionPanelResults.length - 1) % normalizedMentionPanelResults.length
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const result = normalizedMentionPanelResults[mentionPanelSelectedIndex];
        if (result !== undefined) {
          selectMentionPanelResult(result);
          return;
        }
        return;
      }
    }
    const ranges = attachmentTextRanges(draftValue, attachments);
    const isCollapsed = input.selectionStart === input.selectionEnd;
    if (
      ranges.length > 0 &&
      !isCollapsed &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      const snappedStart = snapSelectionIndex(ranges, input.selectionStart, "start");
      const snappedEnd = snapSelectionIndex(ranges, input.selectionEnd, "end");
      if (snappedStart !== input.selectionStart || snappedEnd !== input.selectionEnd) {
        event.preventDefault();
        replaceDraftRange(snappedStart, snappedEnd, "");
        return;
      }
    }
    if (ranges.length > 0 && isCollapsed && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "ArrowLeft" && !event.shiftKey) {
        const range = ranges.find((entry) =>
          input.selectionStart === entry.end ||
          (input.selectionStart > entry.start && input.selectionStart < entry.end)
        );
        if (range !== undefined) {
          event.preventDefault();
          input.setSelectionRange(range.start, range.start);
          return;
        }
      }
      if (event.key === "ArrowRight" && !event.shiftKey) {
        const range = ranges.find((entry) =>
          input.selectionStart === entry.start ||
          (input.selectionStart > entry.start && input.selectionStart < entry.end)
        );
        if (range !== undefined) {
          event.preventDefault();
          input.setSelectionRange(range.end, range.end);
          return;
        }
      }
      if (event.key === "Backspace") {
        const range = rangeForBackspace(ranges, input.selectionStart);
        if (range !== null) {
          event.preventDefault();
          replaceDraftRange(range.start, range.end, "");
          return;
        }
      }
      if (event.key === "Delete") {
        const range = rangeForDelete(ranges, input.selectionStart);
        if (range !== null) {
          event.preventDefault();
          replaceDraftRange(range.start, range.end, "");
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled && !sending && hasContent) {
        if (event.metaKey || event.ctrlKey) {
          onSendWithFollow?.();
        }
        void submit("send");
      }
    }
  }, [
    attachments,
    draftValue,
    hasContent,
    mentionPanelOpen,
    mentionPanelSelectedIndex,
    normalizedMentionPanelResults,
    onSendWithFollow,
    replaceDraftRange,
    selectMentionPanelResult,
    sendDisabled,
    sending,
    stopMentionPanel,
    submit
  ]);

  const onTextareaKeyUp = useCallback((): void => {
    window.requestAnimationFrame(syncMentionPanel);
  }, [syncMentionPanel]);

  const onTextareaPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const clipboardData = event.clipboardData;
    const hasPotentialAttachments =
      clipboardData.files.length > 0 ||
      clipboardData.getData("text/uri-list").trim().length > 0 ||
      attachmentsFromPlainPathText(clipboardData.getData("text/plain"), "clipboard").length > 0;
    if (!hasPotentialAttachments) {
      return;
    }
    event.preventDefault();
    void attachmentsFromPaste(clipboardData).then((nextAttachments) => {
      if (nextAttachments.length === 0) {
        return;
      }
      insertAttachments(nextAttachments);
    });
  }, [insertAttachments]);

  const onInputShellDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!hasAttachmentDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    attachmentDragDepthRef.current += 1;
    setAttachmentDragActive(true);
  }, []);

  const onInputShellDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!hasAttachmentDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onInputShellDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!hasAttachmentDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1);
    if (attachmentDragDepthRef.current === 0) {
      setAttachmentDragActive(false);
    }
  }, []);

  const onInputShellDrop = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!hasAttachmentDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    attachmentDragDepthRef.current = 0;
    setAttachmentDragActive(false);
    insertAttachments(attachmentsFromDrop(event.dataTransfer));
    clearFileManagerEntryDragPayload();
  }, [insertAttachments]);

  return {
    containerRef,
    toolsMenuRef,
    toolsMenuPortalRef,
    toolsMenuStyle: {
      left: menuPlacement.menuLeft,
      top: menuPlacement.menuTop,
    },
    submenuStyle: {
      left: menuPlacement.submenuLeft,
      top: menuPlacement.submenuTop,
    },
    inputRef,
    draftValue,
    hasContent,
    inputFocused,
    toolsMenuOpen,
    modelSubmenuOpen,
    attachments,
    draftParts,
    inputScrollTop,
    attachmentDragActive,
    mentionPanelOpen,
    mentionPanelStyle,
    mentionPanelResults: normalizedMentionPanelResults,
    mentionPanelSelectedIndex,
    setDraftValue: setDraftValueAndSyncAttachments,
    removeAttachment,
    selectMentionPanelResult,
    requestFileAttachments,
    submit,
    toggleToolsMenu,
    toggleModelSubmenu,
    closeMenus,
    selectModel,
    onTextareaCompositionStart,
    onTextareaCompositionEnd,
    onTextareaFocus,
    onTextareaBlur,
    onTextareaScroll,
    onTextareaInput,
    onTextareaKeyDown,
    onTextareaKeyUp,
    onTextareaPaste,
    onInputShellDragEnter,
    onInputShellDragOver,
    onInputShellDragLeave,
    onInputShellDrop
  };
};
