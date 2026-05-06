import { memo } from "react";
import { AlertTriangle, CheckCircle2, FileDiff, FileSearch, FileText, FolderOpen, GitBranch, Info, Loader2 } from "lucide-react";

import { LyraBrandLogo } from "../brand";
import type { WorkbenchLocale } from "../i18n";
import type {
  AgentApplyPatchRequest,
  AgentApplyPatchResult,
  AgentMessage,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
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
import type { ReadPatchArtifact } from "./use-patch-artifact";

type AiPanelThreadViewProps = {
  readonly logoUrl: string;
  readonly blinkLogoUrl?: string | undefined;
  readonly emptyThreadLabel: string;
  readonly emptyGreetingLabels?: readonly string[] | undefined;
  readonly locale?: WorkbenchLocale | undefined;
  readonly detail: AgentSessionDetail | null;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly isLoading: boolean;
  readonly runtimeError: string | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?: ((request: AgentApplyPatchRequest) => Promise<AgentApplyPatchResult>) | undefined;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
};

const messageText = (message: AgentMessage): string =>
  (message.displayContent ?? message.content).trim();

type ThreadTimelineItem =
  | {
    readonly kind: "message";
    readonly id: string;
    readonly createdAt: number;
    readonly message: AgentMessage;
  }
  | {
    readonly kind: "toolEvent";
    readonly id: string;
    readonly createdAt: number;
    readonly event: AgentRuntimeEvent;
  };

const TOOL_EVENT_PHASES = new Set([
  "tool_operation_started",
  "tool_operation_completed",
  "tool_operation_failed",
]);

const buildTimelineItems = (detail: AgentSessionDetail | null): readonly ThreadTimelineItem[] => {
  if (detail === null) {
    return [];
  }
  const messages = detail.messages.map<ThreadTimelineItem>((message) => ({
    kind: "message",
    id: `message:${message.id}`,
    createdAt: message.createdAt,
    message,
  }));
  const toolEvents = detail.runtimeEvents
    .filter((event) => TOOL_EVENT_PHASES.has(event.phase))
    .map<ThreadTimelineItem>((event, index) => ({
      kind: "toolEvent",
      id: `tool:${event.turnId}:${event.phase}:${String(index)}:${String(event.timestamp)}`,
      createdAt: event.timestamp,
      event,
    }));
  return [...messages, ...toolEvents].sort((left, right) => left.createdAt - right.createdAt);
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

const AiPanelMessageBubble = ({
  message,
  locale,
  live = false,
}: {
  readonly message: AgentMessage;
  readonly locale: WorkbenchLocale;
  readonly live?: boolean;
}) => {
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = messageText(message);
  return (
    <article
      className={`lyra-ai-agent-message lyra-ai-agent-message-${role}${live ? " lyra-ai-agent-message-live" : ""}`}
    >
      <header className="lyra-ai-agent-message-meta">
        <span>{role === "assistant" ? "Lyra" : "You"}</span>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {formatMessageTime(message.createdAt, locale)}
        </time>
      </header>
      {role === "assistant" ? (
        content.length === 0 ? (
          <div className="lyra-ai-agent-message-pending">
            <SpinnerLabel size="sm" tone="muted" label="Thinking" />
          </div>
        ) : (
          <AiPanelRichContent locale={locale} content={content} />
        )
      ) : (
        <div className="lyra-ai-agent-message-content lyra-ai-agent-message-content-user">
          <InlineMessageContent content={content} parts={message.contentParts} />
        </div>
      )}
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
    );
  }
  const { toolPath, summary, detail } = toolEventLabel(event);
  const tone = event.phase === "tool_operation_failed"
    ? "error"
    : event.phase === "tool_operation_started"
      ? "running"
      : "done";
  return (
    <div className={`lyra-ai-agent-tool-event lyra-ai-agent-tool-event-${tone}`}>
      <span className="lyra-ai-agent-tool-event-icon">
        {toolIcon(toolPath, event.phase)}
      </span>
      <span className="lyra-ai-agent-tool-event-summary">{summary}</span>
      {detail === null ? null : (
        <span className="lyra-ai-agent-tool-event-detail">{detail}</span>
      )}
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
  streamingTurnId,
  streamingAssistantText,
  isLoading,
  runtimeError,
  expandedPatchKey = null,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
}: AiPanelThreadViewProps) => {
  const messages = detail?.messages ?? [];
  const timelineItems = buildTimelineItems(detail);
  const hasLiveAssistant =
    streamingTurnId !== null
    && streamingAssistantText.trim().length > 0
    && !messages.some((message) =>
      message.role === "assistant" && message.turnId === streamingTurnId
    );

  if (messages.length > 0 || hasLiveAssistant || runtimeError !== null || isLoading) {
    return (
      <div className="lyra-ai-agent-thread-view" role="log" aria-live="polite">
        {timelineItems.map((item) => (
          item.kind === "message" ? (
            <AiPanelMessageBubble
              key={item.id}
              message={item.message}
              locale={locale}
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
        {hasLiveAssistant ? (
          <AiPanelMessageBubble
            message={{
              id: `live:${streamingTurnId}`,
              sessionId: detail?.session.id ?? "",
              turnId: streamingTurnId,
              role: "assistant",
              content: streamingAssistantText,
              displayContent: streamingAssistantText,
              createdAt: Date.now(),
            }}
            locale={locale}
            live
          />
        ) : null}
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
