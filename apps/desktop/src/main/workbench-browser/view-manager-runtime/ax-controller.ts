import type { WorkbenchBrowserAuthChallengeSignal } from "../../../shared/desktop-bridge";
import type {
  BrowserAxNode,
  BrowserAxSnapshot,
  WorkbenchBrowserAgentElementBounds,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAxActionMethod,
  WorkbenchBrowserAxActionResult,
  WorkbenchBrowserAxExplanation,
  WorkbenchBrowserAxFocusDirection,
  WorkbenchBrowserAxFocusResult,
  WorkbenchBrowserAxFocusTrailEntry,
  WorkbenchBrowserAxInteraction,
  WorkbenchBrowserAxMapResult,
  WorkbenchBrowserAxNodeState,
  WorkbenchBrowserAxOsStatus,
  WorkbenchBrowserAxQueryMatch,
  WorkbenchBrowserAxQueryResult,
  WorkbenchBrowserAxRefBboxResult,
  WorkbenchBrowserAxStrategy,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserOsAxAdapter,
  WorkbenchBrowserSemanticBlockedRegion,
  WorkbenchBrowserSemanticFrame
} from "../types";
import { agentTargetAddress, agentTargetIsLoading, agentTargetTitle } from "./agent-target-runtime";
import {
  boundsFromCdpBoxModel,
  readAxValueText
} from "./agent-observation-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAxSnapshotStore } from "./ax-snapshot-store";
import { BROWSER_AX_SNAPSHOT_TTL_MS } from "./ax-snapshot-store";
import type { BrowserAxActCache } from "./ax-act-cache";
import { buildAxActCacheKey } from "./ax-act-cache";
import {
  BROWSER_AX_ACTIONABLE_ROLES,
  BROWSER_AX_TEXT_ROLES,
  browserAxNodeHash,
  browserAxSnapshotHash,
  classifyRisk,
  detectProvider,
  roleToActionCapabilities
} from "./ax-detectors";
import type { BrowserAgentPageTarget, BrowserAgentSemanticFrameGraph } from "./types";

const DEFAULT_MAX_NODES = 200;
const HARD_MAX_NODES = 400;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const diffAxNodeSnapshots = (
  before: BrowserAxNode,
  after: BrowserAxNode
): readonly string[] => {
  const changes: string[] = [];
  if (before.name !== after.name) {
    changes.push(`name: ${before.name} -> ${after.name}`);
  }
  if (before.value !== after.value) {
    changes.push(`value: ${before.value ?? ""} -> ${after.value ?? ""}`);
  }
  const left = before.state;
  const right = after.state;
  if (left.checked !== right.checked) {
    changes.push(`checked: ${String(left.checked)} -> ${String(right.checked)}`);
  }
  if (left.expanded !== right.expanded) {
    changes.push(`expanded: ${String(left.expanded)} -> ${String(right.expanded)}`);
  }
  if (left.focused !== right.focused) {
    changes.push(`focused: ${String(left.focused)} -> ${String(right.focused)}`);
  }
  if (left.selected !== right.selected) {
    changes.push(`selected: ${String(left.selected)} -> ${String(right.selected)}`);
  }
  return changes;
};

type BrowserAxControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "openDebuggerSessionForTarget"
  | "resolveBrowserAgentTarget"
  | "sendAgentInputEvent"
  | "publishBrowserAgentActivity"
  | "recordFollowAction"
  | "assertSharedControlCanContinue"
> & {
  readonly buildSemanticFrameGraph: (
    target: BrowserAgentPageTarget,
    timeoutMs: number
  ) => Promise<BrowserAgentSemanticFrameGraph>;
  readonly nextMapEpoch: (tabId: string, targetMode: WorkbenchBrowserAgentTargetMode) => number;
  readonly axSnapshotStore: BrowserAxSnapshotStore;
  readonly axActCache: BrowserAxActCache;
  readonly getActCacheEnabled?: () => boolean;
  readonly osAxAdapter?: WorkbenchBrowserOsAxAdapter;
};

const normalizeAxStrategy = (strategy: unknown): WorkbenchBrowserAxStrategy => {
  if (strategy === "document" || strategy === "auth") {
    return strategy;
  }
  return "interactive";
};

const normalizeAxInteraction = (interaction: unknown): WorkbenchBrowserAxInteraction => {
  if (
    interaction === "hover"
    || interaction === "focus"
    || interaction === "toggle"
    || interaction === "select"
  ) {
    return interaction;
  }
  return "click";
};

