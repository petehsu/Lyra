import type { WebContents, WebFrameMain } from "electron";

import type { WorkbenchBrowserPageLayout } from "../../../shared/desktop-bridge";
import {
  buildFrameDomProbeScript,
  normalizeFrameDomProbeResult
} from "../frame-probe";
import type {
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent
} from "../types";
import {
  buildBrowserAgentFrameOwnerProbeScript,
  coerceFrameOwnerCandidates,
  delay,
  matchFrameOwnerCandidates,
  normalizeExecuteScriptTimeoutMs,
  runFrameScriptWithTimeout,
  scoreFrameOwnerCandidate,
  toNativeInputEvent
} from "./normalizers";
import type { BrowserPageEntry } from "./types";

type PageFrameSessionHost = {
  readonly entries: ReadonlyMap<string, BrowserPageEntry>;
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly findLayout: (tabId: string) => WorkbenchBrowserPageLayout | null;
};

export const createPageFrameSessionController = ({
  entries,
  requireEntry,
  findLayout
}: PageFrameSessionHost) => {
  const findFrameInWebContents = (
    webContents: WebContents,
    frameTreeNodeId: number
  ): WebFrameMain | null =>
    webContents.mainFrame.framesInSubtree.find(
      (frame) => frame.frameTreeNodeId === frameTreeNodeId && !frame.isDestroyed()
    ) ?? null;

  const findFrame = (
    entry: BrowserPageEntry,
    frameTreeNodeId: number
  ): WebFrameMain | null => findFrameInWebContents(entry.webContents, frameTreeNodeId);

  const listFrames = (tabId: string) => {
    const entry = requireEntry(tabId);
    return entry.webContents.mainFrame.framesInSubtree
      .filter((frame) => frame.isDestroyed() === false)
      .map((frame) => ({
        frameTreeNodeId: frame.frameTreeNodeId,
        url: frame.url,
        origin: frame.origin,
        name: frame.name,
        ...(frame.parent === null
          ? {}
          : { parentFrameTreeNodeId: frame.parent.frameTreeNodeId }),
        isMainFrame: frame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId
      }));
  };

  const probeFrameDom = async (
    tabId: string,
    frameTreeNodeId: number,
    options?: { readonly maxChars?: number }
  ) => {
    const entry = requireEntry(tabId);
    const frame = findFrame(entry, frameTreeNodeId);
    if (frame === null) {
      throw new Error(`Unknown browser frame: ${frameTreeNodeId}`);
    }
    try {
      const raw = await frame.executeJavaScript(
        buildFrameDomProbeScript({
          maxChars: Math.max(512, Math.min(40_000, Math.round(options?.maxChars ?? 8_000)))
        }),
        true
      );
      return normalizeFrameDomProbeResult(raw);
    } catch {
      return { embeddedDocuments: [] };
    }
  };

  const executeFrameScript = async (
    tabId: string,
    request: {
      readonly script: string;
      readonly frameTreeNodeId?: number;
      readonly userGesture?: boolean;
      readonly timeoutMs?: number;
    }
  ) => {
    if (typeof request.script !== "string" || request.script.trim().length === 0) {
      throw new Error("script is required");
    }
    const entry = requireEntry(tabId);
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs);
    if (typeof request.frameTreeNodeId === "number" && Number.isFinite(request.frameTreeNodeId)) {
      const frame = findFrame(entry, Math.round(request.frameTreeNodeId));
      if (frame === null) {
        throw new Error(`Unknown browser frame: ${request.frameTreeNodeId}`);
      }
      return await runFrameScriptWithTimeout(
        () => frame.executeJavaScript(request.script, request.userGesture === true),
        timeoutMs
      );
    }
    return await runFrameScriptWithTimeout(
      () => entry.webContents.executeJavaScript(request.script, request.userGesture === true),
      timeoutMs
    );
  };

  const dispatchNativeInput = async (
    tabId: string,
    events: readonly WorkbenchBrowserNativeInputEvent[]
  ): Promise<void> => {
    const entry = requireEntry(tabId);
    entry.webContents.focus();
    for (const event of events) {
      entry.webContents.sendInputEvent(toNativeInputEvent(event));
      await delay(Math.max(0, Math.min(2_000, Math.round(event.delayMs ?? 0))));
    }
  };

  const fetchWithTabSession = async (
    tabId: string,
    request: {
      readonly url: string;
      readonly referrer?: string;
      readonly timeoutMs?: number;
      readonly maxBytes?: number;
    }
  ) => {
    const entry = requireEntry(tabId);
    const timeoutMs = Math.max(250, Math.min(30_000, Math.round(request.timeoutMs ?? 10_000)));
    const maxBytes = Math.max(
      1_024,
      Math.min(128 * 1024 * 1024, Math.round(request.maxBytes ?? 64 * 1024 * 1024))
    );
    const response = await entry.webContents.session.fetch(request.url, {
      method: "GET",
      ...(typeof request.referrer === "string" && request.referrer.trim().length > 0
        ? { headers: { referer: request.referrer.trim() } }
        : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const contentLength = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
    }
    return {
      finalUrl: response.url,
      status: response.status,
      ...(response.headers.get("content-type") === null
        ? {}
        : { mimeType: response.headers.get("content-type") ?? "" }),
      body: buffer
    };
  };

  const resolveFrameGlobalBounds = async (
    tabId: string,
    frameTreeNodeId: number
  ): Promise<WorkbenchBrowserFrameGlobalBounds | null> => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      return null;
    }
    const targetFrame = findFrame(entry, frameTreeNodeId);
    if (targetFrame === null) {
      return null;
    }
    if (targetFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
      const layout = findLayout(tabId);
      return layout === null
        ? null
        : { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
    }
    try {
      let currentFrame = targetFrame;
      let accumulatedX = 0;
      let accumulatedY = 0;
      let boundsWidth = 0;
      let boundsHeight = 0;
      let firstIteration = true;
      const ownerScript = buildBrowserAgentFrameOwnerProbeScript();
      while (currentFrame.parent !== null && !currentFrame.parent.isDestroyed()) {
        const parentFrame = currentFrame.parent;
        const raw = await parentFrame.executeJavaScript(ownerScript, false);
        const probed = coerceFrameOwnerCandidates(raw);
        const matches = matchFrameOwnerCandidates(parentFrame, probed.candidates);
        const owner = matches.get(currentFrame.frameTreeNodeId);
        const siblingOrdinal = parentFrame.frames.findIndex(
          (frame) => frame.frameTreeNodeId === currentFrame.frameTreeNodeId
        );
        if (
          owner === undefined
          || siblingOrdinal < 0
          || scoreFrameOwnerCandidate(currentFrame, owner, siblingOrdinal) <= 0
        ) {
          return null;
        }
        accumulatedX += owner.bounds.x;
        accumulatedY += owner.bounds.y;
        if (firstIteration) {
          boundsWidth = owner.bounds.width;
          boundsHeight = owner.bounds.height;
          firstIteration = false;
        }
        if (parentFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
          break;
        }
        currentFrame = parentFrame;
      }
      const layout = findLayout(tabId);
      if (layout !== null) {
        accumulatedX += layout.x;
        accumulatedY += layout.y;
      }
      return {
        x: accumulatedX,
        y: accumulatedY,
        width: boundsWidth,
        height: boundsHeight
      };
    } catch {
      return null;
    }
  };

  return {
    dispatchNativeInput,
    executeFrameScript,
    fetchWithTabSession,
    findFrame,
    findFrameInWebContents,
    listFrames,
    probeFrameDom,
    resolveFrameGlobalBounds
  };
};
