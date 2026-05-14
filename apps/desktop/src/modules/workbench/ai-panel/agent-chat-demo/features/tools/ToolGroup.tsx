import { useRef, useState } from "react";
import type { ToolCall, ToolGroup } from "../../core/types";
import {
  CheckCircleIcon,
  ChevronIcon,
  ErrorCircleIcon,
  ToolIcon,
} from "../../components/Icons";
import { ToolDetails } from "./ToolDetails";
import { TickingNumber } from "../../components/TickingNumber";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";

/**
 * If the tool call is an edit, return its current +/- counts; otherwise null.
 */
function editCounts(call: ToolCall | undefined): { add: number; del: number } | null {
  if (!call || call.kind !== "edit" || call.details?.type !== "edit") return null;
  return { add: call.details.additions, del: call.details.deletions };
}

/** Strip any trailing "+N -N" stats from a title so we can render them ourselves. */
function stripStatsFromTitle(title: string): string {
  return title.replace(/\s*\+\d+\s+-\d+\s*$/u, "").trim();
}

/**
 * Level 1 head has three faces keyed by the group status and per-call errors:
 *   - running: current tool icon + shimmering title
 *   - error:   red ✗ icon + elapsed label     (any call in the group failed)
 *   - done:    green ✓ icon + elapsed label   (all calls succeeded)
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
  const counts = editCounts(currentCall);

  const mode = isRunning ? "running" : hasError ? "error" : "done";

  return (
    <div className={`tool-group ${open ? "open" : ""} mode-${mode}`}>
      <button
        type="button"
        className="tool-group-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span ref={anchorRef} className="tool-group-icon-slot">
          <span className="tool-group-lead">
            {isRunning && currentCall ? (
              <ToolIcon kind={currentCall.kind} />
            ) : hasError ? (
              <ErrorCircleIcon />
            ) : (
              <CheckCircleIcon />
            )}
          </span>
          <span className="chevron-slot">
            <ChevronIcon open={open} />
          </span>
        </span>

        <span className={`tool-group-label ${isRunning ? "shimmer" : ""}`}>
          {isRunning && currentCall ? currentCall.title : group.label}
        </span>

        {isRunning && counts && (
          <span className="inline-stats">
            <span className="diff-add">
              +<TickingNumber value={counts.add} direction="up" />
            </span>
            <span className="diff-del">
              -<TickingNumber value={counts.del} direction="down" />
            </span>
          </span>
        )}

        {!isRunning && group.hint && (
          <span className="tool-group-hint">{group.hint}</span>
        )}
      </button>

      {open && !anchorVisible && (
        <button
          type="button"
          className="fold-line fold-line-group"
          onClick={() => setOpen(false)}
          aria-label="Collapse tool group"
        />
      )}

      <div className="collapse" data-open={open}>
        <div className="collapse-inner">
          <div className="tool-group-body">
            {group.calls.map((call, i) => (
              <div
                key={call.id}
                className="stagger-item"
                style={{ "--stagger-index": i } as React.CSSProperties}
              >
                <ToolCallRow call={call} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const hasDetails = !!call.details;
  const counts = editCounts(call);

  return (
    <div className={`tool-call ${open ? "open" : ""} status-${call.status}`}>
      <button
        type="button"
        className={`tool-call-head ${hasDetails ? "has-details" : ""}`}
        onClick={() => hasDetails && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetails}
      >
        <span ref={anchorRef} className="icon-swap">
          <span className="icon-swap-tool">
            <ToolIcon kind={call.kind} />
          </span>
          <span className="icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span
          className={`tool-call-title ${call.status === "running" ? "shimmer" : ""}`}
        >
          {counts ? stripStatsFromTitle(call.title) : call.title}
        </span>
        {counts && (
          <span className="inline-stats">
            <span className="diff-add">
              +{call.status === "running" ? (
                <TickingNumber value={counts.add} direction="up" />
              ) : (
                counts.add
              )}
            </span>
            <span className="diff-del">
              -{call.status === "running" ? (
                <TickingNumber value={counts.del} direction="down" />
              ) : (
                counts.del
              )}
            </span>
          </span>
        )}
      </button>

      {hasDetails && (
        <>
          {open && !anchorVisible && (
            <button
              type="button"
              className="fold-line fold-line-call"
              onClick={() => setOpen(false)}
              aria-label="Collapse tool call"
            />
          )}

        <div className="collapse" data-open={open}>
          <div className="collapse-inner">
            <div className="tool-call-body">
              <ToolDetails details={call.details!} />
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
