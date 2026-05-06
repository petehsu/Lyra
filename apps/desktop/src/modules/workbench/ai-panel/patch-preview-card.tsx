import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileDiff, Loader2, Play, X } from "lucide-react";

import type {
  AgentApplyPatchResult,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
} from "./agent-ui-types";
import { DiffPreview } from "./diff-preview";
import {
  changedFilesSummary,
  formatPatchTotals,
  patchProposalTotals,
  type PatchProposalEvent,
} from "./patch-artifact";
import { usePatchArtifact, type ReadPatchArtifact } from "./use-patch-artifact";

type PatchPreviewCardProps = {
  readonly proposal: PatchProposalEvent;
  readonly expanded: boolean;
  readonly onToggle: (key: string) => void;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?: ((request: {
    readonly sessionId: string;
    readonly artifactId?: string;
    readonly patchRef?: string;
  }) => Promise<AgentApplyPatchResult>) | undefined;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
  readonly applied?: boolean | undefined;
  readonly denied?: boolean | undefined;
  readonly approvalRequired?: boolean | undefined;
  readonly approvalTicketId?: string | null | undefined;
};

export const PatchPreviewCard = ({
  proposal,
  expanded,
  onToggle,
  readArtifact,
  applyPatch,
  resolveApproval,
  applied = false,
  denied = false,
  approvalRequired = false,
  approvalTicketId = null,
}: PatchPreviewCardProps) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const [applyState, setApplyState] = useState<"idle" | "applying" | "applied" | "error">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const loadState = usePatchArtifact({
    proposal,
    enabled: expanded,
    readArtifact,
  });
  const effectiveApplied = applied;
  const effectiveDenied = denied;
  const changedFiles = loadState.artifact?.changedFiles ?? proposal.changedFiles;
  const totals = patchProposalTotals(changedFiles);
  const detail = changedFilesSummary(changedFiles)
    ?? proposal.patchRef
    ?? proposal.artifactId
    ?? "Patch artifact";
  const refs = [
    proposal.patchRef ?? proposal.resultRef,
    proposal.artifactId === null ? null : `artifact ${proposal.artifactId}`,
  ].filter((value): value is string => value !== null);
  const applyRequest = useMemo(() => {
    if (proposal.artifactId !== null) {
      return {
        sessionId: proposal.sessionId,
        artifactId: proposal.artifactId,
      };
    }
    const patchRef = proposal.patchRef ?? proposal.resultRef;
    if (patchRef !== null) {
      return {
        sessionId: proposal.sessionId,
        patchRef,
      };
    }
    return null;
  }, [proposal.artifactId, proposal.patchRef, proposal.resultRef, proposal.sessionId]);
  const canApply =
    !effectiveDenied
    && !effectiveApplied
    && applyState !== "applying";
  const canResolveApproval =
    approvalTicketId !== null
    && resolveApproval !== undefined
    && canApply;
  const canDirectApply =
    applyPatch !== undefined
    && applyRequest !== null
    && canApply;
  const hasApplyControl =
    (applyPatch !== undefined && applyRequest !== null)
    || (resolveApproval !== undefined && approvalTicketId !== null);

  const handleApply = async () => {
    if (!canResolveApproval && !canDirectApply) {
      return;
    }
    setApplyState("applying");
    setApplyError(null);
    try {
      const ticketId = approvalTicketId;
      if (canResolveApproval && ticketId !== null) {
        await resolveApproval({
          sessionId: proposal.sessionId,
          approvalTicketId: ticketId,
          decision: "approve",
        });
      } else if (applyRequest !== null && applyPatch !== undefined) {
        await applyPatch(applyRequest);
      }
      setApplyState("idle");
    } catch (error) {
      setApplyState("error");
      setApplyError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (applied || denied) {
      setApplyState("idle");
      setApplyError(null);
    }
  }, [applied, denied]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const element = cardRef.current;
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [expanded, proposal.key]);

  return (
    <article ref={cardRef} className="lyra-ai-patch-preview-card">
      <button
        type="button"
        className="lyra-ai-patch-preview-toggle"
        aria-expanded={expanded}
        onClick={() => {
          onToggle(proposal.key);
        }}
      >
        <span className="lyra-ai-patch-preview-icon">
          <FileDiff size={14} aria-hidden="true" />
        </span>
        <span className="lyra-ai-patch-preview-main">
          <span className="lyra-ai-patch-preview-title">
            {loadState.artifact?.title ?? proposal.summary}
          </span>
          <span className="lyra-ai-patch-preview-detail">
            {formatPatchTotals(totals)} · {effectiveApplied ? "Applied" : effectiveDenied ? "Denied" : "Preview only · Not applied or tested"}
          </span>
          <span className="lyra-ai-patch-preview-paths">{detail}</span>
        </span>
        <span className="lyra-ai-patch-preview-refs">{refs.join(" · ")}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={expanded ? "lyra-ai-patch-preview-chevron-open" : ""}
        />
      </button>

      {expanded ? (
        <div className="lyra-ai-patch-preview-body">
          <div className="lyra-ai-patch-preview-actions">
            <span className="lyra-ai-patch-preview-actions-status">
              {effectiveApplied
                ? "Applied"
                : effectiveDenied
                  ? "Denied"
                : applyState === "applying"
                  ? "Applying"
                  : applyState === "error"
                    ? "Apply failed"
                    : approvalRequired
                      ? "Approval required"
                      : "Ready to apply"}
            </span>
            {hasApplyControl ? (
              <button
                type="button"
                className="lyra-ai-patch-preview-apply"
                disabled={!canResolveApproval && !canDirectApply}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleApply();
                }}
              >
                {effectiveApplied ? (
                  <Check size={13} aria-hidden="true" />
                ) : effectiveDenied ? (
                  <X size={13} aria-hidden="true" />
                ) : applyState === "applying" ? (
                  <Loader2 size={13} aria-hidden="true" />
                ) : (
                  <Play size={13} aria-hidden="true" />
                )}
                <span>{effectiveApplied ? "Applied" : effectiveDenied ? "Denied" : applyState === "applying" ? "Applying" : "Apply"}</span>
              </button>
            ) : null}
          </div>
          {loadState.status === "loading" ? (
            <div className="lyra-ai-patch-preview-status">Loading patch preview...</div>
          ) : null}
          {loadState.status === "error" ? (
            <div className="lyra-ai-patch-preview-error" role="alert">
              {loadState.error}
            </div>
          ) : null}
          {applyError === null ? null : (
            <div className="lyra-ai-patch-preview-error" role="alert">
              {applyError}
            </div>
          )}
          {loadState.status === "ready" ? (
            <DiffPreview
              content={loadState.artifact.content}
              changedFiles={loadState.artifact.changedFiles}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
};
