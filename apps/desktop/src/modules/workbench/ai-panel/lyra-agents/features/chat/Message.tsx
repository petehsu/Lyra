import { ChevronDown, ChevronUp, Copy, Link2, Undo2 } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import {
  AGENT_FOLLOW_ACTIVITY_CONNECTING,
  type AgentRollbackPreviewResponse,
  type AgentRuntimeTurnState
} from "../../../../../../shared/agent";
import { writeClipboardText } from "../../../../../../shared/clipboard";
import type { ChatMessage, MessageBlock, ToolCall, ToolDetails, ToolGroup } from "../../core/types";
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

type AgentMessageProps = {
  message: ChatMessage;
  showActivityIndicator: boolean;
  activityIndicatorMessage: ChatMessage | null;
  isTurnRunning: boolean;
  followActivity: string | null | undefined;
  highlightCitationTarget?: boolean;
  onContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onCiteMessage?: () => void;
};

const rollbackEqual = (
  left: ChatMessage["rollback"] | undefined,
  right: ChatMessage["rollback"] | undefined
): boolean => {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  return left.available === right.available &&
    left.anchorId === right.anchorId &&
    left.checkpointAt === right.checkpointAt &&
    left.unavailableReason === right.unavailableReason;
};

const diffLinesEqual = (
  left: readonly { kind: string; text: string }[],
  right: readonly { kind: string; text: string }[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a?.kind !== b?.kind || a?.text !== b?.text) return false;
  }
  return true;
};

const diffHunksEqual = (
  left: readonly { startLine: number; lines: readonly { kind: string; text: string }[] }[],
  right: readonly { startLine: number; lines: readonly { kind: string; text: string }[] }[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a?.startLine !== b?.startLine) return false;
    if (!diffLinesEqual(a?.lines ?? [], b?.lines ?? [])) return false;
  }
  return true;
};

const searchResultsEqual = (
  left: readonly { file: string; line: number; text: string }[],
  right: readonly { file: string; line: number; text: string }[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a?.file !== b?.file || a?.line !== b?.line || a?.text !== b?.text) {
      return false;
    }
  }
  return true;
};

const webResultsEqual = (
  left: readonly { title: string; url: string; snippet?: string }[] | undefined,
  right: readonly { title: string; url: string; snippet?: string }[] | undefined
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a?.title !== b?.title || a?.url !== b?.url || a?.snippet !== b?.snippet) {
      return false;
    }
  }
  return true;
};

const stringArraysEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const workbenchTabsEqual = (
  left: readonly { title: string; tabId: string; kind: string; flags: readonly string[]; url?: string; excerpt?: string }[] | undefined,
  right: readonly { title: string; tabId: string; kind: string; flags: readonly string[]; url?: string; excerpt?: string }[] | undefined
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a?.title !== b?.title ||
      a?.tabId !== b?.tabId ||
      a?.kind !== b?.kind ||
      a?.url !== b?.url ||
      a?.excerpt !== b?.excerpt ||
      a === undefined ||
      b === undefined ||
      !stringArraysEqual(a.flags, b.flags)
    ) {
      return false;
    }
  }
  return true;
};

const unknownArrayEqual = (
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!unknownValueEqual(left[index], right[index])) return false;
  }
  return true;
};

const unknownRecordEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!unknownValueEqual(left[key], right[key])) return false;
  }
  return true;
};

function unknownValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return left === right;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      unknownArrayEqual(left, right);
  }
  if (typeof left === "object" && typeof right === "object") {
    return unknownRecordEqual(
      left as Record<string, unknown>,
      right as Record<string, unknown>
    );
  }
  return false;
}

const resolveFinalSummaryBlockId = (message: ChatMessage): string | null => {
  if (message.isApiError === true || isAgentMessageWorking(message)) return null;
  const lastBlock = message.blocks.at(-1);
  if (lastBlock?.type !== "text" || lastBlock.body.trim().length === 0) return null;
  const precedingBlocks = message.blocks.slice(0, -1);
  if (!precedingBlocks.some((block) => block.type === "tools")) return null;
  return lastBlock.id;
};

const formatProcessDuration = (durationMs: number | undefined): string | null => {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return formatMessage("lyra-agents-message.durationSeconds", { count: seconds });
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return formatMessage("lyra-agents-message.durationMinutes", { count: minutes });
  }
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) {
    return formatMessage("lyra-agents-message.durationHours", { count: hours });
  }
  return formatMessage("lyra-agents-message.durationDays", {
    count: Math.max(1, Math.round(hours / 24))
  });
};

