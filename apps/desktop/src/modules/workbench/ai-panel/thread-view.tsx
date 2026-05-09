import { memo, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FileDiff, FileSearch, FileText, FolderOpen, GitBranch, Info, Loader2, Terminal } from "lucide-react";

import { LyraBrandLogo } from "../brand";
import type { WorkbenchLocale } from "../i18n";
import type {
  AgentApplyPatchRequest,
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
  isPatchProposalApplied,
  isPatchProposalDenied,
  isRecord,
  patchApprovalForProposal,
  readBoolean,
  readNumber,
  readString,
} from "./patch-artifact";
import { PatchPreviewCard } from "./patch-preview-card";
import { AiPanelRichContent } from "./rich-content";
import { SpinnerLabel } from "./stream-spinner";
import {
  buildTimelineRuntimeActionItems,
  TimelineRuntimeAction,
  type TimelineRuntimeActionItem,
} from "./timeline-runtime-action";
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
  readonly applyPatch?: ((request: AgentApplyPatchRequest) => Promise<AgentApplyPatchResult>) | undefined;
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

type ThreadTimelineItem =
  | {
    readonly kind: "message";
    readonly id: string;
    readonly createdAt: number;
    readonly sortRank: number;
    readonly live: boolean;
    readonly message: AgentMessage;
  }
  | {
    readonly kind: "toolEvent";
    readonly id: string;
    readonly createdAt: number;
    readonly sortRank: number;
    readonly event: AgentRuntimeEvent;
  }
  | (TimelineRuntimeActionItem & {
    readonly sortRank: number;
  });

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

const buildTimelineItems = (
  detail: AgentSessionDetail | null,
  optimisticUserMessages: readonly OptimisticUserMessage[],
  liveAssistant: { readonly turnId: string; readonly text: string } | null
): readonly ThreadTimelineItem[] => {
  const sessionMessages = detail?.messages ?? [];
  const events = detail?.runtimeEvents ?? [];
  const messages = [...sessionMessages, ...optimisticUserMessages].map<ThreadTimelineItem>((message) => {
    const role = message.role === "assistant" ? "assistant" : "user";
    return {
      kind: "message",
      id: `message:${message.id}`,
      createdAt: role === "assistant"
        ? modelTextSegmentStartAt(events, message.turnId, message.createdAt)
        : message.createdAt,
      sortRank: role === "assistant" ? 30 : 10,
      live: false,
      message,
    };
  });
  const liveMessage: ThreadTimelineItem[] = liveAssistant === null ? [] : [
    {
      kind: "message",
      id: `live:${liveAssistant.turnId}`,
      createdAt: modelTextSegmentStartAt(events, liveAssistant.turnId, Date.now()),
      sortRank: 30,
      live: true,
      message: {
        id: `live:${liveAssistant.turnId}`,
        sessionId: detail?.session.id ?? "",
        turnId: liveAssistant.turnId,
        role: "assistant",
        content: liveAssistant.text,
        displayContent: liveAssistant.text,
        createdAt: Date.now(),
      },
    },
  ];
  const toolEvents = (detail?.runtimeEvents ?? [])
    .filter((event) => TOOL_EVENT_PHASES.has(event.phase))
    .map<ThreadTimelineItem>((event, index) => ({
      kind: "toolEvent",
      id: `tool:${event.turnId}:${event.phase}:${String(index)}:${String(event.timestamp)}`,
      createdAt: event.timestamp,
      sortRank: 20,
      event,
    }));
  const runtimeActions = buildTimelineRuntimeActionItems(detail).map<ThreadTimelineItem>((item) => ({
    ...item,
    sortRank: 40,
  }));
  return [...messages, ...liveMessage, ...toolEvents, ...runtimeActions].sort((left, right) =>
    left.createdAt - right.createdAt || left.sortRank - right.sortRank
  );
};

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

const toolIcon = (toolPath: string, phase: string) => {
  if (phase === "tool_operation_failed") {
    return <AlertTriangle size={13} aria-hidden="true" />;
  }
  if (phase === "tool_operation_started") {
    return <Loader2 size={13} aria-hidden="true" />;
  }
  if (toolPath.startsWith("/tools/git")) {
    return <GitBranch size={13} aria-hidden="true" />;
  }
  if (toolPath.startsWith("/tools/shell")) {
    return <Terminal size={13} aria-hidden="true" />;
  }
  if (toolPath.includes("/propose_patch")) {
    return <FileDiff size={13} aria-hidden="true" />;
  }
  if (
    toolPath.includes("/list_files")
    || toolPath.includes("/walk_directory")
    || toolPath === "/tools/filesystem"
  ) {
    return <FolderOpen size={13} aria-hidden="true" />;
  }
  if (
    toolPath.includes("/read_file")
    || toolPath.includes("/read_range")
    || toolPath.includes("/stat_path")
  ) {
    return <FileText size={13} aria-hidden="true" />;
  }
  if (
    toolPath.includes("/search")
    || toolPath.startsWith("/tools/code")
  ) {
    return <FileSearch size={13} aria-hidden="true" />;
  }
  return phase === "tool_operation_completed"
    ? <CheckCircle2 size={13} aria-hidden="true" />
    : <Info size={13} aria-hidden="true" />;
};

