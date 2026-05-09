import { memo, type ReactNode } from "react";

import { LyraBrandLogo } from "../brand";
import type { WorkbenchLocale } from "../i18n";
import type {
  AgentApplyPatchResult,
  AgentExecuteMessageRollbackRequest,
  AgentExecuteMessageRollbackResult,
  AgentMessage,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentResolveClarificationRequest,
  AgentResolveClarificationResult,
  AgentResolvePlanReviewRequest,
  AgentResolvePlanReviewResult,
  AgentRuntimeEvent,
  AgentSessionDetail,
} from "./agent-ui-types";
import { AiPanelEmptyGreetingRotator } from "./empty-greeting-rotator";
import { InlineMessageContent } from "./inline-message-content";
import {
  changedFilesSummary,
  extractChangedFiles,
  extractPatchProposalEvent,
  isRecord,
  readBoolean,
  readNumber,
  readString,
} from "./patch-artifact";
import { AiPanelRichContent } from "./rich-content";
import { SpinnerLabel } from "./stream-spinner";
import {
  buildTimelineRuntimeActionItems,
  TimelineRuntimeAction,
  type TimelineRuntimeActionItem,
} from "./timeline-runtime-action";
import { ToolCallGroup, type DeduplicatedToolCall } from "./tool-call-group";
import type { ReadPatchArtifact } from "./use-patch-artifact";
import type { OptimisticUserMessage } from "./use-lyra-thread-runtime";

type AiPanelThreadViewProps = {
  readonly logoUrl: string;
  readonly blinkLogoUrl?: string | undefined;
  readonly emptyThreadLabel: string;
  readonly emptyGreetingLabels?: readonly string[] | undefined;
  readonly locale?: WorkbenchLocale | undefined;
  readonly detail: AgentSessionDetail | null;
  readonly optimisticUserMessages?: readonly OptimisticUserMessage[] | undefined;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly isLoading: boolean;
  readonly runtimeError: string | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?: ((request: {
    readonly sessionId: string;
    readonly artifactId?: string;
    readonly patchRef?: string;
  }) => Promise<AgentApplyPatchResult>) | undefined;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
  readonly resolveClarification?:
    | ((request: AgentResolveClarificationRequest) => Promise<AgentResolveClarificationResult>)
    | undefined;
  readonly resolvePlanReview?:
    | ((request: AgentResolvePlanReviewRequest) => Promise<AgentResolvePlanReviewResult>)
    | undefined;
  readonly executeMessageRollback?:
    | ((request: AgentExecuteMessageRollbackRequest) => Promise<AgentExecuteMessageRollbackResult>)
    | undefined;
  readonly onClarificationResolved?: (() => Promise<void> | void) | undefined;
  readonly onRollbackExecuted?: (() => Promise<void> | void) | undefined;
  readonly renderMessageActions?: ((message: AgentMessage) => ReactNode) | undefined;
};

const messageText = (message: AgentMessage): string =>
  (message.displayContent ?? message.content).trim();

/* ── Turn group model ─────────────────────────────────────── */

const TOOL_EVENT_PHASES = new Set([
  "tool_operation_started",
  "tool_operation_completed",
  "tool_operation_failed",
]);

const MODEL_TEXT_PHASES = new Set([
  "model_stream_delta",
  "model_text_delta",
  "model_stream_reset",
]);

const modelTextSegmentStartAt = (
  events: readonly AgentRuntimeEvent[],
  turnId: string | undefined,
  fallback: number
): number => {
  if (turnId === undefined) {
    return fallback;
  }
  const ordered = events
    .filter((event) => event.turnId === turnId && MODEL_TEXT_PHASES.has(event.phase))
    .sort((left, right) => left.timestamp - right.timestamp);
  let segmentStart: number | null = null;
  for (const event of ordered) {
    if (event.phase === "model_stream_reset") {
      segmentStart = null;
      continue;
    }
    if (segmentStart === null) {
      segmentStart = event.timestamp;
    }
  }
  return segmentStart ?? fallback;
};

