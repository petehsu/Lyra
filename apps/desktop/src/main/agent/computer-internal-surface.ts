import type {
  BrowserAxNode,
  WorkbenchBrowserAxActionResult,
  WorkbenchBrowserAxInteraction,
  WorkbenchBrowserAxMapResult,
  WorkbenchBrowserAxQueryResult
} from "../workbench-browser/types";
import type { TerminalScreenRegion } from "../../shared/desktop-bridge";
import { isRecord } from "./host-payload";

/** Level-1 Lyra surface identifiers (Tool-FS `surface` parameter). */
export const LYRA_BROWSER_SURFACE = "lyra-browser";
export const LYRA_TERMINAL_SURFACE = "lyra-terminal";
export const LYRA_FILE_MANAGER_SURFACE = "lyra-files";

export type ComputerSurfaceRoute =
  | "auto"
  | "lyra-browser"
  | "lyra-terminal"
  | "lyra-files"
  | "native";

/** Prefix for opaque osRefs that route act/diff/explain to browser_ax. */
export const LYRA_BROWSER_OS_REF_PREFIX = "lyb::";
export const LYRA_TERMINAL_OS_REF_PREFIX = "lyt::";
export const LYRA_FILE_MANAGER_OS_REF_PREFIX = "lyf::";

export type LyraBrowserOsRef = {
  readonly tabId: string;
  readonly axRef: string;
};

export type LyraTerminalOsRef = {
  readonly sessionId: string;
  readonly regionId: string;
};

export type LyraFileManagerOsRef = {
  readonly tabId: string;
  readonly entryId: string;
};

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

export const encodeLyraTerminalOsRef = (sessionId: string, regionId: string): string =>
  `${LYRA_TERMINAL_OS_REF_PREFIX}${sessionId}::${regionId}`;

export const parseLyraTerminalOsRef = (osRef: string): LyraTerminalOsRef | null => {
  if (!osRef.startsWith(LYRA_TERMINAL_OS_REF_PREFIX)) {
    return null;
  }
  const remainder = osRef.slice(LYRA_TERMINAL_OS_REF_PREFIX.length);
  const separator = remainder.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  const sessionId = remainder.slice(0, separator);
  const regionId = remainder.slice(separator + 2);
  return sessionId && regionId ? { sessionId, regionId } : null;
};

export const isLyraTerminalOsRef = (osRef: string): boolean => parseLyraTerminalOsRef(osRef) !== null;

export const encodeLyraFileManagerOsRef = (tabId: string, entryId: string): string =>
  `${LYRA_FILE_MANAGER_OS_REF_PREFIX}${tabId}::${entryId}`;

export const parseLyraFileManagerOsRef = (osRef: string): LyraFileManagerOsRef | null => {
  if (!osRef.startsWith(LYRA_FILE_MANAGER_OS_REF_PREFIX)) {
    return null;
  }
  const remainder = osRef.slice(LYRA_FILE_MANAGER_OS_REF_PREFIX.length);
  const separator = remainder.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  const tabId = remainder.slice(0, separator);
  const entryId = remainder.slice(separator + 2);
  return tabId && entryId ? { tabId, entryId } : null;
};

export const isLyraFileManagerOsRef = (osRef: string): boolean =>
  parseLyraFileManagerOsRef(osRef) !== null;

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

const mapTerminalSuggestedAction = (action: string): string | null => {
  switch (action) {
    case "confirm":
      return "press";
    case "focus":
      return "focus";
    case "toggle":
      return "toggle";
    case "select":
      return "select";
    case "type":
      return "setText";
    case "scroll":
      return "scroll";
    default:
      return null;
  }
};

export const terminalRegionToComputerNode = (
  sessionId: string,
  region: TerminalScreenRegion
): Record<string, unknown> => {
  const actions = [
    ...new Set(
      region.suggestedActions
        .map(mapTerminalSuggestedAction)
        .filter((action): action is string => action !== null)
    )
  ];
  return {
    osRef: encodeLyraTerminalOsRef(sessionId, region.regionId),
    platform: platformLabel(),
    app: "lyra-terminal",
    window: sessionId,
    role: region.kind,
    name: region.text.trim() || region.kind,
    value: region.text,
    bounds: {
      x: region.colStart,
      y: region.rowStart,
      width: Math.max(1, region.colEnd - region.colStart + 1),
      height: Math.max(1, region.rowEnd - region.rowStart + 1)
    },
    actions: actions.length > 0 ? actions : ["press"],
    source: "internal-ipc",
    secure: false,
    osPath: region.regionId
  };
};

export const adaptTerminalMapToComputerMap = (
  tabId: string,
  result: {
    readonly sessionId: string;
    readonly screen: { readonly screenVersion: number };
    readonly regions: readonly TerminalScreenRegion[];
    readonly stale?: boolean;
    readonly warning?: string;
  }
): Record<string, unknown> => ({
  ok: true,
  platform: platformLabel(),
  surface: LYRA_TERMINAL_SURFACE,
  capabilityLevel: 1,
  tabId,
  snapshotId: `lyt-snap-${result.sessionId}-${result.screen.screenVersion}`,
  status: {
    ok: true,
    state: result.stale === true ? "stale" : "available",
    message: "Lyra terminal semantic regions were read via internal IPC.",
    nodeCount: result.regions.length,
    sessionId: result.sessionId,
    ...(result.warning === undefined ? {} : { warning: result.warning })
  },
  nodes: result.regions.map((region) => terminalRegionToComputerNode(result.sessionId, region))
});

