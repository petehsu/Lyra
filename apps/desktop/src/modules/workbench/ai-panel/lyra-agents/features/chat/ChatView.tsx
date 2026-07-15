// ============================================================================
// ChatView — scrollable message list + floating lyra-agents-composer stack
// ============================================================================
//
// The DataProvider limits how much history is materialized; this view also
// virtualizes that window so resize and paint cost stays bounded.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";
import {
  ArrowDown,
  BookText,
  CornerUpLeft,
  Copy,
  Link2,
  ListChecks,
  MapPin,
  Plus,
  Undo2,
  X
} from "lucide-react";
import { ContextMenuHost, useContextMenuModel } from "../../../../context-menu";
import type { LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import type { OmaAgentMember } from "../../../../../../shared/agent";
import type { ChatMessage, OmaControls } from "../../core/types";
import { APP_CONFIG } from "../../core/config";
import { t } from "@workbench/i18n";
import { useData } from "../../data/DataProvider";
import {
  isEmptyPendingAgentMessage,
  Message,
  resolveAgentActivityHostMessageId
} from "./Message";
import { Composer } from "./Composer";
import { ContextRing } from "./context-ring";
import { ChatEmptyState } from "./ChatEmptyState";
import { ProjectDirChip } from "./ProjectDirChip";
import { BackgroundTerminalButton } from "./BackgroundTerminalButton";
import { TodoBar } from "../pills/TodoBar";
import { DecisionPanel, PermissionPanel, PlanReviewPanel } from "../panels";
import { AppButton, AppSwitch } from "@renderer/ui/components";
import {
  buildFullMessageCitation,
  messagePlainText,
  resolveSelectionCitation
} from "./message-citation";
import { queryCitationMessageElement } from "./scroll-to-citation";

// ponytail: sticky anchor offset from the top of the scroll viewport.
const STICKY_ANCHOR_TOP_OFFSET_PX = 18;
const STICKY_ANCHOR_PREVIEW_CHARS = 96;
const CHAT_VIRTUALIZATION_THRESHOLD = 40;
const CHAT_VIRTUAL_OVERSCAN_PX = 600;
const CHAT_INITIAL_TAIL_MESSAGES = 30;

type ChatVirtualRange = {
  readonly start: number;
  readonly end: number;
  readonly top: number;
  readonly bottom: number;
  readonly messageCount: number;
};

const estimateMessageHeight = (message: ChatMessage): number => {
  let textChars = 0;
  let toolBlocks = 0;
  let imageBlocks = 0;
  for (const block of message.blocks) {
    if (block.type === "text" || block.type === "thinking") {
      textChars += block.body.length;
    } else if (block.type === "tools") {
      toolBlocks += 1 + block.group.calls.length;
    } else if (block.type === "image") {
      imageBlocks += 1;
    }
  }
  const textRows = Math.ceil(textChars / 92);
  return Math.min(900, Math.max(58, 52 + textRows * 18 + toolBlocks * 76 + imageBlocks * 180));
};

const heightForMessage = (
  message: ChatMessage,
  measuredHeights: ReadonlyMap<string, number>
): number => measuredHeights.get(message.id) ?? estimateMessageHeight(message);

const fullChatRange = (messageCount: number): ChatVirtualRange => ({
  start: 0,
  end: messageCount,
  top: 0,
  bottom: 0,
  messageCount
});

const initialChatRange = (
  messages: readonly ChatMessage[],
  measuredHeights: ReadonlyMap<string, number>
): ChatVirtualRange => {
  if (messages.length <= CHAT_VIRTUALIZATION_THRESHOLD) {
    return fullChatRange(messages.length);
  }
  const start = Math.max(0, messages.length - CHAT_INITIAL_TAIL_MESSAGES);
  let top = 0;
  for (let index = 0; index < start; index += 1) {
    top += heightForMessage(messages[index]!, measuredHeights);
  }
  return {
    start,
    end: messages.length,
    top,
    bottom: 0,
    messageCount: messages.length
  };
};

const calculateChatRange = (
  messages: readonly ChatMessage[],
  measuredHeights: ReadonlyMap<string, number>,
  scrollTop: number,
  clientHeight: number
): ChatVirtualRange => {
  if (messages.length <= CHAT_VIRTUALIZATION_THRESHOLD) {
    return fullChatRange(messages.length);
  }
  const viewportHeight = Math.max(480, clientHeight || 0);
  const startCutoff = Math.max(0, scrollTop - CHAT_VIRTUAL_OVERSCAN_PX);
  const endCutoff = scrollTop + viewportHeight + CHAT_VIRTUAL_OVERSCAN_PX;
  let top = 0;
  let start = 0;
  while (start < messages.length) {
    const nextTop = top + heightForMessage(messages[start]!, measuredHeights);
    if (nextTop >= startCutoff) break;
    top = nextTop;
    start += 1;
  }

  let end = start;
  let visibleHeight = top;
  while (end < messages.length && visibleHeight < endCutoff) {
    visibleHeight += heightForMessage(messages[end]!, measuredHeights);
    end += 1;
  }
  if (end < messages.length) {
    visibleHeight += heightForMessage(messages[end]!, measuredHeights);
    end += 1;
  }

  let totalHeight = visibleHeight;
  for (let index = end; index < messages.length; index += 1) {
    totalHeight += heightForMessage(messages[index]!, measuredHeights);
  }

  return {
    start,
    end,
    top,
    bottom: Math.max(0, totalHeight - visibleHeight),
    messageCount: messages.length
  };
};

const chatRangeEqual = (left: ChatVirtualRange, right: ChatVirtualRange): boolean =>
  left.start === right.start &&
  left.end === right.end &&
  left.top === right.top &&
  left.bottom === right.bottom &&
  left.messageCount === right.messageCount;

const stickyMessageIdAtScroll = (
  messages: readonly ChatMessage[],
  measuredHeights: ReadonlyMap<string, number>,
  anchorLine: number
): string | null => {
  let bottom = 0;
  let stickyId: string | null = null;
  for (const message of messages) {
    bottom += heightForMessage(message, measuredHeights);
    if (bottom > anchorLine) break;
    if (message.author === "user") {
      stickyId = message.id;
    }
  }
  return stickyId;
};

const textPreviewForMessage = (message: ChatMessage): string => {
  const text = message.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.body.trim())
    .filter((textBlock) => textBlock.length > 0)
    .join(" ");
  if (text.length > 0) {
    return text.length > STICKY_ANCHOR_PREVIEW_CHARS
      ? `${text.slice(0, STICKY_ANCHOR_PREVIEW_CHARS).trim()}...`
      : text;
  }
  if (message.blocks.some((block) => block.type === "image")) {
    return t("lyra-agents-message.imageAttachment");
  }
  return message.blocks.find((block) => block.type === "tools")?.group.label ?? "";
};

