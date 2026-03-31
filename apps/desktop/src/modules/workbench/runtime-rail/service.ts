import type { ShellMetric } from "../shell/types";

export const defaultRuntimeMetrics: readonly ShellMetric[] = [
  { id: "cpu", label: "CPU", valueText: "36%", percent: 36 },
  { id: "mem", label: "MEM", valueText: "2.2GB", percent: 49 },
  { id: "tabs", label: "Tabs", valueText: "6 open", percent: 58 }
];
