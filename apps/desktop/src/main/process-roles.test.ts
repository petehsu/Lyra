import { describe, expect, test } from "vitest";

import {
  aggregateProcessRoles,
  classifyProcessRole,
  productRssKb,
  type ProcessRolePids,
  type ProcessSample
} from "./process-roles";

const pids = (): ProcessRolePids => ({
  mainPid: 1,
  mainWindowRendererPids: new Set([10]),
  guestRendererPids: new Set([11]),
  registered: new Map([[40, "terminal"], [41, "files"], [42, "exec"]])
});

describe("process roles", () => {
  test("keeps the main window separate from a later guest page", () => {
    const roles = pids();
    expect(classifyProcessRole({ pid: 10, type: "Tab" }, roles)).toBe("renderer_main");
    expect(classifyProcessRole({ pid: 11, type: "Tab" }, roles)).toBe("renderer_guest");
    expect(classifyProcessRole({ pid: 12, type: "Tab" }, roles)).toBe("renderer_guest");
  });

  test("names supervised hosts and leaves the dev server out of the product total", () => {
    const roles = pids();
    const processes: ProcessSample[] = [
      { pid: 1, type: "Browser", cpuPercent: 2, rssKb: 200_000 },
      { pid: 10, type: "Tab", cpuPercent: 10, rssKb: 700_000 },
      { pid: 11, type: "Tab", cpuPercent: 1, rssKb: 130_000 },
      { pid: 20, type: "GPU", cpuPercent: 3, rssKb: 120_000 },
      { pid: 30, type: "Utility", serviceName: "electron-vite", cpuPercent: 20, rssKb: 900_000 },
      { pid: 40, type: "Utility", serviceName: "lyra-terminal", cpuPercent: 1, rssKb: 80_000 },
      { pid: 41, type: "", cpuPercent: 0, rssKb: 90_000 },
      { pid: 42, type: "", cpuPercent: 4, rssKb: 110_000 }
    ];
    const aggregates = aggregateProcessRoles(processes, roles);
    expect(aggregates.find((row) => row.role === "renderer_guest")?.rssKbTotal).toBe(130_000);
    expect(aggregates.find((row) => row.role === "dev")?.rssKbTotal).toBe(900_000);
    expect(productRssKb(aggregates)).toBe(200_000 + 700_000 + 130_000 + 120_000 + 80_000 + 90_000 + 110_000);
  });
});
