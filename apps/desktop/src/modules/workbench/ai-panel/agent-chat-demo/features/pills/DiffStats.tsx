import { useState, type CSSProperties } from "react";
import { GitBranch } from "lucide-react";
import { FileTypeIcon } from "../../components/FileTypeIcon";

export interface DiffFileEntry {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * Floating diff stats pill — same style as TodoBar.
 * Collapsed: icon + total +/- counts.
 * Expanded: list of modified files with per-file stats.
 */
export function DiffStats({
  files,
}: {
  files: DiffFileEntry[];
}) {
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className={`diff-stats-pill ${open ? "open" : ""}`}>
      <button
        type="button"
        className="diff-stats-pill-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <GitBranch size={14} strokeWidth={2} />
        <span className="diff-stats-summary">
          <span className="diff-add">+{totalAdd}</span>
          <span className="diff-del">-{totalDel}</span>
        </span>
        <span className="diff-stats-count">{files.length} files</span>
      </button>

      <div className="diff-stats-collapse" data-open={open}>
        <div className="diff-stats-collapse-inner">
          <div className="diff-stats-body">
            <ul className="diff-stats-list">
              {files.map((f, i) => (
                <li
                  key={f.file}
                  className="diff-stats-item"
                  style={{ "--stagger-index": i } as CSSProperties}
                >
                  <span className="diff-stats-file-icon">
                    <FileTypeIcon filename={f.file} size={13} />
                  </span>
                  <span className="diff-stats-filename">{f.file}</span>
                  <span className="diff-stats-file-nums">
                    <span className="diff-add">+{f.additions}</span>
                    <span className="diff-del">-{f.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
