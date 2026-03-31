import type { WorkbenchCommand } from "../shell/types";

export type WorkbenchGatewayResult = {
  readonly summary: string;
  readonly actions: readonly string[];
  readonly terminalLogs: readonly string[];
};

export type WorkbenchGateway = {
  readonly execute: (command: WorkbenchCommand) => Promise<WorkbenchGatewayResult>;
};
