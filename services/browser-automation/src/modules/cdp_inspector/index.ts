export type BrowserDiagnosticSeverity = "info" | "warning" | "error";

export type BrowserDiagnosticSource =
  | "console"
  | "network"
  | "navigation"
  | "runtime"
  | "log"
  | "performance"
  | "page";

export type BrowserNetworkFailureKind =
  | "http"
  | "cors"
  | "blockedByClient"
  | "blocked"
  | "mixedContent"
  | "dns"
  | "tls"
  | "network"
  | "failed";

export type BrowserDiagnosticHeaderMap = Readonly<Record<string, string>>;

export type BrowserDiagnosticEntry = {
  readonly id?: string;
  readonly at?: number;
  readonly source: BrowserDiagnosticSource;
  readonly severity: BrowserDiagnosticSeverity;
  readonly message: string;
  readonly timestamp?: string;
  readonly stack?: string;
  readonly stackTruncated?: boolean;
  readonly stackFrameCount?: number;
  readonly url?: string;
  readonly line?: number;
  readonly column?: number;
  readonly requestId?: string;
  readonly method?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly failureKind?: BrowserNetworkFailureKind;
  readonly errorText?: string;
  readonly blockedReason?: string;
  readonly requestHeaders?: BrowserDiagnosticHeaderMap;
  readonly responseHeaders?: BrowserDiagnosticHeaderMap;
  readonly responseBody?: string;
  readonly responseBodyBase64Encoded?: boolean;
  readonly responseBodyTruncated?: boolean;
  readonly mimeType?: string;
  readonly resourceType?: string;
  readonly durationMs?: number;
  readonly evidenceRef?: string;
};

export type BrowserDiagnosticsFilter = {
  readonly includeConsole?: boolean;
  readonly includeNetwork?: boolean;
  readonly includeRuntime?: boolean;
  readonly severity?: BrowserDiagnosticSeverity | readonly BrowserDiagnosticSeverity[];
  readonly since?: string | number;
  readonly maxEntries?: number;
  readonly domain?: string;
  readonly path?: string;
  readonly status?: number;
  readonly method?: string;
};

export type BrowserDiagnosticsSummary = {
  readonly errors: number;
  readonly warnings: number;
  readonly networkFailures: number;
  readonly consoleErrors: number;
  readonly runtimeExceptions: number;
  readonly httpFailures: number;
  readonly corsFailures: number;
  readonly blockedRequests: number;
  readonly pageEvents: number;
};

export type CdpSnapshot = {
  readonly available: boolean;
  readonly domNodes?: number;
  readonly consoleErrors?: number;
  readonly consoleWarnings?: number;
  readonly networkFailures?: number;
  readonly capturedAt: string;
  readonly unavailableReason?: string;
};

export type CdpInspectorSource = {
  readonly countDomNodes: () => Promise<number> | number;
  readonly readConsoleEntries?: () => Promise<readonly { readonly level: string }[]> | readonly { readonly level: string }[];
  readonly readNetworkFailures?: () => Promise<readonly unknown[]> | readonly unknown[];
};

export type CdpStackFormatOptions = {
  readonly maxFrames?: number;
  readonly maxChars?: number;
};

export type CdpNetworkRequestState = {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly domain?: string;
  readonly path?: string;
  readonly documentUrl?: string;
  readonly requestHeaders?: BrowserDiagnosticHeaderMap;
  readonly timestamp: string;
};

const DEFAULT_STACK_MAX_FRAMES = 12;
const DEFAULT_STACK_MAX_CHARS = 3_600;
const DEFAULT_RESPONSE_BODY_MAX_BYTES = 16 * 1024;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const normalizeLineNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }
  return Math.max(1, Math.round(value) + 1);
};

const normalizeColumnNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }
  return Math.max(1, Math.round(value) + 1);
};

const cdpTimestampToEpochMs = (value: unknown): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return Date.now();
  }
  if (value > 10_000_000_000) {
    return Math.round(value);
  }
  if (value > 1_000_000_000) {
    return Math.round(value * 1000);
  }
  return Date.now();
};

export const diagnosticTimestamp = (value?: unknown): string =>
  new Date(cdpTimestampToEpochMs(value)).toISOString();

const normalizeHeaderValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  return String(value);
};

