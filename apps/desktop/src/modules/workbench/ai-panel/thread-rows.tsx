import type {
  AgentTurn,
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { PendingInteractionPanel } from "./interaction/pending-interaction-mappers";
import { InlineMessageContent } from "./inline-message-content";
import { MessageActions } from "./message-actions";
import { PlanCard } from "./plan-card";
import { AiPanelRichContent } from "./rich-content";
import {
  AiPanelRuntimeFeedBlock,
  AiPanelStreamStatusBlock,
} from "./runtime-feed-block";
import {
  type AgentRuntimeFeedItem,
  type AgentTurnTimelineItem,
} from "./runtime/feed-utils";
import {
  displayMessageTurnId,
  planTextForApproval,
  type AiPanelThreadMessageMetadata,
  type AiPanelThreadRenderRow,
} from "./thread-render-model";
import type { LyraTurnPlanState } from "./use-lyra-thread-runtime";
import {
  isOptimisticUserMessage,
  resolveAssistantDisplayContent,
  resolveTurnDurationLabel,
  sanitizeAssistantDisplayContent,
  type StreamStatusItem,
} from "./view-helpers";

type OpenRuntimeTargetPath = (
  path: string,
  options?: {
    readonly forceReloadIfOpen?: boolean;
    readonly allowMissing?: boolean;
    readonly location?: { readonly line: number };
  }
) => Promise<void>;

const formatMessageTime = (timestamp: number, locale: WorkbenchLocale): string => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
};

const firstNonEmptyLine = (text: string): string | null =>
  text.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0) ?? null;

const planApprovalRequestFromState = (
  plan: LyraTurnPlanState,
  sessionId: string
): PlanApprovalRequest | null => {
  const proposedMarkdown = planTextForApproval(plan);
  if (proposedMarkdown.length === 0) {
    return null;
  }
  return {
    id: `plan:${plan.turnId}`,
    sessionId,
    turnId: plan.turnId,
    version: 0,
    status: "submitted",
    summary: firstNonEmptyLine(proposedMarkdown) ?? "Proposed plan",
    proposedMarkdown,
    ...(plan.draftText.length === 0 ? {} : { draftMarkdown: plan.draftText }),
  };
};

type AiPanelMessageRowProps = {
  readonly row: Extract<AiPanelThreadRenderRow, { kind: "message" }>;
  readonly locale: WorkbenchLocale;
  readonly isZhLocale: boolean;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly messageMetadata: AiPanelThreadMessageMetadata;
  readonly turnsById: ReadonlyMap<string, AgentTurn>;
  readonly runtimeFeedByTurn: ReadonlyMap<string, AgentRuntimeFeedItem[]>;
  readonly turnTimelineByTurn: ReadonlyMap<string, readonly AgentTurnTimelineItem[]>;
  readonly assistantMessageOrderById: ReadonlyMap<string, number>;
  readonly turnWorkingLabel: string;
  readonly turnWorkedForPrefix: string;
  readonly toolStatusRunningLabel: string;
  readonly toolStatusCompletedLabel: string;
  readonly toolStatusFailedLabel: string;
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: OpenRuntimeTargetPath;
  readonly copyMessageLabel: string;
  readonly copiedMessageLabel: string;
  readonly forkResponseLabel: string;
  readonly regenerateResponseLabel: string;
  readonly editMessageLabel: string;
  readonly onForkTurn: (turnId: string) => void;
  readonly onRegenerateTurn: (turnId: string) => void;
  readonly onEditMessageTurn: (turnId: string, content: string) => void;
  readonly onOpenThread?: (threadId: string) => void;
};

