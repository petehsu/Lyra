import type {
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserSemanticFrame
} from "../types";
import { buildBrowserAgentObservationScript } from "./agent-observation-runtime";
import type { BrowserAgentSemanticFrameGraph } from "./types";

const KNOWN_OAUTH_IFRAME_HOSTS = [
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.live.com"
] as const;

const normalizeUrlBase = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url.split("?")[0]?.split("#")[0]?.replace(/\/$/, "") ?? "";
  }
};

const hostFromUrl = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

export const isKnownOAuthIframeHost = (url: string): boolean => {
  const host = hostFromUrl(url);
  if (host.length === 0) {
    return false;
  }
  return KNOWN_OAUTH_IFRAME_HOSTS.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`)
  );
};

export const resolveCrossOriginBlockedFallback = (
  frame: Pick<WorkbenchBrowserSemanticFrame, "url" | "bounds">
): "ax" | "coordinate" | "visual" => {
  if (isKnownOAuthIframeHost(frame.url)) {
    return "ax";
  }
  const bounds = frame.bounds;
  if (
    bounds !== undefined
    && bounds.width >= 50
    && bounds.height >= 50
  ) {
    return "coordinate";
  }
  return "visual";
};

const correlateTargetFrame = (
  targetUrl: string,
  frameGraph: BrowserAgentSemanticFrameGraph
): { readonly frame: WorkbenchBrowserSemanticFrame; readonly confidence: "high" | "medium" } | undefined => {
  const candidates = frameGraph.frames.filter((frame) => !frame.isMainFrame);
  const exact = candidates.find((frame) => frame.url === targetUrl);
  if (exact !== undefined) {
    return { frame: exact, confidence: "high" };
  }
  const targetHost = hostFromUrl(targetUrl);
  if (targetHost.length === 0) {
    return undefined;
  }
  const hostMatches = candidates.filter((frame) => hostFromUrl(frame.url) === targetHost);
  if (hostMatches.length === 1) {
    return { frame: hostMatches[0]!, confidence: "medium" };
  }
  const targetBase = normalizeUrlBase(targetUrl);
  if (targetBase.length === 0) {
    return undefined;
  }
  const baseMatches = candidates.filter((frame) => normalizeUrlBase(frame.url) === targetBase);
  if (baseMatches.length === 1) {
    return { frame: baseMatches[0]!, confidence: "medium" };
  }
  return undefined;
};

export const findOopifTargetForFrame = (
  semanticFrame: WorkbenchBrowserSemanticFrame,
  targetInfos: readonly unknown[],
  frameGraph: BrowserAgentSemanticFrameGraph
): { readonly targetId: string; readonly confidence: "high" | "medium" } | undefined => {
  const iframeTargets = targetInfos.flatMap((info) => {
    if (info === null || typeof info !== "object") {
      return [];
    }
    const record = info as Record<string, unknown>;
    if (record.type !== "iframe") {
      return [];
    }
    const targetId = typeof record.targetId === "string" ? record.targetId : undefined;
    if (targetId === undefined) {
      return [];
    }
    const targetUrl = typeof record.url === "string" ? record.url : "";
    return [{ targetId, targetUrl }];
  });

  const exact = iframeTargets.find((target) => target.targetUrl === semanticFrame.url);
  if (exact !== undefined) {
    return { targetId: exact.targetId, confidence: "high" };
  }

  const semanticBase = normalizeUrlBase(semanticFrame.url);
  const baseMatch = iframeTargets.find((target) =>
    target.targetUrl.length > 0 && normalizeUrlBase(target.targetUrl) === semanticBase
  );
  if (baseMatch !== undefined) {
    return { targetId: baseMatch.targetId, confidence: "high" };
  }

  const semanticHost = hostFromUrl(semanticFrame.url);
  if (semanticHost.length > 0) {
    const hostMatches = iframeTargets.filter((target) => hostFromUrl(target.targetUrl) === semanticHost);
    if (hostMatches.length === 1) {
      return { targetId: hostMatches[0]!.targetId, confidence: "medium" };
    }
  }

  const emptyUrlTargets = iframeTargets.filter((target) => target.targetUrl.length === 0);
  if (emptyUrlTargets.length === 1 && semanticFrame.url.length > 0) {
    return { targetId: emptyUrlTargets[0]!.targetId, confidence: "medium" };
  }

  for (const target of iframeTargets) {
    const correlated = correlateTargetFrame(target.targetUrl, frameGraph);
    if (correlated?.frame.frameRef === semanticFrame.frameRef) {
      return { targetId: target.targetId, confidence: correlated.confidence };
    }
  }

  return undefined;
};

const readRuntimeEvaluateValue = (response: Record<string, unknown>): Record<string, unknown> | null => {
  const result = response.result;
  if (result === null || typeof result !== "object") {
    return null;
  }
  const value = (result as Record<string, unknown>).value;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
};

export const observeCrossOriginFrameViaCdp = async ({
  session,
  semanticFrame,
  frameGraph,
  strategy,
  activeFileChooserPending,
  frameBounds
}: {
  readonly session: WorkbenchBrowserDebuggerSession;
  readonly semanticFrame: WorkbenchBrowserSemanticFrame;
  readonly frameGraph: BrowserAgentSemanticFrameGraph;
  readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  readonly activeFileChooserPending: boolean;
  readonly frameBounds: WorkbenchBrowserFrameGlobalBounds;
}): Promise<Record<string, unknown> | null> => {
  const targetsResponse = await session.sendCommand("Target.getTargets").catch(() => ({}));
  const targetInfos = Array.isArray((targetsResponse as Record<string, unknown>).targetInfos)
    ? ((targetsResponse as Record<string, unknown>).targetInfos as unknown[])
    : [];
  const matched = findOopifTargetForFrame(semanticFrame, targetInfos, frameGraph);
  if (matched === undefined) {
    return null;
  }

  const attach = await session
    .sendCommand("Target.attachToTarget", { targetId: matched.targetId, flatten: true })
    .catch(() => ({}));
  const childSessionId = typeof (attach as Record<string, unknown>).sessionId === "string"
    ? ((attach as Record<string, unknown>).sessionId as string)
    : undefined;
  if (childSessionId === undefined) {
    return null;
  }

  try {
    await session.sendCommand("Runtime.enable", undefined, childSessionId).catch(() => ({}));
    const script = buildBrowserAgentObservationScript({
      frameTreeNodeId: semanticFrame.frameTreeNodeId,
      frameRef: semanticFrame.frameRef,
      frameBounds,
      strategy,
      includeChildFrames: false,
      activeFileChooserPending
    });
    const response = await session.sendCommand(
      "Runtime.evaluate",
      {
        expression: script,
        returnByValue: true,
        awaitPromise: true
      },
      childSessionId
    );
    return readRuntimeEvaluateValue(response);
  } finally {
    await session
      .sendCommand("Target.detachFromTarget", { sessionId: childSessionId })
      .catch(() => ({}));
  }
};