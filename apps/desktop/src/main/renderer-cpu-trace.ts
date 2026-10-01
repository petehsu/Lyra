import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BrowserWindow } from "electron";

/**
 * Temporary. Samples the renderer from the main process so a stuck UI thread
 * still shows up. Set LYRA_TRACE_RENDERER=1 for one launch, then delete this.
 */

type ProfileCallFrame = {
  readonly functionName?: string;
  readonly url?: string;
  readonly lineNumber?: number;
};

type ProfileNode = {
  readonly id: number;
  readonly callFrame: ProfileCallFrame;
  readonly hitCount?: number;
  readonly children?: readonly number[];
};

type CpuProfile = {
  readonly nodes: readonly ProfileNode[];
  readonly samples?: readonly number[];
};

const WATCH_INTERVAL_MS = 5_000;
const WATCH_LIMIT_MS = 8 * 60_000;
const GROWTH_TRIGGER_MB = 400;
const SAMPLE_DURATION_MS = 8_000;
const MAX_CAPTURES = 2;

const rendererRssMb = (pid: number): number | null => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)/m.exec(status);
    return match === null ? null : Math.round(Number(match[1]) / 1024);
  } catch {
    return null;
  }
};

const shortUrl = (url: string | undefined): string => {
  if (url === undefined || url.length === 0) {
    return "";
  }
  const marker = url.lastIndexOf("/src/");
  return marker >= 0 ? url.slice(marker + 1) : url.slice(Math.max(0, url.length - 80));
};

const formatFrame = (frame: ProfileCallFrame): string => {
  const name = frame.functionName !== undefined && frame.functionName.length > 0
    ? frame.functionName
    : "(anonymous)";
  const line = frame.lineNumber === undefined ? "" : `:${frame.lineNumber + 1}`;
  return `${name} ${shortUrl(frame.url)}${line}`;
};

const summarizeProfile = (profile: CpuProfile): string => {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parent.set(child, node.id);
    }
  }
  const ranked = [...profile.nodes]
    .filter((node) => (node.hitCount ?? 0) > 0)
    .filter((node) => {
      const name = node.callFrame.functionName ?? "";
      return name !== "(idle)" && name !== "(program)" && name !== "(root)" && name !== "(garbage collector)";
    })
    .sort((left, right) => (right.hitCount ?? 0) - (left.hitCount ?? 0))
    .slice(0, 8);
  const lines = ranked.map((node) => `  ${node.hitCount} ${formatFrame(node.callFrame)}`);
  const hottest = ranked[0];
  if (hottest !== undefined) {
    const stack: string[] = [];
    const seen = new Set<number>();
    let current: number | undefined = hottest.id;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const node = byId.get(current);
      if (node === undefined) {
        break;
      }
      stack.push(formatFrame(node.callFrame));
      current = parent.get(current);
    }
    lines.push("stack:");
    lines.push(...stack.slice(0, 12).map((frame) => `  ${frame}`));
  }
  return lines.join("\n");
};

const captureProfile = async (
  window: BrowserWindow,
  before: number | null
): Promise<void> => {
  const contents = window.webContents;
  if (!contents.debugger.isAttached()) {
    contents.debugger.attach("1.3");
  }
  await contents.debugger.sendCommand("Profiler.enable");
  await contents.debugger.sendCommand("Profiler.setSamplingInterval", { interval: 1000 });
  await contents.debugger.sendCommand("Profiler.start");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, SAMPLE_DURATION_MS);
  });
  const result = await contents.debugger.sendCommand("Profiler.stop") as { profile?: CpuProfile };
  const profile = result.profile;
  if (profile === undefined) {
    console.error("[lyra-trace] profiler returned no profile");
    return;
  }
  const outputDir = join(process.cwd(), ".tmp");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "lyra-renderer.cpuprofile");
  writeFileSync(outputPath, JSON.stringify(profile));
  const after = rendererRssMb(contents.getOSProcessId());
  console.info(
    `[lyra-trace] renderer pid=${contents.getOSProcessId()} rss ${before ?? "?"}MB -> ${after ?? "?"}MB`
  );
  console.info(`[lyra-trace] wrote ${outputPath}`);
  console.info(`[lyra-trace] hottest frames\n${summarizeProfile(profile)}`);
};

export const traceRendererCpu = (window: BrowserWindow): void => {
  if (process.env.LYRA_TRACE_RENDERER !== "1") {
    return;
  }
  const startedAt = Date.now();
  let baseline: number | null = null;
  let captures = 0;
  let capturing = false;

  const watch = (): void => {
    if (window.isDestroyed() || captures >= MAX_CAPTURES || Date.now() - startedAt > WATCH_LIMIT_MS) {
      if (captures === 0) {
        console.info("[lyra-trace] renderer memory stayed flat for this launch");
      }
      return;
    }
    const rss = rendererRssMb(window.webContents.getOSProcessId());
    if (baseline === null && rss !== null) {
      baseline = rss;
    }
    const grew = baseline !== null && rss !== null && rss - baseline >= GROWTH_TRIGGER_MB;
    if (!grew || capturing) {
      setTimeout(watch, WATCH_INTERVAL_MS);
      return;
    }
    capturing = true;
    captures += 1;
    console.info(`[lyra-trace] renderer grew ${baseline}MB -> ${rss}MB, sampling`);
    void captureProfile(window, rss)
      .catch((error: unknown) => {
        console.error(`[lyra-trace] profile failed ${String(error)}`);
      })
      .finally(() => {
        if (!window.isDestroyed() && window.webContents.debugger.isAttached()) {
          window.webContents.debugger.detach();
        }
        capturing = false;
        const next = rendererRssMb(window.isDestroyed() ? 0 : window.webContents.getOSProcessId());
        baseline = next ?? rss;
        setTimeout(watch, WATCH_INTERVAL_MS);
      });
  };

  setTimeout(watch, WATCH_INTERVAL_MS);
};