export const AiPanelMessageRow = ({
  row,
  locale,
  isZhLocale,
  richRenderingEnabled,
  themeSignature,
  messageMetadata,
  turnsById,
  runtimeFeedByTurn,
  turnTimelineByTurn,
  assistantMessageOrderById,
  turnWorkingLabel,
  turnWorkedForPrefix,
  toolStatusRunningLabel,
  toolStatusCompletedLabel,
  toolStatusFailedLabel,
  canOpenFilePath,
  openRuntimeTargetPath,
  copyMessageLabel,
  copiedMessageLabel,
  forkResponseLabel,
  regenerateResponseLabel,
  editMessageLabel,
  onForkTurn,
  onRegenerateTurn,
  onEditMessageTurn,
  onOpenThread,
}: AiPanelMessageRowProps) => {
  const message = row.message;
  const messageIndex = row.messageIndex;
  const isUserMessage = message.role === "user";
  const isOptimistic = isOptimisticUserMessage(message);
  const turnId = displayMessageTurnId(message);
  const turn = turnId === null ? null : (turnsById.get(turnId) ?? null);
  const canRewriteTurn = turn !== null && turn.status !== "running";
  const assistantOrder = assistantMessageOrderById.get(message.id) ?? null;
  const turnDurationLabel =
    turn === null || turn.status === "running"
      ? null
      : resolveTurnDurationLabel(turn, turnWorkingLabel, turnWorkedForPrefix);
  const turnRuntimeFeed =
    turnId !== null && message.role === "assistant"
      ? (runtimeFeedByTurn.get(turnId) ?? [])
      : [];
  const turnTimeline =
    turnId !== null && message.role === "assistant"
      ? (turnTimelineByTurn.get(turnId) ?? [])
      : [];
  const fallbackTimeline =
    turnTimeline.length === 0
      ? [
          {
            kind: "assistant" as const,
            id: `${message.id}-assistant-fallback`,
            timestamp: message.createdAt,
            content: resolveAssistantDisplayContent(message),
          },
          ...turnRuntimeFeed.map((item) => ({
            kind: "tool" as const,
            id: `tool-${item.id}`,
            timestamp: item.timestamp,
            tool: item,
          })),
        ]
      : turnTimeline;
  const displayTimeline: AgentTurnTimelineItem[] = [];
  for (const entry of fallbackTimeline) {
    if (entry.kind !== "assistant") {
      displayTimeline.push(entry);
      continue;
    }
    const content = sanitizeAssistantDisplayContent(entry.content);
    if (content.length === 0) {
      continue;
    }
    displayTimeline.push({ ...entry, content });
  }
  const displayMessageContent = isUserMessage
    ? message.content
    : resolveAssistantDisplayContent(message);
  const messageTimeLabel = formatMessageTime(message.createdAt, locale);
  const isLastAssistantMessageForTurn =
    !isUserMessage
    && turnId !== null
    && messageMetadata.lastAssistantIndexByTurn.get(turnId) === messageIndex;

  return (
    <div
      className={
        isUserMessage
          ? (
              isOptimistic
                ? "lyra-ai-agent-message lyra-ai-agent-message-user lyra-ai-agent-message-pending"
                : "lyra-ai-agent-message lyra-ai-agent-message-user"
            )
          : "lyra-ai-agent-message lyra-ai-agent-message-assistant"
      }
    >
      {isUserMessage || !richRenderingEnabled ? (
        <div className="lyra-ai-agent-message-content">
          {isUserMessage ? (
            <InlineMessageContent
              content={displayMessageContent}
              parts={message.contentParts}
            />
          ) : (
            displayMessageContent
          )}
        </div>
      ) : (
        <>
          <div className="lyra-ai-agent-turn-timeline">
            {(() => {
              const nodes: JSX.Element[] = [];
              for (let timelineIndex = 0; timelineIndex < displayTimeline.length; timelineIndex += 1) {
                const timelineEntry = displayTimeline[timelineIndex];
                if (timelineEntry === undefined) {
                  continue;
                }
                if (timelineEntry.kind === "tool") {
                  const groupedTools: AgentRuntimeFeedItem[] = [timelineEntry.tool];
                  let groupEndIndex = timelineIndex;
                  while (groupEndIndex + 1 < displayTimeline.length) {
                    const nextEntry = displayTimeline[groupEndIndex + 1];
                    if (nextEntry === undefined || nextEntry.kind !== "tool") {
                      break;
                    }
                    groupedTools.push(nextEntry.tool);
                    groupEndIndex += 1;
                  }
                  const firstToolId = groupedTools[0]?.id ?? `${message.id}-tool-group-${String(timelineIndex)}`;
                  const lastToolId = groupedTools[groupedTools.length - 1]?.id ?? firstToolId;
                  nodes.push(
                    <div
                      key={`tool-group-${firstToolId}-${lastToolId}`}
                      className="lyra-ai-agent-turn-timeline-item lyra-ai-agent-turn-timeline-item-tool"
                    >
                      <AiPanelRuntimeFeedBlock
                        items={groupedTools}
                        canOpenPath={canOpenFilePath}
                        statusLabels={{
                          running: toolStatusRunningLabel,
                          completed: toolStatusCompletedLabel,
                          failed: toolStatusFailedLabel,
                        }}
                        openRuntimeTargetPath={openRuntimeTargetPath}
                        {...(onOpenThread === undefined ? {} : { onOpenThread })}
                      />
                    </div>
                  );
                  timelineIndex = groupEndIndex;
                  continue;
                }
                nodes.push(
                  <div
                    key={timelineEntry.id}
                    className="lyra-ai-agent-turn-timeline-item lyra-ai-agent-turn-timeline-item-assistant"
                  >
                    <AiPanelRichContent
                      content={timelineEntry.content}
                      locale={locale}
                      {...(themeSignature === undefined ? {} : { themeSignature })}
                    />
                  </div>
                );
              }
              return nodes;
            })()}
          </div>
        </>
      )}
      <div className="lyra-ai-agent-message-footer">
        <div
          className={
            isUserMessage
              ? "lyra-ai-agent-message-footer-meta lyra-ai-agent-message-footer-meta-user"
              : "lyra-ai-agent-message-footer-meta lyra-ai-agent-message-footer-meta-assistant"
          }
        >
          {isUserMessage ? (
            <span className="lyra-ai-agent-message-footer-time">{messageTimeLabel}</span>
          ) : (
            <>
              {assistantOrder === null ? null : (
                <span className="lyra-ai-agent-turn-footer-index">
                  {(isZhLocale ? "消息" : "Message")}
                  ·
                  {String(assistantOrder)}
                </span>
              )}
              {turnDurationLabel === null ? null : (
                <span className="lyra-ai-agent-turn-footer-duration">
                  {turnDurationLabel}
                </span>
              )}
              <span className="lyra-ai-agent-message-footer-time">{messageTimeLabel}</span>
            </>
          )}
        </div>
        <MessageActions
          content={displayMessageContent}
          messageType={isUserMessage ? "user" : "assistant"}
          copyLabel={copyMessageLabel}
          copiedLabel={copiedMessageLabel}
          {...(isLastAssistantMessageForTurn && turnId !== null && canRewriteTurn
            ? {
                forkLabel: forkResponseLabel,
                onFork: () => {
                  onForkTurn(turnId);
                },
                regenerateLabel: regenerateResponseLabel,
                onRegenerate: () => {
                  onRegenerateTurn(turnId);
                },
              }
            : {})}
          {...(isUserMessage && turnId !== null && canRewriteTurn && !isOptimistic
            ? {
                editLabel: editMessageLabel,
                onEdit: () => {
                  onEditMessageTurn(turnId, displayMessageContent);
                },
              }
            : {})}
        />
      </div>
    </div>
  );
};

