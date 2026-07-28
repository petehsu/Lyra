import type {
  BrowserActionEffect,
  LumenScreenshotHighlightColor,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentScrollBlock,
  WorkbenchBrowserAgentScrollDirection,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVerification,
  WorkbenchBrowserWorkflowCacheMode
} from "../workbench-browser/types";
import { compactMapObservation } from "../workbench-browser/view-manager-runtime/agent-map-compaction";
import { normalizeWorkflowCacheMode } from "../workbench-browser/view-manager-runtime/lumen-workflow-cache";
import {
  isRecord,
  readOptionalBooleanField,
  readOptionalNumberField,
  readOptionalStringField
} from "./host-payload";

const LUMEN_SEE_CONTENT_CHAR_BUDGET = 8_000;
const LUMEN_MAP_JSON_CHAR_BUDGET = 8_000;
const UNCERTAIN_TIMEOUT_METHODS = [
  "lyraLumen.act",
  "lyraLumen.vact",
  "lyraLumen.scroll",
  "lyraLumen.navigate",
  "lyraLumen.reload",
  "lyraLumen.submit",
  "lyraLumen.press",
  "lyraLumen.type"
] as const;

const LUMEN_ANNOTATION_COLORS: readonly LumenScreenshotHighlightColor[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple"
];

type BlockedRegionLike = {
  readonly kind?: string;
  readonly reason?: string;
};

export class LumenActionTimeoutError extends Error {
  constructor(
    readonly requestedMethod: string,
    readonly timeoutMs: number
  ) {
    super(`Lyra Lumen ${requestedMethod} timed out after ${timeoutMs}ms`);
    this.name = "LumenActionTimeoutError";
  }
}

export class InvalidLumenElementIdError extends Error {
  readonly received: string;
  readonly recommendedTool: string;

  constructor(received: string) {
    super(
      `elementId must be a numeric Lyra Lumen element id, not a Workbench tab id: ${received}`
    );
    this.name = "InvalidLumenElementIdError";
    this.received = received;
    this.recommendedTool = "lyra_lumen_map";
  }
}

export const isUncertainTimeoutMethod = (requestedMethod: string): boolean =>
  UNCERTAIN_TIMEOUT_METHODS.some((method) => method === requestedMethod);

export const readLumenAuditRequest = (
  payload: Record<string, unknown>,
  targetMode: "isolated" | "live"
) => {
  const value = payload.severity;
  const normalizeSeverity = (
    item: unknown
  ): "info" | "warning" | "error" | null =>
    item === "info" || item === "warning" || item === "error" ? item : null;
  let severity:
    | "info"
    | "warning"
    | "error"
    | readonly ("info" | "warning" | "error")[]
    | undefined;
  if (Array.isArray(value)) {
    const severities = value.map(normalizeSeverity);
    if (severities.some((item) => item === null)) {
      throw new Error("severity must contain only info, warning, or error");
    }
    severity = severities as readonly ("info" | "warning" | "error")[];
  } else if (value !== undefined) {
    const normalized = normalizeSeverity(value);
    if (normalized === null) {
      throw new Error("severity must be info, warning, or error");
    }
    severity = normalized;
  }

  const maxEntries = readOptionalNumberField(payload, "maxEntries");
  const status = readOptionalNumberField(payload, "status");
  const responseBodyMaxBytes = readOptionalNumberField(payload, "responseBodyMaxBytes");
  const includeConsole = readOptionalBooleanField(payload, "includeConsole");
  const includeNetwork = readOptionalBooleanField(payload, "includeNetwork");
  const includeRuntime = readOptionalBooleanField(payload, "includeRuntime");
  const includeResponseBody = readOptionalBooleanField(payload, "includeResponseBody");
  const since =
    typeof payload.since === "string" || typeof payload.since === "number"
      ? payload.since
      : undefined;
  if (payload.since !== undefined && since === undefined) {
    throw new Error("since must be an ISO timestamp string or epoch milliseconds");
  }
  const domain = readOptionalStringField(payload, "domain");
  const path = readOptionalStringField(payload, "path");
  const method = readOptionalStringField(payload, "method");
  return {
    targetMode,
    ...(includeConsole === undefined ? {} : { includeConsole }),
    ...(includeNetwork === undefined ? {} : { includeNetwork }),
    ...(includeRuntime === undefined ? {} : { includeRuntime }),
    ...(severity === undefined ? {} : { severity }),
    ...(since === undefined ? {} : { since }),
    ...(maxEntries === undefined ? {} : { maxEntries }),
    ...(domain === undefined ? {} : { domain }),
    ...(path === undefined ? {} : { path }),
    ...(status === undefined ? {} : { status }),
    ...(method === undefined ? {} : { method }),
    ...(includeResponseBody === undefined ? {} : { includeResponseBody }),
    ...(responseBodyMaxBytes === undefined ? {} : { responseBodyMaxBytes })
  };
};

