// ============================================================================
// ChatView — scrollable message list + floating composer stack
// ============================================================================
//
// Wires together: messages, scroll-to-bottom button, panels (decision /
// permission), and composer. Drives the scroll-linked decision panel
// progress value.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, CornerUpLeft } from "lucide-react";
import type { ChatMessage } from "../../core/types";
import { APP_CONFIG } from "../../core/config";
import { t } from "../../core/i18n";
import { useData } from "../../data/DataProvider";
import { Message, shouldShowAgentActivityIndicator } from "./Message";
import { Composer } from "./Composer";
import { DecisionPanel, PermissionPanel } from "../panels";

interface ChatViewProps {
  /** When true, render the decision panel even if there are no questions. */
  showDecisions: boolean;
  showPermission: boolean;
}

const STICKY_ANCHOR_TOP_OFFSET_PX = 18;
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
    return t("msg.imageAttachment");
  }
  return message.blocks.find((block) => block.type === "tools")?.group.label ?? "";
};

const previousUserMessageAtTop = (
  scrollElement: HTMLDivElement,
  messages: readonly ChatMessage[]
): ChatMessage | null => {
  const containerTop = scrollElement.getBoundingClientRect().top;
  const messageById = new Map(messages.map((message) => [message.id, message]));
  let current: ChatMessage | null = null;
  const slots = scrollElement.querySelectorAll<HTMLElement>("[data-chat-message-author='user']");

  slots.forEach((slot) => {
    const messageId = slot.dataset.chatMessageId;
    if (messageId === undefined) return;
    const message = messageById.get(messageId);
    if (message === undefined) return;
    const bottom = slot.getBoundingClientRect().bottom;
    if (bottom <= containerTop + STICKY_ANCHOR_TOP_OFFSET_PX) {
      current = message;
    }
  });

  return current;
};

const nextStickyMessageId = (
  scrollElement: HTMLDivElement,
  messages: readonly ChatMessage[],
  currentStickyMessageId: string | null
): string | null => {
  const previousUserMessage = previousUserMessageAtTop(scrollElement, messages);
  if (previousUserMessage !== null) {
    return previousUserMessage.id;
  }
  if (scrollElement.scrollTop <= APP_CONFIG.scroll.topLoadThreshold) {
    return null;
  }
  if (currentStickyMessageId !== null) {
    const stickySlot = Array.from(
      scrollElement.querySelectorAll<HTMLElement>("[data-chat-message-id]")
    ).find((slot) => slot.dataset.chatMessageId === currentStickyMessageId);
    if (
      stickySlot !== undefined &&
      stickySlot.getBoundingClientRect().bottom > scrollElement.getBoundingClientRect().top +
        STICKY_ANCHOR_TOP_OFFSET_PX
    ) {
      return null;
    }
  }
  return currentStickyMessageId !== null &&
    messages.some((message) => message.id === currentStickyMessageId)
    ? currentStickyMessageId
    : null;
};

export function ChatView({ showDecisions, showPermission }: ChatViewProps) {
  const {
    messages,
    messageWindow,
    decisions,
    permissions,
    sendMessage,
    loadEarlierMessages,
    captureBrowserScreenshot,
    captureWindowScreenshot,
    submitDecisions,
    approvePermission,
    denyPermission,
    modelControls,
    permissionModeControls,
    openModelSettings,
    isTurnRunning,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    cancelTurn,
  } = useData();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [panelProgress, setPanelProgress] = useState(1);
  const [stickyMessageId, setStickyMessageId] = useState<string | null>(null);
  const hasPendingClarification = showDecisions && decisions.length > 0;
  const activityIndicatorMessageId =
    [...messages].reverse().find(shouldShowAgentActivityIndicator)?.id ?? null;
  const stickyMessage = stickyMessageId === null
    ? null
    : messages.find((message) => message.id === stickyMessageId) ?? null;
  const stickyMessagePreview = stickyMessage === null ? "" : textPreviewForMessage(stickyMessage);

  const lastScrollTop = useRef(0);
  const rafId = useRef(0);
  const accumulatedDelta = useRef(0);
  const loadingEarlierRef = useRef(false);
  const prependRestoreRef = useRef<{
    readonly scrollHeight: number;
    readonly scrollTop: number;
  } | null>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (
      messageWindow.canLoadEarlier &&
      !loadingEarlierRef.current &&
      el.scrollTop <= APP_CONFIG.scroll.topLoadThreshold
    ) {
      loadingEarlierRef.current = true;
      prependRestoreRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop
      };
      void loadEarlierMessages().finally(() => {
        loadingEarlierRef.current = false;
      });
    }

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);
    setStickyMessageId((current) => nextStickyMessageId(el, messages, current));

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
  }, [loadEarlierMessages, messageWindow.canLoadEarlier, messages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prependRestore = prependRestoreRef.current;
    if (prependRestore !== null) {
      prependRestoreRef.current = null;
      el.scrollTop = Math.max(
        0,
        el.scrollHeight - prependRestore.scrollHeight + prependRestore.scrollTop
      );
      lastScrollTop.current = el.scrollTop;
      return;
    }

    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
  }, [messages, isAtBottom]);

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
    const target = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-chat-message-id]") ?? []
    ).find((slot) => slot.dataset.chatMessageId === stickyMessageId);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {stickyMessage !== null && stickyMessagePreview.length > 0 ? (
          <div className="chat-thread-anchor">
            <button
              type="button"
              className="chat-thread-anchor-button"
              onClick={scrollToStickyMessage}
              aria-label={t("scroll.jumpToPreviousMessage")}
              title={`${t("scroll.jumpToPreviousMessage")}: ${stickyMessagePreview}`}
            >
              <CornerUpLeft size={13} strokeWidth={2.1} aria-hidden="true" />
              <span className="chat-thread-anchor-label">{t("scroll.previousMessage")}</span>
              <span className="chat-thread-anchor-text">{stickyMessagePreview}</span>
            </button>
          </div>
        ) : null}
        <div className="chat-inner">
          {messages.map((m) => (
            <div
              key={m.id}
              className="chat-message-slot"
              data-chat-message-id={m.id}
              data-chat-message-author={m.author}
            >
              <Message
                message={m}
                showActivityIndicator={
                  activityIndicatorMessageId === null || m.id === activityIndicatorMessageId
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="composer-wrap">
        <button
          type="button"
          className={`scroll-to-bottom ${isAtBottom ? "out" : "in"}`}
          onClick={scrollToBottom}
          aria-label={t("scroll.toBottom")}
          aria-hidden={isAtBottom}
        >
          <svg className="scroll-circle" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="16" />
          </svg>
          <span className="scroll-arrow">
            <ArrowDown size={15} strokeWidth={2.2} />
          </span>
        </button>

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

        <Composer
          onSend={sendMessage}
          onCaptureBrowserScreenshot={captureBrowserScreenshot}
          onCaptureWindowScreenshot={captureWindowScreenshot}
          modelControls={modelControls ?? null}
          permissionModeControls={permissionModeControls ?? null}
          onOpenModelSettings={openModelSettings}
          isTurnRunning={isTurnRunning}
          browserFollowModeEnabled={browserFollowModeEnabled}
          onToggleBrowserFollowMode={setBrowserFollowMode}
          onCancelTurn={cancelTurn}
          disabledReason={
            hasPendingClarification ? t("composer.answerClarificationFirst") : undefined
          }
        />
      </div>
    </>
  );
}
