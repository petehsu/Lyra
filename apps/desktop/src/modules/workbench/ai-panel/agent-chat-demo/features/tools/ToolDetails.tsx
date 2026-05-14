import { useRef, useState } from "react";
import type { ToolDetails as ToolDetailsType } from "../../core/types";
import { ChevronIcon } from "../../components/Icons";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { TickingNumber } from "../../components/TickingNumber";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";

/**
 * Level-3 renderer. Rendered inline without surrounding borders or panels so
 * it reads as a continuation of the message, not a nested card.
 */
export function ToolDetails({ details }: { details: ToolDetailsType }) {
  switch (details.type) {
    case "edit":
      return <EditCard details={details} />;
    case "read":
      return <ReadCard details={details} />;
    case "search":
      return <SearchCard details={details} />;
    case "shell":
      return <ShellCard details={details} />;
    case "web":
      return <WebCard details={details} />;
    case "task":
      return <TaskCard details={details} />;
    case "text":
      return <p className="tool-details-text">{details.body}</p>;
    case "ask":
      return <AskCard details={details} />;
  }
}

function EditCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "edit" }>;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  return (
    <div className={`edit-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="edit-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span ref={anchorRef} className="icon-swap">
          <span className="icon-swap-tool">
            <FileTypeIcon filename={details.file} />
          </span>
          <span className="icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span className="edit-card-file">{details.file}</span>
        <span className="edit-card-stats">
          <span className="diff-add">
            +<TickingNumber value={details.additions} direction="up" />
          </span>
          <span className="diff-del">
            -<TickingNumber value={details.deletions} direction="down" />
          </span>
        </span>
      </button>

      {open && !anchorVisible && (
        <button
          type="button"
          className="fold-line fold-line-edit"
          onClick={() => setOpen(false)}
          aria-label="Collapse edit details"
        />
      )}

      <div className="collapse" data-open={open}>
        <div className="collapse-inner">
          <div className="edit-card-body">
            {details.hunks.map((hunk, i) => (
              <div key={i} className="diff-hunk">
                {hunk.lines.map((line, j) => {
                  const lineNumber = hunk.startLine + j;
                  return (
                    <div
                      key={j}
                      className={`diff-line diff-line-${line.kind} stagger-item`}
                      style={{ "--stagger-index": j } as React.CSSProperties}
                    >
                      <span className="diff-gutter">{lineNumber}</span>
                      <span className="diff-sign">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                      </span>
                      <span className="diff-text">{line.text || "\u00A0"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "read" }>;
}) {
  return (
    <div className="info-block">
      <div className="info-line">
        <FileTypeIcon filename={details.file} />
        <span className="info-strong">{details.file}</span>
        {details.range && <span className="info-dim">:{details.range}</span>}
      </div>
      {details.preview && <pre className="info-pre">{details.preview}</pre>}
    </div>
  );
}

function SearchCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "search" }>;
}) {
  return (
    <div className="info-block">
      <div className="info-line">
        <span className="info-dim">query</span>
        <span className="info-strong">{details.query}</span>
      </div>
      <div className="search-results">
        {details.results.map((r, i) => (
          <div key={i} className="search-row">
            <span className="info-dim">
              {r.file}:{r.line}
            </span>
            <span className="search-text">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShellCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "shell" }>;
}) {
  return (
    <div className="info-block">
      <div className="shell-command">
        <span className="shell-prompt">$</span>
        <span>{details.command}</span>
      </div>
      <pre className="info-pre">{details.output}</pre>
      <div className="info-dim shell-exit">exit {details.exitCode}</div>
    </div>
  );
}

function WebCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "web" }>;
}) {
  return (
    <div className="info-block">
      <div className="info-line">
        <span className="info-dim">URL</span>
        <span className="info-strong">{details.url}</span>
      </div>
      {details.summary && <p className="tool-details-text">{details.summary}</p>}
    </div>
  );
}

function TaskCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "task" }>;
}) {
  return (
    <div className="task-card">
      <div className="task-card-head">Execution plan</div>
      <ul className="task-list">
        {details.tasks.map((t, i) => (
          <li key={i} className={`task-item status-${t.status}`}>
            <span className={t.status === "running" ? "shimmer" : ""}>
              {t.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "ask" }>;
}) {
  return (
    <div className="ask-card">
      <div className="ask-question">{details.question}</div>
      <div className="ask-answer">{details.answer}</div>
    </div>
  );
}