export const readLumenQueryField = (payload: Record<string, unknown>): string => {
  const query = readOptionalStringField(payload, "query");
  if (query !== undefined && query.trim().length > 0) {
    return query.trim();
  }
  const text = readOptionalStringField(payload, "text");
  if (text !== undefined && text.trim().length > 0) {
    return text.trim();
  }
  throw new Error("query must be a non-empty string");
};

export const findActiveBrowserBlock = (
  blockedRegions: readonly BlockedRegionLike[] | undefined
): BlockedRegionLike | undefined =>
  blockedRegions?.find((region) => region.kind === "permission-prompt");

export const applyBrowserBlockedEnvelope = <T extends Record<string, unknown>>(
  result: T,
  blockedRegion: BlockedRegionLike | undefined
): T => {
  if (blockedRegion === undefined) {
    return result;
  }
  const reason = blockedRegion.reason ?? "browser automation blocked";
  return {
    ...result,
    ok: false,
    status: "blocked",
    browserBlocked: true,
    blockedRegions: "blockedRegions" in result && Array.isArray(result.blockedRegions)
      ? result.blockedRegions
      : [blockedRegion],
    message:
      `Browser automation paused: ${reason}. Close the upload or permission dialog, then retry.`,
    nextRecommendedAction: "ask_user"
  };
};

export const annotationColorForIndex = (
  index: number
): LumenScreenshotHighlightColor =>
  LUMEN_ANNOTATION_COLORS[index % LUMEN_ANNOTATION_COLORS.length]!;

export const truncateLumenTextContent = (
  content: string,
  budget = LUMEN_SEE_CONTENT_CHAR_BUDGET
): { readonly content: string; readonly truncated: boolean } => {
  if (content.length <= budget) {
    return { content, truncated: false };
  }
  const headBudget = Math.floor(budget * 0.6);
  const tailBudget = Math.floor(budget * 0.3);
  return {
    content: `${content.slice(0, headBudget)}\n\n[... truncated for provider budget ...]\n\n${content.slice(-tailBudget)}`,
    truncated: true
  };
};

export const budgetMapResult = <T extends Record<string, unknown>>(result: T): T => {
  if (JSON.stringify(result).length <= LUMEN_MAP_JSON_CHAR_BUDGET) {
    return result;
  }
  return {
    ...result,
    outputTruncated: true,
    outputTruncatedReason:
      `map observation exceeded ${LUMEN_MAP_JSON_CHAR_BUDGET} characters; full evidence remains in session artifacts`
  };
};

export const readLumenMapScope = (
  payload: Record<string, unknown>
): "viewport" | "document" | undefined => {
  const value = payload.mapScope;
  return value === "viewport" || value === "document" ? value : undefined;
};

export const readLumenStrategy = (
  payload: Record<string, unknown>,
  fallback: "interactiveOnly" | "picker" | "focus" | "hybrid" | "domFallback" = "interactiveOnly"
) => {
  const value = payload.strategy;
  return value === "interactiveOnly"
    || value === "picker"
    || value === "focus"
    || value === "hybrid"
    || value === "domFallback"
    ? value
    : fallback;
};

export const readLumenInteraction = (payload: Record<string, unknown>) => {
  const value = payload.interaction;
  if (value === "double_click" || value === "doubleClick") return "doubleClick";
  if (value === "right_click" || value === "rightClick") return "rightClick";
  if (value === "select") return "select";
  return value === "hover" || value === "click" ? value : "click";
};

