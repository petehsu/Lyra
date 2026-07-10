// ============================================================================
// ChatView — scrollable message list + floating lyra-agents-composer stack
// ============================================================================
//
// Render-budget approach (replaces virtual scroll + height estimation):
// All messages from the DataProvider are rendered directly as DOM. The
// DataProvider caps the count via a render budget; a "Show earlier" button
// loads more. This eliminates height-table / spacer / pre-measure jitter
// at the cost of more DOM nodes for very long sessions — a tradeoff that
// favors stability over memory, matching hermes-agent's proven approach.

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
import { AppButton } from "@renderer/ui/components";
import {
  buildFullMessageCitation,
  messagePlainText,
  resolveSelectionCitation
} from "./message-citation";
import { queryCitationMessageElement } from "./scroll-to-citation";

// ponytail: sticky anchor offset from the top of the scroll viewport.
const STICKY_ANCHOR_TOP_OFFSET_PX = 18;
const STICKY_ANCHOR_PREVIEW_CHARS = 96;
const CHAT_VIRTUALIZATION_THRESHOLD = 120;
const CHAT_VIRTUAL_OVERSCAN_PX = 1_400;
const CHAT_INITIAL_TAIL_MESSAGES = 80;

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

  const recordMessageHeight = useCallback((messageId: string, height: number) => {
    const normalized = Math.max(1, Math.ceil(height));
    const current = measuredMessageHeightsRef.current.get(messageId);
    if (current !== undefined && Math.abs(current - normalized) < 2) return;
    measuredMessageHeightsRef.current.set(messageId, normalized);
    scheduleVirtualRangeUpdate();
  }, [scheduleVirtualRangeUpdate]);

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

    // Sticky anchor: find the last user message whose bottom is above the anchor line.
    // Uses DOM getBoundingClientRect instead of a height table — simpler and always accurate.
    const anchorLine = el.scrollTop + STICKY_ANCHOR_TOP_OFFSET_PX;
    let foundStickyId: string | null = null;
    const slots = el.querySelectorAll<HTMLElement>("[data-chat-message-id]");
    for (const slot of slots) {
      const top = slot.offsetTop;
      const bottom = top + slot.offsetHeight;
      if (bottom <= anchorLine && slot.dataset.chatMessageAuthor === "user") {
        foundStickyId = slot.dataset.chatMessageId ?? null;
      } else if (top > anchorLine) {
        break;
      }
    }
    setStickyMessageId(foundStickyId);

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
              onHeight={recordMessageHeight}
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
          />
        )}

        {showDecisions && decisions.length > 0 && (
          <DecisionPanel
            questions={decisions}
            onSubmit={submitDecisions}
            onDismiss={() => undefined}
            progress={1}
            onTap={() => undefined}
          />
        )}

        <PlanReviewPanel
          plan={pendingPlanReview}
          onReview={openPlanReview}
          onRespond={respondPlanReview}
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

function OmaChannelStrip({ controls }: { readonly controls: OmaControls | null }) {
  const [panelOpen, setPanelOpen] = useState(false);

  if (controls === null || controls.state === null) {
    return null;
  }

  const oma = controls.state;
  const activeAgentIdSet = new Set(oma.agents.map((agent) => agent.agentId));
  const agentById = new Map(oma.agents.map((agent) => [agent.id, agent]));
  const addableAgents = oma.availableAgents.filter((agent) => !activeAgentIdSet.has(agent.agentId));
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
    return "";
  };
  const dominantStatus = (agents: readonly OmaAgentMember[]): OmaAgentMember["status"] =>
    agents.some((agent) => agent.status === "retrying") ? "retrying"
      : agents.some((agent) => agent.status === "running") ? "running"
        : agents.some((agent) => agent.status === "queued") ? "queued"
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

      {panelOpen ? (
        <div className="lyra-agents-oma-panel" role="dialog" aria-label={t("lyra-agents-oma.manage")}>
          <div className="lyra-agents-oma-panel-head">
            <div>
              <div className="lyra-agents-oma-panel-title">{t("lyra-agents-oma.manage")}</div>
              <div className="lyra-agents-oma-panel-subtitle">{t("lyra-agents-oma.tagline")}</div>
            </div>
            <AppButton type="button" variant="ghost" size="sm" className="lyra-agents-oma-icon-button" onClick={() => setPanelOpen(false)}>
              <X size={14} strokeWidth={2.2} />
            </AppButton>
          </div>

          {addableAgents.length > 0 ? (
            <div className="lyra-agents-oma-section">
              <div className="lyra-agents-oma-section-title">{t("lyra-agents-oma.addAgent")}</div>
              <div className="lyra-agents-oma-agent-list">
                {addableAgents.map((agent) => (
                  <AppButton key={agent.agentId} type="button" variant="ghost" size="sm" className="lyra-agents-oma-agent-row" onClick={() => void controls.addAgent(agent.agentId)}>
                    {avatar(agent, agent.name)}
                    <span>{agent.name}</span>
                    <Plus size={13} strokeWidth={2.2} />
                  </AppButton>
                ))}
              </div>
            </div>
          ) : null}

          <div className="lyra-agents-oma-section">
            <div className="lyra-agents-oma-section-title">{t("lyra-agents-oma.manageMembers")}</div>
            <div className="lyra-agents-oma-agent-list">
              {oma.agents.map((agent) => {
                const locked = agent.agentId === "did:lyra:agent:builtin:lead" || agent.status !== "idle";
                return (
                  <AppButton
                    key={agent.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="lyra-agents-oma-agent-row"
                    disabled={locked}
                    onClick={() => void controls.removeAgent(agent.agentId)}
                    title={statusLabel(agent.status) || agent.name}
                  >
                    {avatar(agent, agent.name)}
                    <span>{agent.name}</span>
                    <X size={13} strokeWidth={2.2} />
                  </AppButton>
                );
              })}
            </div>
          </div>

        </div>
      ) : null}
    </div>
  );
}

function MeasuredMessageSlot({
  message,
  onHeight,
  children
}: {
  readonly message: ChatMessage;
  readonly onHeight: (messageId: string, height: number) => void;
  readonly children: ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const measure = () => {
      onHeight(message.id, slot.getBoundingClientRect().height || slot.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [message.id, onHeight]);

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