const taskItemsEqual = (
  left: readonly { title: string; status: string }[],
  right: readonly { title: string; status: string }[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a?.title !== b?.title || a?.status !== b?.status) return false;
  }
  return true;
};

const toolDetailsEqual = (left: ToolDetails | undefined, right: ToolDetails | undefined): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  if (left.type !== right.type) return false;

  switch (left.type) {
    case "edit":
      return right.type === "edit" &&
        left.file === right.file &&
        left.additions === right.additions &&
        left.deletions === right.deletions &&
        diffHunksEqual(left.hunks, right.hunks);
    case "read":
      return right.type === "read" &&
        left.file === right.file &&
        left.range === right.range &&
        left.preview === right.preview;
    case "search":
      return right.type === "search" &&
        left.query === right.query &&
        searchResultsEqual(left.results, right.results);
    case "shell":
      return right.type === "shell" &&
        left.command === right.command &&
        left.output === right.output &&
        left.exitCode === right.exitCode;
    case "terminal":
      return right.type === "terminal" &&
        left.action === right.action &&
        left.target === right.target &&
        left.output === right.output &&
        left.cursor === right.cursor &&
        left.sessionId === right.sessionId &&
        left.terminalTabId === right.terminalTabId &&
        left.paneId === right.paneId &&
        left.command === right.command &&
        left.wrote === right.wrote &&
        left.reason === right.reason &&
        left.running === right.running &&
        left.exitCode === right.exitCode &&
        left.truncated === right.truncated;
    case "web":
      return right.type === "web" &&
        left.url === right.url &&
        left.summary === right.summary &&
        left.screenshot === right.screenshot &&
        left.query === right.query &&
        left.title === right.title &&
        left.fetchedBytes === right.fetchedBytes &&
        webResultsEqual(left.results, right.results);
    case "workbench":
      return right.type === "workbench" &&
        left.action === right.action &&
        left.label === right.label &&
        left.excerpt === right.excerpt &&
        left.text === right.text &&
        workbenchTabsEqual(left.tabs, right.tabs) &&
        workbenchTabsEqual(left.tab === undefined ? undefined : [left.tab], right.tab === undefined ? undefined : [right.tab]);
    case "lumen":
      return right.type === "lumen" &&
        left.action === right.action &&
        left.targetMode === right.targetMode &&
        left.text === right.text &&
        left.screenshot === right.screenshot &&
        left.peek.excerpt === right.peek.excerpt &&
        stringArraysEqual(left.peek.chips, right.peek.chips) &&
        unknownValueEqual(left.peek.thumbnail, right.peek.thumbnail) &&
        unknownArrayEqual(left.targets, right.targets);
    case "software":
      return right.type === "software" &&
        left.action === right.action &&
        left.softwareId === right.softwareId &&
        left.actionId === right.actionId &&
        left.text === right.text &&
        unknownArrayEqual(left.targets, right.targets);
    case "task":
      return right.type === "task" && taskItemsEqual(left.tasks, right.tasks);
    case "text":
      return right.type === "text" && left.body === right.body;
    case "ask":
      return right.type === "ask" &&
        left.question === right.question &&
        left.answer === right.answer;
    default:
      return false;
  }
};

const toolCallsEqual = (
  left: readonly ToolCall[],
  right: readonly ToolCall[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a?.id !== b?.id ||
      a?.kind !== b?.kind ||
      a?.title !== b?.title ||
      a?.status !== b?.status ||
      a?.traceId !== b?.traceId ||
      a?.failureReason !== b?.failureReason ||
      !toolDetailsEqual(a?.details, b?.details) ||
      !unknownArrayEqual(a?.trace, b?.trace) ||
      !unknownArrayEqual(a?.artifactRefs, b?.artifactRefs) ||
      !unknownArrayEqual(a?.artifactTargets, b?.artifactTargets) ||
      !unknownArrayEqual(a?.artifactPreviews, b?.artifactPreviews) ||
      !unknownArrayEqual(a?.changes, b?.changes)
    ) {
      return false;
    }
  }
  return true;
};

const toolGroupEqual = (left: ToolGroup, right: ToolGroup): boolean => {
  if (left === right) return true;
  return left.id === right.id &&
    left.status === right.status &&
    left.label === right.label &&
    left.hint === right.hint &&
    left.currentCallId === right.currentCallId &&
    toolCallsEqual(left.calls, right.calls);
};

