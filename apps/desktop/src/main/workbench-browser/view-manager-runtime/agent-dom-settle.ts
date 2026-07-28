import type { WebContents } from "electron";

const DEFAULT_QUIET_MS = 500;
const DEFAULT_BUDGET_MS = 2_000;

const AD_TRACKING_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googletagmanager.com",
  "facebook.net",
  "analytics",
  "/ads/",
  "/pixel"
];

export type DomSettleResult = {
  readonly settled: boolean;
  readonly elapsedMs: number;
  readonly skipped: boolean;
  readonly reason: "already_quiet" | "network_quiet" | "budget_exhausted" | "forced_skip";
  readonly pendingRequests?: number;
};

const readReadyState = async (webContents: WebContents): Promise<string> => {
  try {
    const value = await webContents.executeJavaScript("document.readyState", true);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
};

const readPendingResourceCount = async (webContents: WebContents): Promise<number> => {
  try {
    const value = await webContents.executeJavaScript(`(() => {
      const blocked = ${JSON.stringify(AD_TRACKING_DOMAINS)};
      const resources = performance.getEntriesByType("resource");
      let pending = 0;
      for (const entry of resources) {
        if (!entry.name || entry.responseEnd > 0) continue;
        const lower = String(entry.name).toLowerCase();
        if (blocked.some((token) => lower.includes(token))) continue;
        pending += 1;
      }
      const docLoading = document.readyState !== "complete";
      return docLoading ? Math.max(pending, 1) : pending;
    })()`, true);
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  } catch {
    return 0;
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitForDomNetworkQuiet = async (
  webContents: WebContents,
  options?: {
    readonly budgetMs?: number;
    readonly quietMs?: number;
    readonly forceSkip?: boolean;
    readonly deepSettle?: boolean;
  }
): Promise<DomSettleResult> => {
  const startedAt = Date.now();
  if (options?.forceSkip === true) {
    return { settled: false, elapsedMs: 0, skipped: true, reason: "forced_skip" };
  }
  const budgetMs = Math.max(0, Math.min(options?.budgetMs ?? DEFAULT_BUDGET_MS, 5_000));
  const quietMs = Math.max(100, Math.min(options?.quietMs ?? DEFAULT_QUIET_MS, 2_000));
  if (budgetMs === 0) {
    return { settled: false, elapsedMs: 0, skipped: true, reason: "forced_skip" };
  }

  if (options?.deepSettle === true) {
    let lastPending = Number.POSITIVE_INFINITY;
    let quietSince: number | null = null;
    while (Date.now() - startedAt < budgetMs) {
      const pending = await readPendingResourceCount(webContents);
      const readyState = await readReadyState(webContents);
      if (pending === 0 && readyState === "complete") {
        if (quietSince === null) {
          quietSince = Date.now();
        }
        if (Date.now() - quietSince >= quietMs) {
          return {
            settled: true,
            elapsedMs: Date.now() - startedAt,
            skipped: false,
            reason: "network_quiet",
            pendingRequests: 0
          };
        }
      } else {
        quietSince = null;
        lastPending = pending;
      }
      await sleep(50);
    }
    return {
      settled: lastPending === 0,
      elapsedMs: Date.now() - startedAt,
      skipped: false,
      reason: lastPending === 0 ? "network_quiet" : "budget_exhausted",
      ...(Number.isFinite(lastPending) ? { pendingRequests: lastPending } : {})
    };
  }

  const readyState = await readReadyState(webContents);
  if (readyState !== "complete" && readyState !== "interactive") {
    await sleep(Math.min(quietMs, budgetMs));
    return {
      settled: true,
      elapsedMs: Date.now() - startedAt,
      skipped: false,
      reason: "network_quiet"
    };
  }

  await sleep(Math.min(quietMs, budgetMs));
  const elapsedMs = Date.now() - startedAt;
  return {
    settled: true,
    elapsedMs,
    skipped: false,
    reason: elapsedMs === 0 ? "already_quiet" : "network_quiet"
  };
};

export const shouldSettleBeforeObserve = (request: {
  readonly settle?: boolean;
  readonly urlChanged?: boolean;
  readonly afterNavigation?: boolean;
}): boolean =>
  request.settle === true
  || request.urlChanged === true
  || request.afterNavigation === true;
