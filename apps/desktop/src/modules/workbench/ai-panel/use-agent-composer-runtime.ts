import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  measureTextAreaCaretRect,
  measureTextAreaTextRects,
  useCaretMotionState,
  useCaretPressState,
  type ModernCaretMotionTrail,
  type ModernCaretRect
} from "../caret/modern-caret";
import {
  AGENT_COMPOSER_MAX_HEIGHT,
  AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS,
  AGENT_COMPOSER_MIN_HEIGHT,
  AGENT_COMPOSER_TEXT_EFFECT_LIFETIME_MS,
  diffComposerText
} from "./agent-composer-model";
import type {
  AgentComposerAppendRequest,
  AgentComposerContentPart,
  AgentComposerFileAttachment,
  AgentComposerFileMentionSearchResult,
  AgentComposerInlineAttachment,
  AgentComposerSubmitAction,
  AgentComposerSubmitPayload,
  ComposerTextEffect,
  ComposerTextEffectDraft
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
  readonly inputRef: RefObject<HTMLTextAreaElement>;
  readonly draftValue: string;
  readonly hasContent: boolean;
  readonly inputFocused: boolean;
  readonly toolsMenuOpen: boolean;
  readonly modelSubmenuOpen: boolean;
  readonly caretRect: ModernCaretRect | null;
  readonly isCaretIdle: boolean;
  readonly isCaretPressed: boolean;
  readonly caretMotionToken: number;
  readonly caretMotionTrail: ModernCaretMotionTrail | null;
  readonly textEffects: readonly ComposerTextEffect[];
  readonly attachments: readonly AgentComposerInlineAttachment[];
  readonly draftParts: readonly AgentComposerContentPart[];
  readonly inputScrollTop: number;
  readonly attachmentDragActive: boolean;
  readonly fileMentionMenuOpen: boolean;
  readonly fileMentionResults: readonly AgentComposerFileMentionSearchResult[];
  readonly fileMentionSelectedIndex: number;
  readonly setDraftValue: (value: string) => void;
  readonly removeAttachment: (id: string) => void;
  readonly selectFileMentionResult: (result: AgentComposerFileMentionSearchResult) => void;
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

type FileMentionSessionState = {
  readonly sessionId: string;
  readonly triggerStart: number;
  readonly triggerEnd: number;
  readonly query: string;
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
  source
}: Omit<AgentComposerFileAttachment, "id">): AgentComposerFileAttachment => {
  const normalizedPath = path.trim();
  const normalizedName = name.trim().length > 0 ? name.trim() : fileNameFromPath(normalizedPath);
  const normalizedKind = attachmentKindForPath(normalizedPath, kind);
  return {
    id: `${source}:${normalizedKind}:${normalizedPath}`,
    name: normalizedName,
    path: normalizedPath,
    kind: normalizedKind,
    source
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
): Omit<FileMentionSessionState, "sessionId"> | null => {
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

const mentionResultToAttachment = (
  result: AgentComposerFileMentionSearchResult
): AgentComposerFileAttachment =>
  createFileAttachment({
    name: result.name,
    path: result.path,
    kind: result.kind,
    source: "fuzzy-mention",
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
  onFileMentionSearchStart,
  onFileMentionSearchUpdate,
  onFileMentionSearchStop
}: UseAgentComposerRuntimeInput): AgentComposerRuntime => {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousValueRef = useRef(initialValue);
  const previousExternalDraftRef = useRef({
    currentThreadId,
    initialValue
  });
  const lastAppendRequestIdRef = useRef<number | null>(null);
  const textEffectIdRef = useRef(0);
  const textEffectTimeoutsRef = useRef<number[]>([]);
  const composingRef = useRef(false);
  const attachmentDragDepthRef = useRef(0);
  const fileMentionSessionRef = useRef<FileMentionSessionState | null>(null);
  const [draftValue, setDraftValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<readonly AgentComposerInlineAttachment[]>([]);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [modelSubmenuOpen, setModelSubmenuOpen] = useState(false);
  const [fileMentionMenuOpen, setFileMentionMenuOpen] = useState(false);
  const [fileMentionSelectedIndex, setFileMentionSelectedIndex] = useState(0);
  const [caretRect, setCaretRect] = useState<ModernCaretRect | null>(null);
  const [caretActivityVersion, setCaretActivityVersion] = useState(0);
  const [textEffects, setTextEffects] = useState<readonly ComposerTextEffect[]>([]);
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

  const markCaretActivity = useCallback((): void => {
    setCaretActivityVersion((current) => current + 1);
  }, []);

  const {
    pressed: isCaretPressed,
    pressKey: pressCaretKey,
    releaseKey: releaseCaretKey,
    resetPressed: resetCaretPressed
  } = useCaretPressState({
    enabled: inputFocused,
    onActivity: markCaretActivity
  });
  const {
    motionToken: caretMotionToken,
    isIdle: isCaretIdle,
    motionTrail: caretMotionTrail
  } = useCaretMotionState(caretRect, {
    enabled: inputFocused,
    activityKey: caretActivityVersion,
    suppressMotion: isCaretPressed
  });

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

  const syncCaret = useCallback((): void => {
    const input = inputRef.current;
    if (input === null || inputDisabled || input.ownerDocument.activeElement !== input) {
      setCaretRect(null);
      return;
    }
    setCaretRect(measureTextAreaCaretRect(input));
  }, [inputDisabled]);

  const stopFileMentionSearch = useCallback((): void => {
    const session = fileMentionSessionRef.current;
    fileMentionSessionRef.current = null;
    setFileMentionMenuOpen(false);
    setFileMentionSelectedIndex(0);
    if (session !== null) {
      void onFileMentionSearchStop?.(session.sessionId);
    }
  }, [onFileMentionSearchStop]);

  const syncFileMentionSearch = useCallback((): void => {
    const input = inputRef.current;
    if (
      input === null ||
      inputDisabled ||
      input.ownerDocument.activeElement !== input ||
      input.selectionStart !== input.selectionEnd ||
      normalizedFileMentionRoots.length === 0 ||
      onFileMentionSearchStart === undefined ||
      onFileMentionSearchUpdate === undefined
    ) {
      stopFileMentionSearch();
      return;
    }

    const trigger = resolveFileMentionTrigger(draftValue, input.selectionStart);
    if (trigger === null) {
      stopFileMentionSearch();
      return;
    }

    const existing = fileMentionSessionRef.current;
    if (existing === null) {
      const nextSession: FileMentionSessionState = {
        sessionId: createFileMentionSessionId(),
        ...trigger,
      };
      fileMentionSessionRef.current = nextSession;
      setFileMentionMenuOpen(true);
      setFileMentionSelectedIndex(0);
      void onFileMentionSearchStart(nextSession.sessionId, normalizedFileMentionRoots);
      void onFileMentionSearchUpdate(nextSession.sessionId, trigger.query);
      return;
    }

    const nextSession: FileMentionSessionState = {
      ...existing,
      ...trigger,
    };
    fileMentionSessionRef.current = nextSession;
    setFileMentionMenuOpen(true);
    if (existing.query !== trigger.query) {
      setFileMentionSelectedIndex(0);
      void onFileMentionSearchUpdate(existing.sessionId, trigger.query);
    }
  }, [
    draftValue,
    inputDisabled,
    normalizedFileMentionRoots,
    onFileMentionSearchStart,
    onFileMentionSearchUpdate,
    stopFileMentionSearch
  ]);

  const pushTextEffects = useCallback((nextEffects: readonly ComposerTextEffectDraft[]): void => {
    if (nextEffects.length === 0) {
      return;
    }

    const createdEffects = nextEffects.map((effect) => ({
      ...effect,
      id: textEffectIdRef.current++
    }));
    setTextEffects((current) => [...current, ...createdEffects]);
    for (const effect of createdEffects) {
      const timeoutId = window.setTimeout(() => {
        setTextEffects((current) => current.filter((entry) => entry.id !== effect.id));
        textEffectTimeoutsRef.current = textEffectTimeoutsRef.current.filter((entry) => entry !== timeoutId);
      }, AGENT_COMPOSER_TEXT_EFFECT_LIFETIME_MS);
      textEffectTimeoutsRef.current.push(timeoutId);
    }
  }, []);

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
    previousValueRef.current = draftValue;
    markCaretActivity();
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.setSelectionRange(nextCursor, nextCursor);
      smartResize();
      syncCaret();
    });
  }, [draftValue, markCaretActivity, setDraftValueAndSyncAttachments, smartResize, syncCaret]);

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
      ...Array.from(draftValue.matchAll(/\[\[(?:file|directory|local_image|image):[^\]]+\]\]/gu), (match) => match[0] ?? ""),
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
        source: attachment.source
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
    previousValueRef.current = draftValue;
    markCaretActivity();
    window.requestAnimationFrame(() => {
      const target = inputRef.current;
      target?.focus();
      target?.setSelectionRange(nextCursor, nextCursor);
      smartResize();
      syncCaret();
    });
  }, [attachments, draftValue, markCaretActivity, smartResize, syncCaret]);

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target !== undefined) {
        setDraftValue((value) => value.replace(target.placeholder, ""));
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const selectFileMentionResult = useCallback((
    result: AgentComposerFileMentionSearchResult
  ): void => {
    const session = fileMentionSessionRef.current;
    if (session === null) {
      return;
    }
    insertAttachments(
      [mentionResultToAttachment(result)],
      { start: session.triggerStart, end: session.triggerEnd }
    );
    stopFileMentionSearch();
  }, [insertAttachments, stopFileMentionSearch]);

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
    previousValueRef.current = initialValue;
    for (const timeoutId of textEffectTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    textEffectTimeoutsRef.current = [];
    setTextEffects([]);
    setDraftValue(initialValue);
    setAttachments([]);
    markCaretActivity();
  }, [currentThreadId, initialValue, markCaretActivity]);

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
    markCaretActivity();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      smartResize();
      syncCaret();
    });
  }, [appendRequest, markCaretActivity, smartResize, syncCaret]);

  useLayoutEffect(() => {
    const previousValue = previousValueRef.current;
    const input = inputRef.current;
    if (
      previousValue !== draftValue &&
      input !== null &&
      input.ownerDocument.activeElement === input &&
      composingRef.current === false
    ) {
      const diff = diffComposerText(previousValue, draftValue);
      const nextEffects: ComposerTextEffectDraft[] = [];
      if (diff.removed.length > 0) {
        nextEffects.push(
          ...measureTextAreaTextRects(
            input,
            previousValue,
            diff.start,
            diff.start + diff.removed.length,
            AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS
          ).map((entry) => ({
            kind: "delete" as const,
            text: entry.text,
            left: entry.left,
            top: entry.top
          }))
        );
      }
      if (diff.inserted.length > 0) {
        nextEffects.push(
          ...measureTextAreaTextRects(
            input,
            draftValue,
            diff.start,
            diff.start + diff.inserted.length,
            AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS
          ).map((entry) => ({
            kind: "insert" as const,
            text: entry.text,
            left: entry.left,
            top: entry.top
          }))
        );
      }
      pushTextEffects(nextEffects);
    }

    previousValueRef.current = draftValue;
    syncCaret();
  }, [draftValue, pushTextEffects, syncCaret]);

  useEffect(() => {
    if (!inputFocused) {
      return;
    }

    const ownerDocument = inputRef.current?.ownerDocument ?? document;
    const handleSelectionChange = (): void => {
      if (ownerDocument.activeElement === inputRef.current) {
        normalizeAttachmentSelection();
        syncFileMentionSearch();
        markCaretActivity();
        syncCaret();
      }
    };

    ownerDocument.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [inputFocused, markCaretActivity, normalizeAttachmentSelection, syncCaret, syncFileMentionSearch]);

  useEffect(() => {
    if (inputFocused) {
      syncFileMentionSearch();
    } else {
      stopFileMentionSearch();
    }
  }, [draftValue, inputFocused, stopFileMentionSearch, syncFileMentionSearch]);

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
    stopFileMentionSearch();
    previousValueRef.current = "";
    setInputScrollTop(0);
    markCaretActivity();
    try {
      if (action === "steer") {
        await onSteer?.(payload);
        return;
      }
      await onSend(payload);
    } catch {
      setDraftValue(draftValue);
      setAttachments(submittedInlineAttachments);
      previousValueRef.current = draftValue;
      markCaretActivity();
    }
  }, [attachments, draftValue, markCaretActivity, onSend, onSteer, stopFileMentionSearch]);

  useEffect(() => {
    if (onHeightChange === undefined) {
      return;
    }
    const node = containerRef.current;
    if (node === null) {
      return;
    }

    const reportHeight = (): void => {
      onHeightChange(node.offsetHeight);
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

  useEffect(() => {
    return () => {
      const session = fileMentionSessionRef.current;
      if (session !== null) {
        void onFileMentionSearchStop?.(session.sessionId);
      }
      for (const timeoutId of textEffectTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      textEffectTimeoutsRef.current = [];
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

  const onTextareaCompositionStart = useCallback((): void => {
    composingRef.current = true;
    markCaretActivity();
  }, [markCaretActivity]);

  const onTextareaCompositionEnd = useCallback((): void => {
    composingRef.current = false;
    markCaretActivity();
  }, [markCaretActivity]);

  const onTextareaFocus = useCallback((): void => {
    setInputFocused(true);
    markCaretActivity();
    syncCaret();
  }, [markCaretActivity, syncCaret]);

  const onTextareaBlur = useCallback((): void => {
    resetCaretPressed();
    setInputFocused(false);
    setCaretRect(null);
  }, [resetCaretPressed]);

  const onTextareaScroll = useCallback((): void => {
    setInputScrollTop(inputRef.current?.scrollTop ?? 0);
    markCaretActivity();
    syncCaret();
  }, [markCaretActivity, syncCaret]);

  const onTextareaInput = useCallback((): void => {
    setInputScrollTop(inputRef.current?.scrollTop ?? 0);
    smartResize();
    markCaretActivity();
    window.requestAnimationFrame(() => {
      normalizeAttachmentSelection();
      syncFileMentionSearch();
      syncCaret();
    });
  }, [markCaretActivity, normalizeAttachmentSelection, smartResize, syncCaret, syncFileMentionSearch]);

  const onTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    pressCaretKey(event.key, event.repeat);
    const input = event.currentTarget;
    if (fileMentionMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        stopFileMentionSearch();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFileMentionSelectedIndex((current) =>
          normalizedFileMentionResults.length === 0
            ? 0
            : (current + 1) % normalizedFileMentionResults.length
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFileMentionSelectedIndex((current) =>
          normalizedFileMentionResults.length === 0
            ? 0
            : (current + normalizedFileMentionResults.length - 1) % normalizedFileMentionResults.length
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const result = normalizedFileMentionResults[fileMentionSelectedIndex];
        if (result !== undefined) {
          event.preventDefault();
          selectFileMentionResult(result);
          return;
        }
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
          markCaretActivity();
          window.requestAnimationFrame(syncCaret);
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
          markCaretActivity();
          window.requestAnimationFrame(syncCaret);
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
    fileMentionMenuOpen,
    fileMentionSelectedIndex,
    hasContent,
    markCaretActivity,
    normalizedFileMentionResults,
    onSendWithFollow,
    pressCaretKey,
    replaceDraftRange,
    selectFileMentionResult,
    sendDisabled,
    sending,
    stopFileMentionSearch,
    submit,
    syncCaret
  ]);

  const onTextareaKeyUp = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    releaseCaretKey(event.key);
    window.requestAnimationFrame(syncFileMentionSearch);
  }, [releaseCaretKey, syncFileMentionSearch]);

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
      markCaretActivity();
    });
  }, [insertAttachments, markCaretActivity]);

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
    inputRef,
    draftValue,
    hasContent,
    inputFocused,
    toolsMenuOpen,
    modelSubmenuOpen,
    caretRect,
    isCaretIdle,
    isCaretPressed,
    caretMotionToken,
    caretMotionTrail,
    textEffects,
    attachments,
    draftParts,
    inputScrollTop,
    attachmentDragActive,
    fileMentionMenuOpen,
    fileMentionResults: normalizedFileMentionResults,
    fileMentionSelectedIndex,
    setDraftValue: setDraftValueAndSyncAttachments,
    removeAttachment,
    selectFileMentionResult,
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