const messageBlockEqual = (left: MessageBlock, right: MessageBlock): boolean => {
  if (left === right) return true;
  if (left.type !== right.type || left.id !== right.id) return false;
  switch (left.type) {
    case "text":
      return right.type === "text" &&
        left.body === right.body;
    case "image":
      return right.type === "image" &&
        left.image.id === right.image.id &&
        left.image.mediaType === right.image.mediaType &&
        left.image.data === right.image.data &&
        left.image.label === right.image.label &&
        left.image.source === right.image.source &&
        left.image.width === right.image.width &&
        left.image.height === right.image.height &&
        left.image.workspaceTabId === right.image.workspaceTabId &&
        left.image.workspaceTabTitle === right.image.workspaceTabTitle &&
        left.image.workspaceTabPageKind === right.image.workspaceTabPageKind &&
        left.image.workspaceTabAddress === right.image.workspaceTabAddress;
    case "tools":
      return right.type === "tools" && toolGroupEqual(left.group, right.group);
    default:
      return false;
  }
};

const chatMessageEqual = (
  left: ChatMessage | null,
  right: ChatMessage | null
): boolean => {
  if (left === right) return true;
  if (left === null || right === null) return left === right;
  if (
    left.id !== right.id ||
    left.author !== right.author ||
    left.isApiError !== right.isApiError ||
    left.time !== right.time ||
    left.workDurationMs !== right.workDurationMs ||
    left.blocks.length !== right.blocks.length ||
    !rollbackEqual(left.rollback, right.rollback)
  ) {
    return false;
  }
  for (let index = 0; index < left.blocks.length; index += 1) {
    const a = left.blocks[index];
    const b = right.blocks[index];
    if (a === undefined || b === undefined || !messageBlockEqual(a, b)) {
      return false;
    }
  }
  return true;
};

