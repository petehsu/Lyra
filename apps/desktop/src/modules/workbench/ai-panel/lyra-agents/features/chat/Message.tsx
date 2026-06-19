import { Copy, Link2, Undo2 } from "lucide-react";
import { memo, useState, type MouseEvent } from "react";
import {
  AGENT_FOLLOW_ACTIVITY_CONNECTING,
  type AgentRollbackPreviewResponse,
  type AgentRuntimeTurnState
} from "../../../../../../shared/agent";
import { writeClipboardText } from "../../../../../../shared/clipboard";
import type { ChatMessage } from "../../core/types";
import { useData } from "../../data/DataProvider";
import { ToolGroupBlock } from "../tools/ToolGroup";
import { BrailleSpinner } from "../../components/BrailleSpinner";
import { ThinkingIndicator, ToolExecutionIndicator } from "../../components/Icons";
import { ClickableImage, imagePreviewSource } from "../rich-text/ActionTargets";
import { StreamingText } from "../rich-text/StreamingText";
import { formatMessage, t } from "../../core/i18n";
import { AppButton } from "@renderer/ui/components";
import { MessageCitationText } from "./MessageCitationText";
import { textHasInlineContentMarkers } from "./message-citation";

/** Check if any tool group in the message is still running. */
export function isAgentMessageWorking(message: ChatMessage): boolean {
  return message.blocks.some(
    (b) => b.type === "tools" && b.group.status === "running"
  );
}

export function isEmptyPendingAgentMessage(message: ChatMessage): boolean {
  return (
    message.author === "agent" &&
    message.blocks.length > 0 &&
    message.blocks.every((b) => b.type === "text" && b.body.trim().length === 0)
  );
}

export function shouldShowAgentActivityIndicator(message: ChatMessage): boolean {
  return (
    message.author === "agent" &&
    (isEmptyPendingAgentMessage(message) || isAgentMessageWorking(message))
  );
}

export function resolveAgentActivityHostMessageId(
  messages: readonly ChatMessage[],
  isTurnRunning: boolean
): string | null {
  if (!isTurnRunning) return null;
  const reversed = [...messages].reverse();
  const active = reversed.find(shouldShowAgentActivityIndicator);
  if (active !== undefined) return active.id;
  return reversed.find((message) => message.author === "agent")?.id ?? null;
}

const normalizeFollowActivity = (
  activity: string | null | undefined
): AgentRuntimeTurnState | null => {
  if (activity === null || activity === undefined || activity.trim().length === 0) {
    return null;
  }
  const normalized = activity.trim().toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "calling_model":
    case "streaming_model":
    case "waiting_for_tool":
    case "retrying_provider":
      return normalized;
    default:
      return null;
  }
};

export const isRecognizedFollowActivity = (
  activity: string | null | undefined
): boolean => activity === AGENT_FOLLOW_ACTIVITY_CONNECTING || normalizeFollowActivity(activity) !== null;

const usesServiceStatusDots = (activity: string | null | undefined): boolean =>
  activity === AGENT_FOLLOW_ACTIVITY_CONNECTING ||
  normalizeFollowActivity(activity) === "retrying_provider";

// Equality check for the memoized agent message body. ChatMessage is a pure,
// JSON-serializable DTO produced by deterministic view-model code (stable key
// order), so a structural comparison via JSON.stringify is a sound content check.
// This is purely an optimization: a false "not equal" only causes a normal
// re-render, never a stale UI, because the body is a pure function of its props.
type AgentMessageProps = {
  message: ChatMessage;
  showActivityIndicator: boolean;
  activityIndicatorMessage: ChatMessage | null;
  highlightCitationTarget?: boolean;
  onContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onCiteMessage?: () => void;
};

const agentMessagePropsAreEqual = (prev: AgentMessageProps, next: AgentMessageProps): boolean => {
  if (prev.showActivityIndicator !== next.showActivityIndicator) return false;
  if (prev.activityIndicatorMessage?.id !== next.activityIndicatorMessage?.id) return false;
  if (JSON.stringify(prev.activityIndicatorMessage) !== JSON.stringify(next.activityIndicatorMessage)) {
    return false;
  }
  if (prev.message === next.message) return true;
  return JSON.stringify(prev.message) === JSON.stringify(next.message);
};

export const ServiceStatusDots = () => (
  <span className="lyra-agents-service-status-dots" aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);