type TurnResponseItem =
  | { readonly kind: "assistantMessage"; readonly sortRank: number; readonly message: AgentMessage }
  | { readonly kind: "runtimeAction"; readonly sortRank: number; readonly action: TimelineRuntimeActionItem }
  | { readonly kind: "liveAssistant"; readonly sortRank: number; readonly text: string };

type TurnGroup = {
  readonly turnId: string;
  readonly userMessages: readonly AgentMessage[];
  readonly toolCalls: readonly DeduplicatedToolCall[];
  readonly responseItems: readonly TurnResponseItem[];
};

const toolEventToCall = (event: AgentRuntimeEvent): {
  readonly opId: string;
  readonly toolPath: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly status: "running" | "done" | "error";
  readonly timestamp: number;
} => {
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : {};
  const toolPath = readString(operation.toolPath)
    ?? readString(operation.path)
    ?? readString(result.path)
    ?? "/tools";
  const opId = readString(operation.opId) ?? `${event.turnId}:${String(event.timestamp)}`;
  const summary = readString(result.summary)
    ?? readString(operation.summary)
    ?? (event.phase === "tool_operation_started" ? `Running ${toolPath}` : "ToolFS event");
  const truncated = readBoolean(result.truncated);
  const resultRef = readString(result.resultRef);
  const patchRef = readString(result.patchRef);
  const artifactId = readString(result.artifactId);
  const evidenceId = readString(result.evidenceId);
  const contentBytes = readNumber(result.contentBytes);
  const patchDetail = toolPath.includes("/propose_patch") || patchRef !== null || artifactId !== null
    ? [
        changedFilesSummary(extractChangedFiles(result.changedFiles)),
        patchRef === null ? resultRef : `patch ${patchRef}`,
        artifactId === null ? null : `artifact ${artifactId}`,
        evidenceId === null ? null : `evidence ${evidenceId}`,
        truncated ? "truncated" : null,
      ].filter((value): value is string => value !== null).join(" · ")
    : "";
  const resultDetail = patchDetail.length > 0
    ? patchDetail
    : [
        resultRef,
        truncated ? "truncated" : null,
        contentBytes === null ? null : `${String(contentBytes)} bytes`,
      ].filter((value): value is string => value !== null).join(" · ");
  const detail = readString(result.errorMessage)
    ?? readString(result.errorCode)
    ?? (resultDetail.length > 0 ? resultDetail : toolPath);
  const status: "running" | "done" | "error" =
    event.phase === "tool_operation_failed"
      ? "error"
      : event.phase === "tool_operation_started"
        ? "running"
        : "done";
  return { opId, toolPath, summary, detail, status, timestamp: event.timestamp };
};

const deduplicateToolEvents = (events: readonly AgentRuntimeEvent[]): DeduplicatedToolCall[] => {
  const byOpId = new Map<string, DeduplicatedToolCall>();
  const ordered: string[] = [];
  for (const event of events) {
    const call = toolEventToCall(event);
    const patchProposal = extractPatchProposalEvent(event);
    const existing = byOpId.get(call.opId);
    if (existing === undefined) {
      ordered.push(call.opId);
      byOpId.set(call.opId, { ...call, patchProposal });
    } else {
      const betterStatus =
        call.status === "done" || call.status === "error" || existing.status === "running";
      if (betterStatus) {
        byOpId.set(call.opId, {
          ...call,
          patchProposal: patchProposal ?? existing.patchProposal,
        });
      }
    }
  }
  return ordered.map((opId) => byOpId.get(opId)!);
};

