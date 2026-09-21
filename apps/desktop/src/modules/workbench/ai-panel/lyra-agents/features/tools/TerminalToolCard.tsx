import type { ToolDetails as ToolDetailsType } from "../../core/types";
import { HighlightedSource } from "@workbench/syntax/highlighted-source";
import { splitCommandDump } from "@workbench/agent-session-view-model/tool-parsing/terminal";

type TerminalToolDetails = Extract<ToolDetailsType, { type: "terminal" }>;

export function TerminalToolCard({
  details
}: {
  readonly details: TerminalToolDetails;
}) {
  const command = details.command ?? details.wrote;
  const screenText = details.screen?.visibleText;
  const dump = typeof screenText === "string" && screenText.trim().length > 0
    ? screenText
    : details.output;
  const parts = splitCommandDump(command, dump);

  return (
    <div className="lyra-agents-info-block">
      {parts.command !== null ? (
        <div className="lyra-agents-shell-command">
          <span className="lyra-agents-shell-prompt">$</span>
          <HighlightedSource
            code={parts.command}
            language="shell"
            className="lyra-agents-tool-dump"
          />
        </div>
      ) : null}
      {parts.output !== null ? (
        <HighlightedSource
          code={parts.output}
          language="shell"
          className="lyra-agents-tool-dump"
        />
      ) : null}
      {!details.running && details.exitCode !== null && details.exitCode !== undefined ? (
        <div className="lyra-agents-info-dim lyra-agents-shell-exit">exit {details.exitCode}</div>
      ) : null}
    </div>
  );
}
