import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

import type { AgentSessionDetail } from "./agent-ui-types";
import {
  activeRollbackPreview,
  rollbackImpactLabel,
  rollbackPreviewCounts,
  rollbackTone,
} from "./rollback-preview-model";

type RollbackPreviewRowProps = {
  readonly detail: AgentSessionDetail | null;
};

export const RollbackPreviewRow = ({ detail }: RollbackPreviewRowProps) => {
  const preview = activeRollbackPreview(detail?.recoverySummary);
  if (preview === null) {
    return null;
  }
  const tone = rollbackTone(preview.impactLevel);
  return (
    <section
      className="lyra-ai-rollback-preview-row"
      data-impact={tone}
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
          {rollbackPreviewCounts(preview)}
        </span>
      </span>
      <button
        className="lyra-ai-rollback-preview-disabled-action"
        type="button"
        disabled
        aria-label="Rollback execution unavailable"
        title="Rollback execution is not available in this version"
      >
        Preview only
      </button>
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