const toolEventLabel = (event: AgentRuntimeEvent): {
  readonly toolPath: string;
  readonly summary: string;
  readonly detail: string | null;
} => {
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : {};
  const toolPath = readString(operation.toolPath)
    ?? readString(operation.path)
    ?? readString(result.path)
    ?? "/tools";
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
  return { toolPath, summary, detail };
};

const AiPanelToolEventRow = ({
  event,
  detail: sessionDetail,
  expandedPatchKey = null,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
}: {
  readonly event: AgentRuntimeEvent;
  readonly detail: AgentSessionDetail | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?: ((request: AgentApplyPatchRequest) => Promise<AgentApplyPatchResult>) | undefined;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
}) => {
  const patchProposal = extractPatchProposalEvent(event);
  if (patchProposal !== null) {
    const expanded = expandedPatchKey === patchProposal.key;
    const approval = patchApprovalForProposal(sessionDetail, patchProposal);
    return (
      <div className="lyra-ai-agent-timeline-event" data-kind="patch">
        <span className="lyra-ai-agent-timeline-event-marker" aria-hidden="true">
          {toolIcon("/tools/filesystem/propose_patch", event.phase)}
        </span>
        <div className="lyra-ai-agent-timeline-event-body">
          <PatchPreviewCard
            proposal={patchProposal}
            expanded={expanded}
            readArtifact={readArtifact}
            applyPatch={applyPatch}
            resolveApproval={resolveApproval}
            applied={isPatchProposalApplied(sessionDetail, patchProposal)}
            denied={isPatchProposalDenied(sessionDetail, patchProposal)}
            approvalRequired={approval !== null}
            approvalTicketId={approval?.approvalTicketId ?? null}
            onToggle={(key) => {
              onPatchExpandedChange?.(expanded ? null : key);
            }}
          />
        </div>
      </div>
    );
  }
  const { toolPath, summary, detail } = toolEventLabel(event);
  const tone = event.phase === "tool_operation_failed"
    ? "error"
    : event.phase === "tool_operation_started"
      ? "running"
      : "done";
  return (
    <div className="lyra-ai-agent-timeline-event" data-kind="tool" data-tone={tone}>
      <span className="lyra-ai-agent-timeline-event-marker" aria-hidden="true">
        {toolIcon(toolPath, event.phase)}
      </span>
      <div className="lyra-ai-agent-timeline-event-body">
        <div className={`lyra-ai-agent-tool-event lyra-ai-agent-tool-event-${tone}`}>
          <span className="lyra-ai-agent-tool-event-summary">{summary}</span>
          {detail === null ? null : (
            <span className="lyra-ai-agent-tool-event-detail">{detail}</span>
          )}
        </div>
      </div>
    </div>
  );
};

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
  const timelineItems = buildTimelineItems(
    detail,
    optimisticUserMessages,
    hasLiveAssistant && streamingTurnId !== null
      ? { turnId: streamingTurnId, text: streamingAssistantText }
      : null
  );

  if (
    timelineItems.length > 0
    || runtimeError !== null
    || isLoading
  ) {
    return (
      <div className="lyra-ai-agent-thread-view" role="log" aria-live="polite">
        {timelineItems.map((item) => (
          item.kind === "message" ? (
            <AiPanelMessageBubble
              key={item.id}
              message={item.message}
              locale={locale}
              live={item.live || (item.message.role === "assistant" && item.message.turnId === streamingTurnId)}
              actions={renderMessageActions?.(item.message)}
            />
          ) : item.kind === "runtimeAction" ? (
            <TimelineRuntimeAction
              key={item.id}
              actionKind={item.actionKind}
              detail={detail}
              resolveClarification={resolveClarification}
              resolveApproval={resolveApproval}
              resolvePlanReview={resolvePlanReview}
              executeMessageRollback={executeMessageRollback}
              onClarificationResolved={onClarificationResolved}
              onRollbackExecuted={onRollbackExecuted}
            />
          ) : (
            <AiPanelToolEventRow
              key={item.id}
              event={item.event}
              detail={detail}
              expandedPatchKey={expandedPatchKey}
              onPatchExpandedChange={onPatchExpandedChange}
              readArtifact={readArtifact}
              applyPatch={applyPatch}
              resolveApproval={resolveApproval}
            />
          )
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
