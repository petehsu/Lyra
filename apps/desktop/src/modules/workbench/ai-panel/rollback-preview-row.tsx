import { useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";

import type {
  AgentExecuteMessageRollbackRequest,
  AgentExecuteMessageRollbackResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import {
  activeRollbackPreview,
  canExecuteRollbackPreview,
  matchingRollbackExecution,
  rollbackImpactLabel,
  rollbackPreviewCounts,
  rollbackTone,
} from "./rollback-preview-model";

type RollbackPreviewRowProps = {
  readonly detail: AgentSessionDetail | null;
  readonly executeMessageRollback?:
    | ((request: AgentExecuteMessageRollbackRequest) => Promise<AgentExecuteMessageRollbackResult>)
    | undefined;
  readonly onExecuteComplete?: (() => Promise<void> | void) | undefined;
};

export const RollbackPreviewRow = ({
  detail,
  executeMessageRollback,
  onExecuteComplete,
}: RollbackPreviewRowProps) => {
  const [executingRollbackId, setExecutingRollbackId] = useState<string | null>(null);
  const [localResult, setLocalResult] = useState<AgentExecuteMessageRollbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = activeRollbackPreview(detail?.recoverySummary);
  if (preview === null) {
    return null;
  }
  const tone = rollbackTone(preview.impactLevel);
  const execution =
    localResult?.rollbackId === preview.rollbackId
      ? localResult
      : matchingRollbackExecution(detail?.recoverySummary, preview);
  const isExecuting = executingRollbackId === preview.rollbackId;
  const isRestored = preview.status === "executed" || execution?.status === "completed";
  const isBlocked =
    preview.status === "blocked" || execution?.status === "blocked" || tone !== "safe";
  const canRestore =
    canExecuteRollbackPreview(preview)
    && executeMessageRollback !== undefined
    && isRestored === false
    && isBlocked === false;
  const detailText = execution?.detail ?? rollbackPreviewCounts(preview);
  return (
    <section
      className="lyra-ai-rollback-preview-row"
      data-impact={tone}
      data-status={execution?.status ?? preview.status}
      aria-label="Rollback preview"
    >
      <span className="lyra-ai-rollback-preview-icon" aria-hidden="true">
        {iconForTone(tone)}
      </span>
      <span className="lyra-ai-rollback-preview-main">
        <span className="lyra-ai-rollback-preview-title">
          {rollbackImpactLabel(preview.impactLevel)}
        </span>
        <span className="lyra-ai-rollback-preview-detail">
          {detailText}
        </span>
        {error === null ? null : (
          <span className="lyra-ai-rollback-preview-error">{error}</span>
        )}
      </span>
      {canRestore ? (
        <button
          className="lyra-ai-rollback-preview-action"
          type="button"
          disabled={isExecuting}
          aria-label="Restore rollback preview"
          title="Restore this safe rollback preview"
          onClick={() => {
            setExecutingRollbackId(preview.rollbackId);
            setError(null);
            void executeMessageRollback({
              sessionId: preview.sessionId,
              rollbackId: preview.rollbackId,
              confirmationToken: `restore:${preview.rollbackId}`,
              strategy: "safe_only",
            })
              .then(async (result) => {
                setLocalResult(result);
                if (result.status !== "completed") {
                  setError(result.detail);
                }
                await onExecuteComplete?.();
              })
              .catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : String(reason));
              })
              .finally(() => {
                setExecutingRollbackId(null);
              });
          }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          {isExecuting ? "Restoring" : "Restore"}
        </button>
      ) : (
        <span className="lyra-ai-rollback-preview-status">
          {isRestored ? "Restored" : isBlocked ? "Blocked" : "Preview only"}
        </span>
      )}
    </section>
  );
};

const iconForTone = (tone: ReturnType<typeof rollbackTone>) => {
  switch (tone) {
    case "conflict":
      return <AlertTriangle size={13} />;
    case "external":
    case "destructive":
      return <ShieldAlert size={13} />;
    default:
      return <CheckCircle2 size={13} />;
  }
};
