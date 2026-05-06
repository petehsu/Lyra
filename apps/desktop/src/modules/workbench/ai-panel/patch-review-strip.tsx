import { FileDiff } from "lucide-react";

import {
  formatPatchTotals,
  latestPendingPatchProposalEvent,
  patchProposalTotals,
} from "./patch-artifact";
import type { AgentSessionDetail } from "./agent-ui-types";

type PatchReviewStripProps = {
  readonly detail: AgentSessionDetail | null;
  readonly expandedPatchKey: string | null;
  readonly onSelectPatch: (key: string) => void;
};

export const PatchReviewStrip = ({
  detail,
  expandedPatchKey,
  onSelectPatch,
}: PatchReviewStripProps) => {
  const proposal = latestPendingPatchProposalEvent(detail);
  if (proposal === null) {
    return null;
  }
  const totals = patchProposalTotals(proposal.changedFiles);
  return (
    <button
      type="button"
      className="lyra-ai-patch-review-strip"
      aria-expanded={expandedPatchKey === proposal.key}
      onClick={() => {
        onSelectPatch(proposal.key);
      }}
    >
      <FileDiff size={14} aria-hidden="true" />
      <span>{formatPatchTotals(totals)}</span>
      <small>Preview only</small>
    </button>
  );
};