// Agent streaming is the chat render hot path. Avoid JSON.stringify here:
// it allocates and gets more expensive with every generated token.
const agentMessagePropsAreEqual = (prev: AgentMessageProps, next: AgentMessageProps): boolean => {
  if (prev.showActivityIndicator !== next.showActivityIndicator) return false;
  if (prev.isTurnRunning !== next.isTurnRunning) return false;
  if (prev.followActivity !== next.followActivity) return false;
  if (prev.highlightCitationTarget !== next.highlightCitationTarget) return false;
  if (prev.onContextMenu !== next.onContextMenu) return false;
  if (prev.onCiteMessage !== next.onCiteMessage) return false;
  return chatMessageEqual(prev.activityIndicatorMessage, next.activityIndicatorMessage) &&
    chatMessageEqual(prev.message, next.message);
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
    followActivity,
    scrollToMessage,
    navigateToPageCitation,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    openFileInWorkbench
  } = useData();
  const [rollbackPreview, setRollbackPreview] = useState<AgentRollbackPreviewResponse | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [userBubbleExpanded, setUserBubbleExpanded] = useState(false);
  const [userBubbleOverflowing, setUserBubbleOverflowing] = useState(false);
  const userBubbleRef = useRef<HTMLDivElement>(null);
  // Signature of the user message's text so overflow is re-measured only when
  // the rendered content changes (user messages are immutable once sent).
  // ponytail: does not re-measure on live panel-width changes — acceptable
  // because the bubble content never reflows after send.
  const userTextSignature =
    message.author === "user"
      ? message.blocks.map((b) => (b.type === "text" ? b.body : b.type)).join("\u0001")
      : "";
  useLayoutEffect(() => {
    if (message.author !== "user") return;
    const el = userBubbleRef.current;
    if (el === null) return;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 14;
    const lineHeight = cs.lineHeight.endsWith("px")
      ? parseFloat(cs.lineHeight)
      : fontSize * 1.5;
    // ~10 lines of text plus the bubble's vertical padding (8px each side).
    // scrollHeight reports full content height even while max-height clips it.
    const collapsedMax = lineHeight * 10 + 16;
    setUserBubbleOverflowing(el.scrollHeight > collapsedMax + lineHeight * 0.5);
  }, [message.author, userTextSignature]);

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
            ref={userBubbleRef}
            className={`lyra-agents-message-bubble${highlightCitationTarget ? " lyra-agents-message-citation-target" : ""}${userBubbleOverflowing && !userBubbleExpanded ? " lyra-agents-message-bubble-collapsed" : ""}`}
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
          {(message.time || userBubbleOverflowing) && (
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
                {userBubbleOverflowing ? (
                  <span
                    className="lyra-agents-time-copy"
                    onClick={() => setUserBubbleExpanded((open) => !open)}
                    role="button"
                    aria-expanded={userBubbleExpanded}
                    aria-label={userBubbleExpanded ? t("lyra-agents-message.collapse") : t("lyra-agents-message.expand")}
                    title={userBubbleExpanded ? t("lyra-agents-message.collapse") : t("lyra-agents-message.expand")}
                  >
                    {userBubbleExpanded ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
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
      isTurnRunning={isTurnRunning}
      followActivity={followActivity}
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
// (whose blocks change) re-renders.
const AgentMessage = memo(function AgentMessage({
  message,
  showActivityIndicator,
  activityIndicatorMessage,
  isTurnRunning,
  followActivity,
  highlightCitationTarget = false,
  onContextMenu,
  onCiteMessage
}: AgentMessageProps) {
  const working = isAgentMessageWorking(message);
  const streamingTextActive = isTurnRunning || working;
  const activitySource = activityIndicatorMessage ?? message;
  const textBlocks = message.blocks.filter((b) => b.type === "text");
  const lastTextId = textBlocks.at(-1)?.id ?? null;
  const finalSummaryBlockId = !isTurnRunning
    ? resolveFinalSummaryBlockId(message)
    : null;
  const preSummaryBlocks = finalSummaryBlockId === null
    ? []
    : message.blocks.filter((block) => block.id !== finalSummaryBlockId);
  const [preSummaryOpen, setPreSummaryOpen] = useState(false);
  const processDuration = formatProcessDuration(message.workDurationMs);
  const processFoldLabel = processDuration === null
    ? t("lyra-agents-message.processFold")
    : formatMessage("lyra-agents-message.processWorked", { duration: processDuration });
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

  const renderAgentBlock = (b: MessageBlock) => {
    if (b.type === "text") {
      // Only stream text that is actively being written (trailing text
      // block). Avoid re-animating earlier narration when a new tool
      // round starts. NOTE: we intentionally do NOT require the last
      // block overall to be text — when a tool block lands after the
      // current sentence (`[text, tool]`), the last *text* block is
      // still being streamed and must keep updating, otherwise it freezes
      // until the tool finishes.
      const isLastText = b.id === lastTextId;
      const isStreamingHost = showActivityIndicator && streamingTextActive;
      const shouldStream = isStreamingHost && isLastText;
      return (
        <div
          key={b.id}
          className="lyra-agents-message-text-block"
          data-message-block-id={b.id}
        >
          <StreamingText
            content={b.body}
            streaming={shouldStream}
          />
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
  };

  const renderedBlocks = finalSummaryBlockId === null
    ? message.blocks.map(renderAgentBlock)
    : (
        <>
          <div className={`lyra-agents-message-process-fold ${preSummaryOpen ? "open" : ""}`}>
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              className="lyra-agents-message-process-fold-head"
              onClick={() => setPreSummaryOpen((open) => !open)}
              aria-expanded={preSummaryOpen}
            >
              <span className="lyra-agents-message-process-fold-line" aria-hidden="true" />
              <span className="lyra-agents-message-process-fold-label">{processFoldLabel}</span>
              <span className="lyra-agents-message-process-fold-line" aria-hidden="true" />
            </AppButton>
            <div className="lyra-agents-collapse" data-open={preSummaryOpen}>
              <div className="lyra-agents-collapse-inner">
                <div className="lyra-agents-message-process-fold-body">
                  {preSummaryBlocks.map(renderAgentBlock)}
                </div>
              </div>
            </div>
          </div>
          {message.blocks
            .filter((block) => block.id === finalSummaryBlockId)
            .map(renderAgentBlock)}
        </>
      );

  return (
    <div
      className={`lyra-agents-message lyra-agents-message-agent${message.isApiError === true ? " lyra-agents-message-agent-error" : ""}`}
      data-message-id={message.id}
    >
      <div
        className={`lyra-agents-message-body${highlightCitationTarget ? " lyra-agents-message-citation-target" : ""}`}
        onContextMenu={(event) => onContextMenu?.(event, message)}
      >
        {isEmptyPendingAgent ? null : renderedBlocks}
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
