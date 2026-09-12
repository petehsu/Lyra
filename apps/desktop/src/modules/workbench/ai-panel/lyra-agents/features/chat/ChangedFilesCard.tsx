import { useState } from "react";

import { formatMessage, t } from "@workbench/i18n";
import { AppButton } from "@renderer/ui/components";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { ChevronIcon } from "../../components/Icons";
import { VirtualizedDiffView } from "../tools/VirtualizedDiffView";
import {
  CHANGED_FILES_PREVIEW_LIMIT,
  type ChangedFile,
  splitDisplayPath
} from "./changed-files";

export function ChangedFilesCard({ files }: { readonly files: readonly ChangedFile[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  if (files.length === 0) return null;

  const overflow = Math.max(0, files.length - CHANGED_FILES_PREVIEW_LIMIT);
  const visible = showAll ? files : files.slice(0, CHANGED_FILES_PREVIEW_LIMIT);
  const totalAdd = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDel = files.reduce((sum, file) => sum + file.deletions, 0);
  const label = formatMessage(
    files.length === 1
      ? "lyra-agents-message.changedFile"
      : "lyra-agents-message.changedFiles",
    { count: files.length }
  );

  const toggle = (file: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  return (
    <div className="lyra-agents-changed-files">
      <div className="lyra-agents-changed-files-header">
        <span className="lyra-agents-changed-files-label">{label}</span>
        <span className="lyra-agents-changed-files-totals">
          <span className="lyra-agents-diff-add">+{totalAdd}</span>
          <span className="lyra-agents-diff-del">-{totalDel}</span>
        </span>
        {overflow > 0 ? (
          <AppButton
            variant="ghost"
            size="sm"
            type="button"
            className="lyra-agents-changed-files-toggle"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("lyra-agents-message.showLessFiles")
              : t("lyra-agents-message.showAllFiles")}
          </AppButton>
        ) : null}
      </div>
      <div className="lyra-agents-changed-files-list">
        {visible.map((file) => {
          const open = expanded.has(file.file);
          const { directory, filename } = splitDisplayPath(file.file);
          return (
            <div key={file.file} className={`lyra-agents-changed-files-item${open ? " open" : ""}`}>
              <AppButton
                variant="ghost"
                size="sm"
                type="button"
                className="lyra-agents-changed-files-row"
                aria-expanded={open}
                onClick={() => toggle(file.file)}
              >
                <span className="lyra-agents-changed-files-main">
                  <span className="lyra-agents-changed-files-icon" aria-hidden="true">
                    <FileTypeIcon filename={file.file} size={14} />
                  </span>
                  <span className="lyra-agents-changed-files-path">
                    {directory.length > 0 ? (
                      <span className="lyra-agents-changed-files-directory">{`\u202A${directory}\u202C`}</span>
                    ) : null}
                    <span className="lyra-agents-changed-files-filename">{filename}</span>
                  </span>
                </span>
                <span className="lyra-agents-changed-files-meta">
                  <span className="lyra-agents-changed-files-counts">
                    <span className="lyra-agents-diff-add">+{file.additions}</span>
                    <span className="lyra-agents-diff-del">-{file.deletions}</span>
                  </span>
                  <span className="lyra-agents-changed-files-chevron">
                    <ChevronIcon open={open} />
                  </span>
                </span>
              </AppButton>
              {open ? (
                <div className="lyra-agents-changed-files-diff">
                  <VirtualizedDiffView hunks={file.hunks} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!showAll && overflow > 0 ? (
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-changed-files-more"
          onClick={() => setShowAll(true)}
        >
          {formatMessage("lyra-agents-message.moreFiles", { count: overflow })}
        </AppButton>
      ) : null}
    </div>
  );
}
