import type { WorkbenchCommand } from "../shell/types";
import type { WorkbenchGateway, WorkbenchGatewayResult } from "./types";
import { formatMessage } from "@workbench/i18n";

const withPrefix = (prefix: string, lines: readonly string[]): readonly string[] => lines.map((line) => `${prefix}${line}`);

const mapCommandToResult = (command: WorkbenchCommand): WorkbenchGatewayResult => {
  if (command.kind === "url") {
    return {
      summary: formatMessage("gateway.summaryUrl", { value: command.value }),
      actions: [
        `browser_navigate ${command.value}`,
        "browser_capture_dom",
        "browser_capture_console"
      ],
      terminalLogs: withPrefix("[browser] ", ["navigation ok", "dom snapshot ready"])
    };
  }

  if (command.kind === "file") {
    return {
      summary: formatMessage("gateway.summaryFile", { value: command.value }),
      actions: [
        `read_file ${command.value}`,
        "collect_symbol_outline",
        "open_editor_tab"
      ],
      terminalLogs: withPrefix("[file] ", ["read complete", "outline indexed"])
    };
  }

  if (command.kind === "command") {
    return {
      summary: formatMessage("gateway.summaryCommand", { value: command.value }),
      actions: [
        `run_command ${command.value}`,
        "collect_exit_code",
        "summarize_run_output"
      ],
      terminalLogs: withPrefix("[cmd] ", [command.value, "exit code: 0"])
    };
  }

  return {
    summary: formatMessage("gateway.summaryTask", { value: command.value }),
    actions: [
      "collect_context workspace",
      "plan_task_tree",
      "execute_step_pipeline"
    ],
    terminalLogs: withPrefix("[task] ", ["plan generated", "pipeline started"])
  };
};

export const createMockWorkbenchGateway = (): WorkbenchGateway => ({
  execute: async (command: WorkbenchCommand): Promise<WorkbenchGatewayResult> => {
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    return mapCommandToResult(command);
  }
});