interface ChatViewProps {
  showDecisions: boolean;
  showPermission: boolean;
  desktopApi?: LyraDesktopApi | null;
}

export function ChatView({ showDecisions, showPermission, desktopApi = null }: ChatViewProps) {
  const {
    messages,
    messageWindow,
    decisions,
    permissions,
    planReview,
    sendMessage,
    loadEarlierMessages,
    captureWorkspaceScreenshot,
    captureWindowScreenshot,
    pickFileFromFileManager,
    workspaceTabs,
    terminalTabs,
    getTerminalTabPanes,
    closeTerminalTab,
    focusTerminalTabInDock,
    openTerminalLiveSession,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    submitDecisions,
    approvePermission,
    denyPermission,
    openPlanReview,
    respondPlanReview,
    modelControls,
    permissionModeControls,
    locationControls,
    omaControls,
    openModelSettings,
    isTurnRunning,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    cancelTurn,
    session,
    bindProject,
    openProjectTree,
    openInFileManager,
    openProjectPlanManager,
    openProjectTodo,
    todos,
    addCitationToComposer,
    addPageCitationToComposer,
    pendingCitation,
    pendingCitationNonce,
    pendingImages,
    pendingImagesNonce,
    pendingFiles,
    pendingFilesNonce,
    navigateToPageCitation,
    scrollToMessage,
    citationScrollTarget,
    reportCitationScrollFinished,
    citationHighlightMessageId,
    previewRollback,
    rollbackMessage,
  } = useData();
  const contextMenu = useContextMenuModel();
  const omaMentionAgents = useMemo(() => {
    const oma = omaControls?.state;
    if (oma === null || oma === undefined || oma.activeChannelId !== "group:default") {
      return [];
    }
    const group = oma.channels.find((channel) => channel.id === "group:default" && !channel.archived);
    if (group === undefined) {
      return [];
    }
    const agents = new Map(oma.agents.map((agent) => [agent.id, agent] as const));
    return group.memberAgentIds
      .map((sessionAgentId) => agents.get(sessionAgentId))
      .filter((agent): agent is OmaAgentMember => agent !== undefined);
  }, [omaControls?.state]);
  const omaAgentBySessionId = useMemo(
    () => new Map((omaControls?.state?.agents ?? []).map((agent) => [agent.id, agent] as const)),
    [omaControls?.state?.agents]
  );
  const resolveOmaSource = useCallback(
    (sourceSessionAgentId: string | null | undefined) =>
      sourceSessionAgentId === null || sourceSessionAgentId === undefined
        ? undefined
        : omaAgentBySessionId.get(sourceSessionAgentId),
    [omaAgentBySessionId]
  );

  const canManagePlans =
    session.projectBound === true &&
    session.workingDirIsHome !== true &&
    typeof session.workingDir === "string" &&
    session.workingDir.trim().length > 0;
  const openPlanBoard = useCallback(
    (): Promise<void> => (canManagePlans ? openProjectPlanManager("plan") : openProjectTodo()),
    [canManagePlans, openProjectPlanManager, openProjectTodo]
  );
  const openTodoBoard = useCallback(
    (): Promise<void> => (canManagePlans ? openProjectPlanManager("todo") : openProjectTodo()),
    [canManagePlans, openProjectPlanManager, openProjectTodo]
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [stickyMessageId, setStickyMessageId] = useState<string | null>(null);

  const hasPendingClarification = showDecisions && decisions.length > 0;
  const pendingPlanReview = planReview !== null && planReview.phase === "reviewing" ? planReview : null;
  const activityIndicatorMessageId = resolveAgentActivityHostMessageId(messages, isTurnRunning);
  const activityIndicatorMessage =
    activityIndicatorMessageId === null
      ? null
      : messages.find((message) => message.id === activityIndicatorMessageId) ?? null;
  const activityIndicatorMessageIndex =
    activityIndicatorMessage === null
      ? -1
      : messages.findIndex((message) => message.id === activityIndicatorMessage.id);
  const activityIndicatorPreviousMessage =
    activityIndicatorMessageIndex > 0 ? messages[activityIndicatorMessageIndex - 1] : null;
  const activityIndicatorHostMessageId =
    activityIndicatorMessage !== null &&
    isEmptyPendingAgentMessage(activityIndicatorMessage) &&
    activityIndicatorPreviousMessage?.author === "agent" &&
    !isEmptyPendingAgentMessage(activityIndicatorPreviousMessage)
      ? activityIndicatorPreviousMessage.id
      : activityIndicatorMessageId;
  const stickyMessage = stickyMessageId === null
    ? null
    : messages.find((message) => message.id === stickyMessageId) ?? null;
  const stickyMessagePreview = stickyMessage === null ? "" : textPreviewForMessage(stickyMessage);

  const loadingEarlierRef = useRef(false);
  const scrollAnchorDistanceRef = useRef(0);
  const citationScrollCompletedTokenRef = useRef<number | null>(null);
  const measuredMessageHeightsRef = useRef<Map<string, number>>(new Map());
  const pendingMessageHeightsRef = useRef<Map<string, number>>(new Map());
  const messageResizeObserverRef = useRef<ResizeObserver | null>(null);
  const messageMeasureFrameRef = useRef<number | null>(null);
  const virtualScrollFrameRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [virtualRange, setVirtualRange] = useState<ChatVirtualRange>(() => fullChatRange(0));

  const updateVirtualRangeNow = useCallback(() => {
    const el = scrollRef.current;
    const currentMessages = messagesRef.current;
    const next = calculateChatRange(
      currentMessages,
      measuredMessageHeightsRef.current,
      el?.scrollTop ?? 0,
      el?.clientHeight ?? 0
    );
    setVirtualRange((current) => chatRangeEqual(current, next) ? current : next);
  }, []);

  const scheduleVirtualRangeUpdate = useCallback(() => {
    if (virtualScrollFrameRef.current !== null) return;
    virtualScrollFrameRef.current = window.requestAnimationFrame(() => {
      virtualScrollFrameRef.current = null;
      updateVirtualRangeNow();
    });
  }, [updateVirtualRangeNow]);

  const flushMessageHeights = useCallback(() => {
    messageMeasureFrameRef.current = null;
    let changed = false;
    for (const [messageId, height] of pendingMessageHeightsRef.current) {
      const normalized = Math.max(1, Math.ceil(height));
      const current = measuredMessageHeightsRef.current.get(messageId);
      if (current !== undefined && Math.abs(current - normalized) < 2) continue;
      measuredMessageHeightsRef.current.set(messageId, normalized);
      changed = true;
    }
    pendingMessageHeightsRef.current.clear();
    if (changed) {
      scheduleVirtualRangeUpdate();
    }
  }, [scheduleVirtualRangeUpdate]);

  const ensureMessageResizeObserver = useCallback((): ResizeObserver | null => {
    if (typeof ResizeObserver === "undefined") return null;
    if (messageResizeObserverRef.current !== null) return messageResizeObserverRef.current;
    messageResizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const messageId = target.dataset.chatMessageId;
        if (messageId === undefined) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        pendingMessageHeightsRef.current.set(messageId, height);
      }
      if (messageMeasureFrameRef.current === null) {
        messageMeasureFrameRef.current = window.requestAnimationFrame(flushMessageHeights);
      }
    });
    return messageResizeObserverRef.current;
  }, [flushMessageHeights]);

  const registerMessageSlot = useCallback((messageId: string, slot: HTMLElement) => {
    const observer = ensureMessageResizeObserver();
    observer?.observe(slot);
    return () => {
      observer?.unobserve(slot);
      pendingMessageHeightsRef.current.delete(messageId);
    };
  }, [ensureMessageResizeObserver]);

  const visibleRange =
    virtualRange.messageCount === messages.length
      ? virtualRange
      : initialChatRange(messages, measuredMessageHeightsRef.current);
  const visibleMessages = useMemo(
    () => messages.slice(visibleRange.start, visibleRange.end),
    [messages, visibleRange.end, visibleRange.start]
  );

  // --- Scroll handler: bottom detection, sticky anchor, history loading ---
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - el.scrollTop;
    scheduleVirtualRangeUpdate();

    const anchorLine = el.scrollTop + STICKY_ANCHOR_TOP_OFFSET_PX;
    setStickyMessageId(stickyMessageIdAtScroll(
      messagesRef.current,
      measuredMessageHeightsRef.current,
      anchorLine
    ));

    // Load earlier messages when scrolled near the top
    if (
      messageWindow.canLoadEarlier &&
      !loadingEarlierRef.current &&
      el.scrollTop <= APP_CONFIG.scroll.topLoadThreshold
    ) {
      loadingEarlierRef.current = true;
      void loadEarlierMessages().finally(() => {
        loadingEarlierRef.current = false;
      });
    }
  }, [loadEarlierMessages, messageWindow.canLoadEarlier, scheduleVirtualRangeUpdate]);

  // --- Scroll position maintenance on messages change ---
  // Anchors to bottom (or preserves distance-from-bottom if user scrolled up).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const nextScrollTop = Math.max(0, el.scrollHeight - scrollAnchorDistanceRef.current);
    el.scrollTop = nextScrollTop;
    const atBottom =
      el.scrollHeight - nextScrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - nextScrollTop;
    updateVirtualRangeNow();
  }, [messages, updateVirtualRangeNow]);

  useEffect(() => {
    const liveIds = new Set(messages.map((message) => message.id));
    for (const messageId of measuredMessageHeightsRef.current.keys()) {
      if (!liveIds.has(messageId)) {
        measuredMessageHeightsRef.current.delete(messageId);
      }
    }
    scheduleVirtualRangeUpdate();
  }, [messages, scheduleVirtualRangeUpdate]);

  useEffect(() => () => {
    if (virtualScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(virtualScrollFrameRef.current);
    }
    if (messageMeasureFrameRef.current !== null) {
      window.cancelAnimationFrame(messageMeasureFrameRef.current);
    }
    messageResizeObserverRef.current?.disconnect();
  }, []);

  const scrollToEstimatedMessage = useCallback((messageId: string): boolean => {
    const el = scrollRef.current;
    if (el === null) return false;
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) return false;
    let top = 0;
    for (let index = 0; index < targetIndex; index += 1) {
      top += heightForMessage(messages[index]!, measuredMessageHeightsRef.current);
    }
    el.scrollTop = Math.max(0, top - Math.floor(el.clientHeight / 2));
    updateVirtualRangeNow();
    return true;
  }, [messages, updateVirtualRangeNow]);

  // --- Citation scroll: scroll a specific message into view ---
  useLayoutEffect(() => {
    if (citationScrollTarget === null) return;
    if (citationScrollCompletedTokenRef.current === citationScrollTarget.token) return;

    const el = scrollRef.current;
    if (el === null) return;

    const domTarget = queryCitationMessageElement(el, citationScrollTarget.messageId);
    if (domTarget !== null) {
      domTarget.scrollIntoView({ block: "center", behavior: "auto" });
      citationScrollCompletedTokenRef.current = citationScrollTarget.token;
      // Highlight after a frame so the scroll settles
      requestAnimationFrame(() => {
        reportCitationScrollFinished(citationScrollTarget.messageId);
      });
    } else if (scrollToEstimatedMessage(citationScrollTarget.messageId)) {
      requestAnimationFrame(() => {
        const retryTarget = queryCitationMessageElement(el, citationScrollTarget.messageId);
        if (retryTarget === null) return;
        retryTarget.scrollIntoView({ block: "center", behavior: "auto" });
        citationScrollCompletedTokenRef.current = citationScrollTarget.token;
        requestAnimationFrame(() => {
          reportCitationScrollFinished(citationScrollTarget.messageId);
        });
      });
    }
  }, [citationScrollTarget, reportCitationScrollFinished, scrollToEstimatedMessage]);

  useEffect(() => {
    if (stickyMessageId !== null && !messages.some((message) => message.id === stickyMessageId)) {
      setStickyMessageId(null);
    }
  }, [messages, stickyMessageId]);

  // Reset scroll anchor on session switch — start at bottom
  useEffect(() => {
    scrollAnchorDistanceRef.current = 0;
    setStickyMessageId(null);
  }, [session.id]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  };

  const scrollToStickyMessage = () => {
    if (stickyMessageId === null) return;
    const el = scrollRef.current;
    if (el === null) return;
    const target = el.querySelector<HTMLElement>(`[data-chat-message-id="${CSS.escape(stickyMessageId)}"]`);
    if (target !== null) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  };

  const openMessageContextMenu = useCallback((
    event: MouseEvent<HTMLElement>,
    message: ChatMessage
  ) => {
    event.preventDefault();
    const root = event.currentTarget;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    const hasSelection =
      selectedText.length > 0 &&
      selection !== null &&
      selection.rangeCount > 0 &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode);
    const copySelection = () => {
      if (hasSelection) {
        void navigator.clipboard.writeText(selectedText);
        return;
      }
      void navigator.clipboard.writeText(messagePlainText(message));
    };
    const citeSelection = () => {
      if (hasSelection && selection !== null && selection.rangeCount > 0) {
        const citation = resolveSelectionCitation(
          message,
          selectedText,
          selection.getRangeAt(0),
          root
        );
        if (citation !== null) {
          addCitationToComposer(citation);
        }
        return;
      }
      addCitationToComposer(buildFullMessageCitation(message));
    };
    const items = message.author === "user"
      ? [
          {
            id: "cite",
            label: hasSelection ? t("lyra-agents-message.citeSelection") : t("lyra-agents-message.citeMessage"),
            icon: <Link2 size={14} strokeWidth={2} />,
            onSelect: citeSelection
          },
          {
            id: "copy",
            label: t("lyra-agents-message.copy"),
            icon: <Copy size={14} strokeWidth={2} />,
            onSelect: copySelection
          },
          ...(message.rollback?.available === true
            ? [{
                id: "rollback",
                label: t("lyra-agents-message.undoMessage"),
                icon: <Undo2 size={14} strokeWidth={2} />,
                separatorBefore: true,
                onSelect: () => {
                  void previewRollback(message.id).then((preview) => {
                    if (preview.available) {
                      void rollbackMessage(message.id);
                    }
                  });
                }
              }]
            : [])
        ]
      : [
          {
            id: "copy",
            label: t("lyra-agents-message.copy"),
            icon: <Copy size={14} strokeWidth={2} />,
            onSelect: copySelection
          },
          {
            id: "cite",
            label: hasSelection ? t("lyra-agents-message.citeSelection") : t("lyra-agents-message.citeMessage"),
            icon: <Link2 size={14} strokeWidth={2} />,
            onSelect: citeSelection
          }
        ];
    contextMenu.openMenu({
      anchorX: event.clientX,
      anchorY: event.clientY,
      items
    });
  }, [addCitationToComposer, contextMenu, previewRollback, rollbackMessage]);

  return (
    <>
      <ContextMenuHost
        state={contextMenu.state}
        onClose={contextMenu.closeMenu}
        onSelectItem={contextMenu.selectItem}
      />

      <div className="lyra-agents-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {stickyMessage !== null && stickyMessagePreview.length > 0 ? (
          <div className="lyra-agents-chat-thread-anchor">
            <AppButton variant="ghost" size="sm"
              type="button"
              className="lyra-agents-chat-thread-anchor-button"
              onClick={scrollToStickyMessage}
              aria-label={t("scroll.jumpToPreviousMessage")}
              title={`${t("scroll.jumpToPreviousMessage")}: ${stickyMessagePreview}`}
            >
              <CornerUpLeft size={13} strokeWidth={2.1} aria-hidden="true" />
              <span className="lyra-agents-chat-thread-anchor-label">{t("scroll.previousMessage")}</span>
              <span className="lyra-agents-chat-thread-anchor-text">{stickyMessagePreview}</span>
            </AppButton>
          </div>
        ) : null}

        <div className="lyra-agents-chat-inner">
          {/* Show earlier button */}
          {messageWindow.canLoadEarlier ? (
            <div className="lyra-agents-chat-load-earlier">
              <AppButton
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void loadEarlierMessages()}
                disabled={loadingEarlierRef.current}
              >
                {t("scroll.showEarlier")}
              </AppButton>
            </div>
          ) : null}

          {messages.length === 0 ? (
            <ChatEmptyState
              key={session.id}
              projectName={session.project.trim().length > 0 ? session.project.trim() : null}
              isHome={session.workingDirIsHome}
              onChooseProject={bindProject}
            />
          ) : null}

          {visibleRange.top > 0 ? (
            <div
              className="lyra-agents-chat-virtual-spacer"
              style={{ height: visibleRange.top }}
              aria-hidden="true"
            />
          ) : null}

          {visibleMessages.map((message) => (
            <MeasuredMessageSlot
              key={message.id}
              message={message}
              register={registerMessageSlot}
            >
              <Message
                message={message}
                showActivityIndicator={
                  activityIndicatorHostMessageId === null ||
                  message.id === activityIndicatorHostMessageId
                }
                activityIndicatorMessage={
                  message.id === activityIndicatorHostMessageId ? activityIndicatorMessage : null
                }
                highlightCitationTarget={citationHighlightMessageId === message.id}
                onContextMenu={openMessageContextMenu}
                onCiteMessage={() => addCitationToComposer(buildFullMessageCitation(message))}
              />
            </MeasuredMessageSlot>
          ))}

          {visibleRange.bottom > 0 ? (
            <div
              className="lyra-agents-chat-virtual-spacer"
              style={{ height: visibleRange.bottom }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>

      <div className="lyra-agents-composer-wrap">
        <div className="lyra-agents-composer-toprow">
          <AppButton variant="ghost" size="sm"
            type="button"
            className={`lyra-agents-scroll-to-bottom ${isAtBottom ? "out" : "in"}`}
            onClick={scrollToBottom}
            aria-label={t("scroll.toBottom")}
            aria-hidden={isAtBottom}
          >
            <svg className="lyra-agents-scroll-circle" viewBox="0 0 34 34">
              <circle cx="17" cy="17" r="16" />
            </svg>
            <span className="lyra-agents-scroll-arrow">
              <ArrowDown size={15} strokeWidth={2.2} />
            </span>
          </AppButton>
          <div className="lyra-agents-composer-todo-slot">
            <TodoBar tasks={todos} onOpenBoard={openTodoBoard} />
          </div>
        </div>

        {showPermission && permissions.length > 0 && (
          <PermissionPanel
            requests={permissions}
            onApprove={approvePermission}
            onDeny={denyPermission}
            progress={1}
            onTap={() => undefined}
            resolveOmaSource={resolveOmaSource}
          />
        )}

        {showDecisions && decisions.length > 0 && (
          <DecisionPanel
            questions={decisions}
            onSubmit={submitDecisions}
            onDismiss={() => undefined}
            progress={1}
            onTap={() => undefined}
            resolveOmaSource={resolveOmaSource}
          />
        )}

        <OmaTeamBoard controls={omaControls ?? null} />

        <PlanReviewPanel
          plan={pendingPlanReview}
          onReview={openPlanReview}
          onRespond={respondPlanReview}
          resolveOmaSource={resolveOmaSource}
        />

        <Composer
          onSend={sendMessage}
          onCaptureWorkspaceScreenshot={captureWorkspaceScreenshot}
          onCaptureWindowScreenshot={captureWindowScreenshot}
          onPickFileFromFileManager={pickFileFromFileManager}
          workspaceTabs={workspaceTabs}
          terminalTabs={terminalTabs}
          onImageAttachmentClick={(image) => {
            if (!canOpenImageInWorkbench(image)) {
              return;
            }
            void openImageInWorkbench(image);
          }}
          modelControls={modelControls ?? null}
          permissionModeControls={permissionModeControls ?? null}
          topSlot={<OmaChannelStrip controls={omaControls ?? null} />}
          omaMentionAgents={omaMentionAgents}
          onOpenModelSettings={openModelSettings}
          isTurnRunning={isTurnRunning}
          browserFollowModeEnabled={browserFollowModeEnabled}
          onToggleBrowserFollowMode={setBrowserFollowMode}
          onCancelTurn={cancelTurn}
          pendingCitation={pendingCitation}
          pendingCitationNonce={pendingCitationNonce}
          pendingImages={pendingImages}
          pendingImagesNonce={pendingImagesNonce}
          pendingFiles={pendingFiles}
          pendingFilesNonce={pendingFilesNonce}
          onTranscriptCitationClick={(citation) => {
            void scrollToMessage(citation.messageId, {
              blockId: citation.blockId ?? null,
              startOffset: citation.startOffset ?? null
            });
          }}
          onPageCitationClick={(citation) => {
            void navigateToPageCitation(citation);
          }}
          disabledReason={
            hasPendingClarification
              ? t("lyra-agents-composer.answerClarificationFirst")
              : pendingPlanReview !== null
                ? t("lyra-agents-composer.reviewPlanFirst")
                : undefined
          }
        />

        <div className="lyra-agents-project-dir-chip-row lyra-agents-project-meta-row">
          <ProjectDirChip
            desktopApi={desktopApi}
            sessionId={session.id}
            projectName={session.project.trim().length > 0 ? session.project.trim() : null}
            workingDir={session.workingDir}
            isHome={session.workingDirIsHome}
            canOpenProjectTree={session.projectBound && !session.workingDirIsHome}
            onChooseProject={bindProject}
            onOpenProjectTree={openProjectTree}
            onOpenInFileManager={openInFileManager}
          />
          <BackgroundTerminalButton
            terminalTabs={terminalTabs}
            getTerminalTabPanes={getTerminalTabPanes}
            session={session}
            workspaceTabs={workspaceTabs}
            onCiteTerminal={addPageCitationToComposer}
            onCloseTerminalTab={closeTerminalTab}
            onFocusTerminalTabInDock={focusTerminalTabInDock}
            onOpenTerminalInWorkspace={(request) => {
              void openTerminalLiveSession(request);
            }}
            desktopApi={desktopApi}
          />
          {/* ponytail: 规划/代办入口按钮常驻显示，不再受 projectBound 条件门控 */}
          <AppButton
            variant="ghost"
            size="sm"
            type="button"
            className="lyra-agents-project-plan-chip"
            aria-label={t("lyra-agents-composer.openPlan")}
            title={t("lyra-agents-composer.openPlan")}
            onClick={() => { void openPlanBoard(); }}
          >
            <BookText size={13} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("lyra-agents-composer.openPlan")}</span>
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            type="button"
            className="lyra-agents-project-todo-chip"
            aria-label={t("lyra-agents-composer.openTodo")}
            title={t("lyra-agents-composer.openTodo")}
            onClick={() => { void openTodoBoard(); }}
          >
            <ListChecks size={13} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("lyra-agents-composer.openTodo")}</span>
          </AppButton>
          {locationControls !== null && locationControls !== undefined ? (
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              className="lyra-agents-project-location-chip"
              aria-label={locationControls.title}
              title={locationControls.title}
              aria-busy={locationControls.busy ? "true" : undefined}
              data-status={locationControls.status}
              disabled={locationControls.busy}
              onClick={locationControls.onPress}
            >
              <MapPin size={13} strokeWidth={2.1} aria-hidden="true" />
              {locationControls.status === "located" || locationControls.status === "unavailable" ? (
                <span>{locationControls.label}</span>
              ) : null}
            </AppButton>
          ) : null}
        </div>
        <div className="lyra-agents-composer-context-ring-slot">
          <ContextRing />
        </div>
      </div>
    </>
  );
}

