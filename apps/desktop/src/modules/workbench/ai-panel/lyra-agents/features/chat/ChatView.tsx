// ============================================================================
// ChatView — scrollable message list + floating lyra-agents-composer stack
// ============================================================================
//
// The DataProvider limits how many messages are materialized as DOM nodes
// (render-budget system). This view renders all provided messages directly —
// no virtual scrolling, no height estimation.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent
} from "react";
import {
  ArrowDown,
  BookText,
  CornerUpLeft,
  Copy,
  GitBranch,
  Link2,
  Undo2
} from "@lyra/icons";
import { ContextMenuHost, useContextMenuModel } from "../../../../context-menu";
import type { LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import type { ChatMessage } from "../../core/types";
import { APP_CONFIG } from "../../core/config";
import { t } from "@workbench/i18n";
import { useData } from "../../data/DataProvider";
import {
  Message,
  resolveAgentActivityHostMessageId
} from "./Message";
import { Composer } from "./Composer";
import { ContextRing } from "./context-ring";
import { ChatEmptyState } from "./ChatEmptyState";
import {
  ComposerMetaBuiltinProvider,
  useRegisterCoreComposerMetaChrome,
  WorkbenchChromeComposerMetaRow
} from "../../../../shell/workbench-chrome-composer-meta";
import { UserGateHost } from "../panels";
import { TodoBar } from "../pills";
import { AppButton } from "@renderer/ui/components";
import {
  buildFullMessageCitation,
  messagePlainText,
  resolveSelectionCitation
} from "./message-citation";
import { queryCitationMessageElement } from "./scroll-to-citation";
import { useAutoScroll } from "./use-auto-scroll";
import { createRafCoalescer } from "../../../../shell/raf-coalesce";

// ponytail: sticky anchor offset from the top of the scroll viewport.
const STICKY_ANCHOR_TOP_OFFSET_PX = 18;
const STICKY_ANCHOR_PREVIEW_CHARS = 96;
const GIT_STATUS_POLL_MS = 5000;

/** Keep the last message above the floating composer, including permission/decision popups. */
export const syncComposerStackHeight = (scroll: HTMLElement, wrap: HTMLElement): number => {
  const height = Math.max(wrap.getBoundingClientRect().height, wrap.offsetHeight);
  if (height <= 0) {
    return 0;
  }
  const next = Math.ceil(height);
  scroll.style.setProperty(
    "--lyra-agents-composer-scroll-bottom-padding",
    `${next}px`
  );
  return next;
};

type ComposerGitCounts = {
  readonly additions: number;
  readonly deletions: number;
};

const useComposerGitCounts = (
  desktopApi: LyraDesktopApi | null,
  workingDir: string | undefined
): ComposerGitCounts | null => {
  const [counts, setCounts] = useState<ComposerGitCounts | null>(null);
  useEffect(() => {
    const dir = workingDir?.trim() ?? "";
    const agent = desktopApi?.agent;
    if (agent === undefined || dir.length === 0) {
      setCounts(null);
      return undefined;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await agent.readGitStatus({ workingDir: dir });
        if (cancelled) {
          return;
        }
        const additions = next.summary.additions ?? 0;
        const deletions = next.summary.deletions ?? 0;
        if (!next.isRepository || (next.summary.changed === 0 && additions === 0 && deletions === 0)) {
          setCounts(null);
          return;
        }
        setCounts({ additions, deletions });
      } catch {
        if (!cancelled) {
          setCounts(null);
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, GIT_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [desktopApi, workingDir]);
  return counts;
};

const useComposerHasProjectPlan = (
  desktopApi: LyraDesktopApi | null,
  workingDir: string | null | undefined,
  sessionId: string | null | undefined,
  enabled: boolean
): boolean => {
  const [hasPlan, setHasPlan] = useState(false);
  useEffect(() => {
    const dir = workingDir?.trim() ?? "";
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    const agent = desktopApi?.agent;
    if (!enabled || agent?.listProjectPlans === undefined || dir.length === 0) {
      setHasPlan(false);
      return undefined;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await agent.listProjectPlans({
          workingDir: dir,
          ...(id.length === 0 ? {} : { sessionId: id })
        });
        if (!cancelled) {
          setHasPlan(next.plans.length > 0);
        }
      } catch {
        if (!cancelled) {
          setHasPlan(false);
        }
      }
    };
    void load();
    const unsubscribe = agent.onEvent?.((event) => {
      if (
        event.kind === "planUpdated"
        || event.kind === "planReviewRequested"
        || event.kind === "planReviewResolved"
      ) {
        void load();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [desktopApi, enabled, sessionId, workingDir]);
  return hasPlan;
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
    openUrlInWorkbench,
    submitDecisions,
    approvePermission,
    denyPermission,
    openPlanReview,
    respondPlanReview,
    modelControls,
    permissionModeControls,
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
    openProjectGit,
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
    todos,
  } = useData();
  useRegisterCoreComposerMetaChrome(session.id);
  const contextMenu = useContextMenuModel();
  const composerMetaBuiltins = {
    projectDir: {
      desktopApi,
      sessionId: session.id,
      projectName: session.project.trim().length > 0 ? session.project.trim() : null,
      workingDir: session.workingDir,
      isHome: session.workingDirIsHome,
      canOpenProjectTree: session.projectBound && !session.workingDirIsHome,
      onChooseProject: bindProject,
      onSelectProject: bindProject,
      onOpenProjectTree: openProjectTree,
      onOpenInFileManager: openInFileManager
    },
    backgroundTerminal: {
      terminalTabs,
      getTerminalTabPanes,
      session,
      workspaceTabs,
      onCiteTerminal: addPageCitationToComposer,
      onCloseTerminalTab: closeTerminalTab,
      onFocusTerminalTabInDock: focusTerminalTabInDock,
      onOpenTerminalInWorkspace: (request: Parameters<typeof openTerminalLiveSession>[0]) => {
        void openTerminalLiveSession(request);
      },
      desktopApi
    }
  };

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
  const gitCounts = useComposerGitCounts(desktopApi, session.workingDir);
  const hasProjectPlan = useComposerHasProjectPlan(
    desktopApi,
    session.workingDir,
    session.id,
    canManagePlans
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const autoScroll = useAutoScroll({
    working: true,
    overflowAnchor: "none",
    bottomThreshold: APP_CONFIG.scroll.atBottomThreshold
  });
  const bindScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    autoScroll.setScrollElement(node);
  }, [autoScroll.setScrollElement]);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [stickyMessageId, setStickyMessageId] = useState<string | null>(null);
  const [composerStackHeight, setComposerStackHeight] = useState(0);

  const hasPendingClarification = showDecisions && decisions.length > 0;
  const pendingPlanReview = planReview !== null && planReview.phase === "reviewing" ? planReview : null;
  const showPlanChip = canManagePlans && (hasProjectPlan || pendingPlanReview !== null);
  const activityIndicatorMessageId = resolveAgentActivityHostMessageId(messages, isTurnRunning);
  const activityIndicatorMessage =
    activityIndicatorMessageId === null
      ? null
      : messages.find((message) => message.id === activityIndicatorMessageId) ?? null;
  const activityIndicatorHostMessageId = activityIndicatorMessageId;
  const stickyMessage = stickyMessageId === null
    ? null
    : messages.find((message) => message.id === stickyMessageId) ?? null;
  const stickyMessagePreview = stickyMessage === null ? "" : textPreviewForMessage(stickyMessage);

  const loadingEarlierRef = useRef(false);
  const pendingEarlierAnchorRef = useRef(false);
  const scrollAnchorDistanceRef = useRef(0);
  const citationScrollCompletedTokenRef = useRef<number | null>(null);
  const stickyAnchorFrameRef = useRef<number | null>(null);

  const updateStickyAnchor = useCallback(() => {
    stickyAnchorFrameRef.current = null;
    const el = scrollRef.current;
    if (el === null) return;
    if (el.scrollTop <= 0) {
      setStickyMessageId(null);
      return;
    }
    const anchorY = el.getBoundingClientRect().top + STICKY_ANCHOR_TOP_OFFSET_PX;
    let stickyId: string | null = null;
    for (const slot of el.querySelectorAll<HTMLElement>("[data-chat-message-id]")) {
      const slotBottom = slot.getBoundingClientRect().bottom;
      if (slotBottom > anchorY) break;
      if (slot.dataset.chatMessageAuthor === "user") {
        stickyId = slot.dataset.chatMessageId ?? null;
      }
    }
    setStickyMessageId(stickyId);
  }, []);

  const scheduleStickyAnchorUpdate = useCallback(() => {
    if (stickyAnchorFrameRef.current !== null) return;
    stickyAnchorFrameRef.current = window.requestAnimationFrame(updateStickyAnchor);
  }, [updateStickyAnchor]);

  // --- Scroll handler: follow lock, bottom detection, sticky anchor, history loading ---
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    autoScroll.handleScroll();
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - el.scrollTop;
    if (el.scrollTop <= 0) {
      if (stickyAnchorFrameRef.current !== null) {
        window.cancelAnimationFrame(stickyAnchorFrameRef.current);
        stickyAnchorFrameRef.current = null;
      }
      setStickyMessageId(null);
    } else {
      scheduleStickyAnchorUpdate();
    }

    // Load earlier messages when scrolled near the top
    if (
      messageWindow.canLoadEarlier &&
      !loadingEarlierRef.current &&
      el.scrollTop <= APP_CONFIG.scroll.topLoadThreshold
    ) {
      loadingEarlierRef.current = true;
      pendingEarlierAnchorRef.current = true;
      void loadEarlierMessages().finally(() => {
        loadingEarlierRef.current = false;
      });
    }
  }, [
    autoScroll.handleScroll,
    loadEarlierMessages,
    messageWindow.canLoadEarlier,
    scheduleStickyAnchorUpdate
  ]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const wrap = composerWrapRef.current;
    if (scroll === null || wrap === null) {
      return undefined;
    }
    const apply = () => {
      const next = syncComposerStackHeight(scroll, wrap);
      if (next > 0) {
        setComposerStackHeight((current) => (current === next ? current : next));
      }
    };
    apply();
    const coalescer = createRafCoalescer(apply);
    const observer = new ResizeObserver(() => coalescer.schedule());
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      coalescer.cancel();
    };
  }, []);

  // Following: pin to bottom as content grows. Unlocked: only restore position
  // when older messages were prepended; appended stream must not drag the viewport.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!autoScroll.userScrolled()) {
      autoScroll.follow();
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
      setIsAtBottom(atBottom);
      scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - el.scrollTop;
      return;
    }

    if (pendingEarlierAnchorRef.current) {
      pendingEarlierAnchorRef.current = false;
      const nextScrollTop = Math.max(0, el.scrollHeight - scrollAnchorDistanceRef.current);
      el.scrollTop = nextScrollTop;
      const atBottom =
        el.scrollHeight - nextScrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
      setIsAtBottom(atBottom);
      scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - nextScrollTop;
      return;
    }

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    scrollAnchorDistanceRef.current = atBottom ? 0 : el.scrollHeight - el.scrollTop;
  }, [autoScroll.follow, autoScroll.userScrolled, composerStackHeight, messages]);

  useEffect(() => () => {
    if (stickyAnchorFrameRef.current !== null) {
      window.cancelAnimationFrame(stickyAnchorFrameRef.current);
    }
  }, []);

  // --- Citation scroll: scroll a specific message into view ---
  useLayoutEffect(() => {
    if (citationScrollTarget === null) return;
    if (citationScrollCompletedTokenRef.current === citationScrollTarget.token) return;

    const el = scrollRef.current;
    if (el === null) return;

    const domTarget = queryCitationMessageElement(el, citationScrollTarget.messageId);
    if (domTarget === null) return;
    autoScroll.pause();
    domTarget.scrollIntoView({ block: "center", behavior: "auto" });
    citationScrollCompletedTokenRef.current = citationScrollTarget.token;
    requestAnimationFrame(() => {
      reportCitationScrollFinished(citationScrollTarget.messageId);
    });
  }, [autoScroll.pause, citationScrollTarget, reportCitationScrollFinished]);

  useEffect(() => {
    if (stickyMessageId !== null && !messages.some((message) => message.id === stickyMessageId)) {
      setStickyMessageId(null);
    }
  }, [messages, stickyMessageId]);

  // Reset scroll anchor on session switch — start at bottom
  useEffect(() => {
    scrollAnchorDistanceRef.current = 0;
    setStickyMessageId(null);
    autoScroll.resume();
  }, [autoScroll.resume, session.id]);

  const scrollToStickyMessage = () => {
    if (stickyMessageId === null) return;
    const el = scrollRef.current;
    if (el === null) return;
    const target = el.querySelector<HTMLElement>(`[data-chat-message-id="${CSS.escape(stickyMessageId)}"]`);
    if (target !== null) {
      autoScroll.pause();
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

      <div
        className="lyra-agents-chat-scroll"
        ref={bindScrollRef}
        onScroll={handleScroll}
        onWheel={autoScroll.handleWheel}
      >
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

        <div
          className="lyra-agents-chat-inner"
          ref={autoScroll.setContentElement}
          onClick={autoScroll.handleInteraction}
        >
          {/* Show earlier button */}
          {messageWindow.canLoadEarlier ? (
            <div className="lyra-agents-chat-load-earlier">
              <AppButton
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  pendingEarlierAnchorRef.current = true;
                  void loadEarlierMessages();
                }}
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

          {messages.map((message) => (
            <div
              key={message.id}
              className="lyra-agents-chat-message-slot"
              data-chat-message-id={message.id}
              data-chat-message-author={message.author}
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
            </div>
          ))}
        </div>
      </div>

      <div className="lyra-agents-composer-wrap" ref={composerWrapRef}>
        <div className="lyra-agents-composer-toprow">
          {gitCounts !== null ? (
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              className="lyra-agents-composer-rail-chip lyra-agents-composer-changes-chip"
              aria-label={t("lyra-agents-composer.openChanges")}
              title={t("lyra-agents-composer.openChanges")}
              onClick={() => { void openProjectGit(); }}
            >
              <GitBranch size={13} strokeWidth={2.1} aria-hidden="true" />
              <span>{t("lyra-agents-composer.openChanges")}</span>
              {gitCounts.additions > 0 || gitCounts.deletions > 0 ? (
                <span className="lyra-agents-composer-changes-counts">
                  <span className="lyra-agents-diff-add">+{gitCounts.additions}</span>
                  <span className="lyra-agents-diff-del">-{gitCounts.deletions}</span>
                </span>
              ) : null}
            </AppButton>
          ) : null}
          {showPlanChip ? (
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              className="lyra-agents-composer-rail-chip"
              aria-label={t("lyra-agents-composer.openPlan")}
              title={t("lyra-agents-composer.openPlan")}
              onClick={() => { void openPlanBoard(); }}
            >
              <BookText size={13} strokeWidth={2.1} aria-hidden="true" />
              <span>{t("lyra-agents-composer.openPlan")}</span>
            </AppButton>
          ) : null}
          {isAtBottom ? null : (
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              className="lyra-agents-composer-rail-chip lyra-agents-scroll-to-bottom in"
              onClick={autoScroll.resume}
              aria-label={t("scroll.toBottom")}
              title={t("scroll.toBottom")}
            >
              <ArrowDown size={13} strokeWidth={2.2} aria-hidden="true" />
            </AppButton>
          )}
          <TodoBar tasks={todos} onOpenBoard={openTodoBoard} />
        </div>

        <UserGateHost
          sessionId={session.id}
          permissionMode={permissionModeControls?.currentMode ?? "approval"}
          showDecisions={showDecisions}
          showPermission={showPermission}
          decisions={decisions}
          permissions={permissions}
          planReview={pendingPlanReview}
          onSubmitDecisions={submitDecisions}
          onApprovePermission={approvePermission}
          onDenyPermission={denyPermission}
          onOpenPlanReview={openPlanReview}
          onRespondPlanReview={respondPlanReview}
          autoResolve={desktopApi?.agent?.autoResolveUserGate ?? null}
          touchActivity={desktopApi?.agent?.touchUserGateActivity ?? null}
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
          onLinkClick={(url, title) => {
            void openUrlInWorkbench(url, title);
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

        <ComposerMetaBuiltinProvider value={composerMetaBuiltins}>
          <WorkbenchChromeComposerMetaRow sessionId={session.id} />
        </ComposerMetaBuiltinProvider>
        <div className="lyra-agents-composer-context-ring-slot">
          <ContextRing />
        </div>
      </div>
    </>
  );
}