const buildTurnGroups = (
  detail: AgentSessionDetail | null,
  optimisticUserMessages: readonly OptimisticUserMessage[],
  liveAssistant: { readonly turnId: string; readonly text: string } | null
): readonly TurnGroup[] => {
  const sessionMessages = detail?.messages ?? [];
  const events = detail?.runtimeEvents ?? [];
  const allMessages = [...sessionMessages, ...optimisticUserMessages];
  const runtimeActionItems = buildTimelineRuntimeActionItems(detail);

  const turnIds: string[] = [];
  const turnIdSet = new Set<string>();

  const addTurnId = (turnId: string) => {
    if (!turnIdSet.has(turnId)) {
      turnIdSet.add(turnId);
      turnIds.push(turnId);
    }
  };

  for (const message of allMessages) {
    const turnId = message.turnId ?? message.id;
    addTurnId(turnId);
  }
  for (const event of events) {
    if (TOOL_EVENT_PHASES.has(event.phase)) {
      addTurnId(event.turnId);
    }
  }
  for (const action of runtimeActionItems) {
    const turnId = extractRuntimeActionTurnId(action);
    if (turnId !== null) {
      addTurnId(turnId);
    }
  }
  if (liveAssistant !== null && !turnIdSet.has(liveAssistant.turnId)) {
    addTurnId(liveAssistant.turnId);
  }

  const groups: TurnGroup[] = [];

  for (const turnId of turnIds) {
    const userMsgs = allMessages.filter(
      (m) => (m.turnId ?? m.id) === turnId && m.role !== "assistant"
    );
    const assistantMsgs = allMessages.filter(
      (m) => m.turnId === turnId && m.role === "assistant"
    );
    const turnToolEvents = events.filter(
      (e) => e.turnId === turnId && TOOL_EVENT_PHASES.has(e.phase)
    );
    const toolCalls = deduplicateToolEvents(turnToolEvents);
    const turnActions = runtimeActionItems.filter(
      (a) => extractRuntimeActionTurnId(a) === turnId
    );
    const isLiveTurn = liveAssistant !== null && liveAssistant.turnId === turnId;
    const hasLiveText = isLiveTurn && !assistantMsgs.some(
      (m) => m.role === "assistant"
    );

    const responseItems: TurnResponseItem[] = [];
    for (const msg of assistantMsgs) {
      const sortRank = modelTextSegmentStartAt(events, msg.turnId, msg.createdAt);
      responseItems.push({ kind: "assistantMessage", sortRank, message: msg });
    }
    for (const action of turnActions) {
      responseItems.push({ kind: "runtimeAction", sortRank: action.createdAt, action });
    }
    if (hasLiveText) {
      const liveRank = modelTextSegmentStartAt(events, turnId, Date.now());
      responseItems.push({
        kind: "liveAssistant",
        sortRank: liveRank,
        text: liveAssistant!.text,
      });
    }
    responseItems.sort((a, b) => a.sortRank - b.sortRank);

    groups.push({
      turnId,
      userMessages: userMsgs,
      toolCalls,
      responseItems,
    });
  }

  const orphanActions = runtimeActionItems.filter(
    (a) => extractRuntimeActionTurnId(a) === null
  );
  if (orphanActions.length > 0) {
    groups.push({
      turnId: "__orphan__",
      userMessages: [],
      toolCalls: [],
      responseItems: orphanActions.map((action) => ({
        kind: "runtimeAction" as const,
        sortRank: action.createdAt,
        action,
      })),
    });
  }

  return groups;
};

const extractRuntimeActionTurnId = (
  action: TimelineRuntimeActionItem,
): string | null => action.turnId;

/* ── Presentation components ─────────────────────────────── */