export const filterTerminalRegions = (
  sessionId: string,
  regions: readonly TerminalScreenRegion[],
  filters: { readonly role?: string; readonly nameIncludes?: string; readonly maxResults: number }
): Record<string, unknown>[] => {
  const roleFilter = filters.role?.toLowerCase();
  const nameFilter = filters.nameIncludes?.toLowerCase();
  const matches = regions.filter((region) => {
    if (roleFilter !== undefined && region.kind.toLowerCase() !== roleFilter) {
      return false;
    }
    if (nameFilter !== undefined && !region.text.toLowerCase().includes(nameFilter)) {
      return false;
    }
    return true;
  });
  return matches
    .slice(0, filters.maxResults)
    .map((region) => terminalRegionToComputerNode(sessionId, region));
};

export const mapComputerActionToTerminalAction = (
  action: string
): { readonly action: string; readonly unsupported?: string } | null => {
  switch (action) {
    case "press":
      return { action: "confirm" };
    case "focus":
      return { action: "focus" };
    case "toggle":
      return { action: "toggle" };
    case "select":
      return { action: "select" };
    case "setText":
      return { action: "type" };
    case "scroll":
      return { action: "scroll" };
    default:
      return null;
  }
};

export const adaptTerminalActToComputerAct = (
  osRef: string,
  action: string,
  result: {
    readonly ok?: boolean;
    readonly status?: string;
    readonly actId?: string;
    readonly screenCursor?: string | null;
    readonly map?: {
      readonly sessionId: string;
      readonly regions: readonly TerminalScreenRegion[];
    };
    readonly error?: { readonly kind: string; readonly message: string };
  }
): Record<string, unknown> => {
  const parsed = parseLyraTerminalOsRef(osRef);
  if (result.ok === false || (result.status !== undefined && result.status !== "executed")) {
    return {
      ok: false,
      platform: platformLabel(),
      surface: LYRA_TERMINAL_SURFACE,
      capabilityLevel: 1,
      osRef,
      action,
      error: result.error ?? {
        kind: result.status ?? "terminalActFailed",
        message: "Lyra terminal internal action did not execute."
      }
    };
  }
  const afterRegion = parsed === null
    ? undefined
    : result.map?.regions.find((region) => region.regionId === parsed.regionId);
  return {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_TERMINAL_SURFACE,
    capabilityLevel: 1,
    osRef,
    action,
    actId: result.actId,
    changed: afterRegion === undefined ? [] : ["terminal-region-updated"],
    ...(result.screenCursor === undefined || result.screenCursor === null
      ? {}
      : { afterObservationId: result.screenCursor })
  };
};

export type FileManagerObservationEntry = {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly kind?: string;
};

export const fileManagerEntryToComputerNode = (
  tabId: string,
  entry: FileManagerObservationEntry,
  selectedEntryId?: string
): Record<string, unknown> => ({
  osRef: encodeLyraFileManagerOsRef(tabId, entry.id),
  platform: platformLabel(),
  app: "lyra-files",
  window: tabId,
  role: entry.kind ?? "entry",
  name: entry.name,
  ...(entry.path === undefined ? {} : { value: entry.path }),
  state: {
    selected: selectedEntryId === entry.id
  },
  actions: ["select", "press"],
  source: "internal-ipc",
  secure: false,
  osPath: entry.id
});

export const adaptFileManagerObservationToComputerMap = (
  tabId: string,
  observation: {
    readonly kind: "file-manager";
    readonly viewKind?: string;
    readonly currentLocation?: { readonly title?: string; readonly path?: string } | null;
    readonly selectedEntryId?: string;
    readonly entries?: readonly FileManagerObservationEntry[];
  }
): Record<string, unknown> => {
  const entries = observation.entries ?? [];
  const nodes = entries.map((entry) =>
    fileManagerEntryToComputerNode(tabId, entry, observation.selectedEntryId)
  );
  if (observation.currentLocation !== null && observation.currentLocation !== undefined) {
    nodes.unshift({
      osRef: encodeLyraFileManagerOsRef(tabId, "__location__"),
      platform: platformLabel(),
      app: "lyra-files",
      window: tabId,
      role: "location",
      name: observation.currentLocation.title ?? observation.currentLocation.path ?? "location",
      ...(observation.currentLocation.path === undefined
        ? {}
        : { value: observation.currentLocation.path }),
      actions: ["focus"],
      source: "internal-ipc",
      secure: false,
      osPath: "__location__"
    });
  }
  return {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_FILE_MANAGER_SURFACE,
    capabilityLevel: 1,
    tabId,
    snapshotId: `lyf-snap-${tabId}-${entries.length}`,
    status: {
      ok: true,
      state: "available",
      message: "Lyra file manager entries were read via internal IPC.",
      nodeCount: nodes.length,
      viewKind: observation.viewKind
    },
    nodes
  };
};

export const filterFileManagerEntries = (
  tabId: string,
  entries: readonly FileManagerObservationEntry[],
  filters: {
    readonly role?: string;
    readonly nameIncludes?: string;
    readonly maxResults: number;
    readonly selectedEntryId?: string;
  }
): Record<string, unknown>[] => {
  const roleFilter = filters.role?.toLowerCase();
  const nameFilter = filters.nameIncludes?.toLowerCase();
  const matches = entries.filter((entry) => {
    if (roleFilter !== undefined && (entry.kind ?? "entry").toLowerCase() !== roleFilter) {
      return false;
    }
    if (nameFilter !== undefined && !entry.name.toLowerCase().includes(nameFilter)) {
      return false;
    }
    return true;
  });
  return matches
    .slice(0, filters.maxResults)
    .map((entry) => fileManagerEntryToComputerNode(tabId, entry, filters.selectedEntryId));
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
    readonly surface?: string;
  }
): Record<string, unknown> => ({
  ok: true,
  platform: platformLabel(),
  surface: explanation.surface ?? (osRef === undefined ? undefined : LYRA_BROWSER_SURFACE),
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