import { Fragment, memo, type CSSProperties, type RefObject } from "react";

import type {
  AgentToolCall,
  AgentTurn,
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import { LyraBrandLogo } from "../brand";
import type { WorkbenchLocale } from "../i18n";
import type {
  PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";
import { AiPanelRichContent } from "./rich-content";
import { InlineMessageContent } from "./inline-message-content";
import { MessageActions } from "./message-actions";
import { PlanCard } from "./plan-card";
import {
  type AgentRuntimeFeedItem,
  type AgentTurnTimelineItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import {
  isOptimisticUserMessage,
  proposedPlanPattern,
  resolveAssistantDisplayContent,
  resolveTurnDurationLabel,
  resolveTurnSecondaryLabel,
  sanitizeAssistantDisplayContent,
  type DisplayMessage,
  type StreamStatusItem,
} from "./view-helpers";
import {
  AiPanelRuntimeFeedBlock,
  AiPanelStreamStatusBlock,
} from "./runtime-feed-block";
import { StatusEmptyState } from "./status-primitives";
import type { LyraTurnPlanState } from "./use-lyra-thread-runtime";

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

type AiPanelThreadViewProps = {
  readonly logoUrl: string;
  readonly locale: WorkbenchLocale;
  readonly isZhLocale: boolean;
  readonly title: string;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly showEmptySessionScene: boolean;
  readonly isLoading: boolean;
  readonly loadingSessionLabel: string;
  readonly emptyThreadLabel: string;
  readonly threadRef: RefObject<HTMLDivElement>;
  readonly threadStyle: CSSProperties;
  readonly sortedMessages: readonly DisplayMessage[];
  readonly turnsById: ReadonlyMap<string, AgentTurn>;
  readonly toolCallsByTurn: ReadonlyMap<string, AgentToolCall[]>;
  readonly runtimeFeedByTurn: ReadonlyMap<string, AgentRuntimeFeedItem[]>;
  readonly turnTimelineByTurn: ReadonlyMap<string, readonly AgentTurnTimelineItem[]>;
  readonly assistantMessageOrderById: ReadonlyMap<string, number>;
  readonly turnWorkingLabel: string;
  readonly turnWorkedForPrefix: string;
  readonly turnNoToolCallsLabel: string;
  readonly turnFailedLabel: string;
  readonly toolNameLabels: ToolNameLabelMap;
  readonly toolStatusRunningLabel: string;
  readonly toolStatusCompletedLabel: string;
  readonly toolStatusFailedLabel: string;
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: (
    path: string,
    options?: {
      readonly forceReloadIfOpen?: boolean;
      readonly allowMissing?: boolean;
      readonly location?: { readonly line: number };
    }
  ) => Promise<void>;
  readonly typewriterText: string;
  readonly streamingTurnRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingStatus: StreamStatusItem | null;
  readonly orphanRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly runtimeError: string | null;
  readonly planByTurn: Readonly<Record<string, LyraTurnPlanState>>;
  readonly latestPlanTurnId: string | null;
  readonly planActionsEnabled: boolean;
  readonly copyMessageLabel: string;
  readonly copiedMessageLabel: string;
  readonly forkResponseLabel: string;
  readonly regenerateResponseLabel: string;
  readonly editMessageLabel: string;
  readonly onForkTurn: (turnId: string) => void;
  readonly onRegenerateTurn: (turnId: string) => void;
  readonly onEditMessageTurn: (turnId: string, content: string) => void;
  readonly onPlanApprovalDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
  readonly onOpenPlanApprovalInPanel: (requestId: string) => void;
  readonly onOpenThread?: (threadId: string) => void;
};

export const AiPanelThreadView = memo(({
  logoUrl,
  locale,
  isZhLocale,
  title,
  richRenderingEnabled,
  themeSignature,
  showEmptySessionScene,
  isLoading,
  loadingSessionLabel,
  emptyThreadLabel,
  threadRef,
  threadStyle,
  sortedMessages,
  turnsById,
  toolCallsByTurn,
  runtimeFeedByTurn,
  turnTimelineByTurn,
  assistantMessageOrderById,
  turnWorkingLabel,
  turnWorkedForPrefix,
  turnNoToolCallsLabel,
  turnFailedLabel,
  toolNameLabels,
  toolStatusRunningLabel,
  toolStatusCompletedLabel,
  toolStatusFailedLabel,
  pendingInteractionQueue,
  canOpenFilePath,
  openRuntimeTargetPath,
  typewriterText,
  streamingTurnRuntimeFeed,
  streamingStatus,
  orphanRuntimeFeed,
  runtimeError,
  planByTurn,
  latestPlanTurnId,
  planActionsEnabled,
  copyMessageLabel,
  copiedMessageLabel,
  forkResponseLabel,
  regenerateResponseLabel,
  editMessageLabel,
  onForkTurn,
  onRegenerateTurn,
  onEditMessageTurn,
  onPlanApprovalDecision,
  onOpenPlanApprovalInPanel,
  onOpenThread,
}: AiPanelThreadViewProps) => (
  <>
    {showEmptySessionScene ? (
      <div className="lyra-ai-agent-empty-scene">
        <div className="lyra-ai-agent-empty-hero">
          <LyraBrandLogo
            logoUrl={logoUrl}
            className="lyra-ai-agent-empty-logo"
          />
          <StatusEmptyState
            title={isLoading ? loadingSessionLabel : emptyThreadLabel}
            loading={isLoading}
            spinnerVariant={isLoading ? "sand" : "dots"}
            tone={isLoading ? "info" : "muted"}
            className="lyra-ai-agent-empty-state-card"
          />
        </div>
      </div>
    ) : null}
    <div
      ref={threadRef}
      className="lyra-ai-agent-thread"
      aria-label={title}
      style={threadStyle}
    >
      {sortedMessages.length === 0
        ? null
        : sortedMessages.map((message, messageIndex) => {
          const isUserMessage = message.role === "user";
          const isOptimistic = isOptimisticUserMessage(message);
          const turnId = "turnId" in message && typeof message.turnId === "string"
            ? message.turnId
            : null;
          const turn = turnId === null ? null : (turnsById.get(turnId) ?? null);
          const canRewriteTurn = turn !== null && turn.status !== "running";
          const turnToolCalls = turnId === null ? [] : (toolCallsByTurn.get(turnId) ?? []);
          const assistantOrder = assistantMessageOrderById.get(message.id) ?? null;
          const turnDurationLabel =
            turn === null || turn.status === "running"
              ? null
              : resolveTurnDurationLabel(turn, turnWorkingLabel, turnWorkedForPrefix);
          const turnToolSummaryLabel =
            turn === null
              ? null
              : resolveTurnSecondaryLabel(
                  turn,
                  turnToolCalls,
                  toolNameLabels,
                  turnNoToolCallsLabel,
                  turnFailedLabel
                );
          const showToolSummary = turnToolCalls.length > 0 && turnToolSummaryLabel !== null;
          const turnRuntimeFeed =
            turnId !== null && message.role === "assistant"
              ? (runtimeFeedByTurn.get(turnId) ?? [])
              : [];
          const turnTimeline =
            turnId !== null && message.role === "assistant"
              ? (turnTimelineByTurn.get(turnId) ?? [])
              : [];
          const isFirstAssistantMessageForTurn =
            !isUserMessage
            && turnId !== null
            && sortedMessages.findIndex((candidate) =>
              candidate.role === "assistant"
              && "turnId" in candidate
              && candidate.turnId === turnId
            ) === messageIndex;
          const fallbackTimeline =
            turnTimeline.length === 0
              ? [
                  {
                    kind: "assistant" as const,
                    id: `${message.id}-assistant-fallback`,
                    timestamp: message.createdAt,
                    content: resolveAssistantDisplayContent(message)
                  },
                  ...turnRuntimeFeed.map((item) => ({
                    kind: "tool" as const,
                    id: `tool-${item.id}`,
                    timestamp: item.timestamp,
                    tool: item
                  }))
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
            displayTimeline.push({
              ...entry,
              content
            });
          }
          const lastAssistantTimelineIndex = displayTimeline.reduce(
            (lastIndex, entry, index) => (entry.kind === "assistant" ? index : lastIndex),
            -1
          );
          const displayMessageContent = isUserMessage
            ? message.content
            : resolveAssistantDisplayContent(message);
          const messageTimeLabel = formatMessageTime(message.createdAt, locale);
          const planForTurn = turnId === null ? undefined : planByTurn[turnId];
          const shouldRenderPlanAfterMessage =
            turnId !== null
            && planForTurn !== undefined
            && message.role === "assistant"
            && sortedMessages.findIndex((candidate) =>
              candidate.role === "assistant"
              && "turnId" in candidate
              && candidate.turnId === turnId
            ) === messageIndex;
          const messagePlanApprovalRequest =
            turnId === null
              ? null
              : pendingInteractionQueue.find(
                  (interaction): interaction is Extract<PendingInteractionPanel, { kind: "planApproval" }> =>
                    interaction.kind === "planApproval" && interaction.request.turnId === turnId
                )?.request
                ?? null;
          const hasPlanActions =
            message.role === "assistant"
            && proposedPlanPattern.test(message.content)
            && messagePlanApprovalRequest !== null;
          const isLastAssistantMessageForTurn =
            !isUserMessage
            && turnId !== null
            && sortedMessages.findIndex((candidate, candidateIndex) =>
              candidateIndex > messageIndex
              && candidate.role === "assistant"
              && "turnId" in candidate
              && candidate.turnId === turnId
            ) === -1;

          if (!isUserMessage && turnId !== null && !isFirstAssistantMessageForTurn) {
            return null;
          }

          return (
            <Fragment key={message.id}>
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
                        const shouldAttachPlanActions =
                          hasPlanActions
                          && timelineIndex === lastAssistantTimelineIndex;
                        nodes.push(
                          <div
                            key={timelineEntry.id}
                            className="lyra-ai-agent-turn-timeline-item lyra-ai-agent-turn-timeline-item-assistant"
                          >
                            {richRenderingEnabled ? (
                              <AiPanelRichContent
                                content={timelineEntry.content}
                                locale={locale}
                                {...(shouldAttachPlanActions
                                  ? {
                                      planActions: {
                                        onApprove: () => {
                                          void onPlanApprovalDecision({
                                            requestId: messagePlanApprovalRequest!.id,
                                            decision: "approve_and_implement",
                                          }, messagePlanApprovalRequest!);
                                        },
                                        onKeepPlanning: () => {
                                          void onPlanApprovalDecision({
                                            requestId: messagePlanApprovalRequest!.id,
                                            decision: "keep_planning",
                                          }, messagePlanApprovalRequest!);
                                        },
                                        onReject: () => {
                                          void onPlanApprovalDecision({
                                            requestId: messagePlanApprovalRequest!.id,
                                            decision: "reject",
                                          }, messagePlanApprovalRequest!);
                                        },
                                        onOpenInPanel: () => {
                                          onOpenPlanApprovalInPanel(messagePlanApprovalRequest!.id);
                                        }
                                      }
                                    }
                                  : {})}
                                {...(themeSignature === undefined ? {} : { themeSignature })}
                              />
                            ) : (
                              <div className="lyra-ai-agent-message-content">{timelineEntry.content}</div>
                            )}
                          </div>
                        );
                      }
                      return nodes;
                    })()}
                  </div>
                  {!showToolSummary ? null : (
                    <details className="lyra-ai-agent-turn-tools-details">
                      <summary className="lyra-ai-agent-turn-tools-summary">
                        {(isZhLocale ? "工具总结" : "Tool Summary")}
                      </summary>
                      <div className="lyra-ai-agent-turn-tools-content">
                        {turnToolSummaryLabel}
                      </div>
                    </details>
                  )}
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
                        }
                      }
                    : {})}
                  {...(isUserMessage && turnId !== null && canRewriteTurn && !isOptimistic
                    ? {
                        editLabel: editMessageLabel,
                        onEdit: () => {
                          onEditMessageTurn(turnId, displayMessageContent);
                        }
                      }
                    : {})}
                />
                </div>
              </div>
              {shouldRenderPlanAfterMessage ? (
                <div className="lyra-ai-agent-message lyra-ai-agent-message-assistant lyra-ai-agent-message-plan">
                  <PlanCard
                    locale={locale}
                    plan={planForTurn}
                    richRenderingEnabled={richRenderingEnabled}
                    {...(themeSignature === undefined ? {} : { themeSignature })}
                    showActions={planActionsEnabled && turnId === latestPlanTurnId}
                    onApprove={() => {
                      void onPlanApprovalDecision({
                        requestId: `plan:${turnId}`,
                        decision: "approve_and_implement",
                      });
                    }}
                    onKeepPlanning={() => {
                      void onPlanApprovalDecision({
                        requestId: `plan:${turnId}`,
                        decision: "keep_planning",
                      });
                    }}
                    onReject={() => {
                      void onPlanApprovalDecision({
                        requestId: `plan:${turnId}`,
                        decision: "reject",
                      });
                    }}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      {typewriterText.length === 0 && streamingTurnRuntimeFeed.length === 0 && streamingStatus === null ? null : (
        <div className="lyra-ai-agent-message lyra-ai-agent-message-assistant">
          {typewriterText.length > 0 || streamingStatus === null
            ? null
            : <AiPanelStreamStatusBlock status={streamingStatus} />}
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
          {typewriterText.length === 0 || streamingStatus === null ? null : (
            <AiPanelStreamStatusBlock status={streamingStatus} />
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
        </div>
      )}
      {orphanRuntimeFeed.length === 0 ? null : (
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
      )}
      {runtimeError === null ? null : (
        <div className="lyra-ai-agent-runtime-error">{runtimeError}</div>
      )}
    </div>
  </>
));

AiPanelThreadView.displayName = "AiPanelThreadView";
