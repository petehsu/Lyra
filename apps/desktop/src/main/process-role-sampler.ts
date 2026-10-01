import { app } from "electron";
import { readFileSync } from "node:fs";

import {
  aggregateProcessRoles,
  processRolePids,
  productRssKb,
  type ProcessSample
} from "./process-roles";

const readRssKb = (pid: number): number => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)/m.exec(status);
    return match === null ? 0 : Number(match[1]);
  } catch {
    return 0;
  }
};

export const logProcessRoleSample = (): void => {
  const seen = new Set<number>();
  const samples: ProcessSample[] = app.getAppMetrics().map((metric) => {
    seen.add(metric.pid);
    return {
      pid: metric.pid,
      type: metric.type,
      ...(metric.serviceName === undefined ? {} : { serviceName: metric.serviceName }),
      cpuPercent: metric.cpu.percentCPUUsage,
      rssKb: Math.round(metric.memory.workingSetSize)
    };
  });
  const pids = processRolePids(process.pid);
  for (const [pid] of pids.registered) {
    if (seen.has(pid)) {
      continue;
    }
    samples.push({ pid, type: "", cpuPercent: 0, rssKb: readRssKb(pid) });
  }
  const aggregates = aggregateProcessRoles(samples, pids);
  const summary = aggregates
    .map((row) => `${row.role}=${Math.round(row.rssKbTotal / 1024)}MB/${row.processCount}`)
    .join(" ");
  console.info(
    `[lyra-process] product ${Math.round(productRssKb(aggregates) / 1024)}MB ${summary}`
  );
};
