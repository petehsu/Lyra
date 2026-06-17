import type {
  BrowserAxNode,
  WorkbenchBrowserAxActionResult,
  WorkbenchBrowserAxInteraction,
  WorkbenchBrowserAxMapResult,
  WorkbenchBrowserAxQueryResult
} from "../workbench-browser/types";
import { isRecord, readOptionalStringField } from "./host-payload";

/** Level-1 Lyra browser surface identifier (Tool-FS `surface` parameter). */
export const LYRA_BROWSER_SURFACE = "lyra-browser";

/** Prefix for opaque osRefs that route act/diff/explain to browser_ax. */
export const LYRA_BROWSER_OS_REF_PREFIX = "lyb::";

export type LyraBrowserOsRef = {
  readonly tabId: string;
  readonly axRef: string;
};

export type InternalSurfaceRoute =
  | { readonly kind: "lyra-browser"; readonly tabId: string }
  | { readonly kind: "native" };

const platformLabel = (): string => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  return "unsupported";
};

export const encodeLyraBrowserOsRef = (tabId: string, axRef: string): string =>
  `${LYRA_BROWSER_OS_REF_PREFIX}${tabId}::${axRef}`;

export const parseLyraBrowserOsRef = (osRef: string): LyraBrowserOsRef | null => {
  if (!osRef.startsWith(LYRA_BROWSER_OS_REF_PREFIX)) {
    return null;
  }
  const remainder = osRef.slice(LYRA_BROWSER_OS_REF_PREFIX.length);
  const separator = remainder.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  const tabId = remainder.slice(0, separator);
  const axRef = remainder.slice(separator + 2);
  if (!tabId || !axRef.startsWith("ax:")) {
    return null;
  }
  return { tabId, axRef };
};

export const isLyraBrowserOsRef = (osRef: string): boolean => parseLyraBrowserOsRef(osRef) !== null;

const mapAxCapability = (capability: string): string | null => {
  switch (capability) {
    case "click":
      return "press";
    case "focus":
      return "focus";
    case "type":
      return "setText";
    case "toggle":
      return "toggle";
    case "select":
      return "select";
    case "press":
      return "press";
    default:
      return null;
  }
};

export const browserAxNodeToComputerNode = (
  tabId: string,
  node: BrowserAxNode
): Record<string, unknown> => {
  const bounds = node.screenBounds ?? node.bounds;
  const actions = [
    ...new Set(
      node.actionCapabilities
        .map(mapAxCapability)
        .filter((action): action is string => action !== null)
    )
  ];
  const secure = node.role.toLowerCase().includes("password")
    || node.role.toLowerCase() === "securetextbox";
  return {
    osRef: encodeLyraBrowserOsRef(tabId, node.axRef),
    platform: platformLabel(),
    app: "lyra-browser",
    window: tabId,
    role: node.role,
    name: node.name,
    ...(node.value === undefined || secure ? {} : { value: node.value }),
    ...(bounds === undefined
      ? {}
      : {
          bounds: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
          }
        }),
    ...(node.state.disabled === undefined
      && node.state.focused === undefined
      && node.state.selected === undefined
      && node.state.checked === undefined
      && node.state.expanded === undefined
      ? {}
      : {
          state: {
            ...(node.state.focused === undefined ? {} : { focused: node.state.focused }),
            ...(node.state.disabled === undefined ? {} : { enabled: !node.state.disabled }),
            ...(node.state.selected === undefined ? {} : { selected: node.state.selected }),
            ...(node.state.checked === undefined ? {} : { checked: node.state.checked }),
            ...(node.state.expanded === undefined ? {} : { expanded: node.state.expanded })
          }
        }),
    actions,
    source: "internal-ipc",
    secure,
    osPath: node.osPath ?? ""
  };
};

export const adaptBrowserAxMapToComputerMap = (
  result: WorkbenchBrowserAxMapResult
): Record<string, unknown> => ({
  ok: true,
  platform: platformLabel(),
  surface: LYRA_BROWSER_SURFACE,
  capabilityLevel: 1,
  snapshotId: result.snapshotId,
  status: {
    ok: true,
    state: "available",
    message: "Lyra browser semantic tree snapshot was read via internal IPC.",
    nodeCount: result.nodes.length,
    url: result.url,
    title: result.title
  },
  nodes: result.nodes.map((node) => browserAxNodeToComputerNode(result.tabId, node))
});