type AiPanelPlanRowProps = {
  readonly row: Extract<AiPanelThreadRenderRow, { kind: "plan" }>;
  readonly locale: WorkbenchLocale;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly latestPlanTurnId: string | null;
  readonly planActionsEnabled: boolean;
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly onPlanApprovalDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
  readonly onOpenPlanApprovalInWorkspace?: (request: PlanApprovalRequest) => void;
};

export const AiPanelPlanRow = ({
  row,
  locale,
  richRenderingEnabled,
  themeSignature,
  latestPlanTurnId,
  planActionsEnabled,
  pendingInteractionQueue,
  onPlanApprovalDecision,
  onOpenPlanApprovalInWorkspace,
}: AiPanelPlanRowProps) => {
  const interactionQueue = pendingInteractionQueue ?? [];
  const pendingRequest =
    interactionQueue.find(
      (interaction): interaction is Extract<PendingInteractionPanel, { kind: "planApproval" }> =>
        interaction.kind === "planApproval" && interaction.request.turnId === row.plan.turnId
    )?.request
    ?? null;
  const request = pendingRequest
    ?? (
      row.sessionId.length === 0
        ? null
        : planApprovalRequestFromState(row.plan, row.sessionId)
    );
  const canActOnPlan =
    planActionsEnabled
    && row.plan.turnId === latestPlanTurnId
    && pendingRequest !== null;
  return (
    <div className="lyra-ai-agent-message lyra-ai-agent-message-assistant lyra-ai-agent-message-plan">
      <PlanCard
        locale={locale}
        plan={row.plan}
        richRenderingEnabled={richRenderingEnabled}
        {...(themeSignature === undefined ? {} : { themeSignature })}
        showActions={canActOnPlan}
        onApprove={() => {
          void onPlanApprovalDecision({
            requestId: `plan:${row.plan.turnId}`,
            decision: "approve_and_implement",
          }, request ?? undefined);
        }}
        onKeepPlanning={() => {
          void onPlanApprovalDecision({
            requestId: `plan:${row.plan.turnId}`,
            decision: "keep_planning",
          }, request ?? undefined);
        }}
        {...(pendingRequest === null || onOpenPlanApprovalInWorkspace === undefined
          ? {}
          : {
              onOpenInWorkspace: () => {
                onOpenPlanApprovalInWorkspace(pendingRequest);
              },
            })}
        onReject={() => {
          void onPlanApprovalDecision({
            requestId: `plan:${row.plan.turnId}`,
            decision: "reject",
          }, request ?? undefined);
        }}
      />
    </div>
  );
};

