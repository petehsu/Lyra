import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Terminal,
} from "lucide-react";

import type {
  AgentApplyPatchResult,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import {
  isPatchProposalApplied,
  isPatchProposalDenied,
  patchApprovalForProposal,
  type PatchProposalEvent,
} from "./patch-artifact";
import { PatchPreviewCard } from "./patch-preview-card";
import type { ReadPatchArtifact } from "./use-patch-artifact";

export type DeduplicatedToolCall = {
  readonly opId: string;
  readonly toolPath: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly status: "running" | "done" | "error";
  readonly timestamp: number;
  readonly patchProposal: PatchProposalEvent | null;
};

const COLLAPSED_THRESHOLD = 5;

type ToolCallGroupProps = {
  readonly calls: readonly DeduplicatedToolCall[];
  readonly detail: AgentSessionDetail | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?:
    | ((request: {
        readonly sessionId: string;
        readonly artifactId?: string;
        readonly patchRef?: string;
      }) => Promise<AgentApplyPatchResult>)
    | undefined;
  readonly resolveApproval?:
    | ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>)
    | undefined;
};

export const ToolCallGroup = ({
  calls,
  detail,
  expandedPatchKey = null,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
}: ToolCallGroupProps) => {
  const [expanded, setExpanded] = useState(false);
  if (calls.length === 0) {
    return null;
  }
  const shouldCollapse = calls.length > COLLAPSED_THRESHOLD && !expanded;
  const visibleCalls = shouldCollapse ? calls.slice(0, 3) : calls;
  const hiddenCount = calls.length - visibleCalls.length;

  return (
    <div className="lyra-ai-tool-call-group">
      {visibleCalls.map((call) =>
        call.patchProposal !== null ? (
          <PatchCallRow
            key={call.opId}
            proposal={call.patchProposal}
            detail={detail}
            expandedPatchKey={expandedPatchKey}
            onPatchExpandedChange={onPatchExpandedChange}
            readArtifact={readArtifact}
            applyPatch={applyPatch}
            resolveApproval={resolveApproval}
          />
        ) : (
          <ToolCallRow key={call.opId} call={call} />
        )
      )}
      {shouldCollapse ? (
        <button
          type="button"
          className="lyra-ai-tool-call-expand"
          onClick={() => {
            setExpanded(true);
          }}
        >
          <ChevronRight size={12} aria-hidden="true" />
          <span>{hiddenCount} more tool calls</span>
        </button>
      ) : null}
    </div>
  );
};

const ToolCallRow = ({ call }: { readonly call: DeduplicatedToolCall }) => (
  <div className="lyra-ai-tool-call-row" data-status={call.status}>
    <span className="lyra-ai-tool-call-icon" aria-hidden="true">
      {toolCallIcon(call.toolPath, call.status)}
    </span>
    <span className="lyra-ai-tool-call-summary">{call.summary}</span>
    {call.detail !== null ? (
      <span className="lyra-ai-tool-call-detail">{call.detail}</span>
    ) : null}
  </div>
);

const PatchCallRow = ({
  proposal,
  detail,
  expandedPatchKey,
  onPatchExpandedChange,
  readArtifact,
  applyPatch,
  resolveApproval,
}: {
  readonly proposal: PatchProposalEvent;
  readonly detail: AgentSessionDetail | null;
  readonly expandedPatchKey?: string | null | undefined;
  readonly onPatchExpandedChange?: ((key: string | null) => void) | undefined;
  readonly readArtifact?: ReadPatchArtifact | undefined;
  readonly applyPatch?:
    | ((request: {
        readonly sessionId: string;
        readonly artifactId?: string;
        readonly patchRef?: string;
      }) => Promise<AgentApplyPatchResult>)
    | undefined;
  readonly resolveApproval?:
    | ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>)
    | undefined;
}) => {
  const patchExpanded = expandedPatchKey === proposal.key;
  const approval = patchApprovalForProposal(detail, proposal);
  return (
    <div className="lyra-ai-tool-call-patch">
      <PatchPreviewCard
        proposal={proposal}
        expanded={patchExpanded}
        readArtifact={readArtifact}
        applyPatch={applyPatch}
        resolveApproval={resolveApproval}
        applied={isPatchProposalApplied(detail, proposal)}
        denied={isPatchProposalDenied(detail, proposal)}
        approvalRequired={approval !== null}
        approvalTicketId={approval?.approvalTicketId ?? null}
        onToggle={(key) => {
          onPatchExpandedChange?.(patchExpanded ? null : key);
        }}
      />
    </div>
  );
};

const toolCallIcon = (toolPath: string, status: string) => {
  if (status === "error") {
    return <AlertTriangle size={12} aria-hidden="true" />;
  }
  if (status === "running") {
    return <Loader2 size={12} aria-hidden="true" className="lyra-ai-tool-call-spinner" />;
  }
  if (toolPath.startsWith("/tools/git")) {
    return <GitBranch size={12} aria-hidden="true" />;
  }
  if (toolPath.startsWith("/tools/shell") || toolPath.includes("/run_command")) {
    return <Terminal size={12} aria-hidden="true" />;
  }
  if (
    toolPath.includes("/list_files") ||
    toolPath.includes("/walk_directory") ||
    toolPath === "/tools/filesystem"
  ) {
    return <FolderOpen size={12} aria-hidden="true" />;
  }
  if (
    toolPath.includes("/read_file") ||
    toolPath.includes("/read_range") ||
    toolPath.includes("/stat_path")
  ) {
    return <FileText size={12} aria-hidden="true" />;
  }
  if (toolPath.includes("/search") || toolPath.startsWith("/tools/code")) {
    return <FileSearch size={12} aria-hidden="true" />;
  }
  return <CheckCircle2 size={12} aria-hidden="true" />;
};
