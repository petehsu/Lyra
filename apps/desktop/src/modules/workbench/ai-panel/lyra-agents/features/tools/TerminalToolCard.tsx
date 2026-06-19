import type { ToolDetails as ToolDetailsType } from "../../core/types";
import { ActionText } from "../rich-text/ActionTargets";

type TerminalToolDetails = Extract<ToolDetailsType, { type: "terminal" }>;

export function TerminalToolCard({
  details
}: {
  readonly details: TerminalToolDetails;
}) {
  const command = details.command ?? details.wrote;
  const output = details.screen?.visibleText ?? details.output;

  return (
    <div className="lyra-agents-info-block">
      {command !== undefined && command.trim().length > 0 ? (
        <div className="lyra-agents-shell-command">
          <span className="lyra-agents-shell-prompt">$</span>
          <span>
            <ActionText text={command} />
          </span>
        </div>
      ) : null}
      {output.trim().length > 0 ? (
        <pre className="lyra-agents-info-pre">
          <ActionText text={output} />
        </pre>
      ) : null}
      {!details.running && details.exitCode !== null && details.exitCode !== undefined ? (
        <div className="lyra-agents-info-dim lyra-agents-shell-exit">exit {details.exitCode}</div>
      ) : null}
    </div>
  );
}