const boundsCenterPoint = (
  bounds: WorkbenchBrowserAgentElementBounds
): { readonly x: number; readonly y: number } => ({
  x: bounds.x + Math.round(bounds.width / 2),
  y: bounds.y + Math.round(bounds.height / 2)
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const coerceAxBounds = (value: unknown): WorkbenchBrowserAgentElementBounds | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const axStateFromProperties = (record: Record<string, unknown>): WorkbenchBrowserAxNodeState => {
  const state: {
    focused?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    checked?: boolean;
    selected?: boolean;
    modal?: boolean;
  } = {};
  const properties = Array.isArray(record.properties) ? record.properties : [];
  for (const property of properties) {
    if (property === null || typeof property !== "object") {
      continue;
    }
    const entry = property as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name : "";
    const rawValue = entry.value !== null && typeof entry.value === "object"
      ? (entry.value as Record<string, unknown>).value
      : undefined;
    switch (name) {
      case "focused":
        if (typeof rawValue === "boolean") state.focused = rawValue;
        break;
      case "disabled":
        if (typeof rawValue === "boolean") state.disabled = rawValue;
        break;
      case "expanded":
        if (typeof rawValue === "boolean") state.expanded = rawValue;
        break;
      case "checked":
        if (typeof rawValue === "boolean") state.checked = rawValue;
        else if (rawValue === "true") state.checked = true;
        else if (rawValue === "false") state.checked = false;
        break;
      case "selected":
        if (typeof rawValue === "boolean") state.selected = rawValue;
        break;
      case "modal":
        if (typeof rawValue === "boolean") state.modal = rawValue;
        break;
      default:
        break;
    }
  }
  return state;
};

export const createBrowserAxController = (deps: BrowserAxControllerDeps) => {
  const {
    openDebuggerSessionForTarget,
    resolveBrowserAgentTarget,
    sendAgentInputEvent,
    publishBrowserAgentActivity,
    recordFollowAction,
    assertSharedControlCanContinue,
    buildSemanticFrameGraph,
    nextMapEpoch,
    axSnapshotStore,
    axActCache,
    getActCacheEnabled,
    osAxAdapter
  } = deps;

  const mainFrameOf = (frameGraph: BrowserAgentSemanticFrameGraph) =>
    frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];

  const compressAxTree = async ({
    debuggerSession,
    axNodes,
    frame,
    snapshotHash,
    strategy,
    maxNodes,
    includeIgnored,
    includeText,
    seenAxRefs,
    sessionId,
    boundsOffset,
    allowBounds
  }: {
    readonly debuggerSession: WorkbenchBrowserDebuggerSession;
    readonly axNodes: readonly unknown[];
    readonly frame: WorkbenchBrowserSemanticFrame | undefined;
    readonly snapshotHash: string;
    readonly strategy: WorkbenchBrowserAxStrategy;
    readonly maxNodes: number;
    readonly includeIgnored: boolean;
    readonly includeText: boolean;
    readonly seenAxRefs: Set<string>;
    readonly sessionId?: string;
    readonly boundsOffset?: { readonly x: number; readonly y: number };
    readonly allowBounds?: boolean;
  }): Promise<readonly BrowserAxNode[]> => {
    const frameUrl = frame?.url ?? "";
    const offsetX = boundsOffset?.x ?? 0;
    const offsetY = boundsOffset?.y ?? 0;
    const nodes: BrowserAxNode[] = [];

    for (const axNode of axNodes) {
      if (nodes.length >= maxNodes) {
        break;
      }
      if (axNode === null || typeof axNode !== "object") {
        continue;
      }
      const record = axNode as Record<string, unknown>;
      const ignored = record.ignored === true;
      if (ignored && !includeIgnored) {
        continue;
      }
      const role = readAxValueText(record.role).toLowerCase();
      const name = readAxValueText(record.name) || readAxValueText(record.value);
      if (role.length === 0) {
        continue;
      }
      if (!includeText && BROWSER_AX_TEXT_ROLES.has(role)) {
        continue;
      }
      const isActionable = BROWSER_AX_ACTIONABLE_ROLES.has(role) || role === "dialog";
      if (strategy === "interactive" && !isActionable) {
        continue;
      }
      if (strategy === "auth" && !isActionable && role !== "dialog" && role !== "alertdialog") {
        continue;
      }
      if (name.length === 0 && role !== "dialog" && role !== "alertdialog") {
        continue;
      }

      const backendNodeId = Number(record.backendDOMNodeId);
      const hasBackend = Number.isFinite(backendNodeId);
      let bounds: WorkbenchBrowserAgentElementBounds | undefined;
      if (hasBackend && allowBounds !== false) {
        const box = await debuggerSession
          .sendCommand("DOM.getBoxModel", { backendNodeId: Math.round(backendNodeId) }, sessionId)
          .catch(() => ({}));
        const local = boundsFromCdpBoxModel(box);
        if (local !== null) {
          // Child-target bounds are in the child frame's own coordinate space; offset into the
          // main WebContents viewport so they line up with sendInputEvent coordinates.
          bounds = offsetX === 0 && offsetY === 0
            ? local
            : { x: local.x + offsetX, y: local.y + offsetY, width: local.width, height: local.height };
        }
      }

      const state = axStateFromProperties(record);
      const nodeId = typeof record.nodeId === "string" ? record.nodeId : undefined;
      const axRef = `ax:${snapshotHash}:${browserAxNodeHash({
        ...(hasBackend ? { backendDOMNodeId: Math.round(backendNodeId) } : {}),
        ...(nodeId === undefined ? {} : { nodeId }),
        role,
        name,
        ...(bounds === undefined ? {} : { boundsX: bounds.x, boundsY: bounds.y }),
        frameUrl
      })}`;
      if (seenAxRefs.has(axRef)) {
        continue;
      }
      seenAxRefs.add(axRef);

      const provider = detectProvider(frameUrl, role, name);
      const node: BrowserAxNode = {
        axRef,
        role,
        name,
        ...(readAxValueText(record.value).length > 0 ? { value: readAxValueText(record.value) } : {}),
        ...(readAxValueText(record.description).length > 0
          ? { description: readAxValueText(record.description) }
          : {}),
        state,
        ...(bounds === undefined ? {} : { bounds }),
        ...(frame === undefined ? {} : { frameRef: frame.frameRef, frameTreeNodeId: frame.frameTreeNodeId }),
        ...(frameUrl.length > 0 ? { frameUrl } : {}),
        ...(hasBackend ? { backendDOMNodeId: Math.round(backendNodeId) } : {}),
        ...(nodeId === undefined ? {} : { nodeId }),
        actionCapabilities: roleToActionCapabilities(role, state, bounds !== undefined),
        confidence: hasBackend ? (bounds === undefined ? 0.6 : 0.86) : 0.5,
        source: "ax",
        axSource: "cdp",
        coordinateSpace: "webContentsCss",
        ...(provider === undefined ? {} : { provider })
      };
      nodes.push(node);
    }
    return nodes;
  };

  const detectAuthSignals = (
    nodes: readonly BrowserAxNode[],
    url: string
  ): readonly WorkbenchBrowserAuthChallengeSignal[] => {
    const signals: WorkbenchBrowserAuthChallengeSignal[] = [];
    const seenProviders = new Set<string>();
    for (const node of nodes) {
      const provider = node.provider ?? detectProvider(node.frameUrl ?? url, node.role, node.name);
      if (provider === undefined || seenProviders.has(provider)) {
        continue;
      }
      seenProviders.add(provider);
      signals.push({
        kind: "oauth_popup",
        confidence: "high",
        source: "ax",
        provider,
        label: node.name,
        ...(node.frameUrl === undefined ? {} : { url: node.frameUrl }),
        ...(node.frameRef === undefined ? {} : { frameRef: node.frameRef }),
        ...(node.bounds === undefined ? {} : { bounds: node.bounds })
      });
    }
    return signals;
  };

  const readAxTree = async (
    target: BrowserAgentPageTarget
  ): Promise<{ readonly session: WorkbenchBrowserDebuggerSession; readonly axNodes: readonly unknown[] }> => {
    const session = await openDebuggerSessionForTarget(target);
    await session.sendCommand("Accessibility.enable").catch(() => ({}));
    await session.sendCommand("DOM.enable").catch(() => ({}));
    const response = await session.sendCommand("Accessibility.getFullAXTree").catch(() => ({}));
    const axNodes = Array.isArray((response as Record<string, unknown>).nodes)
      ? ((response as Record<string, unknown>).nodes as unknown[])
      : [];
    return { session, axNodes };
  };

  // Match a CDP iframe target back to a semantic frame by URL (no direct frameId↔targetId map
  // exists). Prefer an exact URL match, then host match, to keep OOPIF correlation robust.
  const correlateTargetFrame = (
    targetUrl: string,
    frameGraph: BrowserAgentSemanticFrameGraph
  ): { readonly frame: WorkbenchBrowserSemanticFrame; readonly confidence: "high" | "medium" } | undefined => {
    const candidates = frameGraph.frames.filter((frame) => !frame.isMainFrame);
    const exact = candidates.find((frame) => frame.url === targetUrl);
    if (exact !== undefined) {
      return { frame: exact, confidence: "high" };
    }
    let targetHost = "";
    try {
      targetHost = new URL(targetUrl).host;
    } catch {
      targetHost = "";
    }
    if (targetHost.length === 0) {
      return undefined;
    }
    const hostMatches = candidates.filter((frame) => {
      try {
        return new URL(frame.url).host === targetHost;
      } catch {
        return false;
      }
    });
    if (hostMatches.length === 1) {
      return { frame: hostMatches[0]!, confidence: "medium" };
    }
    return undefined;
  };

  // Phase 4: cross-process iframe (OOPIF) AX trees are not in the main session. Enumerate iframe
  // targets, attach a flat session per target, read each AX tree, and merge with bounds offset
  // by the matching frame's global bounds. Best-effort: any failure leaves the main tree intact.
  const readOopifAxNodes = async ({
    session,
    frameGraph,
    snapshotHash,
    strategy,
    maxNodes,
    includeIgnored,
    includeText,
    seenAxRefs,
    remainingBudget
  }: {
    readonly session: WorkbenchBrowserDebuggerSession;
    readonly frameGraph: BrowserAgentSemanticFrameGraph;
    readonly snapshotHash: string;
    readonly strategy: WorkbenchBrowserAxStrategy;
    readonly maxNodes: number;
    readonly includeIgnored: boolean;
    readonly includeText: boolean;
    readonly seenAxRefs: Set<string>;
    readonly remainingBudget: number;
  }): Promise<readonly BrowserAxNode[]> => {
    if (remainingBudget <= 0) {
      return [];
    }
    // Only worth attaching when the frame graph has a cross-origin frame the main session likely misses.
    const hasCrossOrigin = frameGraph.frames.some(
      (frame) => !frame.isMainFrame && (frame.domAccess === "cdp" || frame.domAccess === "blocked")
    );
    if (!hasCrossOrigin) {
      return [];
    }
    const merged: BrowserAxNode[] = [];
    try {
      const targetsResponse = await session.sendCommand("Target.getTargets").catch(() => ({}));
      const targetInfos = Array.isArray((targetsResponse as Record<string, unknown>).targetInfos)
        ? ((targetsResponse as Record<string, unknown>).targetInfos as unknown[])
        : [];
      for (const info of targetInfos) {
        if (merged.length >= remainingBudget) {
          break;
        }
        if (info === null || typeof info !== "object") {
          continue;
        }
        const record = info as Record<string, unknown>;
        if (record.type !== "iframe") {
          continue;
        }
        const targetId = typeof record.targetId === "string" ? record.targetId : undefined;
        const targetUrl = typeof record.url === "string" ? record.url : "";
        if (targetId === undefined) {
          continue;
        }
        const correlated = correlateTargetFrame(targetUrl, frameGraph);
        if (correlated === undefined) {
          continue;
        }
        const { frame } = correlated;
        const attach = await session
          .sendCommand("Target.attachToTarget", { targetId, flatten: true })
          .catch(() => ({}));
        const childSessionId = typeof (attach as Record<string, unknown>).sessionId === "string"
          ? ((attach as Record<string, unknown>).sessionId as string)
          : undefined;
        if (childSessionId === undefined) {
          continue;
        }
        try {
          await session.sendCommand("Accessibility.enable", undefined, childSessionId).catch(() => ({}));
          await session.sendCommand("DOM.enable", undefined, childSessionId).catch(() => ({}));
          const childTree = await session
            .sendCommand("Accessibility.getFullAXTree", undefined, childSessionId)
            .catch(() => ({}));
          const childNodes = Array.isArray((childTree as Record<string, unknown>).nodes)
            ? ((childTree as Record<string, unknown>).nodes as unknown[])
            : [];
          const compressed = await compressAxTree({
            debuggerSession: session,
            axNodes: childNodes,
            frame,
            snapshotHash,
            strategy,
            maxNodes: remainingBudget - merged.length,
            includeIgnored,
            includeText,
            seenAxRefs,
            sessionId: childSessionId,
            ...(correlated.confidence === "high" && frame.bounds !== undefined
              ? { boundsOffset: { x: frame.bounds.x, y: frame.bounds.y } }
              : { allowBounds: false })
          });
          merged.push(...compressed);
        } finally {
          await session
            .sendCommand("Target.detachFromTarget", { sessionId: childSessionId })
            .catch(() => ({}));
        }
      }
    } catch {
      // OOPIF merge is best-effort; fall back to whatever the main tree produced.
    }
    return merged;
  };

  const unavailableOsAxStatus = (message: string): WorkbenchBrowserAxOsStatus => ({
    ok: false,
    platform: process.platform,
    state: "unavailable",
    message
  });

  const normalizeOsAxStatus = (raw: unknown): WorkbenchBrowserAxOsStatus => {
    if (!isRecord(raw)) {
      return unavailableOsAxStatus("OS AX native adapter returned no status.");
    }
    const state = raw.state;
    const normalizedState: WorkbenchBrowserAxOsStatus["state"] =
      state === "available"
      || state === "unsupported"
      || state === "permissionDenied"
      || state === "unavailable"
      || state === "error"
        ? state
        : "unavailable";
    const nodeCount = typeof raw.nodeCount === "number" && Number.isFinite(raw.nodeCount)
      ? Math.max(0, Math.round(raw.nodeCount))
      : undefined;
    return {
      ok: raw.ok === true,
      platform: typeof raw.platform === "string" ? raw.platform : process.platform,
      state: normalizedState,
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
      ...(nodeCount === undefined ? {} : { nodeCount }),
      ...(typeof raw.loadedFrom === "string" ? { loadedFrom: raw.loadedFrom } : {})
    };
  };

  const readOsAxNodes = async ({
    snapshotHash,
    maxNodes,
    includeText,
    seenAxRefs
  }: {
    readonly snapshotHash: string;
    readonly maxNodes: number;
    readonly includeText: boolean;
    readonly seenAxRefs: Set<string>;
  }): Promise<{ readonly nodes: readonly BrowserAxNode[]; readonly status: WorkbenchBrowserAxOsStatus }> => {
    if (osAxAdapter === undefined) {
      return {
        nodes: [],
        status: unavailableOsAxStatus("OS AX native adapter is not loaded.")
      };
    }
    if (maxNodes <= 0) {
      return {
        nodes: [],
        status: {
          ok: true,
          platform: process.platform,
          state: "available",
          message: "OS AX read skipped because maxNodes budget was exhausted.",
          nodeCount: 0,
          ...(osAxAdapter.loadedFrom === undefined ? {} : { loadedFrom: osAxAdapter.loadedFrom })
        }
      };
    }
    try {
      const raw = await osAxAdapter.readTree({ maxNodes });
      const status = normalizeOsAxStatus(isRecord(raw) ? raw.status : undefined);
      const rawNodes = isRecord(raw) && Array.isArray(raw.nodes) ? raw.nodes : [];
      const nodes: BrowserAxNode[] = [];
      for (const rawNode of rawNodes) {
        if (nodes.length >= maxNodes) {
          break;
        }
        if (!isRecord(rawNode)) {
          continue;
        }
        const osPath = typeof rawNode.osPath === "string" ? rawNode.osPath : undefined;
        const role = typeof rawNode.role === "string" ? rawNode.role.toLowerCase() : "";
        const name = typeof rawNode.name === "string" ? rawNode.name.trim() : "";
        if (!includeText && BROWSER_AX_TEXT_ROLES.has(role)) {
          continue;
        }
        if (osPath === undefined || role.length === 0 || name.length === 0) {
          continue;
        }
        const screenBounds = coerceAxBounds(rawNode.screenBounds);
        const axRef = `ax:${snapshotHash}:${browserAxNodeHash({
          nodeId: `os:${osPath}`,
          role,
          name,
          ...(screenBounds === undefined ? {} : { boundsX: screenBounds.x, boundsY: screenBounds.y }),
          frameUrl: "os://focused-window"
        })}`;
        if (seenAxRefs.has(axRef)) {
          continue;
        }
        seenAxRefs.add(axRef);
        const provider = detectProvider(undefined, role, name);
        nodes.push({
          axRef,
          role,
          name,
          state: {},
          ...(screenBounds === undefined ? {} : { screenBounds }),
          osPath,
          actionCapabilities: roleToActionCapabilities(role, {}, screenBounds !== undefined),
          confidence: screenBounds === undefined ? 0.54 : 0.72,
          source: "ax",
          axSource: "os",
          coordinateSpace: "screen",
          ...(provider === undefined ? {} : { provider })
        });
      }
      return {
        nodes,
        status: {
          ...status,
          ...(osAxAdapter.loadedFrom === undefined ? {} : { loadedFrom: osAxAdapter.loadedFrom }),
          nodeCount: nodes.length
        }
      };
    } catch (error) {
      return {
        nodes: [],
        status: {
          ok: false,
          platform: process.platform,
          state: "error",
          message: error instanceof Error ? error.message : String(error),
          ...(osAxAdapter.loadedFrom === undefined ? {} : { loadedFrom: osAxAdapter.loadedFrom })
        }
      };
    }
  };

  const axMapAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAxStrategy;
      readonly maxNodes?: number;
      readonly includeIgnored?: boolean;
      readonly includeText?: boolean;
      readonly includeFrames?: boolean;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAxMapResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const strategy = normalizeAxStrategy(request.strategy);
    const maxNodes = Math.max(
      1,
      Math.min(HARD_MAX_NODES, Math.round(request.maxNodes ?? DEFAULT_MAX_NODES))
    );
    const includeIgnored = request.includeIgnored === true;
    const includeText = request.includeText === true;
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "observe",
      inputActive: false,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_200
    });

    const frameGraph = await buildSemanticFrameGraph(target, request.timeoutMs ?? 8_000);
    let session: WorkbenchBrowserDebuggerSession | null = null;
    let axNodes: readonly unknown[] = [];
    try {
      const read = await readAxTree(target);
      session = read.session;
      axNodes = read.axNodes;
      const createdAt = Date.now();
      const mapEpoch = nextMapEpoch(tabId, target.targetMode);
      const snapshotHash = browserAxSnapshotHash(tabId, target.targetMode, createdAt, mapEpoch);
      const snapshotId = `ax-snap-${snapshotHash}`;
      const seenAxRefs = new Set<string>();
      const mainFrame = mainFrameOf(frameGraph);
      const mainNodes = await compressAxTree({
        debuggerSession: session,
        axNodes,
        frame: mainFrame,
        snapshotHash,
        strategy,
        maxNodes,
        includeIgnored,
        includeText,
        seenAxRefs
      });
      // Phase 4: merge cross-process iframe AX trees when the frame graph shows OOPIF frames and
      // includeFrames is not disabled.
      const oopifNodes = request.includeFrames === false
        ? []
        : await readOopifAxNodes({
            session,
            frameGraph,
            snapshotHash,
            strategy,
            maxNodes,
            includeIgnored,
            includeText,
            seenAxRefs,
            remainingBudget: maxNodes - mainNodes.length
          });
      const osAxRead = await readOsAxNodes({
        snapshotHash,
        maxNodes: maxNodes - mainNodes.length - oopifNodes.length,
        includeText,
        seenAxRefs
      });
      const nodes = [...mainNodes, ...oopifNodes, ...osAxRead.nodes];

      const url = agentTargetAddress(target);
      const title = agentTargetTitle(target);
      const authChallengeSignals = detectAuthSignals(nodes, url);
      const blockedRegions: readonly WorkbenchBrowserSemanticBlockedRegion[] = frameGraph.blockedRegions;

      const snapshot: BrowserAxSnapshot = {
        snapshotId,
        snapshotHash,
        tabId,
        targetMode: target.targetMode,
        url,
        title,
        createdAt,
        mapEpoch,
        ttlMs: BROWSER_AX_SNAPSHOT_TTL_MS,
        nodesByAxRef: new Map(nodes.map((node) => [node.axRef, node])),
        cdpNodeIndex: new Map(
          nodes.filter((node) => node.axSource === "cdp").map((node) => [
            node.axRef,
            {
              ...(node.backendDOMNodeId === undefined ? {} : { backendDOMNodeId: node.backendDOMNodeId }),
              ...(node.nodeId === undefined ? {} : { nodeId: node.nodeId })
            }
          ])
        ),
        osNodeIndex: new Map(
          nodes
            .filter((node) => node.axSource === "os" && node.osPath !== undefined)
            .map((node) => [node.axRef, { osPath: node.osPath as string }])
        )
      };
      axSnapshotStore.rememberSnapshot(snapshot);

      const noAxButAuthFrame = nodes.length === 0
        && blockedRegions.some((region) => region.kind === "auth-prompt" || region.kind === "cross-origin");

      const nextRecommendedAction = noAxButAuthFrame
          ? "lyra_lumen.see"
          : nodes.length > 0
            ? "browser_ax.act"
            : "lyra_lumen.see";

      return {
        ok: true,
        kind: "browserAxMap",
        tabId,
        targetMode: target.targetMode,
        snapshotId,
        url,
        title,
        strategy,
        sources: osAxAdapter === undefined ? ["cdp"] : ["cdp", "os"],
        osAxStatus: osAxRead.status,
        nodes,
        ...(authChallengeSignals.length > 0 ? { authChallengeSignals } : {}),
        ...(blockedRegions.length > 0 ? { blockedRegions } : {}),
        nextRecommendedAction
      };
    } finally {
      await session?.close().catch(() => undefined);
    }
  };

  const scoreMatch = (
    node: BrowserAxNode,
    request: {
      readonly role?: string;
      readonly nameIncludes?: string;
    }
  ): number => {
    let score = 0.5;
    if (request.role !== undefined) {
      score += node.role === request.role.toLowerCase() ? 0.3 : -0.4;
    }
    if (request.nameIncludes !== undefined) {
      const needle = request.nameIncludes.toLowerCase();
      const name = node.name.toLowerCase();
      if (name === needle) {
        score += 0.4;
      } else if (name.includes(needle)) {
        score += 0.25;
      } else {
        score -= 0.5;
      }
    }
    return Math.max(0, Math.min(1, score));
  };

  const axQueryAgentSnapshot = (
    tabId: string,
    request: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly snapshotId?: string;
      readonly role?: string;
      readonly nameIncludes?: string;
      readonly provider?: string;
      readonly visibleOnly?: boolean;
      readonly maxResults?: number;
    }
  ): WorkbenchBrowserAxQueryResult => {
    const targetMode = request.targetMode ?? "live";
    const snapshot = request.snapshotId !== undefined
      ? axSnapshotStore.getSnapshot(request.snapshotId)
      : axSnapshotStore.getLatest(tabId, targetMode);
    if (snapshot === undefined) {
      return {
        ok: true,
        kind: "browserAxQuery",
        snapshotId: request.snapshotId ?? "",
        matches: [],
        nextRecommendedAction: "browser_ax.map"
      };
    }
    const maxResults = Math.max(1, Math.min(50, Math.round(request.maxResults ?? 10)));
    const matches: WorkbenchBrowserAxQueryMatch[] = [];
    for (const node of snapshot.nodesByAxRef.values()) {
      if (request.role !== undefined && node.role !== request.role.toLowerCase()) {
        continue;
      }
      if (request.provider !== undefined && node.provider !== request.provider.toLowerCase()) {
        continue;
      }
      if (
        request.nameIncludes !== undefined
        && !node.name.toLowerCase().includes(request.nameIncludes.toLowerCase())
      ) {
        continue;
      }
      if (request.visibleOnly === true && node.bounds === undefined && node.screenBounds === undefined) {
        continue;
      }
      matches.push({
        axRef: node.axRef,
        role: node.role,
        name: node.name,
        ...(node.bounds === undefined ? {} : { bounds: node.bounds }),
        ...(node.screenBounds === undefined ? {} : { screenBounds: node.screenBounds }),
        ...(node.provider === undefined ? {} : { provider: node.provider }),
        score: scoreMatch(node, request)
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return {
      ok: true,
      kind: "browserAxQuery",
      snapshotId: snapshot.snapshotId,
      matches: matches.slice(0, maxResults),
      nextRecommendedAction: matches.length > 0 ? "browser_ax.act" : "browser_ax.map"
    };
  };

  const sendActivationKey = async (target: BrowserAgentPageTarget, key: string): Promise<void> => {
    target.webContents.focus();
    sendAgentInputEvent(target, { type: "keyDown", keyCode: key });
    if (key.length === 1) {
      sendAgentInputEvent(target, { type: "char", keyCode: key });
    }
    sendAgentInputEvent(target, { type: "keyUp", keyCode: key });
    await delay(30);
  };

  const dispatchPointerInput = async (
    target: BrowserAgentPageTarget,
    bounds: WorkbenchBrowserAgentElementBounds,
    interaction: WorkbenchBrowserAxInteraction
  ): Promise<{ readonly x: number; readonly y: number }> => {
    const center = boundsCenterPoint(bounds);
    target.webContents.focus();
    sendAgentInputEvent(target, {
      type: "mouseMove",
      x: center.x,
      y: center.y,
      button: "left",
      clickCount: 1
    });
    await delay(20);
    if (interaction !== "hover") {
      sendAgentInputEvent(target, {
        type: "mouseDown",
        x: center.x,
        y: center.y,
        button: "left",
        clickCount: 1
      });
      await delay(20);
      sendAgentInputEvent(target, {
        type: "mouseUp",
        x: center.x,
        y: center.y,
        button: "left",
        clickCount: 1
      });
      await delay(30);
    }
    return center;
  };

  const activationKeyForRole = (role: string): string => {
    switch (role) {
      case "checkbox":
      case "switch":
      case "radio":
        return "Space";
      case "combobox":
      case "listbox":
        return "Down";
      default:
        return "Return";
    }
  };

  const tryResolveNodeAction = async (
    target: BrowserAgentPageTarget,
    backendDOMNodeId: number,
    focusOnly: boolean
  ): Promise<boolean> => {
    let session: WorkbenchBrowserDebuggerSession | null = null;
    try {
      session = await openDebuggerSessionForTarget(target);
      const resolved = await session
        .sendCommand("DOM.resolveNode", { backendNodeId: Math.round(backendDOMNodeId) })
        .catch(() => ({}));
      const object = (resolved as Record<string, unknown>).object;
      const objectId = object !== null && typeof object === "object"
        ? (object as Record<string, unknown>).objectId
        : undefined;
      if (typeof objectId !== "string") {
        return false;
      }
      const declaration = focusOnly
        ? "function(){ if (this && this.focus) { this.focus(); return true; } return false; }"
        : "function(){ if (this && this.focus) { this.focus(); } if (this && this.click) { this.click(); return true; } return false; }";
      const result = await session
        .sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: declaration,
          returnByValue: true
        })
        .catch(() => ({}));
      const value = (result as Record<string, unknown>).result;
      const inner = value !== null && typeof value === "object"
        ? (value as Record<string, unknown>).value
        : undefined;
      return inner === true;
    } catch {
      return false;
    } finally {
      await session?.close().catch(() => undefined);
    }
  };

  const axActOnNode = async (
    tabId: string,
    request: {
      readonly axRef: string;
      readonly effect: import("../types").BrowserActionEffect;
      readonly interaction?: WorkbenchBrowserAxInteraction;
      readonly verification?: "fast" | "full";
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly authorized?: boolean;
      readonly intent?: string;
    }
  ): Promise<WorkbenchBrowserAxActionResult> => {
    const interaction = normalizeAxInteraction(request.interaction);
    const targetMode = request.targetMode ?? "live";
    const observationalInteraction = interaction === "hover" || interaction === "focus";
    if (
      request.effect === "unknown"
      || observationalInteraction !== (request.effect === "observe")
    ) {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "browserActionEffectConflict",
          message: "Declared browser action effect conflicts with the requested AX interaction."
        },
        nextRecommendedAction: "lyra_clarification_ask"
      };
    }
    const resolution = axSnapshotStore.resolveAxRef(request.axRef);
    // ActCache replay: when the toggle is on and an intent is supplied, look up
    // a previously-recorded successful result for this (url, snapshot, axRef,
    // interaction, intent) tuple. Hits are only possible within the same AX
    // snapshot (snapshotHash is in the key), so the page state is identical to
    // when the act was first verified — safe to replay the recorded outcome.
    if (getActCacheEnabled !== undefined && getActCacheEnabled() && request.intent !== undefined && resolution.kind === "ok") {
      const cacheKey = buildAxActCacheKey({
        url: resolution.snapshot.url,
        snapshotHash: resolution.snapshot.snapshotHash,
        axRef: request.axRef,
        interaction,
        intent: request.intent
      });
      const lookup = axActCache.get(cacheKey);
      if (lookup.hit && lookup.entry !== undefined) {
        return {
          ...lookup.entry.result,
          cacheHit: true,
          replayed: true,
          nextRecommendedAction: "browser_ax.query"
        };
      }
    }
    if (resolution.kind === "stale") {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: { kind: "staleAxRef", message: "AX snapshot is stale. Re-run browser_ax.map." },
        nextRecommendedAction: "browser_ax.map"
      };
    }
    if (resolution.kind === "unknownNode") {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: { kind: "unknownAxRef", message: "axRef is not present in the latest AX snapshot." },
        nextRecommendedAction: "browser_ax.map"
      };
    }

    const { node } = resolution;
    const beforeNode = node;
    const risk = classifyRisk(node, request.effect);
    if (risk.requiredEffect !== undefined && request.effect !== risk.requiredEffect) {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "browserActionEffectConflict",
          message: `This AX target requires effect=${risk.requiredEffect}.`
        },
        nextRecommendedAction: "lyra_clarification_ask"
      };
    }
    if (risk.highRisk && request.authorized !== true) {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        needsUserAction: {
          kind: "auth_challenge",
          reason: risk.reason ?? "sensitive_action",
          ...(risk.provider === undefined ? {} : { provider: risk.provider }),
          suggestedAction: "lyra_lumen_elevate"
        },
        nextRecommendedAction: "lyra_lumen.elevate"
      };
    }

    const target = await resolveBrowserAgentTarget(tabId, { targetMode }, request.timeoutMs);
    // Respect user takeover / shared-control interruption (throws SharedControlInterruptionError).
    assertSharedControlCanContinue(tabId);
    const beforeUrl = agentTargetAddress(target);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction: interaction === "hover" ? "hover" : "click",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      ...(node.bounds === undefined ? {} : { cursor: boundsCenterPoint(node.bounds) }),
      durationMs: 2_200
    });

    if (node.axSource === "os") {
      if (osAxAdapter === undefined || node.osPath === undefined) {
        return {
          ok: false,
          kind: "browserAxActionResult",
          tabId,
          targetMode: target.targetMode,
          axRef: request.axRef,
          interaction,
          pageChanged: false,
          navigationStarted: false,
          error: {
            kind: "osAxUnavailable",
            message: "OS AX adapter is not available for this node."
          },
          nextRecommendedAction: "lyra_lumen.see"
        };
      }
      const raw = await osAxAdapter.actOnNode({ osPath: node.osPath, interaction });
      if (!isRecord(raw) || raw.ok !== true) {
        const rawError = isRecord(raw) && isRecord(raw.error) ? raw.error : {};
        return {
          ok: false,
          kind: "browserAxActionResult",
          tabId,
          targetMode: target.targetMode,
          axRef: request.axRef,
          interaction,
          pageChanged: false,
          navigationStarted: false,
          error: {
            kind: typeof rawError.kind === "string" ? rawError.kind : "osAxActionFailed",
            message: typeof rawError.message === "string"
              ? rawError.message
              : "OS AX action failed."
          },
          nextRecommendedAction: "lyra_lumen.see"
        };
      }
      let afterObservationId: string | undefined;
      if (request.verification === "full") {
        try {
          const afterMap = await axMapAgentPage(tabId, {
            targetMode: target.targetMode,
            strategy: "interactive",
            includeFrames: true,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
          });
          afterObservationId = afterMap.snapshotId;
        } catch {
          afterObservationId = undefined;
        }
      }
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        interaction: interaction === "hover" ? "hover" : "click",
        inputActive: true,
        result: "success"
      });
      return {
        ok: true,
        kind: "browserAxActionResult",
        tabId,
        targetMode: target.targetMode,
        axRef: request.axRef,
        interaction,
        method: "osAx",
        pageChanged: false,
        navigationStarted: false,
        ...(afterObservationId === undefined ? {} : { afterObservationId }),
        nextRecommendedAction: request.verification === "full" ? "browser_ax.query" : "browser_ax.map"
      };
    }

    let method: WorkbenchBrowserAxActionMethod | undefined;
    let x: number | undefined;
    let y: number | undefined;

    const wantsKeyboardOnly = interaction === "focus";
    const requiresTrustedInput = risk.highRisk && !wantsKeyboardOnly && interaction !== "hover";
    const canTier1 = node.backendDOMNodeId !== undefined
      && (interaction === "click" || interaction === "focus" || interaction === "toggle");

    // High-risk auth/payment actions need a trusted activation path. JS click often reports
    // success while OAuth/FedCM ignores it, so do not use resolveNode for those actions.
    if (requiresTrustedInput && node.bounds !== undefined) {
      const center = await dispatchPointerInput(target, node.bounds, interaction);
      x = center.x;
      y = center.y;
      method = "cdpInput";
    }

    // Tier 1: resolveNode + callFunctionOn for ordinary nodes, or focus-only actions.
    if (method === undefined && canTier1 && !requiresTrustedInput) {
      const ok = await tryResolveNodeAction(target, node.backendDOMNodeId!, wantsKeyboardOnly);
      if (ok) {
        method = "resolveNode";
      }
    }

    // Tier 2: pointer click at bounds center
    if (method === undefined && node.bounds !== undefined && !wantsKeyboardOnly) {
      const center = await dispatchPointerInput(target, node.bounds, interaction);
      x = center.x;
      y = center.y;
      method = "cdpInput";
    }

    if (method === undefined && requiresTrustedInput) {
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode: target.targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "trustedAxInputUnavailable",
          message: "High-risk AX action requires pointer bounds or OS AX. Refusing DOM click fallback."
        },
        nextRecommendedAction: "lyra_lumen.see"
      };
    }

    // Tier 3: focus + keyboard activation
    if (method === undefined) {
      let focused = false;
      if (node.backendDOMNodeId !== undefined) {
        focused = await tryResolveNodeAction(target, node.backendDOMNodeId, true);
      }
      if (focused || wantsKeyboardOnly) {
        if (!wantsKeyboardOnly) {
          await sendActivationKey(target, activationKeyForRole(node.role));
        }
        method = "keyboard";
      }
    }

    if (method === undefined) {
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode: target.targetMode,
        axRef: request.axRef,
        interaction,
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "axActionUnavailable",
          message: "AX node has no usable bounds or DOM binding. Fall back to lyra_lumen.see."
        },
        nextRecommendedAction: "lyra_lumen.see"
      };
    }

    const requiresPostActionVerification = risk.highRisk && interaction !== "hover" && interaction !== "focus";
    await delay(requiresPostActionVerification ? 900 : 40);
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    let afterObservationId: string | undefined;
    let focusChanged: boolean | undefined;
    let highRiskTargetStillPresent = false;
    let verificationUnavailable = false;
    let afterNode: BrowserAxNode | undefined;
    if (request.verification === "full" || request.verification === "fast" || requiresPostActionVerification) {
      try {
        const afterMap = await axMapAgentPage(tabId, {
          targetMode: target.targetMode,
          strategy: "interactive",
          includeFrames: true,
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
        });
        afterObservationId = afterMap.snapshotId;
        afterNode = afterMap.nodes.find((candidate) => candidate.axRef === request.axRef);
        const focused = afterMap.nodes.find((candidate) => candidate.state.focused === true);
        if (focused !== undefined) {
          focusChanged = focused.axRef !== request.axRef || node.state.focused !== true;
        }
        if (requiresPostActionVerification) {
          const expectedProvider = node.provider ?? risk.provider;
          highRiskTargetStillPresent = afterMap.nodes.some((candidate) =>
            candidate.axSource === node.axSource
            && candidate.role === node.role
            && candidate.name === node.name
            && (expectedProvider === undefined || candidate.provider === expectedProvider)
          );
        }
      } catch {
        afterObservationId = undefined;
        focusChanged = undefined;
        verificationUnavailable = true;
      }
    }
    if (
      requiresPostActionVerification
      && !pageChanged
      && !navigationStarted
      && (highRiskTargetStillPresent || verificationUnavailable)
    ) {
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        interaction: "click",
        inputActive: true,
        result: "failure"
      });
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode: target.targetMode,
        axRef: request.axRef,
        interaction,
        method,
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
        pageChanged,
        navigationStarted,
        ...(afterObservationId === undefined ? {} : { afterObservationId }),
        error: {
          kind: "axActionNotVerified",
          message: highRiskTargetStillPresent
            ? "High-risk AX target is still visible after trusted input."
            : "High-risk AX action could not be verified after trusted input."
        },
        nextRecommendedAction: highRiskTargetStillPresent ? "browser_ax.query" : "lyra_lumen.see"
      };
    }
    recordFollowAction(tabId, target.targetMode, "act", {
      visibleFollow: target.browserMode.visibleFollow,
      interaction: interaction === "hover" ? "hover" : "click",
      inputActive: true,
      result: "success"
    });

    const elementDiff = afterNode === undefined
      ? undefined
      : (() => {
          const changed = diffAxNodeSnapshots(beforeNode, afterNode);
          return {
            before: beforeNode.state,
            after: afterNode.state,
            changed,
            ...(changed.length === 0 ? { noObservableChange: true } : {})
          };
        })();

    const result: WorkbenchBrowserAxActionResult = {
      ok: true,
      kind: "browserAxActionResult",
      tabId,
      targetMode: target.targetMode,
      axRef: request.axRef,
      interaction,
      method,
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      pageChanged,
      navigationStarted,
      ...(focusChanged === undefined ? {} : { focusChanged }),
      ...(afterObservationId === undefined ? {} : { afterObservationId }),
      ...(elementDiff === undefined ? { diffUnavailable: true } : { elementDiff }),
      pathTaken: "fast",
      nextRecommendedAction: navigationStarted || pageChanged ? "browser_ax.map" : "browser_ax.query"
    };
    // Record successful acts into the ActCache when the toggle is on and an
    // intent is supplied. The key folds snapshotHash so this entry is only
    // replayable while the same AX snapshot is live.
    if (getActCacheEnabled !== undefined && getActCacheEnabled() && request.intent !== undefined && !pageChanged && !navigationStarted) {
      const cacheKey = buildAxActCacheKey({
        url: resolution.kind === "ok" ? resolution.snapshot.url : "",
        snapshotHash: resolution.kind === "ok" ? resolution.snapshot.snapshotHash : "",
        axRef: request.axRef,
        interaction,
        intent: request.intent
      });
      if (cacheKey.length > 0 && resolution.kind === "ok") {
        axActCache.set({
          tabId,
          targetMode: target.targetMode,
          axRef: request.axRef,
          interaction,
          intent: request.intent,
          snapshotHash: resolution.snapshot.snapshotHash,
          url: resolution.snapshot.url,
          result,
          recordedAt: Date.now(),
          ttlMs: BROWSER_AX_SNAPSHOT_TTL_MS
        });
        return { ...result, cacheMiss: true };
      }
    }
    return result;
  };

  const axPressAgentKey = async (
    tabId: string,
    request: {
      readonly key: string;
      readonly effect: import("../types").BrowserActionEffect;
      readonly axRef?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly authorized?: boolean;
    }
  ): Promise<WorkbenchBrowserAxActionResult> => {
    const targetMode = request.targetMode ?? "live";
    const observationalKey =
      request.key === "Tab"
      || request.key === "Shift+Tab"
      || request.key === "ArrowUp"
      || request.key === "ArrowDown"
      || request.key === "ArrowLeft"
      || request.key === "ArrowRight"
      || request.key === "Escape"
      || request.key === "Home"
      || request.key === "End"
      || request.key === "PageUp"
      || request.key === "PageDown";
    if (request.effect === "unknown" || observationalKey !== (request.effect === "observe")) {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: request.axRef ?? "",
        interaction: "focus",
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "browserActionEffectConflict",
          message: "Declared browser action effect conflicts with the requested key."
        },
        nextRecommendedAction: "lyra_clarification_ask"
      };
    }
    if (!observationalKey && request.axRef === undefined) {
      return {
        ok: false,
        kind: "browserAxActionResult",
        tabId,
        targetMode,
        axRef: "",
        interaction: "focus",
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "axRefRequired",
          message: "A state-changing browser key action requires an axRef."
        },
        nextRecommendedAction: "browser_ax.map"
      };
    }
    let focusMethod: WorkbenchBrowserAxActionMethod | undefined;
    if (request.axRef !== undefined) {
      const resolution = axSnapshotStore.resolveAxRef(request.axRef);
      if (resolution.kind === "stale" || resolution.kind === "unknownNode") {
        return {
          ok: false,
          kind: "browserAxActionResult",
          tabId,
          targetMode,
          axRef: request.axRef,
          interaction: "focus",
          pageChanged: false,
          navigationStarted: false,
          error: {
            kind: resolution.kind === "stale" ? "staleAxRef" : "unknownAxRef",
            message: "AX snapshot is stale or axRef is unknown. Re-run browser_ax.map."
          },
          nextRecommendedAction: "browser_ax.map"
        };
      }
      const risk = classifyRisk(resolution.node, request.effect);
      if (risk.requiredEffect !== undefined && request.effect !== risk.requiredEffect) {
        return {
          ok: false,
          kind: "browserAxActionResult",
          tabId,
          targetMode,
          axRef: request.axRef,
          interaction: "focus",
          pageChanged: false,
          navigationStarted: false,
          error: {
            kind: "browserActionEffectConflict",
            message: `This AX target requires effect=${risk.requiredEffect}.`
          },
          nextRecommendedAction: "lyra_clarification_ask"
        };
      }
      const focusResult = await axActOnNode(tabId, {
        axRef: request.axRef,
        interaction: "focus",
        effect: "observe",
        targetMode,
        ...(request.authorized === true ? { authorized: true } : {}),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      if (focusResult.ok === false) {
        return focusResult;
      }
      focusMethod = focusResult.method;
    }

    const target = await resolveBrowserAgentTarget(tabId, { targetMode }, request.timeoutMs);
    assertSharedControlCanContinue(tabId);
    const beforeUrl = agentTargetAddress(target);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "press",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_400
    });
    await sendActivationKey(target, request.key);
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    return {
      ok: true,
      kind: "browserAxActionResult",
      tabId,
      targetMode: target.targetMode,
      axRef: request.axRef ?? "",
      interaction: "focus",
      method: focusMethod ?? "keyboard",
      pageChanged,
      navigationStarted,
      nextRecommendedAction: navigationStarted || pageChanged ? "browser_ax.map" : "browser_ax.query"
    };
  };

  const axFocusAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction?: WorkbenchBrowserAxFocusDirection;
      readonly role?: string;
      readonly nameIncludes?: string;
      readonly maxSteps?: number;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAxFocusResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const backwards = request.direction === "previous";
    const maxSteps = Math.max(1, Math.min(40, Math.round(request.maxSteps ?? 20)));
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "focus",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(1_400, Math.min(4_000, 950 + maxSteps * 120))
    });

    const trail: WorkbenchBrowserAxFocusTrailEntry[] = [];
    let activeAxRef: string | undefined;
    let snapshotId = "";

    for (let step = 1; step <= maxSteps; step += 1) {
      target.webContents.focus();
      sendAgentInputEvent(target, {
        type: "keyDown",
        keyCode: "Tab",
        ...(backwards ? { modifiers: ["shift"] } : {})
      });
      await delay(12);
      sendAgentInputEvent(target, {
        type: "keyUp",
        keyCode: "Tab",
        ...(backwards ? { modifiers: ["shift"] } : {})
      });
      await delay(60);

      const map = await axMapAgentPage(tabId, {
        targetMode: target.targetMode,
        strategy: "interactive",
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      snapshotId = map.snapshotId;
      const focused = map.nodes.find((node) => node.state.focused === true);
      const entry: WorkbenchBrowserAxFocusTrailEntry = focused === undefined
        ? { step, role: "", name: "" }
        : { step, axRef: focused.axRef, role: focused.role, name: focused.name };
      trail.push(entry);
      activeAxRef = focused?.axRef;

      if (focused !== undefined) {
        const roleMatches = request.role === undefined || focused.role === request.role.toLowerCase();
        const nameMatches = request.nameIncludes === undefined
          || focused.name.toLowerCase().includes(request.nameIncludes.toLowerCase());
        if (roleMatches && nameMatches && (request.role !== undefined || request.nameIncludes !== undefined)) {
          break;
        }
      }
    }

    return {
      ok: true,
      kind: "browserAxFocusResult",
      tabId,
      targetMode: target.targetMode,
      ...(activeAxRef === undefined ? {} : { activeAxRef }),
      snapshotId,
      trail,
      nextRecommendedAction: activeAxRef === undefined ? "browser_ax.map" : "browser_ax.act"
    };
  };

  const axExplainNode = (
    tabId: string,
    request: {
      readonly axRef?: string;
      readonly snapshotId?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    }
  ): WorkbenchBrowserAxExplanation => {
    if (request.axRef === undefined) {
      return {
        ok: true,
        kind: "browserAxExplanation",
        summary: "No axRef supplied. Run browser_ax.map to read the accessibility tree first.",
        domAvailable: false,
        axAvailable: false,
        visualFallbackRecommended: false,
        userActionRequired: false,
        nextRecommendedAction: "browser_ax.map"
      };
    }
    const resolution = axSnapshotStore.resolveAxRef(request.axRef);
    if (resolution.kind === "stale" || resolution.kind === "unknownNode") {
      return {
        ok: true,
        kind: "browserAxExplanation",
        summary: "The axRef is stale or unknown. The AX snapshot expired or the page changed. Re-run browser_ax.map.",
        domAvailable: false,
        axAvailable: false,
        visualFallbackRecommended: true,
        userActionRequired: false,
        nextRecommendedAction: "browser_ax.map"
      };
    }
    const { node } = resolution;
    const risk = classifyRisk(node, node.provider === undefined ? "observe" : "authorize");
    const domAvailable = node.backendDOMNodeId !== undefined;
    const summary = risk.highRisk
      ? `${node.role} "${node.name}" is an account/authorization boundary${risk.provider === undefined ? "" : ` (${risk.provider})`}. The AX tree can see it, but acting requires user confirmation.`
      : `${node.role} "${node.name}" is visible in the accessibility tree${domAvailable ? " and is backed by a DOM node" : " (no DOM binding; pointer/keyboard only)"}.`;
    return {
      ok: true,
      kind: "browserAxExplanation",
      summary,
      domAvailable,
      axAvailable: true,
      visualFallbackRecommended: node.bounds === undefined && !domAvailable,
      userActionRequired: risk.highRisk,
      ...(risk.reason === undefined ? {} : { reason: risk.reason }),
      ...(risk.provider === undefined ? {} : { provider: risk.provider }),
      nextRecommendedAction: risk.highRisk ? "lyra_lumen.elevate" : "browser_ax.act"
    };
  };

  // Resolve an axRef to its current bbox + snapshot metadata. Used by the
  // lumen-tool-host to (a) annotate browser.see screenshots with AX-derived
  // bounding boxes and (b) derive a device-pixel click point for browser.vact
  // from an axRef, bridging the visual and semantic paths.
  const axResolveAxRefBbox = async (
    tabId: string,
    request: {
      readonly axRef: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    }
  ): Promise<WorkbenchBrowserAxRefBboxResult> => {
    const targetMode = request.targetMode ?? "live";
    if (!request.axRef.startsWith("ax:")) {
      return {
        ok: false,
        kind: "browserAxRefBbox",
        tabId,
        targetMode,
        axRef: request.axRef,
        error: { kind: "invalidAxRef", message: "axRef must start with 'ax:'." },
        nextRecommendedAction: "browser_ax.map"
      };
    }
    const resolution = axSnapshotStore.resolveAxRef(request.axRef);
    if (resolution.kind === "stale") {
      return {
        ok: false,
        kind: "browserAxRefBbox",
        tabId,
        targetMode,
        axRef: request.axRef,
        error: { kind: "staleAxRef", message: "AX snapshot is stale. Re-run browser_ax.map." },
        nextRecommendedAction: "browser_ax.map"
      };
    }
    if (resolution.kind === "unknownNode") {
      return {
        ok: false,
        kind: "browserAxRefBbox",
        tabId,
        targetMode,
        axRef: request.axRef,
        error: { kind: "unknownAxRef", message: "axRef is not present in the latest AX snapshot." },
        nextRecommendedAction: "browser_ax.map"
      };
    }
    const { node, snapshot } = resolution;
    return {
      ok: true,
      kind: "browserAxRefBbox",
      tabId,
      targetMode,
      axRef: request.axRef,
      role: node.role,
      name: node.name,
      ...(node.bounds === undefined ? {} : { bounds: node.bounds }),
      ...(node.screenBounds === undefined ? {} : { screenBounds: node.screenBounds }),
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      url: snapshot.url
    };
  };

  const dispose = (): void => {
    // Snapshot store lifecycle is owned by the controller; nothing else to clean up here.
  };

  return {
    axMapAgentPage,
    axQueryAgentSnapshot,
    axActOnNode,
    axFocusAgentPage,
    axPressAgentKey,
    axExplainNode,
    axResolveAxRefBbox,
    dispose
  };
};

export type BrowserAxController = ReturnType<typeof createBrowserAxController>;
