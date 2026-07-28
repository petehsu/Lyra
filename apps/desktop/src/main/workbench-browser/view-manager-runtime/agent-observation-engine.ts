import { sanitizeBrowserPageRestoreState } from "../../../shared/workbench-browser";
import type {
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchLumenTargetRef
} from "../../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentScrollHint,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserSemanticBlockedRegion,
  WorkbenchBrowserSemanticFrame,
  WorkbenchBrowserSemanticNode,
  WorkbenchBrowserSemanticTree
} from "../types";
import {
  applyCdpEnhancementsToElements,
  captureDomObservationEnhancements,
  discoverJsListenerObservationItems,
  filterElementsByParentContainment,
  type DomObservationEnhancements,
  type JsListenerDiscoveryItem
} from "./agent-observation-cdp-enhancements";
import {
  boundsFromCdpBoxModel,
  buildBrowserAgentObservationScript,
  readAxValueText
} from "./agent-observation-runtime";
import { formatScrollHintsForMap } from "./agent-map-format";
import {
  observeCrossOriginFrameViaCdp,
  resolveCrossOriginBlockedFallback
} from "./agent-oopif-observation";
import { shouldSettleBeforeObserve, waitForDomNetworkQuiet } from "./agent-dom-settle";
import { browserHealthWarningsFromAlerts } from "./browser-health-watchdog";
import { agentTargetAddress, agentTargetTitle } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import {
  actionCapabilitiesForElement,
  boundsCenter,
  browserAgentTargetKind,
  buildBrowserAgentFrameOwnerProbeScript,
  coerceElementVisibility,
  coerceFrameBounds,
  coerceFrameOwnerCandidates,
  createBrowserAgentFrameRef,
  createBrowserAgentTargetRef,
  hashStableString,
  matchFrameOwnerCandidates,
  normalizeExecuteScriptTimeoutMs,
  normalizeUnitCoverage,
  runFrameScriptWithTimeout,
  scoreFrameOwnerCandidate,
  semanticNodeKeyForTarget
} from "./normalizers";
import type {
  BrowserAgentFrameOwnerCandidate,
  BrowserAgentPageTarget,
  BrowserAgentRawFrameObservation,
  BrowserAgentSemanticFrameGraph,
  BrowserPageEntry
} from "./types";

type BrowserAgentObservationEngineDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "findFrameInWebContents"
  | "openDebuggerSessionForTarget"
  | "publishBrowserAgentActivity"
  | "readPageDiagnostics"
  | "rememberBrowserRestoreState"
  | "resolveBrowserAgentTarget"
  | "updateRuntimeState"
> & {
  readonly stateStore: BrowserAgentStateStore;
  readonly consumeBrowserHealthAlerts?: (tabId: string) => readonly import("../types").BrowserHealthAlert[];
  readonly onBrowserHealthCaptcha?: (tabId: string, label: string) => void;
  readonly onBrowserHealthPermission?: (tabId: string, kind: string) => void;
};

const elementIntersectsViewport = (
  element: WorkbenchBrowserAgentElement,
  viewportWidth: number,
  viewportHeight: number
): boolean => {
  if (element.discoveryScope === "visual" || element.discoveryScope === "coordinate") {
    return true;
  }
  if (element.visibility?.offscreen === true) {
    return false;
  }
  const bounds = element.bounds;
  return (
    bounds.x < viewportWidth
    && bounds.y < viewportHeight
    && bounds.x + bounds.width > 0
    && bounds.y + bounds.height > 0
  );
};

const collectInteractiveScrollHints = (
  elements: readonly WorkbenchBrowserAgentElement[],
  viewportHeight: number,
  mainFrameRef: string | undefined
): {
  readonly hints: readonly WorkbenchBrowserAgentScrollHint[];
  readonly totalHidden: number;
} => {
  if (viewportHeight <= 0) {
    return { hints: [], totalHidden: 0 };
  }
  const hiddenCandidates = elements.filter((element) =>
    element.discoveryScope !== "visual"
    && element.discoveryScope !== "coordinate"
    && element.frameRef !== mainFrameRef
    && element.visibility?.offscreen === true
    && element.visibility?.covered !== true
    && element.disabled === false
  );
  return {
    hints: hiddenCandidates.slice(0, 8).map((element) => ({
      frameRef: element.frameRef,
      tag: element.tagName,
      text: element.label.trim().length > 0
        ? element.label.slice(0, 40)
        : (element.textSnippet?.slice(0, 40) ?? "(no label)"),
      pagesDown: Math.max(0, Math.round((element.bounds.y / viewportHeight) * 10) / 10)
    })),
    totalHidden: hiddenCandidates.length
  };
};