export const redactHeaders = (
  headers: unknown,
  redaction = "[redacted]"
): BrowserDiagnosticHeaderMap | undefined => {
  if (headers === undefined || headers === null) {
    return undefined;
  }
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      entries.push([key, SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? redaction : value]);
    });
  } else if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      entries.push([
        key,
        SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
          ? redaction
          : normalizeHeaderValue(value)
      ]);
    }
  } else if (Array.isArray(headers)) {
    for (const item of headers) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        entries.push([
          key,
          SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
            ? redaction
            : normalizeHeaderValue(item[1])
        ]);
      }
    }
  }
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
};

const firstCallFrame = (stackTrace: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(stackTrace) || Array.isArray(stackTrace.callFrames) === false) {
    return undefined;
  }
  return stackTrace.callFrames.find(isRecord);
};

const stackFrames = (stackTrace: unknown): readonly Record<string, unknown>[] => {
  const frames: Record<string, unknown>[] = [];
  const visit = (trace: unknown): void => {
    if (!isRecord(trace)) {
      return;
    }
    if (Array.isArray(trace.callFrames)) {
      frames.push(...trace.callFrames.filter(isRecord));
    }
    if (isRecord(trace.parent)) {
      visit(trace.parent);
    }
    if (Array.isArray(trace.parentId)) {
      return;
    }
  };
  visit(stackTrace);
  return frames;
};

export const formatCdpStackTrace = (
  stackTrace: unknown,
  options: CdpStackFormatOptions = {}
): {
  readonly stack?: string;
  readonly stackTruncated?: boolean;
  readonly stackFrameCount?: number;
} => {
  const frames = stackFrames(stackTrace);
  if (frames.length === 0) {
    return {};
  }
  const maxFrames = Math.max(1, Math.min(80, Math.round(options.maxFrames ?? DEFAULT_STACK_MAX_FRAMES)));
  const maxChars = Math.max(240, Math.min(80_000, Math.round(options.maxChars ?? DEFAULT_STACK_MAX_CHARS)));
  const lines = frames.slice(0, maxFrames).map((frame) => {
    const functionName = readString(frame, "functionName") ?? "<anonymous>";
    const url = readString(frame, "url") ?? "";
    const line = normalizeLineNumber(frame.lineNumber) ?? 0;
    const column = normalizeColumnNumber(frame.columnNumber) ?? 0;
    const location = url.length > 0 ? `${url}:${line}:${column}` : `${line}:${column}`;
    return `at ${functionName} (${location})`;
  });
  const frameTruncated = frames.length > maxFrames;
  let stack = lines.join("\n");
  let charTruncated = false;
  if (stack.length > maxChars) {
    stack = `${stack.slice(0, maxChars - 15).trimEnd()}\n...[truncated]`;
    charTruncated = true;
  } else if (frameTruncated) {
    stack = `${stack}\n...${frames.length - maxFrames} more frame${frames.length - maxFrames === 1 ? "" : "s"}`;
  }
  return {
    stack,
    stackFrameCount: frames.length,
    ...((frameTruncated || charTruncated) ? { stackTruncated: true } : {})
  };
};

const formatRemoteObject = (value: unknown): string => {
  if (!isRecord(value)) {
    return String(value);
  }
  if (typeof value.value === "string") {
    return value.value;
  }
  if (value.value !== undefined) {
    return String(value.value);
  }
  if (typeof value.unserializableValue === "string") {
    return value.unserializableValue;
  }
  if (typeof value.description === "string") {
    return value.description;
  }
  const type = readString(value, "type") ?? "object";
  const subtype = readString(value, "subtype");
  return subtype === undefined ? type : `${subtype} ${type}`;
};

const severityForConsoleType = (type: string): BrowserDiagnosticSeverity => {
  const normalized = type.toLowerCase();
  if (normalized === "error" || normalized === "assert") {
    return "error";
  }
  if (normalized === "warning" || normalized === "warn") {
    return "warning";
  }
  return "info";
};

const severityForLogLevel = (level: string): BrowserDiagnosticSeverity => {
  const normalized = level.toLowerCase();
  if (normalized === "error" || normalized === "fatal") {
    return "error";
  }
  if (normalized === "warning" || normalized === "warn") {
    return "warning";
  }
  return "info";
};