export const readOptionalLumenActionEffect = (
  payload: Record<string, unknown>
): BrowserActionEffect | undefined => {
  const value = payload.effect;
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "observe"
    || value === "navigate"
    || value === "editDraft"
    || value === "submitExternal"
    || value === "authorize"
    || value === "purchase"
    || value === "delete"
    || value === "upload"
    || value === "download"
    || value === "communicate"
    || value === "unknown"
  ) {
    return value;
  }
  throw new Error("effect must be a valid BrowserActionEffect");
};

export const readLumenVisualInteraction = (payload: Record<string, unknown>) => {
  const value = payload.interaction;
  if (value === "double_click" || value === "doubleClick") return "doubleClick";
  if (value === "right_click" || value === "rightClick") return "rightClick";
  if (value === "hover" || value === "drag" || value === "scroll") return value;
  return "click";
};

export const readLumenFocusDirection = (payload: Record<string, unknown>) => {
  const value = payload.direction;
  return value === "next" || value === "previous" ? value : "scan";
};

export const readLumenScrollDirection = (
  payload: Record<string, unknown>
): WorkbenchBrowserAgentScrollDirection | undefined => {
  const value = payload.direction;
  return value === "up" || value === "down" || value === "left" || value === "right"
    ? value
    : undefined;
};

export const readLumenScrollBlock = (
  payload: Record<string, unknown>
): WorkbenchBrowserAgentScrollBlock | undefined => {
  const value = payload.block;
  return value === "start" || value === "center" || value === "end" || value === "nearest"
    ? value
    : undefined;
};

export const readLumenScrollOperation = (payload: Record<string, unknown>) => {
  const value = payload.action ?? payload.operation;
  if (value === "scroll_to_target" || value === "ensure_visible" || value === "scroll") {
    return value;
  }
  const toolPath = typeof payload.toolPath === "string" ? payload.toolPath : "";
  if (toolPath.endsWith("/scroll_to_target")) return "scroll_to_target";
  if (toolPath.endsWith("/ensure_visible")) return "ensure_visible";
  return "scroll";
};

export const readLumenWaitUntil = (payload: Record<string, unknown>) => {
  const value = payload.until;
  return value === "loadIdle"
    || value === "textChanged"
    || value === "textStable"
    || value === "textContains"
    ? value
    : "textStable";
};

export const readLumenVerification = (
  payload: Record<string, unknown>,
  defaultVerification: WorkbenchBrowserAgentVerification = "none"
): WorkbenchBrowserAgentVerification => {
  const value = payload.verification ?? payload.verify;
  return value === "full" || value === "fast" || value === "none"
    ? value
    : defaultVerification;
};

export const readLumenSettle = (
  payload: Record<string, unknown>
): boolean | undefined => {
  if (payload.settle === true) return true;
  if (payload.settle === false) return false;
  return undefined;
};

export const readWorkflowFields = (
  payload: Record<string, unknown>
): {
  readonly workflowId?: string;
  readonly cacheMode: WorkbenchBrowserWorkflowCacheMode;
} => {
  const workflowId = readOptionalStringField(payload, "workflowId");
  const cacheMode = normalizeWorkflowCacheMode(payload.cacheMode);
  return {
    ...(workflowId === undefined ? {} : { workflowId }),
    cacheMode
  };
};

export const nextRecommendedActionAfterFastLumenAction = (
  result: Record<string, unknown>
): string => {
  if (result.ok === false) {
    return "lyra_lumen_audit";
  }
  const elementDiff = isRecord(result.elementDiff) ? result.elementDiff : null;
  const changed = Array.isArray(elementDiff?.changed) ? elementDiff.changed : [];
  if (changed.length === 0 && elementDiff?.noObservableChange === true) {
    return "lyra_lumen.read";
  }
  if (result.navigationStarted === true) {
    return "lyra_lumen.wait";
  }
  if (result.pageChanged === true) {
    return "lyra_lumen.map";
  }
  return "continue_with_cached_targets";
};