export const createBrowserAgentObservationEngine = (deps: BrowserAgentObservationEngineDeps) => {
  const {
    findFrameInWebContents,
    openDebuggerSessionForTarget,
    publishBrowserAgentActivity,
    readPageDiagnostics,
    rememberBrowserRestoreState,
    resolveBrowserAgentTarget,
    stateStore,
    updateRuntimeState,
    consumeBrowserHealthAlerts,
    onBrowserHealthCaptcha,
    onBrowserHealthPermission
  } = deps;
  const {
    activeEditableElementFromObservation,
    cacheBrowserAgentInputTarget,
    consumePendingSettle,
    isActiveFileChooserPending,
    nextMapEpoch,
    readBrowserAgentCacheEntry,
    registerTargetObservation,
    rememberBrowserAgentObservation,
    targetTtlMs
  } = stateStore;

  const normalizeAgentObserveStrategy = (
    strategy: WorkbenchBrowserAgentObserveStrategy | undefined
  ): WorkbenchBrowserAgentObserveStrategy => {
    if (
      strategy === "interactiveOnly"
      || strategy === "picker"
      || strategy === "focus"
      || strategy === "hybrid"
      || strategy === "domFallback"
      || strategy === "visionFallback"
    ) {
      return strategy;
    }
    return "interactiveOnly";
  };

  const isLightweightAgentObserveStrategy = (
    strategy: WorkbenchBrowserAgentObserveStrategy
  ): boolean =>
    strategy === "interactiveOnly" || strategy === "picker" || strategy === "focus";

  const createBrowserAgentObservationId = (tabId: string): string =>
    `lyra-lumen-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const buildBrowserAgentSemanticFrameGraph = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number
  ): Promise<BrowserAgentSemanticFrameGraph> => {
    const allFrames = target.webContents.mainFrame.framesInSubtree
      .filter((frame) => frame.isDestroyed() === false);
    const mainFrame = target.webContents.mainFrame;
    const mainOrigin = mainFrame.origin;
    const ownerCandidatesByFrame = new Map<number, readonly BrowserAgentFrameOwnerCandidate[]>();
    const viewportByFrame = new Map<number, WorkbenchBrowserFrameGlobalBounds>();
    const warnings: string[] = [];
    const blockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [];
    const ownerScript = buildBrowserAgentFrameOwnerProbeScript();

    for (const frame of allFrames) {
      try {
        const raw = await runFrameScriptWithTimeout(
          () => frame.executeJavaScript(ownerScript, false),
          Math.max(500, Math.min(2_000, timeoutMs))
        );
        const probed = coerceFrameOwnerCandidates(raw);
        ownerCandidatesByFrame.set(frame.frameTreeNodeId, probed.candidates);
        if (probed.viewport !== null) {
          viewportByFrame.set(frame.frameTreeNodeId, probed.viewport);
        }
      } catch (error) {
        warnings.push(`frame_owner_probe_failed:${frame.frameTreeNodeId}`);
        blockedRegions.push({
          id: `frame-unavailable-${frame.frameTreeNodeId}`,
          kind: "frame-unavailable",
          frameRef: createBrowserAgentFrameRef(
            frame.frameTreeNodeId,
            frame.url,
            frame.parent?.frameTreeNodeId
          ),
          frameTreeNodeId: frame.frameTreeNodeId,
          reason: error instanceof Error ? error.message : String(error),
          ...(frame.url.length > 0 ? { url: frame.url } : {}),
          fallback: "visual",
          confidence: "medium"
        });
      }
    }

    const ownerByChildFrame = new Map<number, BrowserAgentFrameOwnerCandidate>();
    for (const parentFrame of allFrames) {
      const candidates = ownerCandidatesByFrame.get(parentFrame.frameTreeNodeId) ?? [];
      const matches = matchFrameOwnerCandidates(parentFrame, candidates);
      for (const [childFrameTreeNodeId, candidate] of matches) {
        ownerByChildFrame.set(childFrameTreeNodeId, candidate);
      }
    }

    const boundsByFrame = new Map<number, WorkbenchBrowserFrameGlobalBounds>();
    boundsByFrame.set(
      mainFrame.frameTreeNodeId,
      viewportByFrame.get(mainFrame.frameTreeNodeId) ?? { x: 0, y: 0, width: 1_280, height: 720 }
    );

    const sortedFrames = allFrames.slice().sort((left, right) => {
      const leftDepth = left === left.top ? 0 : left.framesInSubtree.length;
      const rightDepth = right === right.top ? 0 : right.framesInSubtree.length;
      return leftDepth - rightDepth || left.frameTreeNodeId - right.frameTreeNodeId;
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (const frame of sortedFrames) {
        if (boundsByFrame.has(frame.frameTreeNodeId) || frame.parent === null) {
          continue;
        }
        const parentBounds = boundsByFrame.get(frame.parent.frameTreeNodeId);
        const owner = ownerByChildFrame.get(frame.frameTreeNodeId);
        if (parentBounds === undefined || owner === undefined) {
          continue;
        }
        boundsByFrame.set(frame.frameTreeNodeId, {
          x: parentBounds.x + owner.bounds.x,
          y: parentBounds.y + owner.bounds.y,
          width: owner.bounds.width,
          height: owner.bounds.height
        });
        changed = true;
      }
    }

    const frames = allFrames.map((frame): WorkbenchBrowserSemanticFrame => {
      const parentFrameTreeNodeId = frame.parent?.frameTreeNodeId;
      const frameRef = createBrowserAgentFrameRef(frame.frameTreeNodeId, frame.url, parentFrameTreeNodeId);
      const owner = ownerByChildFrame.get(frame.frameTreeNodeId);
      const crossOrigin = frame.parent !== null && frame.origin !== "null" && frame.parent.origin !== frame.origin;
      return {
        frameRef,
        frameTreeNodeId: frame.frameTreeNodeId,
        ...(frame.parent === null
          ? {}
          : {
              parentFrameRef: createBrowserAgentFrameRef(
                frame.parent.frameTreeNodeId,
                frame.parent.url,
                frame.parent.parent?.frameTreeNodeId
              ),
              parentFrameTreeNodeId: frame.parent.frameTreeNodeId
            }),
        isMainFrame: frame.frameTreeNodeId === mainFrame.frameTreeNodeId,
        url: frame.url,
        origin: frame.origin,
        name: frame.name,
        ...(boundsByFrame.get(frame.frameTreeNodeId) === undefined
          ? {}
          : { bounds: boundsByFrame.get(frame.frameTreeNodeId) as WorkbenchBrowserFrameGlobalBounds }),
        ...(owner === undefined
          ? {}
          : {
              ownerSelectorPreview: owner.selectorPreview,
              ...(frame.parent === null ? {} : { ownerFrameTreeNodeId: frame.parent.frameTreeNodeId }),
              matchConfidence:
                scoreFrameOwnerCandidate(
                  frame,
                  owner,
                  frame.parent?.frames.findIndex((candidate) => candidate.frameTreeNodeId === frame.frameTreeNodeId) ?? 0
                ) >= 80
                  ? "high"
                  : "medium"
            }),
        domAccess: frame.frameTreeNodeId === mainFrame.frameTreeNodeId || frame.origin === mainOrigin
          ? "direct"
          : (crossOrigin ? "cdp" : "unknown"),
        accessibilityStatus: "unknown"
      };
    });

    const framesByTreeNodeId = new Map(frames.map((frame) => [frame.frameTreeNodeId, frame]));
    return { frames, framesByTreeNodeId, warnings, blockedRegions };
  };

  const buildBrowserAgentSemanticTree = ({
    elements,
    frameGraph,
    warnings,
    authChallengeSignals
  }: {
    readonly elements: readonly WorkbenchBrowserAgentElement[];
    readonly frameGraph: BrowserAgentSemanticFrameGraph;
    readonly warnings: readonly string[];
    readonly authChallengeSignals: NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>;
  }): WorkbenchBrowserSemanticTree => {
    const blockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [...frameGraph.blockedRegions];
    for (const signal of authChallengeSignals) {
      if (signal.kind === "captcha") {
        blockedRegions.push({
          id: `captcha-${hashStableString(`${signal.url ?? ""}|${signal.label ?? ""}`)}`,
          kind: "captcha",
          reason: signal.label ?? "captcha challenge detected",
          ...(signal.frameRef === undefined ? {} : { frameRef: signal.frameRef }),
          ...(signal.frameTreeNodeId === undefined ? {} : { frameTreeNodeId: signal.frameTreeNodeId }),
          ...(signal.bounds === undefined ? {} : { bounds: signal.bounds }),
          ...(signal.url === undefined ? {} : { url: signal.url }),
          fallback: "elevate",
          confidence: signal.confidence
        });
      } else if (signal.kind === "oauth_popup" && signal.confidence === "high") {
        blockedRegions.push({
          id: `auth-prompt-${hashStableString(`${signal.url ?? ""}|${signal.label ?? ""}`)}`,
          kind: "auth-prompt",
          reason: signal.label ?? "OAuth identity prompt detected",
          ...(signal.frameRef === undefined ? {} : { frameRef: signal.frameRef }),
          ...(signal.frameTreeNodeId === undefined ? {} : { frameTreeNodeId: signal.frameTreeNodeId }),
          ...(signal.bounds === undefined ? {} : { bounds: signal.bounds }),
          ...(signal.url === undefined ? {} : { url: signal.url }),
          fallback: "ax",
          confidence: signal.confidence
        });
      } else if (signal.kind === "active_file_chooser" || signal.kind === "payment_auth") {
        blockedRegions.push({
          id: `${signal.kind}-${hashStableString(`${signal.url ?? ""}|${signal.label ?? ""}`)}`,
          kind: "permission-prompt",
          reason: signal.kind === "active_file_chooser"
            ? "system file picker or active upload dialog"
            : (signal.label ?? signal.kind),
          ...(signal.frameRef === undefined ? {} : { frameRef: signal.frameRef }),
          ...(signal.frameTreeNodeId === undefined ? {} : { frameTreeNodeId: signal.frameTreeNodeId }),
          ...(signal.bounds === undefined ? {} : { bounds: signal.bounds }),
          ...(signal.url === undefined ? {} : { url: signal.url }),
          fallback: "user",
          confidence: signal.confidence
        });
      }
    }
    if (warnings.some((warning) => warning.includes("closed_shadow"))) {
      blockedRegions.push({
        id: "closed-shadow-boundary",
        kind: "closed-shadow",
        reason: "A custom element or closed shadow boundary was visible but not DOM-traversable.",
        fallback: "visual",
        confidence: "low"
      });
    }

    const nodes: WorkbenchBrowserSemanticNode[] = elements.map((element) => {
      const frameBounds = element.frameBounds
        ?? frameGraph.framesByTreeNodeId.get(element.frameTreeNodeId)?.bounds;
      const offscreen = frameBounds === undefined
        ? false
        : element.bounds.x + element.bounds.width < frameBounds.x
          || element.bounds.y + element.bounds.height < frameBounds.y
          || element.bounds.x > frameBounds.x + frameBounds.width
          || element.bounds.y > frameBounds.y + frameBounds.height;
      const visibility = element.visibility;
      return {
        nodeKey: element.semanticNodeKey ?? semanticNodeKeyForTarget(element.targetRef, "dom", element.frameRef),
        targetRef: element.targetRef,
        frameRef: element.frameRef,
        frameTreeNodeId: element.frameTreeNodeId,
        elementId: element.id,
        tagName: element.tagName,
        role: element.role,
        name: element.label,
        label: element.label,
        selectorPreview: element.selectorPreview,
        bounds: element.bounds,
        source:
          element.discoveryScope === "visual"
            ? ["visual"]
            : element.discoveryScope === "coordinate"
              ? ["coordinate"]
              : element.discoveryScope === "ax" ? ["ax"] : ["dom"],
        treeScope: element.discoveryScope ?? "document",
        ...(element.hostChain === undefined ? {} : { hostChain: element.hostChain }),
        ...(element.hostChainFingerprint === undefined ? {} : { hostChainFingerprint: element.hostChainFingerprint }),
        actionCapabilities: element.actionCapabilities ?? actionCapabilitiesForElement(element),
        visibility: {
          visible: visibility?.visible ?? true,
          offscreen: visibility?.offscreen ?? offscreen,
          covered: visibility?.covered ?? false,
          ariaHidden: visibility?.ariaHidden ?? false
        },
        state: {
          focusable: element.focusable,
          disabled: element.disabled,
          editable: element.editable,
          ...(element.checked === undefined ? {} : { checked: element.checked }),
          ...(element.expanded === undefined ? {} : { expanded: element.expanded })
        },
        confidence: element.confidence ?? 0.92
      };
    });

    const edges = nodes
      .filter((node) => node.treeScope === "shadow" && node.hostChain !== undefined && node.hostChain.length > 0)
      .map((node): WorkbenchBrowserSemanticTree["edges"][number] => ({
        from: `shadow-host:${hashStableString(node.hostChain?.join(">") ?? "")}`,
        to: node.nodeKey,
        kind: "shadow-host"
      }));
    const frameEdges = frameGraph.frames
      .filter((frame) => frame.parentFrameRef !== undefined)
      .map((frame): WorkbenchBrowserSemanticTree["edges"][number] => ({
        from: frame.parentFrameRef ?? "",
        to: frame.frameRef,
        kind: "frame-owner"
      }));
    const framesWithBounds = frameGraph.frames.filter((frame) => frame.bounds !== undefined).length;
    const shadowNodes = nodes.filter((node) => node.treeScope === "shadow").length;
    const axNodes = nodes.filter((node) => node.source.includes("ax")).length;
    const visualNodes = nodes.filter((node) => node.source.includes("visual")).length;
    const coordinateNodes = nodes.filter((node) => node.source.includes("coordinate")).length;
    return {
      nodes,
      edges: [...edges, ...frameEdges],
      frames: frameGraph.frames,
      warnings,
      coverage: {
        domCoverage: normalizeUnitCoverage(
          elements.some((element) =>
            element.discoveryScope !== "visual"
            && element.discoveryScope !== "coordinate"
            && element.discoveryScope !== "ax"
          )
            ? 1
            : 0
        ),
        axCoverage: normalizeUnitCoverage(axNodes > 0 ? 1 : 0),
        frameCoverage: normalizeUnitCoverage(frameGraph.frames.length === 0 ? 1 : framesWithBounds / frameGraph.frames.length),
        shadowCoverage: normalizeUnitCoverage(
          warnings.some((warning) => warning.includes("closed_shadow"))
            ? (shadowNodes > 0 ? 0.5 : 0)
            : 1
        ),
        visualCoverage: normalizeUnitCoverage(visualNodes > 0 && coordinateNodes === 0 ? 1 : 0)
      },
      blockedRegions
    };
  };

  const createCoordinateFallbackElement = ({
    tabId,
    rawUrl,
    mapEpoch,
    observedAt,
    frame,
    elementId
  }: {
    readonly tabId: string;
    readonly rawUrl: string;
    readonly mapEpoch: number;
    readonly observedAt: number;
    readonly frame: WorkbenchBrowserSemanticFrame;
    readonly elementId: number;
  }): WorkbenchBrowserAgentElement => {
    const frameBounds = frame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 };
    const center = boundsCenter(frameBounds);
    const bounds = {
      x: Math.max(frameBounds.x, center.x - 20),
      y: Math.max(frameBounds.y, center.y - 20),
      width: 40,
      height: 40
    };
    const baseElement = {
      id: elementId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameRef: frame.frameRef,
      tagName: "region",
      role: "region",
      label: "Cross-origin frame target",
      selectorPreview: "coordinate:center",
      bounds,
      localBounds: {
        x: bounds.x - frameBounds.x,
        y: bounds.y - frameBounds.y,
        width: bounds.width,
        height: bounds.height
      },
      frameBounds,
      focusable: false,
      disabled: false,
      editable: false,
      discoveryScope: "coordinate" as const,
      actionHint: "use_coordinate_act",
      textSnippet:
        "Cross-origin iframe with known bounds. Use lyra_lumen.act on this targetRef for compositor-level coordinate clicks without a screenshot.",
      confidence: 0.45
    } satisfies Omit<
      WorkbenchBrowserAgentElement,
      "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
    >;
    const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
    const targetMetadata: WorkbenchLumenTargetRef = {
      targetRef: targetRef.targetRef,
      targetKind: "element",
      tabId,
      frameRef: frame.frameRef,
      frameChain: [frame.frameRef],
      elementFingerprint: targetRef.elementFingerprint,
      mapEpoch,
      expiresAt: observedAt + targetTtlMs()
    };
    return {
      ...baseElement,
      semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "coordinate", frame.frameRef),
      actionCapabilities: ["click"],
      stableId: targetRef.stableId,
      targetRef: targetRef.targetRef,
      target: targetMetadata,
      elementFingerprint: targetRef.elementFingerprint
    };
  };

  const createVisualFallbackElement = ({
    tabId,
    rawUrl,
    mapEpoch,
    observedAt,
    frame,
    elementId
  }: {
    readonly tabId: string;
    readonly rawUrl: string;
    readonly mapEpoch: number;
    readonly observedAt: number;
    readonly frame: WorkbenchBrowserSemanticFrame;
    readonly elementId: number;
  }): WorkbenchBrowserAgentElement => {
    const frameBounds = frame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 };
    const center = boundsCenter(frameBounds);
    const bounds = {
      x: Math.max(frameBounds.x, center.x - 20),
      y: Math.max(frameBounds.y, center.y - 20),
      width: 40,
      height: 40
    };
    const baseElement = {
      id: elementId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameRef: frame.frameRef,
      tagName: "visual",
      role: "visual",
      label: "Visual fallback target",
      selectorPreview: "visual:center",
      bounds,
      localBounds: {
        x: bounds.x - frameBounds.x,
        y: bounds.y - frameBounds.y,
        width: bounds.width,
        height: bounds.height
      },
      frameBounds,
      focusable: false,
      disabled: false,
      editable: false,
      discoveryScope: "visual" as const,
      actionHint: "use_visual_act",
      textSnippet: "Use lyra_lumen.see, then lyra_lumen.vact with the captureId and real screenshot coordinates.",
      confidence: 0.25
    } satisfies Omit<
      WorkbenchBrowserAgentElement,
      "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
    >;
    const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
    const targetMetadata: WorkbenchLumenTargetRef = {
      targetRef: targetRef.targetRef,
      targetKind: "visual",
      tabId,
      frameRef: frame.frameRef,
      frameChain: [frame.frameRef],
      elementFingerprint: targetRef.elementFingerprint,
      mapEpoch,
      expiresAt: observedAt + targetTtlMs()
    };
    return {
      ...baseElement,
      semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "visual", frame.frameRef),
      actionCapabilities: [],
      stableId: targetRef.stableId,
      targetRef: targetRef.targetRef,
      target: targetMetadata,
      elementFingerprint: targetRef.elementFingerprint
    };
  };

  const readBrowserAgentAxOnlyElements = async ({
    tabId,
    target,
    rawUrl,
    frameGraph,
    mapEpoch,
    observedAt,
    existingElements,
    startingElementId
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly rawUrl: string;
    readonly frameGraph: BrowserAgentSemanticFrameGraph;
    readonly mapEpoch: number;
    readonly observedAt: number;
    readonly existingElements: readonly WorkbenchBrowserAgentElement[];
    readonly startingElementId: number;
  }): Promise<readonly WorkbenchBrowserAgentElement[]> => {
    let debuggerSession: WorkbenchBrowserDebuggerSession | null = null;
    try {
      debuggerSession = await openDebuggerSessionForTarget(target);
      await debuggerSession.sendCommand("Accessibility.enable").catch(() => ({}));
      await debuggerSession.sendCommand("DOM.enable").catch(() => ({}));
      const response = await debuggerSession.sendCommand("Accessibility.getFullAXTree");
      const axNodes = Array.isArray(response.nodes) ? response.nodes : [];
      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      if (mainFrame === undefined) {
        return [];
      }
      const existingSignatures = new Set(
        existingElements.map((element) => `${element.role.toLowerCase()}|${element.label.toLowerCase()}`)
      );
      const elements: WorkbenchBrowserAgentElement[] = [];
      let nextElementId = startingElementId;
      for (const axNode of axNodes.slice(0, 160)) {
        if (axNode === null || typeof axNode !== "object") {
          continue;
        }
        const record = axNode as Record<string, unknown>;
        if (record.ignored === true) {
          continue;
        }
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
        if (!Number.isFinite(backendNodeId)) {
          continue;
        }
        const box = await debuggerSession.sendCommand("DOM.getBoxModel", {
          backendNodeId: Math.round(backendNodeId)
        }).catch(() => ({}));
        const bounds = boundsFromCdpBoxModel(box);
        if (bounds === null) {
          continue;
        }
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
        if (elements.length >= 24) {
          break;
        }
      }
      return elements;
    } catch {
      return [];
    } finally {
      await debuggerSession?.close().catch(() => undefined);
    }
  };

  const observeAgentPage = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly mapScope?: import("../types").WorkbenchBrowserAgentMapScope;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
      readonly settle?: boolean;
    }
  ): Promise<WorkbenchBrowserAgentObservation> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request?.timeoutMs);
    const previousCache = readBrowserAgentCacheEntry(tabId, target.targetMode);
    const currentUrl = agentTargetAddress(target);
    if (
      shouldSettleBeforeObserve({
        ...(request?.settle === undefined ? {} : { settle: request.settle }),
        urlChanged: previousCache !== undefined && previousCache.url !== currentUrl,
        afterNavigation: consumePendingSettle(tabId, target.targetMode)
      })
    ) {
      await waitForDomNetworkQuiet(target.webContents, {
        forceSkip: request?.settle === false
      });
    }
    const strategy = normalizeAgentObserveStrategy(request?.strategy);
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request?.timeoutMs, 8_000);
    const activeFileChooserPending = isActiveFileChooserPending(tabId, target.targetMode);
    const lightweightObservation = isLightweightAgentObserveStrategy(strategy);
    if (request?.suppressActivity !== true) {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "observe",
        visibleFollow: target.browserMode.visibleFollow,
        durationMs: lightweightObservation
          ? Math.max(650, Math.min(1_600, timeoutMs))
          : Math.max(1_250, Math.min(3_200, timeoutMs))
      });
    }
    const frameObservations: BrowserAgentRawFrameObservation[] = [];
    let frameGraph: BrowserAgentSemanticFrameGraph;
    let graphWarnings: string[] = [];
    let graphBlockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [];
    if (lightweightObservation) {
      const mainFrame = target.webContents.mainFrame;
      const mainFrameBounds = { x: 0, y: 0, width: 1_280, height: 720 };
      const mainSemanticFrame: WorkbenchBrowserSemanticFrame = {
        frameRef: createBrowserAgentFrameRef(mainFrame.frameTreeNodeId, mainFrame.url),
        frameTreeNodeId: mainFrame.frameTreeNodeId,
        isMainFrame: true,
        url: mainFrame.url,
        origin: mainFrame.origin,
        name: mainFrame.name,
        bounds: mainFrameBounds,
        domAccess: "direct",
        accessibilityStatus: "unknown"
      };
      frameGraph = {
        frames: [mainSemanticFrame],
        framesByTreeNodeId: new Map([[mainSemanticFrame.frameTreeNodeId, mainSemanticFrame]]),
        warnings: [],
        blockedRegions: []
      };
      try {
        const rawFrame = await runFrameScriptWithTimeout(
          () => mainFrame.executeJavaScript(
            buildBrowserAgentObservationScript({
              frameTreeNodeId: mainSemanticFrame.frameTreeNodeId,
              frameRef: mainSemanticFrame.frameRef,
              frameBounds: mainFrameBounds,
              strategy,
              includeChildFrames: true,
              activeFileChooserPending
            }),
            true
          ),
          Math.max(350, Math.min(1_500, timeoutMs))
        );
        frameObservations.push({
          frame: mainSemanticFrame,
          raw: rawFrame !== null && typeof rawFrame === "object" ? rawFrame as Record<string, unknown> : {}
        });
      } catch (error) {
        graphWarnings.push(`frame_observe_failed:${mainSemanticFrame.frameTreeNodeId}`);
        graphBlockedRegions.push({
          id: `frame-observe-${mainSemanticFrame.frameTreeNodeId}`,
          kind: "frame-unavailable",
          frameRef: mainSemanticFrame.frameRef,
          frameTreeNodeId: mainSemanticFrame.frameTreeNodeId,
          bounds: mainFrameBounds,
          reason: error instanceof Error ? error.message : String(error),
          ...(mainSemanticFrame.url.length > 0 ? { url: mainSemanticFrame.url } : {}),
          fallback: "visual",
          confidence: "medium"
        });
      }
    } else {
      frameGraph = await buildBrowserAgentSemanticFrameGraph(target, timeoutMs);
      graphWarnings = [...frameGraph.warnings];
      graphBlockedRegions = [...frameGraph.blockedRegions];
      let oopifDebuggerSession: WorkbenchBrowserDebuggerSession | null = null;
      const ensureOopifDebuggerSession = async (): Promise<WorkbenchBrowserDebuggerSession> => {
        if (oopifDebuggerSession === null) {
          oopifDebuggerSession = await openDebuggerSessionForTarget(target);
        }
        return oopifDebuggerSession;
      };
      for (const semanticFrame of frameGraph.frames.slice(0, 48)) {
        if (semanticFrame.domAccess === "cdp") {
          try {
            const session = await ensureOopifDebuggerSession();
            const rawFrame = await observeCrossOriginFrameViaCdp({
              session,
              semanticFrame,
              frameGraph,
              strategy,
              activeFileChooserPending,
              frameBounds: semanticFrame.bounds ?? { x: 0, y: 0, width: 1, height: 1 }
            });
            if (rawFrame !== null) {
              frameObservations.push({ frame: semanticFrame, raw: rawFrame });
              continue;
            }
            graphWarnings.push(`oopif_observe_empty:${semanticFrame.frameTreeNodeId}`);
          } catch (error) {
            graphWarnings.push(`oopif_observe_failed:${semanticFrame.frameTreeNodeId}`);
          }
          graphBlockedRegions.push({
            id: `frame-observe-${semanticFrame.frameTreeNodeId}`,
            kind: "cross-origin",
            frameRef: semanticFrame.frameRef,
            frameTreeNodeId: semanticFrame.frameTreeNodeId,
            ...(semanticFrame.bounds === undefined ? {} : { bounds: semanticFrame.bounds }),
            reason: "Cross-origin iframe DOM is not reachable from the parent frame session.",
            ...(semanticFrame.url.length > 0 ? { url: semanticFrame.url } : {}),
            fallback: resolveCrossOriginBlockedFallback(semanticFrame),
            confidence: "high"
          });
          continue;
        }

        const frame = findFrameInWebContents(target.webContents, semanticFrame.frameTreeNodeId);
        if (frame === null) {
          graphWarnings.push(`frame_missing:${semanticFrame.frameTreeNodeId}`);
          continue;
        }
        try {
          const rawFrame = await runFrameScriptWithTimeout(
            () => frame.executeJavaScript(
              buildBrowserAgentObservationScript({
                frameTreeNodeId: semanticFrame.frameTreeNodeId,
                frameRef: semanticFrame.frameRef,
                frameBounds: semanticFrame.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                strategy,
                includeChildFrames: false,
                activeFileChooserPending
              }),
              true
            ),
            Math.max(500, Math.min(3_000, timeoutMs))
          );
          frameObservations.push({
            frame: semanticFrame,
            raw: rawFrame !== null && typeof rawFrame === "object" ? rawFrame as Record<string, unknown> : {}
          });
        } catch (error) {
          graphWarnings.push(`frame_observe_failed:${semanticFrame.frameTreeNodeId}`);
          graphBlockedRegions.push({
            id: `frame-observe-${semanticFrame.frameTreeNodeId}`,
            kind: "frame-unavailable",
            frameRef: semanticFrame.frameRef,
            frameTreeNodeId: semanticFrame.frameTreeNodeId,
            ...(semanticFrame.bounds === undefined ? {} : { bounds: semanticFrame.bounds }),
            reason: error instanceof Error ? error.message : String(error),
            ...(semanticFrame.url.length > 0 ? { url: semanticFrame.url } : {}),
            fallback: resolveCrossOriginBlockedFallback(semanticFrame),
            confidence: "medium"
          });
        }
      }
    }

    let cdpEnhancements: DomObservationEnhancements | null = null;
    if (
      strategy === "interactiveOnly"
      || strategy === "picker"
      || strategy === "focus"
      || strategy === "hybrid"
    ) {
      let debuggerSession: WorkbenchBrowserDebuggerSession | null = null;
      try {
        debuggerSession = await openDebuggerSessionForTarget(target);
        cdpEnhancements = await captureDomObservationEnhancements(debuggerSession);
        if (cdpEnhancements === null) {
          graphWarnings.push("cdp_observation_enhancement_unavailable");
        }
      } catch {
        graphWarnings.push("cdp_observation_enhancement_unavailable");
      } finally {
        await debuggerSession?.close().catch(() => undefined);
      }
    }

    const mainRaw = frameObservations.find((entry) => entry.frame.isMainFrame)?.raw ?? {};
    const rawUrl = typeof mainRaw.url === "string" ? mainRaw.url : agentTargetAddress(target);
    const observedAt = Date.now();
    const mapEpoch = nextMapEpoch(tabId, target.targetMode);
    const rawElements = frameObservations.flatMap((entry) => {
      const rawItems = Array.isArray(entry.raw.elements) ? entry.raw.elements : [];
      const activeLocalId = Number.isFinite(Number(entry.raw.activeElementId))
        ? Math.round(Number(entry.raw.activeElementId))
        : null;
      return rawItems.map((item) => ({
        item,
        frame: entry.frame,
        activeLocalId
      }));
    });
    let nextElementId = 1;
    let activeElementId: number | null = null;
    const domElements = rawElements
      .map((entry): WorkbenchBrowserAgentElement | null => {
        const { item, frame, activeLocalId } = entry;
        if (item === null || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const bounds = record.bounds !== null && typeof record.bounds === "object"
          ? record.bounds as Record<string, unknown>
          : {};
        const localId = Number(record.id);
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const width = Number(bounds.width);
        const height = Number(bounds.height);
        if (
          Number.isFinite(localId) === false
          || Number.isFinite(x) === false
          || Number.isFinite(y) === false
          || Number.isFinite(width) === false
          || Number.isFinite(height) === false
          || width <= 0
          || height <= 0
        ) {
          return null;
        }
        const discoveryScope =
          frame.domAccess === "cdp"
            ? "frame"
            : record.discoveryScope === "shadow" || record.discoveryScope === "frame" || record.discoveryScope === "visual"
              ? record.discoveryScope
              : "document";
        const frameTreeNodeId = Number.isFinite(Number(record.frameTreeNodeId))
          ? Math.round(Number(record.frameTreeNodeId))
          : frame.frameTreeNodeId;
        const frameUrl = typeof record.frameUrl === "string" && record.frameUrl.length > 0
          ? record.frameUrl
          : frame.url || rawUrl;
        const frameRef = typeof record.frameRef === "string" && record.frameRef.length > 0
          ? record.frameRef
          : frame.frameRef;
        const localBounds = coerceFrameBounds(record.localBounds) ?? {
          x: Math.round(x - (frame.bounds?.x ?? 0)),
          y: Math.round(y - (frame.bounds?.y ?? 0)),
          width: Math.round(width),
          height: Math.round(height)
        };
        const frameBounds = coerceFrameBounds(record.frameBounds) ?? frame.bounds;
        const hostChain = Array.isArray(record.hostChain)
          ? record.hostChain.filter((value): value is string => typeof value === "string" && value.length > 0)
          : [];
        const hostChainFingerprint = typeof record.hostChainFingerprint === "string" && record.hostChainFingerprint.length > 0
          ? record.hostChainFingerprint
          : (hostChain.length > 0 ? hashStableString(hostChain.join(">")) : undefined);
        const visibility = coerceElementVisibility(record.visibility);
        const elementId = nextElementId;
        nextElementId += 1;
        if (activeLocalId !== null && Math.round(localId) === activeLocalId) {
          activeElementId = elementId;
        }
        const baseElement = {
          id: elementId,
          frameTreeNodeId,
          frameRef,
          tagName: typeof record.tagName === "string" ? record.tagName : "element",
          role: typeof record.role === "string" ? record.role : "element",
          label: typeof record.label === "string" && record.label.length > 0
            ? record.label
            : "(no label)",
          selectorPreview: typeof record.selectorPreview === "string" ? record.selectorPreview : "",
          bounds: {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height)
          },
          localBounds,
          ...(frameBounds === undefined ? {} : { frameBounds }),
          focusable: record.focusable === true,
          disabled: record.disabled === true,
          editable: record.editable === true,
          ...(visibility === undefined ? {} : { visibility }),
          ...(typeof record.checked === "boolean" ? { checked: record.checked } : {}),
          ...(typeof record.expanded === "boolean" ? { expanded: record.expanded } : {}),
          discoveryScope,
          ...(hostChain.length > 0 ? { hostChain } : {}),
          ...(hostChainFingerprint === undefined ? {} : { hostChainFingerprint }),
          ...(typeof record.actionHint === "string" && record.actionHint.length > 0
            ? { actionHint: record.actionHint }
            : {}),
          ...(typeof record.stateHint === "string" && record.stateHint.length > 0
            ? { stateHint: record.stateHint }
            : {}),
          ...(typeof record.tooltipText === "string" && record.tooltipText.length > 0
            ? { tooltipText: record.tooltipText }
            : {}),
          ...(typeof record.textSnippet === "string" && record.textSnippet.length > 0
            ? { textSnippet: record.textSnippet }
            : {}),
          ...(Number.isFinite(Number(record.tabIndex))
            ? { tabIndex: Math.round(Number(record.tabIndex)) }
            : {}),
          ...(typeof record.href === "string" && record.href.length > 0
            ? { href: record.href }
            : {}),
          ...(typeof record.inputType === "string" && record.inputType.length > 0
            ? { inputType: record.inputType }
            : {}),
          ...(typeof record.xpath === "string" && record.xpath.length > 0
            ? { xpath: record.xpath }
            : {}),
          ...(frameUrl.length > 0
            ? { frameUrl }
            : {})
        } satisfies Omit<
          WorkbenchBrowserAgentElement,
          "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
        >;
        const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
        const actionCapabilities = actionCapabilitiesForElement(baseElement);
        const semanticNodeKey = semanticNodeKeyForTarget(targetRef.targetRef, "dom", frameRef);
        const targetMetadata: WorkbenchLumenTargetRef = {
          targetRef: targetRef.targetRef,
          targetKind: browserAgentTargetKind(baseElement),
          tabId,
          frameRef,
          frameChain: [frameRef],
          elementFingerprint: targetRef.elementFingerprint,
          mapEpoch,
          expiresAt: observedAt + targetTtlMs()
        };
        const element: WorkbenchBrowserAgentElement = {
          ...baseElement,
          semanticNodeKey,
          actionCapabilities,
          stableId: targetRef.stableId,
          targetRef: targetRef.targetRef,
          target: targetMetadata,
          elementFingerprint: targetRef.elementFingerprint
        };
        return element;
      })
      .filter((item): item is WorkbenchBrowserAgentElement => item !== null);

    const buildDomElementFromListenerItem = (
      item: JsListenerDiscoveryItem
    ): WorkbenchBrowserAgentElement => {
      const baseElement = {
        id: item.id,
        frameTreeNodeId: item.frameTreeNodeId,
        frameRef: item.frameRef,
        tagName: item.tagName,
        role: item.role,
        label: item.label,
        selectorPreview: item.selectorPreview,
        bounds: item.bounds,
        localBounds: item.localBounds,
        frameBounds: item.frameBounds,
        focusable: item.focusable,
        disabled: item.disabled,
        editable: item.editable,
        visibility: item.visibility,
        discoveryScope: item.discoveryScope,
        actionHint: item.actionHint,
        ...(item.frameUrl.length > 0 ? { frameUrl: item.frameUrl } : {})
      } satisfies Omit<
        WorkbenchBrowserAgentElement,
        "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
      >;
      const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
      const targetMetadata: WorkbenchLumenTargetRef = {
        targetRef: targetRef.targetRef,
        targetKind: browserAgentTargetKind(baseElement),
        tabId,
        frameRef: item.frameRef,
        frameChain: [item.frameRef],
        elementFingerprint: targetRef.elementFingerprint,
        mapEpoch,
        expiresAt: observedAt + targetTtlMs()
      };
      return {
        ...baseElement,
        semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "dom", item.frameRef),
        actionCapabilities: actionCapabilitiesForElement(baseElement),
        stableId: targetRef.stableId,
        targetRef: targetRef.targetRef,
        target: targetMetadata,
        elementFingerprint: targetRef.elementFingerprint
      };
    };

    let refinedDomElements: readonly WorkbenchBrowserAgentElement[] = domElements;
    if (cdpEnhancements !== null) {
      const applied = applyCdpEnhancementsToElements(domElements, cdpEnhancements);
      refinedDomElements = applied.elements;
      graphWarnings.push(...applied.warnings);

      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      if (mainFrame !== undefined) {
        const listenerItems = discoverJsListenerObservationItems({
          enhancements: cdpEnhancements,
          existingElements: refinedDomElements,
          frameTreeNodeId: mainFrame.frameTreeNodeId,
          frameRef: mainFrame.frameRef,
          frameBounds: mainFrame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 },
          frameUrl: rawUrl,
          startingElementId: nextElementId
        });
        if (listenerItems.length > 0) {
          refinedDomElements = [
            ...refinedDomElements,
            ...listenerItems.map((item) => buildDomElementFromListenerItem(item))
          ];
          graphWarnings.push(`${listenerItems.length} js-listener element(s) added from CDP discovery.`);
        }
      }
    }
    refinedDomElements = filterElementsByParentContainment(refinedDomElements);
    if (refinedDomElements.length < domElements.length) {
      graphWarnings.push(
        `${domElements.length - refinedDomElements.length} nested duplicate element(s) removed by parent containment filter.`
      );
    }

    const axElements = lightweightObservation
      ? []
      : await readBrowserAgentAxOnlyElements({
          tabId,
          target,
          rawUrl,
          frameGraph,
          mapEpoch,
          observedAt,
          existingElements: refinedDomElements,
          startingElementId: nextElementId
        });
    let elements: readonly WorkbenchBrowserAgentElement[] = axElements.length > 0
      ? [...refinedDomElements, ...axElements]
      : refinedDomElements;
    const blockedFallbackFrames = lightweightObservation ? [] : graphBlockedRegions
      .filter((region) =>
        (region.kind === "cross-origin" || region.kind === "frame-unavailable")
        && (region.fallback === "visual" || region.fallback === "coordinate")
        && region.frameRef !== undefined
      )
      .map((region) => ({
        region,
        frame: frameGraph.frames.find((candidate) =>
          candidate.frameRef === region.frameRef && candidate.bounds !== undefined
        )
      }))
      .filter((entry): entry is {
        readonly region: WorkbenchBrowserSemanticBlockedRegion;
        readonly frame: WorkbenchBrowserSemanticFrame;
      } => entry.frame !== undefined)
      .filter((entry, index, entries) =>
        entries.findIndex((candidate) => candidate.frame.frameRef === entry.frame.frameRef) === index
        && elements.some((element) => element.frameRef === entry.frame.frameRef) === false
      )
      .slice(0, 4);
    let nextFallbackElementId = nextElementId + axElements.length;
    if (blockedFallbackFrames.length > 0) {
      const fallbackElements = blockedFallbackFrames.map(({ region, frame }) => {
        const useCoordinate = region.fallback === "coordinate";
        const element = useCoordinate
          ? createCoordinateFallbackElement({
              tabId,
              rawUrl,
              mapEpoch,
              observedAt,
              frame,
              elementId: nextFallbackElementId
            })
          : createVisualFallbackElement({
              tabId,
              rawUrl,
              mapEpoch,
              observedAt,
              frame,
              elementId: nextFallbackElementId
            });
        nextFallbackElementId += 1;
        graphBlockedRegions.push({
          id: `${useCoordinate ? "coordinate" : "visual"}-fallback-${frame.frameRef}`,
          kind: "visual-fallback",
          frameRef: frame.frameRef,
          frameTreeNodeId: frame.frameTreeNodeId,
          ...(frame.bounds === undefined ? {} : { bounds: frame.bounds }),
          reason: useCoordinate
            ? "Cross-origin iframe DOM is blocked; compositor-level coordinate act is available on this targetRef."
            : "DOM access is blocked for this frame; compact screenshot fallback is required before acting.",
          fallback: useCoordinate ? "coordinate" : "visual",
          confidence: "medium"
        });
        return element;
      });
      elements = [...elements, ...fallbackElements];
    }
    if (!lightweightObservation && elements.length === 0) {
      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      if (mainFrame !== undefined) {
        elements = [
          createVisualFallbackElement({
            tabId,
            rawUrl,
            mapEpoch,
            observedAt,
            frame: mainFrame,
            elementId: nextFallbackElementId
          })
        ];
        graphBlockedRegions.push({
          id: `visual-fallback-${mainFrame.frameRef}`,
          kind: "visual-fallback",
          frameRef: mainFrame.frameRef,
          frameTreeNodeId: mainFrame.frameTreeNodeId,
          ...(mainFrame.bounds === undefined ? {} : { bounds: mainFrame.bounds }),
          reason: "DOM and Accessibility maps produced no targetable controls; compact screenshot fallback is required.",
          fallback: "visual",
          confidence: "medium"
        });
      }
    }
    let scrollHints: readonly WorkbenchBrowserAgentScrollHint[] = [];
    let hiddenBelowCount = 0;
    let mapAppendix = "";
    const mapScope = request?.mapScope ?? (strategy === "interactiveOnly" ? "viewport" : "document");
    if (strategy === "interactiveOnly") {
      const coveredCount = elements.filter((element) => element.visibility?.covered === true).length;
      if (coveredCount > 0) {
        graphWarnings.push(`${coveredCount} covered interactive element(s) omitted from map output.`);
      }
      elements = elements.filter(
        (element) =>
          element.discoveryScope === "visual"
          || element.discoveryScope === "coordinate"
          || element.visibility?.covered !== true
      );
      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      const viewportWidth = mainFrame?.bounds?.width ?? 1_280;
      const viewportHeight = mainFrame?.bounds?.height ?? 720;
      const preScopeElements = elements;
      if (mapScope === "viewport") {
        const belowViewport = preScopeElements.filter((element) =>
          element.discoveryScope !== "visual"
          && element.discoveryScope !== "coordinate"
          && element.frameRef === mainFrame?.frameRef
          && element.bounds.y >= viewportHeight
        );
        hiddenBelowCount = belowViewport.length;
        elements = preScopeElements.filter((element) =>
          elementIntersectsViewport(element, viewportWidth, viewportHeight)
        );
        if (hiddenBelowCount > 0) {
          graphWarnings.push(`${hiddenBelowCount} below-viewport element(s) omitted from viewport map.`);
        }
      }
      const scrollHintResult = collectInteractiveScrollHints(
        preScopeElements,
        viewportHeight,
        mainFrame?.frameRef
      );
      scrollHints = scrollHintResult.hints;
      hiddenBelowCount = Math.max(hiddenBelowCount, scrollHintResult.totalHidden);
      mapAppendix = formatScrollHintsForMap(scrollHints, hiddenBelowCount);
    }
    const targets = elements.map((element) => element.target);

    const focusOrder = elements
      .filter((element) => element.focusable)
      .slice()
      .sort((left, right) => {
        const leftTab = (left.tabIndex ?? -1) > 0 ? left.tabIndex ?? 0 : Number.MAX_SAFE_INTEGER;
        const rightTab = (right.tabIndex ?? -1) > 0 ? right.tabIndex ?? 0 : Number.MAX_SAFE_INTEGER;
        return leftTab - rightTab || left.id - right.id;
      })
      .map((element) => element.id);
    const rawWarnings = frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.warnings)
        ? entry.raw.warnings.filter((value): value is string => typeof value === "string")
        : []
    );
    for (const rawBlockedRegion of frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.blockedRegions) ? entry.raw.blockedRegions : []
    )) {
      if (rawBlockedRegion === null || typeof rawBlockedRegion !== "object") {
        continue;
      }
      const record = rawBlockedRegion as Record<string, unknown>;
      if (record.kind !== "closed-shadow") {
        continue;
      }
      graphBlockedRegions.push({
        id: typeof record.id === "string" && record.id.length > 0
          ? record.id
          : `closed-shadow-${graphBlockedRegions.length + 1}`,
        kind: "closed-shadow",
        ...(typeof record.frameRef === "string" ? { frameRef: record.frameRef } : {}),
        ...(Number.isFinite(Number(record.frameTreeNodeId))
          ? { frameTreeNodeId: Math.round(Number(record.frameTreeNodeId)) }
          : {}),
        ...(coerceFrameBounds(record.bounds) === null ? {} : { bounds: coerceFrameBounds(record.bounds)! }),
        reason: typeof record.reason === "string" ? record.reason : "closed shadow boundary",
        fallback: "visual",
        confidence: record.confidence === "high" || record.confidence === "medium" ? record.confidence : "low"
      });
    }
    const rawAuthChallengeSignals = frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.authChallengeSignals) ? entry.raw.authChallengeSignals : []
    );
    const diagnosticAuthChallengeSignals: WorkbenchBrowserAuthChallengeSignal[] =
      readPageDiagnostics(tabId).flatMap((entry): WorkbenchBrowserAuthChallengeSignal[] => {
        if (entry.status === 401 || entry.status === 403) {
          return [{
            kind: "login_wall",
            confidence: entry.status === 401 ? "high" : "medium",
            source: "diagnostic",
            label: `http ${entry.status}`,
            ...(entry.url === undefined ? {} : { url: entry.url })
          }];
        }
        if (entry.resourceType === "Document" && entry.mimeType?.includes("octet-stream")) {
          return [{
            kind: "download_prompt",
            confidence: "medium",
            source: "diagnostic",
            label: "download response",
            ...(entry.url === undefined ? {} : { url: entry.url })
          }];
        }
        return [];
      });
    const authChallengeSignals = [...rawAuthChallengeSignals, ...diagnosticAuthChallengeSignals]
      .map((value): NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>[number] | null => {
            if (value === null || typeof value !== "object") {
              return null;
            }
            const record = value as Record<string, unknown>;
            const kind = record.kind;
            const confidence = record.confidence;
            const source = record.source;
            if (
              (
                kind !== "captcha"
                && kind !== "mfa"
                && kind !== "oauth_popup"
                && kind !== "permission_prompt"
                && kind !== "dormant_file_input"
                && kind !== "active_file_chooser"
                && kind !== "login_wall"
                && kind !== "download_prompt"
                && kind !== "payment_auth"
              )
              || (confidence !== "high" && confidence !== "medium" && confidence !== "low")
              || (source !== "dom" && source !== "attribute" && source !== "frame" && source !== "browser" && source !== "diagnostic")
            ) {
              return null;
            }
            const bounds = coerceFrameBounds(record.bounds);
            return {
              kind,
              confidence,
              source,
              ...(typeof record.label === "string" && record.label.length > 0 ? { label: record.label } : {}),
              ...(typeof record.url === "string" && record.url.length > 0 ? { url: record.url } : {}),
              ...(typeof record.frameRef === "string" && record.frameRef.length > 0 ? { frameRef: record.frameRef } : {}),
              ...(Number.isFinite(Number(record.frameTreeNodeId))
                ? { frameTreeNodeId: Math.round(Number(record.frameTreeNodeId)) }
                : {}),
              ...(bounds === null ? {} : { bounds })
            };
          })
      .filter((value): value is NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>[number] => value !== null);
    const highConfidenceCaptcha = authChallengeSignals.find(
      (signal) => signal.kind === "captcha" && signal.confidence === "high"
    );
    const activeFileChooser = authChallengeSignals.find(
      (signal) => signal.kind === "active_file_chooser" && signal.confidence === "high"
    );
    if (highConfidenceCaptcha !== undefined) {
      await waitForDomNetworkQuiet(target.webContents, {
        budgetMs: 1_200,
        quietMs: 400
      });
      onBrowserHealthCaptcha?.(
        tabId,
        highConfidenceCaptcha.label ?? "captcha challenge detected"
      );
      graphWarnings.push("captcha_detected:agent_blocked_until_user_completes_challenge");
    }
    for (const signal of authChallengeSignals) {
      if (signal.kind === "active_file_chooser" || signal.kind === "payment_auth") {
        onBrowserHealthPermission?.(tabId, signal.kind);
      }
    }
    const browserHealth = consumeBrowserHealthAlerts?.(tabId) ?? [];
    const healthWarnings = browserHealthWarningsFromAlerts(browserHealth);
    const warnings = [...new Set([...graphWarnings, ...rawWarnings, ...healthWarnings])];
    const observedFrameGraph: BrowserAgentSemanticFrameGraph = {
      ...frameGraph,
      warnings: graphWarnings,
      blockedRegions: graphBlockedRegions
    };
    const semanticTree = buildBrowserAgentSemanticTree({
      elements,
      frameGraph: observedFrameGraph,
      warnings,
      authChallengeSignals
    });
    const observation: WorkbenchBrowserAgentObservation = {
      ok: true,
      kind: "lyraLumenMap",
      tabId,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      observationId: createBrowserAgentObservationId(tabId),
      mapEpoch,
      strategy,
      ...(strategy === "interactiveOnly" ? { mapScope } : {}),
      url: rawUrl,
      title: typeof mainRaw.title === "string" && mainRaw.title.length > 0 ? mainRaw.title : agentTargetTitle(target),
      targets,
      elements,
      semanticTree,
      coverage: semanticTree.coverage,
      blockedRegions: semanticTree.blockedRegions,
      activeElementId,
      focusOrder,
      ...(authChallengeSignals.length > 0 ? { authChallengeSignals } : {}),
      ...(scrollHints.length > 0 ? { scrollHints } : {}),
      ...(hiddenBelowCount > 0 ? { hiddenBelowCount } : {}),
      ...(mapAppendix.length > 0 ? { mapAppendix } : {}),
      ...(browserHealth.length > 0 ? { browserHealth } : {}),
      ...(highConfidenceCaptcha !== undefined
        ? {
            needsUserAction: {
              kind: "auth_challenge",
              reason: "captcha",
              signal: highConfidenceCaptcha,
              suggestedAction: "ask_user"
            }
          }
        : activeFileChooser !== undefined
          ? {
              needsUserAction: {
                kind: "auth_challenge",
                reason: "active_file_chooser",
                signal: activeFileChooser,
                suggestedAction: "ask_user"
              }
            }
          : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      nextRecommendedAction:
        highConfidenceCaptcha !== undefined || activeFileChooser !== undefined
          ? "ask_user"
          : authChallengeSignals.some(
              (signal) =>
                signal.confidence === "high"
                && signal.kind !== "oauth_popup"
                && signal.kind !== "captcha"
            )
            || semanticTree.blockedRegions.some((region) => region.fallback === "elevate")
            ? "lyra_lumen_elevate"
            : authChallengeSignals.some((signal) => signal.confidence === "high" && signal.kind === "oauth_popup")
              || semanticTree.blockedRegions.some((region) => region.fallback === "ax")
              ? "browser_ax.map"
              : elements.some((element) => element.discoveryScope === "coordinate")
                || semanticTree.blockedRegions.some((region) => region.fallback === "coordinate")
                ? "lyra_lumen.act"
                : semanticTree.coverage.visualCoverage > 0
                  ? "lyra_lumen.see"
                  : elements.length > 0
                    ? "lyra_lumen.act"
                    : "lyra_lumen.read"
    };
    rememberBrowserAgentObservation(tabId, target.targetMode, observation);
    registerTargetObservation({
      tabId,
      targetMode: target.targetMode,
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      observedAt
    });
    const activeEditableElement = activeEditableElementFromObservation(observation);
    if (activeEditableElement !== null) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        activeEditableElement,
        observation.url,
        observation.observationId
      );
    }
    return observation;
  };

  const scheduleBrowserTargetRegistryWarmup = (
    entry: BrowserPageEntry,
    restoreState: NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>
  ): void => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return;
    }
    if (restoreState.targetRegistry?.warmed === true) {
      return;
    }
    void observeAgentPage(entry.tabId, {
      strategy: "interactiveOnly",
      targetMode: "live",
      timeoutMs: 2_500,
      suppressActivity: true
    }).then((observation) => {
      const activeTargetRef =
        observation.activeElementId === null
          ? undefined
          : observation.elements.find((element) => element.id === observation.activeElementId)?.targetRef;
      const nextRestoreState = sanitizeBrowserPageRestoreState({
        ...entry.runtime.restoreState,
        targetRegistry: {
          warmed: true,
          targetCount: observation.targets.length,
          ...(activeTargetRef === undefined ? {} : { activeTargetRef }),
          capturedAt: Date.now()
        },
        capturedAt: Date.now()
      });
      if (nextRestoreState !== undefined) {
        rememberBrowserRestoreState(entry.tabId, nextRestoreState);
        updateRuntimeState(entry, { restoreState: nextRestoreState });
      }
    }).catch((error: unknown) => {
      updateRuntimeState(entry, {
        recoveryFailure: {
          reason: "target_stale",
          message: error instanceof Error ? error.message : String(error),
          at: Date.now()
        }
      });
    });
  };

  return {
    observeAgentPage,
    buildBrowserAgentSemanticFrameGraph,
    scheduleBrowserTargetRegistryWarmup
  };
};