function activeToolCall(message: ChatMessage) {
  for (const block of message.blocks) {
    if (block.type !== "tools" || block.group.status !== "running") continue;
    return block.group.currentCallId === undefined
      ? null
      : block.group.calls.find((call) => call.id === block.group.currentCallId) ?? null;
  }
  return null;
}

export function messageActivityIndicator(
  message: ChatMessage,
  followActivity: string | null | undefined
) {
  const toolCall = activeToolCall(message);
  if (toolCall?.kind === "thought") return <ThinkingIndicator />;

  const activity = normalizeFollowActivity(followActivity);
  if (activity === "waiting_for_tool" || toolCall !== null) {
    return <ToolExecutionIndicator />;
  }
  if (activity === "streaming_model") return <ThinkingIndicator />;
  if (usesServiceStatusDots(followActivity)) return <ServiceStatusDots />;
  return <BrailleSpinner />;
}

export function Message({
  message,
  showActivityIndicator = true,
  activityIndicatorMessage = null,
  highlightCitationTarget = false,
  onContextMenu,
  onCiteMessage
}: {
  message: ChatMessage;
  showActivityIndicator?: boolean;
  activityIndicatorMessage?: ChatMessage | null;
  highlightCitationTarget?: boolean;
  onContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onCiteMessage?: () => void;
}) {
  const {
    previewRollback,
    rollbackMessage,
    isTurnRunning,
    scrollToMessage,
    navigateToPageCitation,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    openFileInWorkbench
  } = useData();
  const [rollbackPreview, setRollbackPreview] = useState<AgentRollbackPreviewResponse | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const handleCopy = () => {
    const text = message.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { body: string }).body)
      .join("\n\n");
    void writeClipboardText(text);
  };

  const canRollback =
    message.rollback?.available === true &&
    message.author === "user" &&
    !isTurnRunning &&
    !rollbackBusy;

  const unavailableRollbackReason =
    isTurnRunning
      ? t("lyra-agents-message.rollbackCancelRunning")
      : message.rollback?.unavailableReason ?? t("lyra-agents-message.rollbackUnavailable");

  const openRollbackConfirm = async () => {
    if (!canRollback) {
      setRollbackError(unavailableRollbackReason);
      return;
    }
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      const preview = await previewRollback(message.id);
      if (!preview.available) {
        setRollbackError(preview.unavailableReason ?? t("lyra-agents-message.rollbackUnavailable"));
        setRollbackPreview(null);
        return;
      }
      setRollbackPreview(preview);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setRollbackBusy(false);
    }
  };

  const confirmRollback = async () => {
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      await rollbackMessage(message.id);
      setRollbackPreview(null);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setRollbackBusy(false);
    }
  };

  if (message.author === "user") {
    return (
      <div
        className="lyra-agents-message lyra-agents-message-user"
        data-message-id={message.id}
      >
        <div className="lyra-agents-message-content-user">
          <div
            className={`lyra-agents-message-bubble${highlightCitationTarget ? " lyra-agents-message-citation-target" : ""}`}
            onContextMenu={(event) => onContextMenu?.(event, message)}
          >
            {message.blocks.map((b) => {
              if (b.type === "text") {
                const transcriptCitations = message.transcriptCitations ?? [];
                const pageCitations = message.pageCitations ?? [];
                const inlineImages = message.inlineImages ?? [];
                const fileAttachments = message.fileAttachments ?? [];
                const renderCitations = textHasInlineContentMarkers(b.body);
                return (
                  <p
                    key={b.id}
                    className="lyra-agents-message-text"
                    data-message-block-id={b.id}
                  >
                    {renderCitations ? (
                      <MessageCitationText
                        text={b.body}
                        transcriptCitations={transcriptCitations}
                        pageCitations={pageCitations}
                        inlineImages={inlineImages}
                        fileAttachments={fileAttachments}
                        onTranscriptCitationClick={(citation) => {
                          void scrollToMessage(citation.messageId, {
                            blockId: citation.blockId ?? null,
                            startOffset: citation.startOffset ?? null
                          });
                        }}
                        onPageCitationClick={(citation) => {
                          void navigateToPageCitation(citation);
                        }}
                        onImageAttachmentClick={(image) => {
                          if (!canOpenImageInWorkbench(image)) {
                            return;
                          }
                          void openImageInWorkbench(image);
                        }}
                        onFileAttachmentClick={(file) => {
                          void openFileInWorkbench(file.path);
                        }}
                      />
                    ) : (
                      b.body
                    )}
                  </p>
                );
              }
              if (b.type === "image") {
                const src = imagePreviewSource(b.image);
                return (
                  <figure key={b.id} className="lyra-agents-message-image">
                    <ClickableImage
                      src={src}
                      image={b.image}
                      alt={b.image.label ?? t("lyra-agents-message.imageAttachment")}
                    />
                    {b.image.label !== undefined && b.image.label !== null ? (
                      <figcaption>{b.image.label}</figcaption>
                    ) : null}
                  </figure>
                );
              }
              return null;
            })}
          </div>
          {message.time && (
            <span className="lyra-agents-message-time lyra-agents-message-time-user">
              <span className="lyra-agents-time-text">{message.time}</span>
              <span className="lyra-agents-time-actions">
                <span className="lyra-agents-time-copy" onClick={handleCopy} role="button" aria-label={t("lyra-agents-message.copy")}>
                  <Copy size={12} strokeWidth={2} />
                </span>
                <span
                  className="lyra-agents-time-copy"
                  onClick={() => onCiteMessage?.()}
                  role="button"
                  aria-label={t("lyra-agents-message.citeMessage")}
                  title={t("lyra-agents-message.citeMessage")}
                >
                  <Link2 size={12} strokeWidth={2} />
                </span>
                {message.rollback?.available === true ? (
                  <span
                    className="lyra-agents-time-copy"
                    onClick={openRollbackConfirm}
                    role="button"
                    aria-disabled={!canRollback}
                    aria-label={t("lyra-agents-message.undoMessage")}
                    title={canRollback ? t("lyra-agents-message.rollbackTitle") : unavailableRollbackReason}
                  >
                    <Undo2 size={12} strokeWidth={2} />
                  </span>
                ) : null}
              </span>
            </span>
          )}
          {(rollbackPreview !== null || rollbackError !== null) && (
            <div className="lyra-agents-message-rollback-popover" role="dialog" aria-label={t("lyra-agents-message.rollbackConfirm")}>
              {rollbackPreview !== null ? (
                <>
                  <div className="lyra-agents-message-rollback-title">{t("lyra-agents-message.rollbackTitle")}</div>
                  <div className="lyra-agents-message-rollback-body">
                    {formatMessage("lyra-agents-message.rollbackBody", {
                      messages: rollbackPreview.removedMessageCount,
                      files: rollbackPreview.changedFiles.length
                    })}
                  </div>
                  {rollbackPreview.changedFiles.length > 0 ? (
                    <div className="lyra-agents-message-rollback-files">
                      {rollbackPreview.changedFiles.slice(0, 4).map((file) => (
                        <span key={file.path}>{file.path}</span>
                      ))}
                      {rollbackPreview.changedFiles.length > 4 ? (
                        <span>
                          {formatMessage("lyra-agents-message.rollbackMoreFiles", {
                            count: rollbackPreview.changedFiles.length - 4
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="lyra-agents-message-rollback-actions">
                    <AppButton variant="ghost" size="sm" type="button" onClick={() => setRollbackPreview(null)} disabled={rollbackBusy}>
                      {t("lyra-agents-message.rollbackCancel")}
                    </AppButton>
                    <AppButton variant="ghost" size="sm" type="button" onClick={confirmRollback} disabled={rollbackBusy}>
                      {rollbackBusy ? t("lyra-agents-message.rollbackBusy") : t("lyra-agents-message.rollbackAction")}
                    </AppButton>
                  </div>
                </>
              ) : (
                <>
                  <div className="lyra-agents-message-rollback-title">{t("lyra-agents-message.rollbackErrorTitle")}</div>
                  <div className="lyra-agents-message-rollback-body">{rollbackError}</div>
                  <div className="lyra-agents-message-rollback-actions">
                    <AppButton variant="ghost" size="sm" type="button" onClick={() => setRollbackError(null)}>{t("lyra-agents-message.rollbackClose")}</AppButton>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <AgentMessage
      message={message}
      showActivityIndicator={showActivityIndicator}
      activityIndicatorMessage={activityIndicatorMessage}
      {...(highlightCitationTarget ? { highlightCitationTarget } : {})}
      {...(onContextMenu === undefined ? {} : { onContextMenu })}
      {...(onCiteMessage === undefined ? {} : { onCiteMessage })}
    />
  );
}

// Agent-message rendering is the hot path during streaming: the chat list rebuilds
// every ChatMessage object on every token, so this body is memoized with a
// content-based equality check. Unchanged earlier messages produce structurally
// identical props each token and are skipped; only the actively-streaming message
// (whose blocks change) re-renders. This is a pure render with no context
// subscription, so the memo is not pierced by per-token context churn.
const AgentMessage = memo(function AgentMessage({
  message,
  showActivityIndicator,
  activityIndicatorMessage,
  highlightCitationTarget = false,
  onContextMenu,
  onCiteMessage
}: AgentMessageProps) {
  const { isTurnRunning, followActivity } = useData();
  const working = isAgentMessageWorking(message);
  const streamingTextActive = isTurnRunning || working;
  const activitySource = activityIndicatorMessage ?? message;
  const textBlocks = message.blocks.filter((b) => b.type === "text");
  const lastBlock = message.blocks.at(-1);
  const lastTextId = textBlocks.at(-1)?.id ?? null;
  const lastBlockIsText = lastBlock?.type === "text";
  const isEmptyPendingAgent = isEmptyPendingAgentMessage(message);
  const hasTextBlocks = textBlocks.some((b) => b.body.trim().length > 0);
  const hasImages = message.blocks.some((b) => b.type === "image");
  const showRespondingStatus =
    showActivityIndicator &&
    isTurnRunning &&
    (isRecognizedFollowActivity(followActivity) ||
      isAgentMessageWorking(activitySource) ||
      isEmptyPendingAgentMessage(activitySource));

  const handleCopy = () => {
    const text = message.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { body: string }).body)
      .join("\n\n");
    void writeClipboardText(text);
  };

  if (isEmptyPendingAgent && !showActivityIndicator) {
    return null;
  }

  return (
    <div
      className="lyra-agents-message lyra-agents-message-agent"
      data-message-id={message.id}
    >
      <div
        className={`lyra-agents-message-body${highlightCitationTarget ? " lyra-agents-message-citation-target" : ""}`}
        onContextMenu={(event) => onContextMenu?.(event, message)}
      >
        {isEmptyPendingAgent ? null : (
          message.blocks.map((b) => {
            if (b.type === "text") {
              // Only stream text that is actively being written (trailing block).
              // Avoid re-animating earlier narration when a new tool round starts.
              const isLastText = b.id === lastTextId;
              const isStreamingHost = showActivityIndicator && streamingTextActive;
              const shouldStream = isStreamingHost && isLastText && lastBlockIsText;
              return (
                <div
                  key={b.id}
                  className="lyra-agents-message-text-block"
                  data-message-block-id={b.id}
                >
                  <StreamingText content={b.body} streaming={shouldStream} />
                </div>
              );
            }
            if (b.type === "image") {
              const src = imagePreviewSource(b.image);
              return (
                <figure key={b.id} className="lyra-agents-message-image lyra-agents-message-image-agent">
                  <ClickableImage
                    src={src}
                    image={b.image}
                    alt={b.image.label ?? t("lyra-agents-message.imageAttachment")}
                  />
                  {b.image.label !== undefined && b.image.label !== null ? (
                    <figcaption>{b.image.label}</figcaption>
                  ) : null}
                </figure>
              );
            }
            return <ToolGroupBlock key={b.id} group={b.group} />;
          })
        )}
        {showRespondingStatus ? (
          <span className="lyra-agents-message-time lyra-agents-message-time-agent" aria-label={t("lyra-agents-message.agentResponding")}>
            {messageActivityIndicator(activitySource, followActivity)}
          </span>
        ) : (message.time && (hasTextBlocks || hasImages)) ? (
          <span className="lyra-agents-message-time lyra-agents-message-time-agent">
            <span className="lyra-agents-time-text">{message.time}</span>
            <span className="lyra-agents-time-actions">
              <span className="lyra-agents-time-copy" onClick={handleCopy} role="button" aria-label={t("lyra-agents-message.copy")}>
                <Copy size={12} strokeWidth={2} />
              </span>
              <span
                className="lyra-agents-time-copy"
                onClick={() => onCiteMessage?.()}
                role="button"
                aria-label={t("lyra-agents-message.citeMessage")}
                title={t("lyra-agents-message.citeMessage")}
              >
                <Link2 size={12} strokeWidth={2} />
              </span>
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}, agentMessagePropsAreEqual);