export const adaptBrowserAxQueryToComputerFind = (
  tabId: string,
  result: WorkbenchBrowserAxQueryResult
): Record<string, unknown> => ({
  ok: true,
  platform: platformLabel(),
  surface: LYRA_BROWSER_SURFACE,
  capabilityLevel: 1,
  snapshotId: result.snapshotId,
  matchCount: result.matches.length,
  nodes: result.matches.map((match) => ({
    osRef: encodeLyraBrowserOsRef(tabId, match.axRef),
    platform: platformLabel(),
    app: "lyra-browser",
    window: tabId,
    role: match.role,
    name: match.name,
    ...(match.bounds === undefined
      ? {}
      : {
          bounds: {
            x: Math.round(match.bounds.x),
            y: Math.round(match.bounds.y),
            width: Math.round(match.bounds.width),
            height: Math.round(match.bounds.height)
          }
        }),
    actions: ["press"],
    source: "internal-ipc",
    secure: false,
    osPath: ""
  }))
});

export const mapComputerActionToAxInteraction = (
  action: string
): WorkbenchBrowserAxInteraction | null => {
  switch (action) {
    case "press":
      return "click";
    case "focus":
      return "focus";
    case "toggle":
      return "toggle";
    case "select":
      return "select";
    default:
      return null;
  }
};

const computerNodeFromAxAction = (
  tabId: string,
  axRef: string,
  node: BrowserAxNode | undefined
): Record<string, unknown> | undefined =>
  node === undefined ? undefined : browserAxNodeToComputerNode(tabId, node);

export const adaptBrowserAxActToComputerAct = (
  osRef: string,
  action: string,
  result: WorkbenchBrowserAxActionResult,
  beforeNode?: BrowserAxNode,
  afterNode?: BrowserAxNode
): Record<string, unknown> => {
  const parsed = parseLyraBrowserOsRef(osRef);
  const tabId = parsed?.tabId ?? result.tabId;
  if (!result.ok) {
    return {
      ok: false,
      platform: platformLabel(),
      surface: LYRA_BROWSER_SURFACE,
      capabilityLevel: 1,
      osRef,
      action,
      error: result.error ?? {
        kind: "internalSurfaceActionFailed",
        message: "Lyra browser internal action failed."
      },
      ...(result.nextRecommendedAction === undefined
        ? {}
        : { nextRecommendedAction: result.nextRecommendedAction })
    };
  }

  const before = computerNodeFromAxAction(tabId, result.axRef, beforeNode);
  const after = computerNodeFromAxAction(tabId, result.axRef, afterNode);
  const changed = result.elementDiff?.changed ?? [];
  const payload: Record<string, unknown> = {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_BROWSER_SURFACE,
    capabilityLevel: 1,
    osRef,
    action,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    changed,
    pageChanged: result.pageChanged,
    navigationStarted: result.navigationStarted,
    ...(result.afterObservationId === undefined ? {} : { afterObservationId: result.afterObservationId })
  };
  if (changed.length === 0 && result.elementDiff?.noObservableChange !== false) {
    payload.warning =
      "Action reported success but no observable state change was detected; verify with computer.map.";
  }
  return payload;
};

export const readComputerSurfaceRoute = (
  payload: Record<string, unknown>
): "auto" | "lyra-browser" | "native" => {
  const surface = readOptionalStringField(payload, "surface");
  if (surface === LYRA_BROWSER_SURFACE || surface === "browser") {
    return "lyra-browser";
  }
  if (surface === "native" || surface === "desktop" || surface === "os") {
    return "native";
  }
  return "auto";
};

export const isBrowserAxMapResult = (value: unknown): value is WorkbenchBrowserAxMapResult =>
  isRecord(value) && value.ok === true && value.kind === "browserAxMap";

export const isBrowserAxQueryResult = (value: unknown): value is WorkbenchBrowserAxQueryResult =>
  isRecord(value) && value.ok === true && value.kind === "browserAxQuery";

export const isBrowserAxActionResult = (value: unknown): value is WorkbenchBrowserAxActionResult =>
  isRecord(value) && value.kind === "browserAxActionResult";

export const adaptBrowserAxExplainToComputerExplain = (
  osRef: string | undefined,
  explanation: {
    readonly summary: string;
    readonly axAvailable: boolean;
    readonly visualFallbackRecommended: boolean;
    readonly userActionRequired: boolean;
    readonly nextRecommendedAction?: string;
  }
): Record<string, unknown> => ({
  ok: true,
  platform: platformLabel(),
  surface: osRef === undefined ? undefined : LYRA_BROWSER_SURFACE,
  capabilityLevel: 1,
  ...(osRef === undefined ? {} : { osRef }),
  semanticControlAvailable: explanation.axAvailable,
  summary: explanation.summary,
  visualFallbackRecommended: explanation.visualFallbackRecommended,
  blocked: explanation.userActionRequired,
  recommendation: explanation.userActionRequired ? "user-action" : "semantic",
  ...(explanation.nextRecommendedAction === undefined
    ? {}
    : { nextRecommendedAction: explanation.nextRecommendedAction })
});