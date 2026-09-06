import type { WorkbenchLumenTargetRef } from "../../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserDebuggerSession
} from "../types";

import { boundsFromCdpBoxModel, readAxValueText } from "./agent-observation-runtime";
import {
  actionCapabilitiesForElement,
  browserAgentTargetKind,
  createBrowserAgentTargetRef,
  semanticNodeKeyForTarget
} from "./normalizers";
import type { BrowserAgentPageTarget, BrowserAgentSemanticFrameGraph } from "./types";

export const readBrowserAgentAxOnlyElements = async ({
  tabId,
  target,
  rawUrl,
  frameGraph,
  mapEpoch,
  observedAt,
  existingElements,
  startingElementId,
  openDebuggerSessionForTarget,
  targetTtlMs
}: {
  readonly tabId: string;
  readonly target: BrowserAgentPageTarget;
  readonly rawUrl: string;
  readonly frameGraph: BrowserAgentSemanticFrameGraph;
  readonly mapEpoch: number;
  readonly observedAt: number;
  readonly existingElements: readonly WorkbenchBrowserAgentElement[];
  readonly startingElementId: number;
  readonly openDebuggerSessionForTarget: (
    target: BrowserAgentPageTarget
  ) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly targetTtlMs: () => number;
}): Promise<readonly WorkbenchBrowserAgentElement[]> => {
  let debuggerSession: WorkbenchBrowserDebuggerSession | null = null;
  try {
    debuggerSession = await openDebuggerSessionForTarget(target);
    await debuggerSession.sendCommand("Accessibility.enable").catch(() => ({}));
    await debuggerSession.sendCommand("DOM.enable").catch(() => ({}));
    const response = await debuggerSession.sendCommand("Accessibility.getFullAXTree");
    const axNodes = Array.isArray(response.nodes) ? response.nodes : [];
    const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
    if (mainFrame === undefined) return [];

    const existingSignatures = new Set(
      existingElements.map((element) => `${element.role.toLowerCase()}|${element.label.toLowerCase()}`)
    );
    const elements: WorkbenchBrowserAgentElement[] = [];
    let nextElementId = startingElementId;
    for (const axNode of axNodes.slice(0, 160)) {
      if (axNode === null || typeof axNode !== "object") continue;
      const record = axNode as Record<string, unknown>;
      if (record.ignored === true) continue;
      const role = readAxValueText(record.role).toLowerCase();
      const label = readAxValueText(record.name) || readAxValueText(record.value);
      const actionable = role === "button"
        || role === "link"
        || role === "textbox"
        || role === "searchbox"
        || role === "checkbox"
        || role === "menuitem"
        || role === "combobox"
        || role === "switch";
      if (!actionable || label.length === 0 || existingSignatures.has(`${role}|${label.toLowerCase()}`)) {
        continue;
      }
      const backendNodeId = Number(record.backendDOMNodeId);
      if (!Number.isFinite(backendNodeId)) continue;
      const box = await debuggerSession.sendCommand("DOM.getBoxModel", {
        backendNodeId: Math.round(backendNodeId)
      }).catch(() => ({}));
      const bounds = boundsFromCdpBoxModel(box);
      if (bounds === null) continue;

      const frameBounds = mainFrame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 };
      const baseElement = {
        id: nextElementId,
        frameTreeNodeId: mainFrame.frameTreeNodeId,
        frameRef: mainFrame.frameRef,
        tagName: "ax",
        role,
        label,
        selectorPreview: `ax[role="${role}"]`,
        bounds,
        localBounds: {
          x: bounds.x - frameBounds.x,
          y: bounds.y - frameBounds.y,
          width: bounds.width,
          height: bounds.height
        },
        frameBounds,
        focusable: true,
        disabled: false,
        editable: role === "textbox" || role === "searchbox",
        discoveryScope: "ax" as const,
        actionHint: role === "textbox" || role === "searchbox" ? "type" : "click",
        confidence: 0.72
      } satisfies Omit<
        WorkbenchBrowserAgentElement,
        "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
      >;
      const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
      const targetMetadata: WorkbenchLumenTargetRef = {
        targetRef: targetRef.targetRef,
        targetKind: browserAgentTargetKind(baseElement),
        tabId,
        frameRef: mainFrame.frameRef,
        frameChain: [mainFrame.frameRef],
        elementFingerprint: targetRef.elementFingerprint,
        mapEpoch,
        expiresAt: observedAt + targetTtlMs()
      };
      elements.push({
        ...baseElement,
        semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "ax", mainFrame.frameRef),
        actionCapabilities: actionCapabilitiesForElement(baseElement),
        stableId: targetRef.stableId,
        targetRef: targetRef.targetRef,
        target: targetMetadata,
        elementFingerprint: targetRef.elementFingerprint
      });
      existingSignatures.add(`${role}|${label.toLowerCase()}`);
      nextElementId += 1;
      if (elements.length >= 24) break;
    }
    return elements;
  } catch {
    return [];
  } finally {
    await debuggerSession?.close().catch(() => undefined);
  }
};