export const readLumenTargetMode = (
  payload: Record<string, unknown>
): WorkbenchBrowserAgentTargetMode => {
  const value = payload.targetMode ?? payload.target;
  if (value === "live") return "live";
  if (value === "isolated") return "isolated";
  return "live";
};

export const readOptionalLumenElementId = (
  payload: Record<string, unknown>,
  fieldName = "elementId"
): number | undefined => {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && /^\d+$/u.test(trimmed)) {
      return Math.round(parsed);
    }
    throw new InvalidLumenElementIdError(trimmed);
  }
  throw new Error(`${fieldName} must be a numeric Lyra Lumen element id`);
};

export const readOptionalLumenTargetRef = (
  payload: Record<string, unknown>,
  fieldName = "targetRef"
): string | undefined => {
  const value = payload[fieldName] ?? payload.lumenTargetRef;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty Lyra Lumen targetRef string`);
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("lumen:")) {
    throw new Error(`${fieldName} must be a stable Lyra Lumen targetRef from /tools/browser/map`);
  }
  return trimmed;
};

export const readLumenPoint = (payload: Record<string, unknown>) => {
  const value = payload.point;
  if (value === null || typeof value !== "object") {
    throw new Error("point must be an object with numeric x and y");
  }
  const point = value as Record<string, unknown>;
  const x = typeof point.x === "number" ? point.x : Number.NaN;
  const y = typeof point.y === "number" ? point.y : Number.NaN;
  if (Number.isFinite(x) === false || Number.isFinite(y) === false) {
    throw new Error("point.x and point.y must be finite numbers");
  }
  return {
    x,
    y,
    ...(typeof point.reason === "string" && point.reason.trim().length > 0
      ? { reason: point.reason.trim() }
      : {})
  };
};

export const readOptionalLumenPoint = (payload: Record<string, unknown>) => {
  if (payload.point !== undefined) {
    return readLumenPoint(payload);
  }
  const x = payload.x;
  const y = payload.y;
  if (x === undefined && y === undefined) {
    return undefined;
  }
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
  ) {
    throw new Error("x and y must be finite numbers when point is omitted");
  }
  return {
    x,
    y,
    ...(typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? { reason: payload.reason.trim() }
      : {})
  };
};

export const readOptionalLumenToPoint = (payload: Record<string, unknown>) => {
  if (payload.to === undefined) {
    return undefined;
  }
  if (!isRecord(payload.to)) {
    throw new Error("to must be an object with numeric x and y");
  }
  return readLumenPoint({ point: payload.to });
};

export const withLumenTargetIds = <T extends Record<string, unknown>>(
  result: T,
  tabId: string,
  elementId?: number
) => {
  const observationId =
    typeof result.observationId === "string"
      ? result.observationId
      : typeof result.afterObservationId === "string"
        ? result.afterObservationId
        : undefined;
  const resolvedElementId =
    elementId
    ?? (typeof result.elementId === "number" && Number.isFinite(result.elementId)
      ? Math.round(result.elementId)
      : undefined);
  const resolvedTargetRef =
    typeof result.targetRef === "string" && result.targetRef.length > 0
      ? result.targetRef
      : undefined;
  const followSessionId =
    typeof result.sessionId === "string" && result.sessionId.length > 0
      ? result.sessionId
      : undefined;
  return {
    ...result,
    workbenchTabId: tabId,
    browserTabId: tabId,
    ...(observationId === undefined ? {} : { lumenObservationId: observationId }),
    ...(resolvedElementId === undefined ? {} : { lumenElementId: resolvedElementId }),
    ...(resolvedTargetRef === undefined ? {} : { lumenTargetRef: resolvedTargetRef }),
    ...(followSessionId === undefined ? {} : { followSessionId })
  };
};

export const createLumenMapObservationCache = () => {
  const observations = new Map<string, WorkbenchBrowserAgentObservation>();
  return {
    compact: (key: string, observation: WorkbenchBrowserAgentObservation) => {
      const compacted = compactMapObservation(observations.get(key), observation);
      observations.set(key, compacted.observation);
      return compacted;
    }
  };
};
