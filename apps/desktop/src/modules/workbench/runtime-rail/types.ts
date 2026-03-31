import type { ShellMetric } from "../shell/types";

export type RuntimeRailProps = {
  readonly terminalLogs: readonly string[];
  readonly metrics: readonly ShellMetric[];
};
