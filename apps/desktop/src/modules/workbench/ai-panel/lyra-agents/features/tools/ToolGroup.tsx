import { useRef, useState } from "react";
import type { ToolCall, ToolGroup } from "../../core/types";
import {
  CheckCircleIcon,
  ChevronIcon,
  ErrorCircleIcon,
  ToolCallIcon,
} from "../../components/Icons";
import { RenderSurfaceCard, ToolDetails } from "./ToolDetails";
import { TickingNumber } from "../../components/TickingNumber";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";
import { t } from "../../core/i18n";
import { ActionTargetList } from "../rich-text/ActionTargets";
import { AppButton } from "@renderer/ui/components";

type RenderToolCall = ToolCall & {
  readonly details: Extract<NonNullable<ToolCall["details"]>, { type: "render" }>;
};

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

function toolCallMetaChips(call: ToolCall): string[] {
  const chips: string[] = [];
  if (call.traceId !== undefined && call.traceId.trim().length > 0) {
    chips.push((call.trace?.length ?? 0) > 0 ? `trace ${call.trace!.length}` : "trace");
  } else if ((call.trace?.length ?? 0) > 0) {
    chips.push(`trace ${call.trace!.length}`);
  }
  if ((call.artifactRefs?.length ?? 0) > 0) {
    chips.push(`artifacts ${call.artifactRefs!.length}`);
  }
  if ((call.artifactPreviews?.length ?? 0) > 0) {
    chips.push(`previews ${call.artifactPreviews!.length}`);
  }
  if ((call.changes?.length ?? 0) > 0) {
    chips.push(`changes ${call.changes!.length}`);
  }
  if (call.failureReason !== undefined && call.failureReason.trim().length > 0) {
    chips.push(call.failureReason.replaceAll("_", " "));
  }
  return chips;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: Record<string, unknown>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
}

function evidenceLabel(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return stringField(record, "summary", "message", "label", "title", "id", "kind") ?? fallback;
}

function evidenceMeta(value: unknown): string[] {
  const record = asRecord(value);
  return [
    stringField(record, "kind", "operation"),
    stringField(record, "path", "uri"),
    stringField(record, "diffRef", "dataRef", "artifactRef")
  ]
    .flatMap((item) => {
      if (item !== undefined) return [item];
      const nested = asRecord(record.diffRef ?? record.dataRef ?? record.artifactRef);
      return stringField(nested, "path", "uri", "id") === undefined
        ? []
        : [stringField(nested, "path", "uri", "id")!];
    })
    .filter((item, index, items) => items.indexOf(item) === index);
}

function hasEvidence(call: ToolCall): boolean {
  return (call.traceId?.trim().length ?? 0) > 0
    || (call.trace?.length ?? 0) > 0
    || (call.artifactRefs?.length ?? 0) > 0
    || (call.artifactPreviews?.length ?? 0) > 0
    || (call.changes?.length ?? 0) > 0;
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
  const renderCalls = group.calls.filter((call): call is RenderToolCall =>
    call.details?.type === "render"
  );

  const mode = isRunning ? "running" : hasError ? "error" : "done";

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

        {isRunning && counts && (
          <span className="lyra-agents-inline-stats">
            <span className="lyra-agents-diff-add">
              +<TickingNumber value={counts.add} direction="up" />
            </span>
            <span className="lyra-agents-diff-del">
              -<TickingNumber value={counts.del} direction="down" />
            </span>
          </span>
        )}

        {!isRunning && group.hint && (
          <span className="lyra-agents-tool-group-hint">{group.hint}</span>
        )}
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
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const hasDetails = (!!call.details && call.details.type !== "render") || hasEvidence(call);
  const counts = editCounts(call);
  const metaChips = toolCallMetaChips(call);

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
          {counts ? stripStatsFromTitle(call.title) : call.title}
        </span>
        {counts && (
          <span className="lyra-agents-inline-stats">
            <span className="lyra-agents-diff-add">
              +{call.status === "running" ? (
                <TickingNumber value={counts.add} direction="up" />
              ) : (
                counts.add
              )}
            </span>
            <span className="lyra-agents-diff-del">
              -{call.status === "running" ? (
                <TickingNumber value={counts.del} direction="down" />
              ) : (
                counts.del
              )}
            </span>
          </span>
        )}
        {metaChips.length > 0 ? (
          <span className="lyra-agents-tool-call-meta" aria-label="Tool evidence metadata">
            {metaChips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </span>
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
                <ToolDetails details={call.details} />
              ) : null}
              {groupOpen && open ? <ToolEvidence call={call} /> : null}
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

function ToolEvidence({ call }: { call: ToolCall }) {
  if (!hasEvidence(call)) return null;
  return (
    <div className="lyra-agents-tool-evidence">
      {call.traceId !== undefined && call.traceId.trim().length > 0 ? (
        <div className="lyra-agents-tool-evidence-section">
          <div className="lyra-agents-tool-evidence-label">Trace</div>
          <code>{call.traceId}</code>
        </div>
      ) : null}

      {(call.artifactRefs?.length ?? 0) > 0 ? (
        <div className="lyra-agents-tool-evidence-section">
          <div className="lyra-agents-tool-evidence-label">Artifacts</div>
          <ActionTargetList targets={call.artifactTargets} />
          <ul>
            {call.artifactRefs!.map((artifact, index) => (
              <li key={`artifact-${index}`}>
                <span>{evidenceLabel(artifact, `artifact ${index + 1}`)}</span>
                {evidenceMeta(artifact).map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(call.artifactPreviews?.length ?? 0) > 0 ? (
        <div className="lyra-agents-tool-evidence-section">
          <div className="lyra-agents-tool-evidence-label">Preview</div>
          <div className="lyra-agents-tool-artifact-preview-list">
            {call.artifactPreviews!.map((preview, index) => (
              <div key={`artifact-preview-${index}`} className="lyra-agents-tool-artifact-preview">
                <div className="lyra-agents-tool-artifact-preview-head">
                  <span>{preview.label}</span>
                  {preview.kind !== undefined ? <code>{preview.kind}</code> : null}
                  {preview.bytes !== undefined ? <code>{preview.bytes.toLocaleString()} bytes</code> : null}
                  {preview.truncated === true ? <code>truncated</code> : null}
                </div>
                {preview.path !== undefined ? <code>{preview.path}</code> : null}
                <pre>{preview.text}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(call.changes?.length ?? 0) > 0 ? (
        <div className="lyra-agents-tool-evidence-section">
          <div className="lyra-agents-tool-evidence-label">Changes</div>
          <ul>
            {call.changes!.map((change, index) => (
              <li key={`change-${index}`}>
                <span>{evidenceLabel(change, `change ${index + 1}`)}</span>
                {evidenceMeta(change).map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
