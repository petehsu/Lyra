import type { CSSProperties, RefObject } from "react";

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
import { MessageActions } from "./message-actions";
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
  readonly onPlanApprovalDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
  readonly onOpenPlanApprovalInPanel: (requestId: string) => void;
};

export const AiPanelThreadView = ({
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
  pendingInteractionQueue,
  canOpenFilePath,
  openRuntimeTargetPath,
  typewriterText,
  streamingTurnRuntimeFeed,
  streamingStatus,
  orphanRuntimeFeed,
  runtimeError,
  onPlanApprovalDecision,
  onOpenPlanApprovalInPanel,
}: AiPanelThreadViewProps) => (
  <>
    {showEmptySessionScene ? (
      <div className="lyra-ai-agent-empty-scene" aria-hidden="true">
        <div className="lyra-ai-agent-empty-hero">
          <LyraBrandLogo
            logoUrl={logoUrl}
            className="lyra-ai-agent-empty-logo"
          />
          <span className="lyra-ai-agent-empty-copy">
            {isLoading ? loadingSessionLabel : emptyThreadLabel}
          </span>
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
        : sortedMessages.map((message) => {
          const isUserMessage = message.role === "user";
          const isOptimistic = isOptimisticUserMessage(message);
          const turnId = "turnId" in message && typeof message.turnId === "string"
            ? message.turnId
            : null;
          const turn = turnId === null ? null : (turnsById.get(turnId) ?? null);
          const turnToolCalls = turnId === null ? [] : (toolCallsByTurn.get(turnId) ?? []);
          const assistantOrder = assistantMessageOrderById.get(message.id) ?? null;
          const turnDurationLabel =
            turn === null ? null : resolveTurnDurationLabel(turn, turnWorkingLabel, turnWorkedForPrefix);
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

          return (
            <div
              key={message.id}
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
              <MessageActions
                content={displayMessageContent}
                messageType={isUserMessage ? "user" : "assistant"}
              />
              {isUserMessage || !richRenderingEnabled ? (
                <div className="lyra-ai-agent-message-content">{displayMessageContent}</div>
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
                                openRuntimeTargetPath={openRuntimeTargetPath}
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
                  {assistantOrder === null || turnDurationLabel === null ? null : (
                    <div className="lyra-ai-agent-turn-footer">
                      <span className="lyra-ai-agent-turn-footer-index">
                        {(isZhLocale ? "消息" : "Message")}
                        ·
                        {String(assistantOrder)}
                      </span>
                      <span className="lyra-ai-agent-turn-footer-duration">
                        {turnDurationLabel}
                      </span>
                    </div>
                  )}
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
            </div>
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
          {streamingTurnRuntimeFeed.length === 0 ? null : (
            <AiPanelRuntimeFeedBlock
              items={streamingTurnRuntimeFeed}
              canOpenPath={canOpenFilePath}
              openRuntimeTargetPath={openRuntimeTargetPath}
            />
          )}
        </div>
      )}
      {orphanRuntimeFeed.length === 0 ? null : (
        <div className="lyra-ai-agent-runtime-block-orphan">
          <AiPanelRuntimeFeedBlock
            items={orphanRuntimeFeed}
            canOpenPath={canOpenFilePath}
            openRuntimeTargetPath={openRuntimeTargetPath}
          />
        </div>
      )}
      {runtimeError === null ? null : (
        <div className="lyra-ai-agent-runtime-error">{runtimeError}</div>
      )}
    </div>
  </>
);
