import { Check, X } from "lucide-react";

import { aiTextLayoutService } from "../ai-panel/text-layout";
import { resolveFileManagerEntryIconKind } from "../file-manager/entry-icon-classifier";
import { renderFileManagerEntryIconByKind } from "../file-manager/icon-registry";
import type {
  SidebarChangeApprovalLabels,
  SidebarChangeApprovalPanelViewModel
} from "./types";

type SidebarChangeApprovalPanelProps = {
  readonly panel: SidebarChangeApprovalPanelViewModel;
  readonly labels: SidebarChangeApprovalLabels;
  readonly onAcceptAll?: () => void;
  readonly onOpenChangedFile?: (filePath: string) => void;
};

const resolveFileNameExtension = (fileName: string): string | undefined => {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
};

export const SidebarChangeApprovalPanel = ({
  panel,
  labels,
  onAcceptAll,
  onOpenChangedFile
}: SidebarChangeApprovalPanelProps) => {
  const activeItems = panel.pendingItems;
  const activeSummary = panel.pendingSummary;
  const canAcceptAll = panel.pendingSummary.fileCount > 0;

  return (
    <div className="lyra-sidebar-change-panel" aria-label="sidebar-change-approval-panel">
      <div className="lyra-sidebar-change-panel-controls">
        <span className="lyra-sidebar-change-panel-title">{labels.viewPending}</span>
        <button
          type="button"
          className="lyra-sidebar-change-panel-accept-all"
          disabled={canAcceptAll === false}
          onClick={onAcceptAll}
        >
          {labels.acceptAll}
        </button>
      </div>

      <p className="lyra-sidebar-change-panel-summary">
        <span>{activeSummary.fileCount} {labels.filesUnit}</span>
        <span className="lyra-sidebar-change-panel-delta">
          <span className="lyra-sidebar-change-panel-delta-added">+{activeSummary.addedLines}</span>
          <span className="lyra-sidebar-change-panel-delta-removed">-{activeSummary.removedLines}</span>
        </span>
      </p>

      <div className="lyra-sidebar-change-panel-list" role="list" aria-label="change-approval-file-list">
        {activeItems.length === 0 ? (
          <p className="lyra-sidebar-change-panel-empty">
            {labels.emptyPending}
          </p>
        ) : (
          activeItems.map((item) => {
            const extension = resolveFileNameExtension(item.fileName);
            const iconKind = resolveFileManagerEntryIconKind({
              id: `change-approval-${item.id}`,
              kind: "file",
              name: item.fileName,
              path: item.filePath,
              isHidden: item.fileName.startsWith("."),
              ...(extension === undefined ? {} : { extension })
            });
            const nameOverflow = aiTextLayoutService.isOverflowing({
              text: item.fileName,
              font: "500 10px system-ui",
              lineHeightPx: 13,
              maxWidthPx: 150,
              maxLines: 1,
              whiteSpace: "normal"
            });
            const pathOverflow = aiTextLayoutService.isOverflowing({
              text: item.filePath,
              font: "400 10px system-ui",
              lineHeightPx: 13,
              maxWidthPx: 150,
              maxLines: 1,
              whiteSpace: "normal"
            });
            return (
              <button
                key={item.id}
                type="button"
                className="lyra-sidebar-change-panel-item"
                aria-label={`${labels.openFile} ${item.filePath}`}
                onClick={() => {
                  onOpenChangedFile?.(item.filePath);
                }}
              >
                <span className="lyra-sidebar-change-panel-item-main">
                  <span className="lyra-sidebar-change-panel-item-icon" aria-hidden="true">
                    {renderFileManagerEntryIconByKind(iconKind, {
                      className: "lyra-sidebar-change-panel-item-icon-glyph",
                      size: 13
                    })}
                  </span>
                  <span className="lyra-sidebar-change-panel-item-texts">
                    <span
                      className="lyra-sidebar-change-panel-item-name"
                      {...(nameOverflow ? { title: item.fileName } : {})}
                    >
                      {item.fileName}
                    </span>
                    <span
                      className="lyra-sidebar-change-panel-item-path"
                      {...(pathOverflow ? { title: item.filePath } : {})}
                    >
                      {item.filePath}
                    </span>
                  </span>
                </span>
                <span className="lyra-sidebar-change-panel-item-meta">
                  <span className="lyra-sidebar-change-panel-delta">
                    <span className="lyra-sidebar-change-panel-delta-added">+{item.addedLines}</span>
                    <span className="lyra-sidebar-change-panel-delta-removed">-{item.removedLines}</span>
                  </span>
                  {item.decision === "accepted" ? (
                    <span className="lyra-sidebar-change-panel-item-decision lyra-sidebar-change-panel-item-decision-accepted" aria-hidden="true">
                      <Check size={11} />
                    </span>
                  ) : item.decision === "rejected" ? (
                    <span className="lyra-sidebar-change-panel-item-decision lyra-sidebar-change-panel-item-decision-rejected" aria-hidden="true">
                      <X size={11} />
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
