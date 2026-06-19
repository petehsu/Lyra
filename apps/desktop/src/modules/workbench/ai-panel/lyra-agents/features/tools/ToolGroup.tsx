import { useEffect, useRef, useState } from "react";
import type { ToolCall, ToolGroup } from "../../core/types";
import {
  CheckCircleIcon,
  ChevronIcon,
  ErrorCircleIcon,
  ToolCallIcon,
} from "../../components/Icons";
import { RenderSurfaceCard, ToolDetails } from "./ToolDetails";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";
import { t } from "../../core/i18n";
import { AppButton } from "@renderer/ui/components";
import {
  InlineDiffStats,
  editDiffCounts,
  shouldShowEditDiffStats
} from "./InlineDiffStats";

type RenderToolCall = ToolCall & {
  readonly details: Extract<NonNullable<ToolCall["details"]>, { type: "render" }>;
};

/**
 * Level 1 head has three faces keyed by the group status and per-call errors:
 *   - running: current tool icon + shimmering title
 *   - error:   red ✗ icon
 *   - done:    green ✓ icon + group label
 */
export function ToolGroupBlock({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const isRunning = group.status === "running";
  const hasError = group.calls.some((c) => c.status === "error");
  const currentCall =
    isRunning && group.currentCallId
      ? group.calls.find((c) => c.id === group.currentCallId)
      : undefined;
  const renderCalls = group.calls.filter((call): call is RenderToolCall =>
    call.details?.type === "render"
  );

  const mode = isRunning ? "running" : hasError ? "error" : "done";
  const currentEditStats = editDiffCounts(currentCall?.details);
  const showGroupEditStats = shouldShowEditDiffStats(currentEditStats);

  return (
    <div className={`lyra-agents-tool-group ${open ? "open" : ""} mode-${mode}`}>
      <AppButton variant="ghost" size="sm"
        type="button"
        className="lyra-agents-tool-group-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span ref={anchorRef} className="lyra-agents-tool-group-icon-slot">
          <span className="lyra-agents-tool-group-lead">
            {isRunning && currentCall ? (
              <ToolCallIcon call={currentCall} />
            ) : hasError ? (
              <ErrorCircleIcon />
            ) : (
              <CheckCircleIcon />
            )}
          </span>
          <span className="lyra-agents-chevron-slot">
            <ChevronIcon open={open} />
          </span>
        </span>

        <span className={`lyra-agents-tool-group-label ${isRunning ? "lyra-agents-shimmer" : ""}`}>
          {isRunning && currentCall ? currentCall.title : group.label}
        </span>
        {showGroupEditStats ? (
          <InlineDiffStats
            additions={currentEditStats.additions}
            deletions={currentEditStats.deletions}
          />
        ) : null}
      </AppButton>

      {renderCalls.length > 0 ? (
        <div className="lyra-agents-tool-group-render-surfaces">
          {renderCalls.map((call) => (
            <RenderSurfaceCard key={call.id} details={call.details} />
          ))}
        </div>
      ) : null}

      {open && !anchorVisible && (
        <AppButton variant="ghost" size="sm"
          type="button"
          className="lyra-agents-fold-line lyra-agents-fold-line-group"
          onClick={() => setOpen(false)}
          aria-label={t("tool.collapseGroup")}
        />
      )}

      <div className="lyra-agents-collapse" data-open={open}>
        <div className="lyra-agents-collapse-inner">
          <div className="lyra-agents-tool-group-body">
            {group.calls.map((call, i) => (
              <div
                key={call.id}
                className="lyra-agents-stagger-item"
                style={{ "--stagger-index": i } as React.CSSProperties}
              >
                <ToolCallRow call={call} groupOpen={open} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallRow({ call, groupOpen }: { call: ToolCall; groupOpen: boolean }) {
  const isLiveEdit = call.status === "running" && call.details?.type === "edit";
  const [open, setOpen] = useState(isLiveEdit);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const hasDetails = !!call.details && call.details.type !== "render";
  const editStats = editDiffCounts(call.details);
  const showRowEditStats = shouldShowEditDiffStats(editStats);

  useEffect(() => {
    if (isLiveEdit) {
      setOpen(true);
    }
  }, [isLiveEdit, call.details]);

  return (
    <div className={`lyra-agents-tool-call ${open ? "open" : ""} status-${call.status}`}>
      <AppButton variant="ghost" size="sm"
        type="button"
        className={`lyra-agents-tool-call-head ${hasDetails ? "has-details" : ""}`}
        onClick={() => hasDetails && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetails}
      >
        <span ref={anchorRef} className="lyra-agents-icon-swap">
          <span className="lyra-agents-icon-swap-tool">
            <ToolCallIcon call={call} />
          </span>
          <span className="lyra-agents-icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span
          className={`lyra-agents-tool-call-title ${call.status === "running" ? "lyra-agents-shimmer" : ""}`}
        >
          {call.title}
        </span>
        {showRowEditStats ? (
          <InlineDiffStats
            additions={editStats.additions}
            deletions={editStats.deletions}
          />
        ) : null}
      </AppButton>

      {hasDetails && (
        <>
          {open && !anchorVisible && (
            <AppButton variant="ghost" size="sm"
              type="button"
              className="lyra-agents-fold-line lyra-agents-fold-line-call"
              onClick={() => setOpen(false)}
              aria-label={t("tool.collapseCall")}
            />
          )}

          <div className="lyra-agents-collapse" data-open={open}>
            <div className="lyra-agents-collapse-inner">
              <div className="lyra-agents-tool-call-body">
                {groupOpen && open && call.details && call.details.type !== "render" ? (
                  <ToolDetails details={call.details} running={call.status === "running"} />
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}