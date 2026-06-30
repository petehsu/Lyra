import { useEffect, useRef, useState } from "react";
import type { ToolCall, ToolGroup } from "../../core/types";
import {
  CheckCircleIcon,
  ChevronIcon,
  ErrorCircleIcon,
  ToolCallIcon,
  ToolIcon,
} from "../../components/Icons";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { ToolDetails } from "./ToolDetails";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";
import { t } from "@workbench/i18n";
import { AppButton } from "@renderer/ui/components";
import { useData } from "../../data/DataProvider";
import {
  InlineDiffStats,
  editDiffCounts,
  shouldShowEditDiffStats
} from "./InlineDiffStats";

export type ThinkingEntry = { id: string; body: string; status: "running" | "done" };
export type ToolGroupActivityEntry =
  | { type: "thinking"; id: string; entry: ThinkingEntry }
  | { type: "tool"; id: string; call: ToolCall };

/**
 * Level 1 head has three faces keyed by the group status and per-call errors:
 *   - running: current tool icon + shimmering title
 *   - error:   red ✗ icon
 *   - done:    green ✓ icon + group label
 */
export function ToolGroupBlock({
  group,
  thinkingEntries = [],
  activityEntries,
}: {
  group: ToolGroup;
  thinkingEntries?: ThinkingEntry[];
  activityEntries?: readonly ToolGroupActivityEntry[];
}) {
  const isRunning = group.status === "running";
  const activityRows = activityEntries ?? [
    ...thinkingEntries.map((entry) => ({ type: "thinking" as const, id: entry.id, entry })),
    ...group.calls.map((call) => ({ type: "tool" as const, id: call.id, call }))
  ];
  const isLiveEditGroup =
    isRunning &&
    group.calls.some(
      (call) => call.status === "running" && call.details?.type === "edit"
    );
  const [open, setOpen] = useState(isLiveEditGroup);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const hasError = group.calls.some((c) => c.status === "error");
  const currentCall =
    isRunning && group.currentCallId
      ? group.calls.find((c) => c.id === group.currentCallId)
      : undefined;

  const mode = isRunning ? "running" : hasError ? "error" : "done";
  const currentEditStats = editDiffCounts(currentCall?.details);
  const showGroupEditStats = shouldShowEditDiffStats(currentEditStats);

  useEffect(() => {
    if (isLiveEditGroup) {
      setOpen(true);
    }
  }, [isLiveEditGroup, currentCall?.details]);

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
            ) : isRunning || group.calls.length === 0 ? (
              <ToolIcon kind="thought" />
            ) : (
              <CheckCircleIcon />
            )}
          </span>
          <span className="lyra-agents-chevron-slot">
            <ChevronIcon open={open} />
          </span>
        </span>

        <span className={`lyra-agents-tool-group-label ${isRunning ? "lyra-agents-shimmer" : ""}`}>
          {isRunning && currentCall ? (
            <ToolCallHeadLabel
              call={currentCall}
              shimmer={
                currentCall.details?.type === "edit" && currentCall.details.hunks.length === 0
              }
            />
          ) : (
            group.label
          )}
        </span>
        {showGroupEditStats ? (
          <InlineDiffStats
            additions={currentEditStats.additions}
            deletions={currentEditStats.deletions}
          />
        ) : null}
      </AppButton>

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
            {activityRows.map((row, i) => (
              <div
                key={row.id}
                className="lyra-agents-stagger-item"
                style={{ "--stagger-index": i } as React.CSSProperties}
              >
                {row.type === "thinking" ? (
                  <ThinkingRow entry={row.entry} />
                ) : (
                  <ToolCallRow call={row.call} groupOpen={open} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const editFileLabel = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.length > 0 ? normalized : filePath;
};

function ToolCallRow({ call, groupOpen }: { call: ToolCall; groupOpen: boolean }) {
  const isLiveEdit = call.status === "running" && call.details?.type === "edit";
  const [open, setOpen] = useState(isLiveEdit);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  const hasDetails = !!call.details;
  const editFile = call.details?.type === "edit" ? call.details.file : undefined;
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
        <ToolCallHeadLabel
          call={call}
          shimmer={call.status === "running" && call.details?.type === "edit" && call.details.hunks.length === 0}
        />
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
                {groupOpen && open && editFile !== undefined ? (
                  <EditFilePathRow filePath={editFile} />
                ) : null}
                {groupOpen && open && call.details ? (
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

function ToolCallHeadLabel({
  call,
  shimmer = false
}: {
  readonly call: ToolCall;
  readonly shimmer?: boolean;
}) {
  const editFile = call.details?.type === "edit" ? call.details.file : undefined;
  const { openFileInWorkbench } = useData();
  const openEditFile = (event: { stopPropagation: () => void }) => {
    if (editFile === undefined) return;
    event.stopPropagation();
    void openFileInWorkbench(editFile).catch(() => undefined);
  };

  return (
    <span className="lyra-agents-tool-call-head-label">
      <span className={`lyra-agents-tool-call-title ${shimmer ? "lyra-agents-shimmer" : ""}`}>
        {call.title}
      </span>
      {editFile !== undefined ? (
        <span
          role="button"
          tabIndex={0}
          className="lyra-agents-tool-call-target"
          title={editFile}
          onClick={openEditFile}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openEditFile(event);
          }}
        >
          {editFileLabel(editFile)}
        </span>
      ) : null}
    </span>
  );
}

function ThinkingRow({ entry }: { entry: ThinkingEntry }) {
  const [open, setOpen] = useState(false);
  const isRunning = entry.status === "running";
  return (
    <div className={`lyra-agents-tool-call ${open ? "open" : ""} status-${entry.status}`}>
      <AppButton variant="ghost" size="sm"
        type="button"
        className="lyra-agents-tool-call-head has-details"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="lyra-agents-icon-swap">
          <span className="lyra-agents-icon-swap-tool">
            <ToolIcon kind="thought" />
          </span>
          <span className="lyra-agents-icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span className="lyra-agents-tool-call-head-label">
          <span className={`lyra-agents-tool-call-title ${isRunning ? "lyra-agents-shimmer" : ""}`}>
            {isRunning
              ? t("lyra-agents-message.thinkingInProgress")
              : t("lyra-agents-message.thinkingLabel")}
          </span>
        </span>
      </AppButton>
      <div className="lyra-agents-collapse" data-open={open}>
        <div className="lyra-agents-collapse-inner">
          <div className="lyra-agents-tool-call-body">
            <div className="lyra-agents-thinking-body">{entry.body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditFilePathRow({ filePath }: { readonly filePath: string }) {
  const { openFileInWorkbench } = useData();

  return (
    <div className="lyra-agents-info-line lyra-agents-tool-call-edit-path">
      <FileTypeIcon filename={filePath} />
      <span
        role="button"
        tabIndex={0}
        className="lyra-agents-tool-call-file-path"
        title={filePath}
        onClick={() => {
          void openFileInWorkbench(filePath).catch(() => undefined);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void openFileInWorkbench(filePath).catch(() => undefined);
        }}
      >
        {filePath}
      </span>
    </div>
  );
}