function OmaTeamBoard({ controls }: { readonly controls: OmaControls | null }) {
  const oma = controls?.state;
  if (controls === null || oma === null || oma === undefined || oma.activeChannelId !== "group:default" || oma.team === null || oma.team === undefined) {
    return null;
  }
  const agents = new Map(oma.agents.map((agent) => [agent.id, agent] as const));
  const statusLabel = (status: string) => {
    if (status === "queued") return "Queued";
    if (status === "running") return "Running";
    if (status === "retrying") return "Retrying";
    if (status === "blocked") return "Blocked";
    if (status === "completed") return "Completed";
    if (status === "failed") return "Failed";
    return status;
  };
  return (
    <section className="lyra-agents-oma-team-board" aria-label={t("lyra-agents-oma.teamPlan")}>
      <div className="lyra-agents-oma-team-board-head">
        <BookText size={14} strokeWidth={2.1} />
        <div>
          <strong>{oma.team.title}</strong>
          {oma.team.summary?.trim() ? <span>{oma.team.summary}</span> : null}
        </div>
      </div>
      <div className="lyra-agents-oma-work-list">
        {oma.team.workPackages.map((workPackage) => {
          const agent = agents.get(workPackage.assigneeSessionAgentId);
          const channelId = `direct:${workPackage.assigneeSessionAgentId}`;
          const detail = workPackage.failureReason ?? workPackage.summary ?? workPackage.task;
          return (
            <AppButton
              key={workPackage.id}
              type="button"
              variant="ghost"
              size="sm"
              className="lyra-agents-oma-work-card"
              data-status={workPackage.status}
              onClick={() => void controls.setActiveChannel(channelId)}
              title={`Open ${agent?.name ?? "Agent"} private work`}
            >
              <span className="lyra-agents-oma-work-avatar" aria-hidden="true">
                {agent?.avatar.src ? <img src={`data:image/svg+xml,${encodeURIComponent(agent.avatar.src)}`} alt="" /> : (agent?.shortName ?? "?").slice(0, 1)}
              </span>
              <span className="lyra-agents-oma-work-copy">
                <strong>{workPackage.title}</strong>
                <span>{detail}</span>
                {workPackage.dependencies.length > 0 ? (
                  <small>Depends on {workPackage.dependencies.length}</small>
                ) : null}
              </span>
              <span className="lyra-agents-oma-work-status">{statusLabel(workPackage.status)}</span>
            </AppButton>
          );
        })}
      </div>
    </section>
  );
}