export const normalizeCdpConsoleApiCalled = (
  params: unknown,
  options: CdpStackFormatOptions = {}
): BrowserDiagnosticEntry | null => {
  if (!isRecord(params)) {
    return null;
  }
  const type = readString(params, "type") ?? "log";
  const args = Array.isArray(params.args) ? params.args : [];
  const message = args.map(formatRemoteObject).join(" ").trim() || type;
  const stack = formatCdpStackTrace(params.stackTrace, options);
  const frame = firstCallFrame(params.stackTrace);
  const url = frame === undefined ? undefined : readString(frame, "url");
  const line = frame === undefined ? undefined : normalizeLineNumber(frame.lineNumber);
  const column = frame === undefined ? undefined : normalizeColumnNumber(frame.columnNumber);
  return {
    source: "console",
    severity: severityForConsoleType(type),
    message,
    timestamp: diagnosticTimestamp(params.timestamp),
    ...stack,
    ...(url === undefined ? {} : { url }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column })
  };
};

export const normalizeCdpRuntimeExceptionThrown = (
  params: unknown,
  options: CdpStackFormatOptions = {}
): BrowserDiagnosticEntry | null => {
  if (!isRecord(params) || !isRecord(params.exceptionDetails)) {
    return null;
  }
  const details = params.exceptionDetails;
  const exception = isRecord(details.exception) ? details.exception : {};
  const description = readString(exception, "description");
  const valueMessage = exception.value === undefined ? undefined : String(exception.value);
  const text = readString(details, "text") ?? "Runtime exception";
  const message = description ?? valueMessage ?? text;
  const stack = formatCdpStackTrace(details.stackTrace, options);
  const url = readString(details, "url");
  const line = normalizeLineNumber(details.lineNumber);
  const column = normalizeColumnNumber(details.columnNumber);
  return {
    source: "runtime",
    severity: "error",
    message,
    timestamp: diagnosticTimestamp(params.timestamp),
    ...stack,
    ...(url === undefined ? {} : { url }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column })
  };
};

export const normalizeCdpLogEntryAdded = (
  params: unknown,
  options: CdpStackFormatOptions = {}
): BrowserDiagnosticEntry | null => {
  if (!isRecord(params) || !isRecord(params.entry)) {
    return null;
  }
  const entry = params.entry;
  const level = readString(entry, "level") ?? "info";
  const message = readString(entry, "text") ?? "Log entry";
  const stack = formatCdpStackTrace(entry.stackTrace, options);
  const url = readString(entry, "url");
  const line = normalizeLineNumber(entry.lineNumber);
  const requestId = readString(entry, "networkRequestId");
  return {
    source: "log",
    severity: severityForLogLevel(level),
    message,
    timestamp: diagnosticTimestamp(entry.timestamp),
    ...stack,
    ...(url === undefined ? {} : { url }),
    ...(line === undefined ? {} : { line }),
    ...(requestId === undefined ? {} : { requestId })
  };
};

