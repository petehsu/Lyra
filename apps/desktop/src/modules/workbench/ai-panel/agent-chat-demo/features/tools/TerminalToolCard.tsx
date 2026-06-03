import { useData } from "../../data/DataProvider";
import type { ToolDetails as ToolDetailsType } from "../../core/types";
import { ActionText } from "../rich-text/ActionTargets";

type TerminalToolDetails = Extract<ToolDetailsType, { type: "terminal" }>;

export function TerminalToolCard({
  details
}: {
  readonly details: TerminalToolDetails;
}) {
  const { openTerminalLiveSession } = useData();
  const terminalSessionId = normalizedValue(details.sessionId);
  const targetLabel =
    details.target === "ui" ? "ui terminal" : details.target === "list" ? "terminals" : "private terminal";
  const summary = details.command ?? details.wrote ?? details.sessionId ?? details.action;
  const outputText = details.screen === undefined ? details.output : "";
  const outputFacts = [
    details.memory?.lineCount === undefined ? null : `lines ${details.memory.lineCount}`,
    details.memory?.errorCount === undefined ? null : `errors ${details.memory.errorCount}`,
    details.memory?.truncatedByProjection === true ? "projected" : null
  ].filter((item): item is string => item !== null);
  const canOpenLiveTerminal =
    details.target === "ui" ||
    normalizedValue(details.terminalTabId) !== null ||
    normalizedValue(details.paneId) !== null;

  const openLiveTerminal = () => {
    if (!canOpenLiveTerminal && terminalSessionId === null) {
      return;
    }
    void openTerminalLiveSession({
      sessionId: terminalSessionId,
      terminalTabId: normalizedValue(details.terminalTabId),
      paneId: normalizedValue(details.paneId)
    }).catch(() => undefined);
  };

  return (
    <div className="info-block terminal-card">
      <div className="info-line">
        <span className="info-dim">target</span>
        <span className="info-strong">{targetLabel}</span>
        {details.reason ? <span className="info-dim">reason {details.reason}</span> : null}
      </div>
      {summary ? (
        <div className="shell-command">
          <span className="shell-prompt">$</span>
          <span>
            <ActionText text={summary} />
          </span>
        </div>
      ) : null}
      {details.screen === undefined ? null : (
        <div className="terminal-screen-snapshot">
          <div className="info-line">
            <span className="info-dim">screen</span>
            <span className="info-strong">
              v{details.screen.screenVersion} - {details.screen.mode} - {details.screen.cols}x{details.screen.rows}
            </span>
            <span className="info-dim">
              cursor {details.screen.cursorPosition.row},{details.screen.cursorPosition.col}
              {details.screen.cursorPosition.visible ? "" : " hidden"}
            </span>
          </div>
          {details.screen.visibleText.trim().length > 0 ? (
            <pre className="info-pre">
              <ActionText text={details.screen.visibleText} />
            </pre>
          ) : null}
        </div>
      )}
      {outputText.trim().length > 0 ? (
        <pre className="info-pre">
          <ActionText text={outputText} />
        </pre>
      ) : null}
      <div className="info-dim shell-exit">
        running {details.running ? "true" : "false"} - exit {details.exitCode ?? "null"}
        {details.truncated ? " - truncated" : ""}
      </div>
      {outputFacts.length > 0 ? (
        <div className="info-line">
          <span className="info-dim">output</span>
          <span className="info-strong">{outputFacts.join(" - ")}</span>
        </div>
      ) : null}
      {canOpenLiveTerminal || terminalSessionId !== null ? (
        <div className="terminal-timeline">
          <div className="terminal-timeline-head">
            <span className="info-dim">live terminal</span>
            <button
              type="button"
              className="terminal-timeline-open"
              onClick={openLiveTerminal}
            >
              Open Terminal
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const normalizedValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
};