const formatMessageTime = (timestamp: number, locale: string): string => {
  try {
    return new Date(timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const AiPanelAssistantGeneratingIndicator = () => (
  <span className="lyra-ai-agent-generating-indicator" aria-label="Lyra is responding">
    <SpinnerLabel size="sm" tone="muted" label="" />
  </span>
);

const AiPanelMessageFooter = ({
  role,
  createdAt,
  locale,
  actions,
  live,
}: {
  readonly role: "assistant" | "user";
  readonly createdAt: number;
  readonly locale: WorkbenchLocale;
  readonly actions?: ReactNode;
  readonly live: boolean;
}) => {
  const timeLabel = formatMessageTime(createdAt, locale);
  const hasActions = actions !== undefined && actions !== null;
  const showTime = !live;
  return (
    <footer
      className="lyra-ai-agent-message-footer"
      data-has-actions={hasActions ? "true" : "false"}
    >
      {role === "assistant" && live ? (
        <AiPanelAssistantGeneratingIndicator />
      ) : null}
      <span className="lyra-ai-agent-message-footer-stack">
        {showTime ? (
          <time
            className="lyra-ai-agent-message-time"
            dateTime={new Date(createdAt).toISOString()}
          >
            {timeLabel}
          </time>
        ) : null}
        {hasActions ? (
          <span className="lyra-ai-agent-message-actions">{actions}</span>
        ) : null}
      </span>
    </footer>
  );
};

const AiPanelMessageBubble = ({
  message,
  locale,
  live = false,
  actions,
}: {
  readonly message: AgentMessage;
  readonly locale: WorkbenchLocale;
  readonly live?: boolean;
  readonly actions?: ReactNode;
}) => {
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = messageText(message);
  return (
    <article
      className={`lyra-ai-agent-message lyra-ai-agent-message-${role}${live ? " lyra-ai-agent-message-live" : ""}`}
    >
      {role === "assistant" ? (
        <header className="lyra-ai-agent-message-meta">
          <span>Lyra</span>
        </header>
      ) : null}
      {role === "assistant" ? (
        content.length === 0 ? (
          live ? null : (
            <div className="lyra-ai-agent-message-pending">
              <SpinnerLabel size="sm" tone="muted" label="Thinking" />
            </div>
          )
        ) : (
          <AiPanelRichContent locale={locale} content={content} />
        )
      ) : (
        <div className="lyra-ai-agent-message-content lyra-ai-agent-message-content-user">
          <InlineMessageContent content={content} parts={message.contentParts} />
        </div>
      )}
      <AiPanelMessageFooter
        role={role}
        createdAt={message.createdAt}
        locale={locale}
        actions={actions}
        live={live}
      />
    </article>
  );
};

const AiPanelLiveAssistantBubble = ({
  text,
  turnId,
  sessionId,
  locale,
}: {
  readonly text: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly locale: WorkbenchLocale;
}) => {
  const content = text.trim();
  return (
    <article className="lyra-ai-agent-message lyra-ai-agent-message-assistant lyra-ai-agent-message-live">
      <header className="lyra-ai-agent-message-meta">
        <span>Lyra</span>
      </header>
      {content.length === 0 ? null : (
        <AiPanelRichContent locale={locale} content={content} />
      )}
      <AiPanelMessageFooter
        role="assistant"
        createdAt={Date.now()}
        locale={locale}
        live
      />
    </article>
  );
};

/* ── Turn group view ─────────────────────────────────────── */

const TurnGroupView = ({
  group,
  locale,
  detail,
  streamingTurnId,
  expandedPatchKey,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
  resolveClarification,
  resolvePlanReview,
  executeMessageRollback,
  onClarificationResolved,
  onRollbackExecuted,
  renderMessageActions,
}: {
  readonly group: TurnGroup;
  readonly locale: WorkbenchLocale;
  readonly detail: AgentSessionDetail | null;
  readonly streamingTurnId: string | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?: ((request: {
    readonly sessionId: string;
    readonly artifactId?: string;
    readonly patchRef?: string;
  }) => Promise<AgentApplyPatchResult>) | undefined;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
  readonly resolveClarification?:
    | ((request: AgentResolveClarificationRequest) => Promise<AgentResolveClarificationResult>)
    | undefined;
  readonly resolvePlanReview?:
    | ((request: AgentResolvePlanReviewRequest) => Promise<AgentResolvePlanReviewResult>)
    | undefined;
  readonly executeMessageRollback?:
    | ((request: AgentExecuteMessageRollbackRequest) => Promise<AgentExecuteMessageRollbackResult>)
    | undefined;
  readonly onClarificationResolved?: (() => Promise<void> | void) | undefined;
  readonly onRollbackExecuted?: (() => Promise<void> | void) | undefined;
  readonly renderMessageActions?: ((message: AgentMessage) => ReactNode) | undefined;
}) => (
  <div className="lyra-ai-turn-group" data-turn-id={group.turnId}>
    {group.userMessages.map((message) => (
      <AiPanelMessageBubble
        key={message.id}
        message={message}
        locale={locale}
        actions={renderMessageActions?.(message)}
      />
    ))}

    {group.toolCalls.length > 0 ? (
      <ToolCallGroup
        calls={group.toolCalls}
        detail={detail}
        expandedPatchKey={expandedPatchKey}
        onPatchExpandedChange={onPatchExpandedChange}
        readArtifact={readArtifact}
        applyPatch={applyPatch}
        resolveApproval={resolveApproval}
      />
    ) : null}

    {group.responseItems.map((item) => {
      if (item.kind === "assistantMessage") {
        return (
          <AiPanelMessageBubble
            key={item.message.id}
            message={item.message}
            locale={locale}
            live={item.message.turnId === streamingTurnId}
            actions={renderMessageActions?.(item.message)}
          />
        );
      }
      if (item.kind === "runtimeAction") {
        return (
          <TimelineRuntimeAction
            key={item.action.id}
            actionKind={item.action.actionKind}
            detail={detail}
            resolveClarification={resolveClarification}
            resolveApproval={resolveApproval}
            resolvePlanReview={resolvePlanReview}
            executeMessageRollback={executeMessageRollback}
            onClarificationResolved={onClarificationResolved}
            onRollbackExecuted={onRollbackExecuted}
          />
        );
      }
      return (
        <AiPanelLiveAssistantBubble
          key={`live-${group.turnId}`}
          text={item.text}
          turnId={group.turnId}
          sessionId={detail?.session.id ?? ""}
          locale={locale}
        />
      );
    })}
  </div>
);

/* ── Main thread view ────────────────────────────────────── */

export const AiPanelThreadView = memo(({
  logoUrl,
  blinkLogoUrl,
  emptyThreadLabel,
  emptyGreetingLabels,
  locale = "en-US",
  detail,
  optimisticUserMessages = [],
  streamingTurnId,
  streamingAssistantText,
  isLoading,
  runtimeError,
  expandedPatchKey = null,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
  resolveClarification,
  resolvePlanReview,
  executeMessageRollback,
  onClarificationResolved,
  onRollbackExecuted,
  renderMessageActions,
}: AiPanelThreadViewProps) => {
  const messages = detail?.messages ?? [];
  const hasLiveAssistant =
    streamingTurnId !== null
    && !messages.some((message) =>
      message.role === "assistant" && message.turnId === streamingTurnId
    );
  const turnGroups = buildTurnGroups(
    detail,
    optimisticUserMessages,
    hasLiveAssistant && streamingTurnId !== null
      ? { turnId: streamingTurnId, text: streamingAssistantText }
      : null
  );

  if (
    turnGroups.length > 0
    || runtimeError !== null
    || isLoading
  ) {
    return (
      <div className="lyra-ai-agent-thread-view" role="log" aria-live="polite">
        {turnGroups.map((group) => (
          <TurnGroupView
            key={group.turnId}
            group={group}
            locale={locale}
            detail={detail}
            streamingTurnId={streamingTurnId}
            expandedPatchKey={expandedPatchKey}
            onPatchExpandedChange={onPatchExpandedChange}
            readArtifact={readArtifact}
            applyPatch={applyPatch}
            resolveApproval={resolveApproval}
            resolveClarification={resolveClarification}
            resolvePlanReview={resolvePlanReview}
            executeMessageRollback={executeMessageRollback}
            onClarificationResolved={onClarificationResolved}
            onRollbackExecuted={onRollbackExecuted}
            renderMessageActions={renderMessageActions}
          />
        ))}
        {isLoading ? (
          <div className="lyra-ai-agent-thread-status">
            <SpinnerLabel size="sm" tone="muted" label="Loading thread" />
          </div>
        ) : null}
        {runtimeError === null ? null : (
          <div className="lyra-ai-agent-thread-error" role="alert">
            {runtimeError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lyra-ai-agent-empty-scene">
      <div className="lyra-ai-agent-empty-hero">
        <LyraBrandLogo
          logoUrl={logoUrl}
          blinkEyes
          {...(blinkLogoUrl === undefined ? {} : { blinkLogoUrl })}
          className="lyra-ai-agent-empty-logo"
        />
        <AiPanelEmptyGreetingRotator
          labels={emptyGreetingLabels}
          fallbackLabel={emptyThreadLabel}
        />
      </div>
    </div>
  );
});

AiPanelThreadView.displayName = "AiPanelThreadView";