const partsForUrl = (url: string): { readonly domain?: string; readonly path?: string } => {
  try {
    const parsed = new URL(url);
    return {
      domain: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`
    };
  } catch {
    return {};
  }
};

export const createCdpNetworkRequestState = (
  params: unknown
): CdpNetworkRequestState | null => {
  if (!isRecord(params) || !isRecord(params.request)) {
    return null;
  }
  const requestId = readString(params, "requestId");
  const url = readString(params.request, "url");
  if (requestId === undefined || url === undefined) {
    return null;
  }
  const method = readString(params.request, "method") ?? "GET";
  const urlParts = partsForUrl(url);
  return {
    requestId,
    url,
    method: method.toUpperCase(),
    ...urlParts,
    ...(readString(params, "documentURL") === undefined
      ? {}
      : { documentUrl: readString(params, "documentURL")! }),
    ...(redactHeaders(params.request.headers) === undefined
      ? {}
      : { requestHeaders: redactHeaders(params.request.headers)! }),
    timestamp: diagnosticTimestamp(params.wallTime)
  };
};

export const classifyNetworkFailure = (
  input: {
    readonly status?: number;
    readonly errorText?: string;
    readonly blockedReason?: string;
    readonly corsErrorStatus?: unknown;
  }
): BrowserNetworkFailureKind => {
  if (typeof input.status === "number" && input.status >= 400) {
    return "http";
  }
  const blockedReason = input.blockedReason?.toLowerCase();
  const text = input.errorText?.toLowerCase() ?? "";
  if (input.corsErrorStatus !== undefined || text.includes("cors")) {
    return "cors";
  }
  if (blockedReason?.includes("mixed") === true || text.includes("mixed content")) {
    return "mixedContent";
  }
  if (blockedReason !== undefined) {
    return blockedReason.includes("client") ? "blockedByClient" : "blocked";
  }
  if (text.includes("err_blocked_by_client")) {
    return "blockedByClient";
  }
  if (text.includes("name_not_resolved") || text.includes("dns")) {
    return "dns";
  }
  if (
    text.includes("cert")
    || text.includes("ssl")
    || text.includes("tls")
    || text.includes("bad_ssl")
  ) {
    return "tls";
  }
  if (
    text.includes("connection")
    || text.includes("timed_out")
    || text.includes("timeout")
    || text.includes("network")
  ) {
    return "network";
  }
  return "failed";
};

export const normalizeCdpNetworkResponseReceived = (
  params: unknown,
  request: CdpNetworkRequestState | undefined,
  options: {
    readonly includeHeaders?: boolean;
  } = {}
): BrowserDiagnosticEntry | null => {
  if (!isRecord(params) || !isRecord(params.response)) {
    return null;
  }
  const response = params.response;
  const status = readNumber(response, "status");
  if (status === undefined || status < 400) {
    return null;
  }
  const url = readString(response, "url") ?? request?.url;
  const method = request?.method;
  const requestId = readString(params, "requestId") ?? request?.requestId;
  const statusText = readString(response, "statusText");
  const urlParts = url === undefined ? {} : partsForUrl(url);
  const failureKind = classifyNetworkFailure({ status });
  return {
    source: "network",
    severity: "error",
    message:
      `HTTP ${status}${statusText === undefined || statusText.length === 0 ? "" : ` ${statusText}`}` +
      `${method === undefined ? "" : ` for ${method}`}` +
      `${url === undefined ? "" : ` ${url}`}`,
    timestamp: diagnosticTimestamp(params.timestamp),
    status,
    failureKind,
    ...(statusText === undefined ? {} : { statusText }),
    ...(url === undefined ? {} : { url }),
    ...urlParts,
    ...(requestId === undefined ? {} : { requestId }),
    ...(method === undefined ? {} : { method }),
    ...(readString(params, "type") === undefined ? {} : { resourceType: readString(params, "type")! }),
    ...(readString(response, "mimeType") === undefined ? {} : { mimeType: readString(response, "mimeType")! }),
    ...(options.includeHeaders === false || request?.requestHeaders === undefined
      ? {}
      : { requestHeaders: request.requestHeaders }),
    ...(options.includeHeaders === false || redactHeaders(response.headers) === undefined
      ? {}
      : { responseHeaders: redactHeaders(response.headers)! })
  };
};

export const normalizeCdpNetworkLoadingFailed = (
  params: unknown,
  request: CdpNetworkRequestState | undefined,
  options: {
    readonly includeHeaders?: boolean;
  } = {}
): BrowserDiagnosticEntry | null => {
  if (!isRecord(params)) {
    return null;
  }
  const requestId = readString(params, "requestId") ?? request?.requestId;
  const errorText = readString(params, "errorText") ?? "Network loading failed";
  const blockedReason = readString(params, "blockedReason");
  const failureKind = classifyNetworkFailure({
    errorText,
    ...(blockedReason === undefined ? {} : { blockedReason }),
    corsErrorStatus: params.corsErrorStatus
  });
  const url = request?.url;
  const method = request?.method;
  return {
    source: "network",
    severity: "error",
    message:
      `Network request failed${method === undefined ? "" : ` for ${method}`}` +
      `${url === undefined ? "" : ` ${url}`}: ${errorText}` +
      ` (${failureKind})`,
    timestamp: diagnosticTimestamp(params.timestamp),
    failureKind,
    errorText,
    ...(blockedReason === undefined ? {} : { blockedReason }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(url === undefined ? {} : { url }),
    ...(request?.domain === undefined ? {} : { domain: request.domain }),
    ...(request?.path === undefined ? {} : { path: request.path }),
    ...(method === undefined ? {} : { method }),
    ...(readString(params, "type") === undefined ? {} : { resourceType: readString(params, "type")! }),
    ...(options.includeHeaders === false || request?.requestHeaders === undefined
      ? {}
      : { requestHeaders: request.requestHeaders })
  };
};

export const applyResponseBodyBudget = (
  body: unknown,
  base64Encoded: unknown,
  maxBytes = DEFAULT_RESPONSE_BODY_MAX_BYTES
): Pick<
  BrowserDiagnosticEntry,
  "responseBody" | "responseBodyBase64Encoded" | "responseBodyTruncated"
> => {
  if (typeof body !== "string") {
    return {};
  }
  const byteLength =
    base64Encoded === true
      ? Math.ceil(body.length * 3 / 4)
      : new TextEncoder().encode(body).byteLength;
  const budget = Math.max(0, Math.min(2 * 1024 * 1024, Math.round(maxBytes)));
  if (byteLength <= budget) {
    return {
      responseBody: body,
      ...(base64Encoded === true ? { responseBodyBase64Encoded: true } : {})
    };
  }
  if (base64Encoded === true) {
    return {
      responseBody: body.slice(0, Math.max(0, budget)),
      responseBodyBase64Encoded: true,
      responseBodyTruncated: true
    };
  }
  return {
    responseBody: body.slice(0, Math.max(0, budget)),
    responseBodyTruncated: true
  };
};

export const normalizeCdpPageEvent = (
  method: string,
  params: unknown
): BrowserDiagnosticEntry | null => {
  if (method !== "Page.domContentEventFired" && method !== "Page.loadEventFired") {
    return null;
  }
  const timestamp = isRecord(params) ? params.timestamp : undefined;
  return {
    source: "performance",
    severity: "info",
    message:
      method === "Page.domContentEventFired"
        ? "DOMContentLoaded event fired."
        : "Page load event fired.",
    timestamp: diagnosticTimestamp(timestamp)
  };
};

export const normalizePerformanceSnapshot = (
  value: unknown
): readonly BrowserDiagnosticEntry[] => {
  if (!isRecord(value)) {
    return [];
  }
  const entries: BrowserDiagnosticEntry[] = [];
  const navigation = isRecord(value.navigation) ? value.navigation : null;
  if (navigation !== null) {
    const domContentLoadedMs = readNumber(navigation, "domContentLoadedMs");
    const loadMs = readNumber(navigation, "loadMs");
    const resourceCount = readNumber(navigation, "resourceCount");
    entries.push({
      source: "performance",
      severity: "info",
      message:
        `Performance timing: DOMContentLoaded=${domContentLoadedMs ?? "unknown"}ms, ` +
        `load=${loadMs ?? "unknown"}ms, resources=${resourceCount ?? "unknown"}.`,
      timestamp: new Date().toISOString(),
      ...(loadMs === undefined ? {} : { durationMs: loadMs })
    });
  }
  if (Array.isArray(value.longTasks)) {
    const longTasks = value.longTasks.filter(isRecord);
    if (longTasks.length > 0) {
      const totalDuration = longTasks.reduce(
        (sum, task) => sum + (readNumber(task, "duration") ?? 0),
        0
      );
      entries.push({
        source: "performance",
        severity: totalDuration >= 500 ? "warning" : "info",
        message:
          `Main thread long tasks: ${longTasks.length} task${longTasks.length === 1 ? "" : "s"}, ` +
          `${Math.round(totalDuration)}ms total blocking sample.`,
        timestamp: new Date().toISOString(),
        durationMs: Math.round(totalDuration)
      });
    }
  }
  return entries;
};

const severitySet = (
  severity: BrowserDiagnosticsFilter["severity"]
): ReadonlySet<BrowserDiagnosticSeverity> | null => {
  if (severity === undefined) {
    return null;
  }
  if (typeof severity === "string") {
    return new Set([severity]);
  }
  return new Set(severity);
};

const sinceMs = (since: BrowserDiagnosticsFilter["since"]): number | null => {
  if (since === undefined) {
    return null;
  }
  if (typeof since === "number" && Number.isFinite(since)) {
    return since;
  }
  if (typeof since === "string" && since.trim().length > 0) {
    const parsed = Date.parse(since);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const diagnosticEpochMs = (entry: BrowserDiagnosticEntry): number => {
  if (typeof entry.at === "number" && Number.isFinite(entry.at)) {
    return entry.at;
  }
  if (entry.timestamp === undefined) {
    return 0;
  }
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sourceEnabled = (
  source: BrowserDiagnosticSource,
  filter: BrowserDiagnosticsFilter
): boolean => {
  if (
    (source === "console" || source === "log")
    && filter.includeConsole === false
  ) {
    return false;
  }
  if (
    (source === "network" || source === "navigation")
    && filter.includeNetwork === false
  ) {
    return false;
  }
  if (
    (source === "runtime" || source === "performance" || source === "page")
    && filter.includeRuntime === false
  ) {
    return false;
  }
  return true;
};

export const filterBrowserDiagnostics = <T extends BrowserDiagnosticEntry>(
  entries: readonly T[],
  filter: BrowserDiagnosticsFilter = {}
): readonly T[] => {
  const severities = severitySet(filter.severity);
  const since = sinceMs(filter.since);
  const domain = filter.domain?.trim().toLowerCase();
  const path = filter.path?.trim();
  const method = filter.method?.trim().toUpperCase();
  const filtered = entries.filter((entry) => {
    if (!sourceEnabled(entry.source, filter)) {
      return false;
    }
    if (severities !== null && severities.has(entry.severity) === false) {
      return false;
    }
    if (since !== null && diagnosticEpochMs(entry) < since) {
      return false;
    }
    if (domain !== undefined) {
      const entryDomain = entry.domain?.toLowerCase() ?? "";
      if (entryDomain !== domain && entryDomain.endsWith(`.${domain}`) === false) {
        return false;
      }
    }
    if (path !== undefined && entry.path?.includes(path) !== true) {
      return false;
    }
    if (filter.status !== undefined && entry.status !== filter.status) {
      return false;
    }
    if (method !== undefined && entry.method !== method) {
      return false;
    }
    return true;
  });
  const maxEntries = Math.max(
    1,
    Math.min(500, Math.round(filter.maxEntries ?? (filtered.length || 1)))
  );
  return filtered.slice(-maxEntries);
};

export const buildBrowserDiagnosticsSummary = (
  entries: readonly BrowserDiagnosticEntry[]
): BrowserDiagnosticsSummary => ({
  errors: entries.filter((entry) => entry.severity === "error").length,
  warnings: entries.filter((entry) => entry.severity === "warning").length,
  networkFailures: entries.filter((entry) =>
    entry.source === "network" || entry.source === "navigation"
  ).length,
  consoleErrors: entries.filter((entry) =>
    entry.source === "console" && entry.severity === "error"
  ).length,
  runtimeExceptions: entries.filter((entry) =>
    entry.source === "runtime" && entry.severity === "error"
  ).length,
  httpFailures: entries.filter((entry) => entry.failureKind === "http").length,
  corsFailures: entries.filter((entry) => entry.failureKind === "cors").length,
  blockedRequests: entries.filter((entry) =>
    entry.failureKind === "blockedByClient" || entry.failureKind === "blocked"
  ).length,
  pageEvents: entries.filter((entry) =>
    entry.source === "performance" || entry.source === "page"
  ).length
});

export const recommendBrowserDiagnosticAction = (
  summary: BrowserDiagnosticsSummary,
  available = true
): string => {
  if (available === false) {
    return "Confirm that the browser tab is still alive, then rerun lyra_lumen_audit.";
  }
  if (summary.runtimeExceptions > 0 || summary.consoleErrors > 0) {
    return "Inspect the top runtime or console stack frame, then patch the failing client code.";
  }
  if (summary.corsFailures > 0) {
    return "Inspect the failed request headers and fix the server CORS policy or request origin.";
  }
  if (summary.httpFailures > 0) {
    return "Inspect the failed HTTP response body and repair the backend route or request payload.";
  }
  if (summary.networkFailures > 0) {
    return "Inspect the network failure classification and retry after fixing connectivity or blocking.";
  }
  return "No blocking browser diagnostics were captured; continue with lyra_lumen_map or lyra_lumen_read.";
};

const isErrorLevel = (level: string): boolean => {
  const normalized = level.toLowerCase();
  return normalized === "error" || normalized === "exception" || normalized === "fatal";
};

const isWarningLevel = (level: string): boolean => {
  const normalized = level.toLowerCase();
  return normalized === "warning" || normalized === "warn";
};

export const captureCdpSnapshot = async (
  source?: CdpInspectorSource
): Promise<CdpSnapshot> => {
  if (source === undefined) {
    return {
      available: false,
      capturedAt: new Date().toISOString(),
      unavailableReason: "No CDP inspector source was provided."
    };
  }

  const [domNodes, consoleEntries, networkFailures] = await Promise.all([
    source.countDomNodes(),
    source.readConsoleEntries?.(),
    source.readNetworkFailures?.()
  ]);

  return {
    available: true,
    domNodes,
    ...(consoleEntries === undefined
      ? {}
      : {
          consoleErrors: consoleEntries.filter((entry) => isErrorLevel(entry.level)).length,
          consoleWarnings: consoleEntries.filter((entry) => isWarningLevel(entry.level)).length
        }),
    ...(networkFailures === undefined ? {} : { networkFailures: networkFailures.length }),
    capturedAt: new Date().toISOString()
  };
};
