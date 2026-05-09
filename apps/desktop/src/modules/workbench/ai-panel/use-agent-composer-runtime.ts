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

import { clearFileManagerEntryDragPayload } from "../file-manager/drag-transfer";
import {
  AGENT_COMPOSER_MAX_HEIGHT,
  AGENT_COMPOSER_MIN_HEIGHT
} from "./agent-composer-model";
import {
  attachmentKey,
  attachmentTextRanges,
  attachmentsFromDrop,
  attachmentsFromPaste,
  attachmentsFromPlainPathText,
  buildContentParts,
  createFileAttachment,
  hasAttachmentDataTransfer,
  normalizeInlineAttachment,
  rangeForBackspace,
  rangeForDelete,
  rangeInsideCaret,
  snapCollapsedSelection,
  snapSelectionIndex,
  stripAttachmentPlaceholders,
  trimSubmitParts,
} from "./agent-composer-attachments";
import {
  aiThreadMentionToPanelResult,
  compareMentionPanelResults,
  createFileMentionSessionId,
  fileMentionResultToPanelResult,
  mentionResultToAttachment,
  resolveFileMentionTrigger,
  workbenchTabMentionToOpenFilePanelResult,
  workbenchTabMentionToPanelResult,
  type AgentComposerMentionPanelResult,
  type AgentComposerMentionPanelSection,
  type MentionPanelSessionState,
} from "./agent-composer-mentions";
import {
  createMenuPlacement,
  DEFAULT_MENU_WIDTH,
  MENU_GAP,
  MENU_VIEWPORT_MARGIN,
  type MenuPlacement,
} from "./agent-composer-menu-placement";
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
export type { AgentComposerMentionPanelResult } from "./agent-composer-mentions";

type UseAgentComposerRuntimeInput = {
  readonly currentThreadId: string | null;
  readonly initialValue: string;
  readonly appendRequest: AgentComposerAppendRequest | null;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly selectedModelProviderId: string | null;
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
  readonly activeModelProviderId: string | null;
  readonly environmentSubmenuOpen: boolean;
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
  readonly setActiveModelProviderId: (providerId: string) => void;
  readonly toggleEnvironmentSubmenu: () => void;
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

export const useAgentComposerRuntime = ({
  currentThreadId,
  initialValue,
  appendRequest,
  inputDisabled,
  sendDisabled,
  sending,
  selectedModelProviderId,
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
  const [activeModelProviderId, setActiveModelProviderId] = useState<string | null>(null);
  const [environmentSubmenuOpen, setEnvironmentSubmenuOpen] = useState(false);
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
    setEnvironmentSubmenuOpen(false);
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
  }, [environmentSubmenuOpen, modelSubmenuOpen, toolsMenuOpen, updateMenuPlacement]);

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

  useEffect(() => {
    if (!modelSubmenuOpen) {
      return;
    }
    setActiveModelProviderId(selectedModelProviderId);
  }, [modelSubmenuOpen, selectedModelProviderId]);

  const toggleToolsMenu = useCallback((): void => {
    setToolsMenuOpen((current) => !current);
    setModelSubmenuOpen(false);
    setEnvironmentSubmenuOpen(false);
  }, []);

  const toggleModelSubmenu = useCallback((): void => {
    setModelSubmenuOpen((current) => !current);
    setEnvironmentSubmenuOpen(false);
  }, []);

  const toggleEnvironmentSubmenu = useCallback((): void => {
    setEnvironmentSubmenuOpen((current) => !current);
    setModelSubmenuOpen(false);
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
    activeModelProviderId,
    environmentSubmenuOpen,
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
    setActiveModelProviderId,
    toggleEnvironmentSubmenu,
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