type AiPanelStreamingRowProps = {
  readonly locale: WorkbenchLocale;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly typewriterText: string;
  readonly streamingTurnRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingStatus: StreamStatusItem | null;
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: OpenRuntimeTargetPath;
  readonly toolStatusRunningLabel: string;
  readonly toolStatusCompletedLabel: string;
  readonly toolStatusFailedLabel: string;
  readonly onOpenThread?: (threadId: string) => void;
};

export const AiPanelStreamingRow = ({
  locale,
  richRenderingEnabled,
  themeSignature,
  typewriterText,
  streamingTurnRuntimeFeed,
  streamingStatus,
  canOpenFilePath,
  openRuntimeTargetPath,
  toolStatusRunningLabel,
  toolStatusCompletedLabel,
  toolStatusFailedLabel,
  onOpenThread,
}: AiPanelStreamingRowProps) => (
  <div className="lyra-ai-agent-message lyra-ai-agent-message-assistant">
    {typewriterText.length === 0 ? null : (
      richRenderingEnabled ? (
        <AiPanelRichContent
          content={typewriterText}
          locale={locale}
          {...(themeSignature === undefined ? {} : { themeSignature })}
        />
      ) : (
        <div className="lyra-ai-agent-message-content">{typewriterText}</div>
      )
    )}
    {streamingTurnRuntimeFeed.length === 0 ? null : (
      <AiPanelRuntimeFeedBlock
        items={streamingTurnRuntimeFeed}
        canOpenPath={canOpenFilePath}
        statusLabels={{
          running: toolStatusRunningLabel,
          completed: toolStatusCompletedLabel,
          failed: toolStatusFailedLabel,
        }}
        openRuntimeTargetPath={openRuntimeTargetPath}
        {...(onOpenThread === undefined ? {} : { onOpenThread })}
      />
    )}
    {streamingStatus === null ? null : (
      <AiPanelStreamStatusBlock status={streamingStatus} />
    )}
  </div>
);

type AiPanelOrphanRuntimeFeedRowProps = {
  readonly orphanRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: OpenRuntimeTargetPath;
  readonly toolStatusRunningLabel: string;
  readonly toolStatusCompletedLabel: string;
  readonly toolStatusFailedLabel: string;
  readonly onOpenThread?: (threadId: string) => void;
};

export const AiPanelOrphanRuntimeFeedRow = ({
  orphanRuntimeFeed,
  canOpenFilePath,
  openRuntimeTargetPath,
  toolStatusRunningLabel,
  toolStatusCompletedLabel,
  toolStatusFailedLabel,
  onOpenThread,
}: AiPanelOrphanRuntimeFeedRowProps) => (
  <div className="lyra-ai-agent-runtime-block-orphan">
    <AiPanelRuntimeFeedBlock
      items={orphanRuntimeFeed}
      canOpenPath={canOpenFilePath}
      statusLabels={{
        running: toolStatusRunningLabel,
        completed: toolStatusCompletedLabel,
        failed: toolStatusFailedLabel,
      }}
      openRuntimeTargetPath={openRuntimeTargetPath}
      {...(onOpenThread === undefined ? {} : { onOpenThread })}
    />
  </div>
);
