import type { WorkbenchBrowserAuthChallengeSignal } from "../../../shared/desktop-bridge";
import type {
  BrowserAxNode,
  WorkbenchBrowserAgentElementBounds,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAxInteraction,
  WorkbenchBrowserAxNodeState,
  WorkbenchBrowserAxOsStatus,
  WorkbenchBrowserAxStrategy,
  WorkbenchBrowserOsAxAdapter
} from "../types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAxActCache } from "./ax-act-cache";
import type { BrowserAxSnapshotStore } from "./ax-snapshot-store";
import { detectProvider } from "./ax-detectors";
import type { BrowserAgentPageTarget, BrowserAgentSemanticFrameGraph } from "./types";

export type BrowserAxControllerDeps = Pick<
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

export const diffAxNodeSnapshots = (
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

export const normalizeAxStrategy = (
  strategy: unknown
): WorkbenchBrowserAxStrategy =>
  strategy === "document" || strategy === "auth" ? strategy : "interactive";

export const normalizeAxInteraction = (
  interaction: unknown
): WorkbenchBrowserAxInteraction => {
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

export const boundsCenterPoint = (
  bounds: WorkbenchBrowserAgentElementBounds
): { readonly x: number; readonly y: number } => ({
  x: bounds.x + Math.round(bounds.width / 2),
  y: bounds.y + Math.round(bounds.height / 2)
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export const coerceAxBounds = (
  value: unknown
): WorkbenchBrowserAgentElementBounds | undefined => {
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

export const axStateFromProperties = (
  record: Record<string, unknown>
): WorkbenchBrowserAxNodeState => {
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

export const detectAuthSignals = (
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

export const unavailableOsAxStatus = (
  message: string
): WorkbenchBrowserAxOsStatus => ({
  ok: false,
  platform: process.platform,
  state: "unavailable",
  message
});

export const normalizeOsAxStatus = (raw: unknown): WorkbenchBrowserAxOsStatus => {
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

export const scoreAxMatch = (
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

export const activationKeyForRole = (role: string): string => {
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
