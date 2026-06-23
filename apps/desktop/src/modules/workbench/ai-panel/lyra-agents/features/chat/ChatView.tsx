// ============================================================================
// ChatView — scrollable message list + floating lyra-agents-composer stack
// ============================================================================
//
// Wires together: messages, lyra-agents-scroll-to-bottom button, panels (decision /
// permission), and lyra-agents-composer. Drives the scroll-linked decision panel
// progress value.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from "react";
import { ArrowDown, CornerUpLeft, Copy, Link2, MapPin, Undo2 } from "lucide-react";
import { ContextMenuHost, useContextMenuModel } from "../../../../context-menu";
import type { LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import type { ChatMessage } from "../../core/types";
import { APP_CONFIG } from "../../core/config";
import { t } from "../../core/i18n";
import { useData } from "../../data/DataProvider";
import {
  getIsLayoutResizing,
  subscribeLayoutResizeEnd,
  subscribeLayoutResizeStart
} from "../../../../shell/use-panel-layout";
import { createChatLoadGovernor } from "./chat-load-governor";
import {
  isEmptyPendingAgentMessage,
  Message,
  resolveAgentActivityHostMessageId
} from "./Message";
import { Composer } from "./Composer";
import { ChatEmptyState } from "./ChatEmptyState";
import { ProjectDirChip } from "./ProjectDirChip";
import { DecisionPanel, PermissionPanel, PlanReviewPanel } from "../panels";
import { AppButton } from "@renderer/ui/components";
import {
  CHAT_INNER_PADDING_TOP_PX,
  CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
  CHAT_MESSAGE_GAP_PX,
  CHAT_VIRTUAL_OVERSCAN
} from "./chat-layout-constants";
import { visibleIndexRange } from "./message-height-table";
import { nextStickyMessageId } from "./sticky-message";
import { useMessageHeightTable } from "./use-message-height-table";
import { VirtualizedMessageList } from "./virtualized-message-list";
import {
  buildFullMessageCitation,
  messagePlainText,
  resolveSelectionCitation
} from "./message-citation";
import { runCitationScrollIntoView } from "./scroll-to-citation";

interface ChatViewProps {
  /** When true, render the decision panel even if there are no questions. */
  showDecisions: boolean;
  showPermission: boolean;
  desktopApi?: LyraDesktopApi | null;
}

const STICKY_ANCHOR_PREVIEW_CHARS = 96;

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

export function ChatView({ showDecisions, showPermission, desktopApi = null }: ChatViewProps) {
  const {
    messages,
    messageWindow,
    decisions,
    permissions,
    planReview,
    sendMessage,
    loadEarlierMessages,
    syncMessageWindowBudget,
    captureWorkspaceScreenshot,
    captureWindowScreenshot,
    pickFileFromFileManager,
    workspaceTabs,
    terminalTabs,
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
    openModelSettings,
    isTurnRunning,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    cancelTurn,
    session,
    bindProject,
    openProjectTree,
    addCitationToComposer,
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const orderedIdsRef = useRef<readonly string[]>([]);
  const listContentStartRef = useRef(0);
  const measurableDuringResizeRef = useRef<ReadonlySet<string> | null>(null);

  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  orderedIdsRef.current = messageIds;

  const heightTable = useMessageHeightTable(
    scrollRef,
    CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
    orderedIdsRef,
    CHAT_MESSAGE_GAP_PX,
    measurableDuringResizeRef
  );

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [panelProgress, setPanelProgress] = useState(1);
  const [stickyMessageId, setStickyMessageId] = useState<string | null>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [isLayoutResizing, setIsLayoutResizing] = useState(false);

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

  const lastScrollTop = useRef(0);
  const rafId = useRef(0);
  const accumulatedDelta = useRef(0);
  const loadingEarlierRef = useRef(false);
  const prependStartedAtRef = useRef<number | null>(null);
  const loadGovernorRef = useRef(createChatLoadGovernor(APP_CONFIG.messageWindow.governor));
  const hasSyncedMessageWindowRef = useRef(false);
  const syncedMessageWindowSessionRef = useRef<string | null>(null);
  const prependRestoreRef = useRef<{
    readonly scrollHeight: number;
    readonly scrollTop: number;
  } | null>(null);
  const citationScrollSessionRef = useRef<{
    readonly token: number;
    readonly anchorScrollHeight: number;
    readonly anchorScrollTop: number;
  } | null>(null);
  const citationScrollCompletedTokenRef = useRef<number | null>(null);
  const citationScrollCancelRef = useRef<(() => void) | null>(null);
  const scrollAnchorDistanceRef = useRef(0);

  const pinnedMessageIds = useMemo(() => {
    const ids = new Set<string>();
    if (citationScrollTarget !== null) {
      ids.add(citationScrollTarget.messageId);
    }
    if (activityIndicatorHostMessageId !== null) {
      ids.add(activityIndicatorHostMessageId);
    }
    return ids.size > 0 ? [...ids] : undefined;
  }, [activityIndicatorHostMessageId, citationScrollTarget?.messageId]);

  const visibleMessageIdsDuringResize = useMemo((): ReadonlySet<string> => {
    if (messageIds.length === 0) {
      return new Set<string>();
    }
    const viewportBottom = viewportHeight <= 0
      ? Number.POSITIVE_INFINITY
      : viewportTop + viewportHeight;
    const [firstIndex, lastIndex] = visibleIndexRange(
      heightTable.store,
      messageIds,
      viewportTop,
      viewportBottom,
      CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
      CHAT_MESSAGE_GAP_PX
    );
    const ids = new Set(messageIds.slice(firstIndex, lastIndex + 1));
    if (pinnedMessageIds !== undefined) {
      for (const pinnedId of pinnedMessageIds) {
        if (ids.has(pinnedId)) continue;
        const pinnedIndex = messageIds.indexOf(pinnedId);
        if (pinnedIndex < firstIndex || pinnedIndex > lastIndex) continue;
        ids.add(pinnedId);
      }
    }
    return ids;
  }, [
    heightTable.store,
    heightTable.version,
    messageIds,
    pinnedMessageIds,
    viewportHeight,
    viewportTop
  ]);

  measurableDuringResizeRef.current = isLayoutResizing
    ? visibleMessageIdsDuringResize
    : null;

  const resolveContentWidthPx = useCallback((): number => {
    const innerWidth = innerRef.current?.clientWidth ?? 0;
    if (innerWidth > 0) return innerWidth;
    return APP_CONFIG.maxColumnWidth;
  }, []);

  const syncAdaptiveMessageWindow = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl === null || scrollEl.clientHeight <= 0) return;
    const budget = loadGovernorRef.current.requestInitialBudget(scrollEl.clientHeight);
    void syncMessageWindowBudget({
      heightBudgetPx: budget,
      contentWidthPx: resolveContentWidthPx()
    });
  }, [resolveContentWidthPx, syncMessageWindowBudget]);

  const syncListContentStart = useCallback((scrollEl: HTMLDivElement): number => {
    const inner = innerRef.current;
    if (inner === null) {
      listContentStartRef.current = 0;
      return 0;
    }
    const start = inner.offsetTop + CHAT_INNER_PADDING_TOP_PX;
    listContentStartRef.current = start;
    return start;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const listContentStart = syncListContentStart(el);
    const contentViewportTop = Math.max(0, el.scrollTop - listContentStart);
    setViewportTop(contentViewportTop);
    setViewportHeight(el.clientHeight);

    if (
      messageWindow.canLoadEarlier &&
      !loadingEarlierRef.current &&
      el.scrollTop <= APP_CONFIG.scroll.topLoadThreshold &&
      !loadGovernorRef.current.shouldDeferLoad(getIsLayoutResizing())
    ) {
      loadingEarlierRef.current = true;
      prependStartedAtRef.current = performance.now();
      prependRestoreRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop
      };
      const budget = loadGovernorRef.current.requestLoadBudget(el.clientHeight);
      void loadEarlierMessages({
        heightBudgetPx: budget,
        contentWidthPx: resolveContentWidthPx()
      }).finally(() => {
        loadingEarlierRef.current = false;
      });
    }

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - el.scrollTop;
    setStickyMessageId((current) =>
      nextStickyMessageId(
        heightTable.store,
        messageIds,
        messages,
        el.scrollTop,
        listContentStart,
        current,
        CHAT_MESSAGE_FALLBACK_HEIGHT_PX,
        CHAT_MESSAGE_GAP_PX
      )
    );

    const currentTop = el.scrollTop;
    const delta = currentTop - lastScrollTop.current;
    lastScrollTop.current = currentTop;

    if (Math.abs(delta) < APP_CONFIG.scroll.ignoreDeltaBelow) return;

    accumulatedDelta.current += delta;

    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        const totalDelta = accumulatedDelta.current;
        accumulatedDelta.current = 0;
        rafId.current = 0;

        if (Math.abs(totalDelta) < APP_CONFIG.scroll.ignoreDeltaBelow) return;

        setPanelProgress((prev) => {
          const change = totalDelta / APP_CONFIG.scroll.decisionPanelRange;
          const next = prev + change;
          if (next <= 0.03) return 0;
          if (next >= 0.97) return 1;
          return Math.max(0, Math.min(1, next));
        });
      });
    }
  }, [
    heightTable,
    loadEarlierMessages,
    messageIds,
    messageWindow.canLoadEarlier,
    messages,
    resolveContentWidthPx,
    syncListContentStart
  ]);

  useEffect(() => {
    loadGovernorRef.current.reset();
    hasSyncedMessageWindowRef.current = false;
    syncedMessageWindowSessionRef.current = null;
  }, [session.id]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (viewportHeight <= 0 || messageWindow.totalCount <= 0) {
      return;
    }
    const sessionKey = session.id ?? "__active-session__";
    if (
      hasSyncedMessageWindowRef.current &&
      syncedMessageWindowSessionRef.current === sessionKey
    ) {
      return;
    }
    hasSyncedMessageWindowRef.current = true;
    syncedMessageWindowSessionRef.current = sessionKey;
    syncAdaptiveMessageWindow();
  }, [
    messageWindow.totalCount,
    session.id,
    syncAdaptiveMessageWindow,
    viewportHeight
  ]);

  useEffect(() => {
    let frameId = 0;
    let lastFrameAt = performance.now();
    const sample = (now: number): void => {
      loadGovernorRef.current.recordFrameDelta(now - lastFrameAt);
      lastFrameAt = now;
      frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    syncListContentStart(el);
    setViewportTop(Math.max(0, el.scrollTop - listContentStartRef.current));
    setViewportHeight(el.clientHeight);

    const prependRestore = prependRestoreRef.current;
    if (prependRestore !== null) {
      prependRestoreRef.current = null;
      el.scrollTop = Math.max(
        0,
        el.scrollHeight - prependRestore.scrollHeight + prependRestore.scrollTop
      );
      lastScrollTop.current = el.scrollTop;
      scrollAnchorDistanceRef.current = el.scrollHeight - el.scrollTop;
      setViewportTop(Math.max(0, el.scrollTop - listContentStartRef.current));
      const startedAt = prependStartedAtRef.current;
      if (startedAt !== null) {
        loadGovernorRef.current.recordPrependDuration(performance.now() - startedAt);
        prependStartedAtRef.current = null;
      }
      return;
    }

    if (citationScrollTarget === null) {
      const nextScrollTop = Math.max(0, el.scrollHeight - scrollAnchorDistanceRef.current);
      el.scrollTop = nextScrollTop;
      lastScrollTop.current = nextScrollTop;
      setViewportTop(Math.max(0, nextScrollTop - listContentStartRef.current));
      const atBottom =
        el.scrollHeight - nextScrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
      setIsAtBottom(atBottom);
      scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - nextScrollTop;
    }
  }, [citationScrollTarget, messages, syncListContentStart]);

  useEffect(() => {
    if (decisions.length > 0 || permissions.length > 0) {
      setPanelProgress(1);
    }
  }, [decisions.length, permissions.length]);

  useEffect(() => {
    if (stickyMessageId !== null && !messages.some((message) => message.id === stickyMessageId)) {
      setStickyMessageId(null);
    }
  }, [messages, stickyMessageId]);

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
    const index = messageIds.indexOf(stickyMessageId);
    if (index < 0) return;
    const targetTop =
      listContentStartRef.current +
      heightTable.offsetOf(messageIds, index);
    el.scrollTo({ top: targetTop, behavior: "smooth" });
  };

  useLayoutEffect(() => {
    if (citationScrollTarget === null) return;
    if (citationScrollCompletedTokenRef.current === citationScrollTarget.token) return;

    const el = scrollRef.current;
    if (el === null) return;

    let session = citationScrollSessionRef.current;
    if (session === null || session.token !== citationScrollTarget.token) {
      citationScrollCompletedTokenRef.current = null;
      session = {
        token: citationScrollTarget.token,
        anchorScrollHeight: el.scrollHeight,
        anchorScrollTop: el.scrollTop
      };
      citationScrollSessionRef.current = session;
    }

    const index = messageIds.indexOf(citationScrollTarget.messageId);
    if (index < 0) return;

    citationScrollCancelRef.current?.();
    citationScrollCancelRef.current = null;

    if (messages.length > citationScrollTarget.visibleCountAtStart) {
      el.scrollTop = Math.max(
        0,
        el.scrollHeight - session.anchorScrollHeight + session.anchorScrollTop
      );
    }

    syncListContentStart(el);
    const targetTop =
      listContentStartRef.current +
      heightTable.offsetOf(messageIds, index);
    setIsAtBottom(false);

    const syncViewport = (scrollTop: number): void => {
      lastScrollTop.current = scrollTop;
      setViewportTop(Math.max(0, scrollTop - listContentStartRef.current));
    };

    citationScrollCancelRef.current = runCitationScrollIntoView({
      scrollEl: el,
      messageId: citationScrollTarget.messageId,
      estimatedTop: targetTop,
      onViewportSync: syncViewport,
      onComplete: () => {
        citationScrollCompletedTokenRef.current = citationScrollTarget.token;
        citationScrollCancelRef.current = null;
        reportCitationScrollFinished(citationScrollTarget.messageId);
      }
    });

    return () => {
      citationScrollCancelRef.current?.();
      citationScrollCancelRef.current = null;
    };
  }, [
    citationScrollTarget,
    heightTable.version,
    messageIds,
    messages.length,
    reportCitationScrollFinished,
    syncListContentStart
  ]);

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

  useEffect(() => {
    const unsubscribeStart = subscribeLayoutResizeStart(() => {
      setIsLayoutResizing(true);
    });
    const unsubscribeEnd = subscribeLayoutResizeEnd(() => {
      setIsLayoutResizing(false);
    });
    return () => {
      unsubscribeStart();
      unsubscribeEnd();
    };
  }, []);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportHeight(scrollEl.clientHeight);
    });
    observer.observe(scrollEl);
    setViewportHeight(scrollEl.clientHeight);
    return () => observer.disconnect();
  }, []);

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
        <div className="lyra-agents-chat-inner" ref={innerRef}>
          {messages.length === 0 ? (
            <ChatEmptyState
              projectName={session.project.trim().length > 0 ? session.project.trim() : null}
              isHome={session.workingDirIsHome}
              onChooseProject={bindProject}
            />
          ) : null}
          <VirtualizedMessageList
            messages={messages}
            heightTable={heightTable}
            viewportTop={viewportTop}
            viewportHeight={viewportHeight}
            contentWidth={resolveContentWidthPx()}
            overscan={CHAT_VIRTUAL_OVERSCAN}
            ignoreOffScreenPins={isLayoutResizing}
            {...(pinnedMessageIds === undefined
              ? {}
              : { pinnedMessageIds })}
            renderMessage={(message) => (
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
            )}
          />
        </div>
      </div>

      <div className="lyra-agents-composer-wrap">
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

        {showPermission && permissions.length > 0 && (
          <PermissionPanel
            requests={permissions}
            onApprove={approvePermission}
            onDeny={denyPermission}
            progress={panelProgress}
            onTap={() => setPanelProgress(1)}
          />
        )}

        {showDecisions && decisions.length > 0 && (
          <DecisionPanel
            questions={decisions}
            onSubmit={submitDecisions}
            onDismiss={() => undefined}
            progress={panelProgress}
            onTap={() => setPanelProgress(1)}
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
            projectName={session.project.trim().length > 0 ? session.project.trim() : null}
            workingDir={session.workingDir}
            isHome={session.workingDirIsHome}
            canOpenProjectTree={session.projectBound && !session.workingDirIsHome}
            onChooseProject={bindProject}
            onOpenProjectTree={openProjectTree}
          />
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
      </div>
    </>
  );
}
