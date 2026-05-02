import { memo, type CSSProperties, type RefObject } from "react";

import type {
  AgentTurn,
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import { LyraBrandLogo } from "../brand";
import type { WorkbenchLocale } from "../i18n";
import type {
  PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";
import {
  type AgentRuntimeFeedItem,
  type AgentTurnTimelineItem,
} from "./runtime/feed-utils";
import {
  type StreamStatusItem,
} from "./view-helpers";
import {
  AiPanelMessageRow,
  AiPanelOrphanRuntimeFeedRow,
  AiPanelPlanRow,
  AiPanelStreamingRow,
} from "./thread-rows";
import { StatusEmptyState } from "./status-primitives";
import {
  type AiPanelThreadMessageMetadata,
  type AiPanelThreadRenderRow,
} from "./thread-render-model";
import type { AiPanelThreadVirtualRow } from "./use-ai-panel-thread-virtual-rows-model";

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
  readonly messageMetadata: AiPanelThreadMessageMetadata;
  readonly virtualRows: readonly AiPanelThreadVirtualRow[];
  readonly topSpacerHeight: number;
  readonly bottomSpacerHeight: number;
  readonly measureRow: (rowKey: string, node: HTMLDivElement | null) => void;
  readonly turnsById: ReadonlyMap<string, AgentTurn>;
  readonly runtimeFeedByTurn: ReadonlyMap<string, AgentRuntimeFeedItem[]>;
  readonly turnTimelineByTurn: ReadonlyMap<string, readonly AgentTurnTimelineItem[]>;
  readonly assistantMessageOrderById: ReadonlyMap<string, number>;
  readonly turnWorkingLabel: string;
  readonly turnWorkedForPrefix: string;
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
  readonly onOpenPlanApprovalInWorkspace?: (request: PlanApprovalRequest) => void;
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
  messageMetadata,
  virtualRows,
  topSpacerHeight,
  bottomSpacerHeight,
  measureRow,
  turnsById,
  runtimeFeedByTurn,
  turnTimelineByTurn,
  assistantMessageOrderById,
  turnWorkingLabel,
  turnWorkedForPrefix,
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
  onOpenPlanApprovalInWorkspace,
  onOpenThread,
}: AiPanelThreadViewProps) => {
  const renderRow = (row: AiPanelThreadRenderRow) => {
    switch (row.kind) {
      case "message":
        return (
          <AiPanelMessageRow
            row={row}
            locale={locale}
            isZhLocale={isZhLocale}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            messageMetadata={messageMetadata}
            turnsById={turnsById}
            runtimeFeedByTurn={runtimeFeedByTurn}
            turnTimelineByTurn={turnTimelineByTurn}
            assistantMessageOrderById={assistantMessageOrderById}
            turnWorkingLabel={turnWorkingLabel}
            turnWorkedForPrefix={turnWorkedForPrefix}
            toolStatusRunningLabel={toolStatusRunningLabel}
            toolStatusCompletedLabel={toolStatusCompletedLabel}
            toolStatusFailedLabel={toolStatusFailedLabel}
            canOpenFilePath={canOpenFilePath}
            openRuntimeTargetPath={openRuntimeTargetPath}
            copyMessageLabel={copyMessageLabel}
            copiedMessageLabel={copiedMessageLabel}
            forkResponseLabel={forkResponseLabel}
            regenerateResponseLabel={regenerateResponseLabel}
            editMessageLabel={editMessageLabel}
            onForkTurn={onForkTurn}
            onRegenerateTurn={onRegenerateTurn}
            onEditMessageTurn={onEditMessageTurn}
            {...(onOpenThread === undefined ? {} : { onOpenThread })}
          />
        );
      case "plan":
        return (
          <AiPanelPlanRow
            row={row}
            locale={locale}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            latestPlanTurnId={latestPlanTurnId}
            planActionsEnabled={planActionsEnabled}
            pendingInteractionQueue={pendingInteractionQueue}
            onPlanApprovalDecision={onPlanApprovalDecision}
            {...(onOpenPlanApprovalInWorkspace === undefined
              ? {}
              : { onOpenPlanApprovalInWorkspace })}
          />
        );
      case "streaming":
        return (
          <AiPanelStreamingRow
            locale={locale}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            typewriterText={typewriterText}
            streamingTurnRuntimeFeed={streamingTurnRuntimeFeed}
            streamingStatus={streamingStatus}
            canOpenFilePath={canOpenFilePath}
            openRuntimeTargetPath={openRuntimeTargetPath}
            toolStatusRunningLabel={toolStatusRunningLabel}
            toolStatusCompletedLabel={toolStatusCompletedLabel}
            toolStatusFailedLabel={toolStatusFailedLabel}
            {...(onOpenThread === undefined ? {} : { onOpenThread })}
          />
        );
      case "orphanRuntimeFeed":
        return (
          <AiPanelOrphanRuntimeFeedRow
            orphanRuntimeFeed={orphanRuntimeFeed}
            canOpenFilePath={canOpenFilePath}
            openRuntimeTargetPath={openRuntimeTargetPath}
            toolStatusRunningLabel={toolStatusRunningLabel}
            toolStatusCompletedLabel={toolStatusCompletedLabel}
            toolStatusFailedLabel={toolStatusFailedLabel}
            {...(onOpenThread === undefined ? {} : { onOpenThread })}
          />
        );
      case "runtimeError":
        return <div className="lyra-ai-agent-runtime-error">{row.message}</div>;
    }
  };

  return (
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
        {topSpacerHeight === 0 ? null : (
          <div
            className="lyra-ai-agent-thread-virtual-spacer"
            style={{ height: topSpacerHeight }}
          />
        )}
        {virtualRows.map(({ row }) => (
          <div
            key={row.key}
            ref={(node) => {
              measureRow(row.key, node);
            }}
            className="lyra-ai-agent-thread-row"
          >
            {renderRow(row)}
          </div>
        ))}
        {bottomSpacerHeight === 0 ? null : (
          <div
            className="lyra-ai-agent-thread-virtual-spacer"
            style={{ height: bottomSpacerHeight }}
          />
        )}
      </div>
    </>
  );
});

AiPanelThreadView.displayName = "AiPanelThreadView";