function OmaChannelStrip({ controls }: { readonly controls: OmaControls | null }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setPanelOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panelOpen]);

  if (controls === null || controls.agentMode !== "oma" || controls.state === null) {
    return null;
  }

  const oma = controls.state;
  const activeAgentIdSet = new Set(oma.agents.map((agent) => agent.agentId));
  const agentById = new Map(oma.agents.map((agent) => [agent.id, agent]));
  const activeAgentByPackageId = new Map(oma.agents.map((agent) => [agent.agentId, agent]));
  const managedAgents = [
    ...oma.availableAgents.map((agent) => activeAgentByPackageId.get(agent.agentId) ?? agent),
    ...oma.agents.filter((agent) => !oma.availableAgents.some((available) => available.agentId === agent.agentId))
  ];
  const channels = oma.channels.filter((channel) => channel.archived !== true);

  const channelLabel = (channel: (typeof channels)[number]): string => {
    if (channel.kind === "direct") {
      const agent = agentById.get(channel.memberAgentIds[0] ?? "");
      return agent?.shortName ?? agent?.name ?? channel.name;
    }
    return channel.name.trim().length > 0 ? channel.name : t("lyra-agents-oma.group");
  };

  const channelMembers = (channel: (typeof channels)[number]) =>
    channel.memberAgentIds
      .map((agentId) => agentById.get(agentId))
      .filter((agent): agent is OmaAgentMember => agent !== undefined);

  const avatarText = (value: string | null | undefined, fallback: string): string =>
    (value ?? fallback).trim().slice(0, 2).toUpperCase();
  const statusLabel = (status: OmaAgentMember["status"] | undefined): string => {
    if (status === "queued") return t("lyra-agents-oma.agentQueued");
    if (status === "retrying") return t("lyra-agents-oma.agentRetrying");
    if (status === "running") return t("lyra-agents-oma.agentRunning");
    if (status === "blocked") return "Blocked by dependency";
    if (status === "completed") return "Completed";
    if (status === "failed") return "Failed";
    return "";
  };
  const dominantStatus = (agents: readonly OmaAgentMember[]): OmaAgentMember["status"] =>
    agents.some((agent) => agent.status === "retrying") ? "retrying"
      : agents.some((agent) => agent.status === "running") ? "running"
        : agents.some((agent) => agent.status === "queued") ? "queued"
          : agents.some((agent) => agent.status === "failed") ? "failed"
            : agents.some((agent) => agent.status === "blocked") ? "blocked"
              : agents.some((agent) => agent.status === "completed") ? "completed"
                : "idle";
  const avatarTone = (value: string): string => {
    const builtInTone: Record<string, string> = {
      "did:lyra:agent:builtin:lead": "1",
      "did:lyra:agent:builtin:builder": "2",
      "did:lyra:agent:builtin:reviewer": "3",
      "did:lyra:agent:builtin:designer": "4",
      "did:lyra:agent:builtin:researcher": "5"
    };
    return builtInTone[value]
      ?? `${(Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5) + 1}`;
  };
  const avatar = (
    agent: OmaAgentMember | undefined,
    fallback: string,
    status: OmaAgentMember["status"] = agent?.status ?? "idle"
  ) => {
    const src = agent?.avatar.src?.trim();
    return (
      <span
        className="lyra-agents-oma-avatar"
        data-tone={avatarTone(agent?.agentId ?? fallback)}
        data-running={status === "running"}
        data-status={status}
        title={statusLabel(status) || undefined}
      >
        {src ? <img src={`data:image/svg+xml,${encodeURIComponent(src)}`} alt="" /> : avatarText(agent?.avatar.value, fallback)}
      </span>
    );
  };

  return (
    <div className="lyra-agents-oma">
      <div className="lyra-agents-oma-channels" role="tablist" aria-label={t("lyra-agents-oma.channels")}>
        {channels.map((channel) => {
          const members = channelMembers(channel);
          const firstMember = members[0];
          const isGroup = channel.kind === "group";
          const channelStatus = isGroup
            ? dominantStatus(members)
            : firstMember?.status ?? "idle";
          return (
            <AppButton
              key={channel.id}
              type="button"
              variant="ghost"
              size="sm"
              className="lyra-agents-oma-channel"
              data-active={channel.id === oma.activeChannelId}
              data-group={isGroup}
              onClick={() => void controls.setActiveChannel(channel.id)}
              aria-label={channelLabel(channel)}
              title={[channelLabel(channel), statusLabel(channelStatus)].filter(Boolean).join(" · ")}
            >
              <span className="lyra-agents-oma-avatar-stack" data-group={isGroup} aria-hidden="true">
                {isGroup ? (
                  <span
                    className="lyra-agents-oma-group-orb"
                    data-running={channelStatus === "running"}
                    data-status={channelStatus}
                  />
                ) : (
                  avatar(firstMember, channelLabel(channel), channelStatus)
                )}
              </span>
            </AppButton>
          );
        })}
        <div ref={triggerRef}>
          <AppButton
            type="button"
            variant="ghost"
            size="sm"
            className="lyra-agents-oma-add"
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={t("lyra-agents-oma.manage")}
            title={t("lyra-agents-oma.manage")}
          >
            <Plus size={14} strokeWidth={2.2} />
          </AppButton>
        </div>
      </div>

      {panelOpen ? (
        <div ref={panelRef} className="lyra-agents-oma-panel" role="dialog" aria-label={t("lyra-agents-oma.manage")}>
          <div className="lyra-agents-oma-panel-head">
            <div className="lyra-agents-oma-panel-title">{t("lyra-agents-oma.manage")}</div>
            <AppButton type="button" variant="ghost" size="sm" className="lyra-agents-oma-icon-button" onClick={() => setPanelOpen(false)}>
              <X size={14} strokeWidth={2.2} />
            </AppButton>
          </div>

          <div className="lyra-agents-oma-agent-list">
            {managedAgents.map((agent) => {
              const active = activeAgentIdSet.has(agent.agentId);
              const locked = active && (
                agent.agentId === "did:lyra:agent:builtin:lead" ||
                agent.status !== "idle"
              );
              return (
                <label
                  key={agent.agentId}
                  className="lyra-agents-oma-agent-row"
                  data-active={active}
                  title={locked ? statusLabel(agent.status) || agent.name : agent.role}
                >
                  {avatar(agent, agent.name)}
                  <span className="lyra-agents-oma-agent-row-copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                  <AppSwitch
                    checked={active}
                    disabled={locked}
                    aria-label={`${active ? "Remove" : "Add"} ${agent.name}`}
                    onCheckedChange={(checked) => {
                      void (checked
                        ? controls.addAgent(agent.agentId)
                        : controls.removeAgent(agent.agentId));
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MeasuredMessageSlot({
  message,
  register,
  children
}: {
  readonly message: ChatMessage;
  readonly register: (messageId: string, slot: HTMLElement) => () => void;
  readonly children: ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    return register(message.id, slot);
  }, [message.id, register]);

  return (
    <div
      ref={slotRef}
      className="lyra-agents-chat-message-slot"
      data-chat-message-id={message.id}
      data-chat-message-author={message.author}
      data-message-id={message.id}
    >
      {children}
    </div>
  );
}
