import {
  applyResponseBodyBudget,
  buildBrowserDiagnosticsSummary,
  createCdpNetworkRequestState,
  filterBrowserDiagnostics,
  normalizeCdpConsoleApiCalled,
  normalizeCdpLogEntryAdded,
  normalizeCdpNetworkLoadingFailed,
  normalizeCdpNetworkResponseReceived,
  normalizeCdpPageEvent,
  normalizeCdpRuntimeExceptionThrown,
  normalizePerformanceSnapshot,
  recommendBrowserDiagnosticAction,
  type BrowserDiagnosticEntry,
  type BrowserDiagnosticsFilter,
  type CdpNetworkRequestState
} from "@lyra/browser-automation";
import type {
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageDiagnosticsResult
} from "../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserDebuggerEvent,
  WorkbenchBrowserDebuggerSession
} from "./types";

type CdpAuditSessionAvailability = {
  readonly available: boolean;
  readonly unavailableReason?: string;
};

export type CdpAuditSessionReadRequest = BrowserDiagnosticsFilter & {
  readonly includeResponseBody?: boolean;
  readonly responseBodyMaxBytes?: number;
};

export type CdpAuditSessionSnapshot = CdpAuditSessionAvailability & {
  readonly entries: readonly WorkbenchBrowserPageDiagnosticEntry[];
  readonly summary: WorkbenchBrowserPageDiagnosticsResult["summary"];
  readonly recommendedNextAction: string;
  readonly evidenceRefs: readonly string[];
};

export type CdpAuditSession = {
  readonly start: () => Promise<CdpAuditSessionAvailability>;
  readonly readDiagnostics: (
    request?: CdpAuditSessionReadRequest
  ) => Promise<CdpAuditSessionSnapshot>;
  readonly dispose: () => Promise<void>;
  readonly isAvailable: () => CdpAuditSessionAvailability;
};

type CreateCdpAuditSessionOptions = {
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly acquireDebugger: () => Promise<WorkbenchBrowserDebuggerSession>;
  readonly onDiagnostic: (entry: WorkbenchBrowserPageDiagnosticEntry) => void;
  readonly onFileChooserOpened?: () => void;
  readonly onFileChooserClosed?: () => void;
  readonly maxBufferedEntries?: number;
  readonly responseBodyMaxBytes?: number;
};

const CDP_ENABLE_COMMANDS: readonly {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}[] = [
  { method: "Runtime.enable" },
  { method: "Log.enable" },
  {
    method: "Network.enable",
    params: {
      maxResourceBufferSize: 2 * 1024 * 1024,
      maxTotalBufferSize: 16 * 1024 * 1024
    }
  },
  { method: "Page.enable" },
  { method: "DOM.enable" },
  { method: "Accessibility.enable" },
  { method: "Performance.enable" }
];

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const epochMsFromTimestamp = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const createDiagnosticId = (
  tabId: string,
  source: BrowserDiagnosticEntry["source"]
): string =>
  `diag-${source}-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toWorkbenchDiagnostic = (
  tabId: string,
  entry: BrowserDiagnosticEntry
): WorkbenchBrowserPageDiagnosticEntry => {
  const id = entry.id ?? createDiagnosticId(tabId, entry.source);
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const at = entry.at ?? epochMsFromTimestamp(timestamp);
  const evidenceRef =
    entry.evidenceRef
    ?? (entry.stackTruncated === true || entry.responseBodyTruncated === true ? id : undefined);
  return {
    id,
    at,
    source: entry.source,
    severity: entry.severity,
    message: entry.message,
    timestamp,
    ...(entry.stack === undefined ? {} : { stack: entry.stack }),
    ...(entry.stackTruncated === undefined ? {} : { stackTruncated: entry.stackTruncated }),
    ...(entry.stackFrameCount === undefined ? {} : { stackFrameCount: entry.stackFrameCount }),
    ...(entry.url === undefined ? {} : { url: entry.url }),
    ...(entry.line === undefined ? {} : { line: entry.line }),
    ...(entry.column === undefined ? {} : { column: entry.column }),
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    ...(entry.method === undefined ? {} : { method: entry.method }),
    ...(entry.domain === undefined ? {} : { domain: entry.domain }),
    ...(entry.path === undefined ? {} : { path: entry.path }),
    ...(entry.status === undefined ? {} : { status: entry.status }),
    ...(entry.statusText === undefined ? {} : { statusText: entry.statusText }),
    ...(entry.failureKind === undefined ? {} : { failureKind: entry.failureKind }),
    ...(entry.errorText === undefined ? {} : { errorText: entry.errorText }),
    ...(entry.blockedReason === undefined ? {} : { blockedReason: entry.blockedReason }),
    ...(entry.requestHeaders === undefined ? {} : { requestHeaders: entry.requestHeaders }),
    ...(entry.responseHeaders === undefined ? {} : { responseHeaders: entry.responseHeaders }),
    ...(entry.responseBody === undefined ? {} : { responseBody: entry.responseBody }),
    ...(entry.responseBodyBase64Encoded === undefined
      ? {}
      : { responseBodyBase64Encoded: entry.responseBodyBase64Encoded }),
    ...(entry.responseBodyTruncated === undefined
      ? {}
      : { responseBodyTruncated: entry.responseBodyTruncated }),
    ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
    ...(entry.resourceType === undefined ? {} : { resourceType: entry.resourceType }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(evidenceRef === undefined ? {} : { evidenceRef })
  };
};

const createRuntimePerformanceExpression = (): string => `
(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const navigation = nav ? {
    domContentLoadedMs: Math.max(0, Math.round(nav.domContentLoadedEventEnd - nav.startTime)),
    loadMs: Math.max(0, Math.round(nav.loadEventEnd - nav.startTime)),
    resourceCount: performance.getEntriesByType("resource").length
  } : {
    resourceCount: performance.getEntriesByType("resource").length
  };
  const longTasks = typeof performance.getEntriesByType === "function"
    ? performance.getEntriesByType("longtask").slice(-20).map((task) => ({
        name: task.name,
        startTime: Math.round(task.startTime),
        duration: Math.round(task.duration)
      }))
    : [];
  return { navigation, longTasks };
})()
`;

export const createCdpAuditSession = ({
  tabId,
  targetMode,
  acquireDebugger,
  onDiagnostic,
  onFileChooserOpened,
  onFileChooserClosed,
  maxBufferedEntries = 300,
  responseBodyMaxBytes = 16 * 1024
}: CreateCdpAuditSessionOptions): CdpAuditSession => {
  const entries: WorkbenchBrowserPageDiagnosticEntry[] = [];
  const requests = new Map<string, CdpNetworkRequestState>();
  const responseDiagnostics = new Map<string, string>();
  let session: WorkbenchBrowserDebuggerSession | null = null;
  let unsubscribe: (() => void) | null = null;
  let startPromise: Promise<CdpAuditSessionAvailability> | null = null;
  let disposed = false;
  let available = false;
  let unavailableReason: string | undefined;

  const trimEntries = (): void => {
    if (entries.length > maxBufferedEntries) {
      entries.splice(0, entries.length - maxBufferedEntries);
    }
  };

  const upsertDiagnostic = (entry: WorkbenchBrowserPageDiagnosticEntry): void => {
    const existingIndex = entries.findIndex((item) => item.id === entry.id);
    if (existingIndex >= 0) {
      entries[existingIndex] = entry;
    } else {
      entries.push(entry);
      trimEntries();
    }
    onDiagnostic(entry);
  };

  const emitDiagnostic = (entry: BrowserDiagnosticEntry): WorkbenchBrowserPageDiagnosticEntry => {
    const diagnostic = toWorkbenchDiagnostic(tabId, entry);
    upsertDiagnostic(diagnostic);
    return diagnostic;
  };

  const emitSessionWarning = (message: string): void => {
    emitDiagnostic({
      source: "runtime",
      severity: "warning",
      message,
      timestamp: new Date().toISOString()
    });
  };

  const enrichResponseBody = async (requestId: string): Promise<void> => {
    if (session === null || disposed) {
      return;
    }
    const diagnosticId = responseDiagnostics.get(requestId);
    if (diagnosticId === undefined) {
      return;
    }
    const diagnostic = entries.find((entry) => entry.id === diagnosticId);
    if (diagnostic === undefined || diagnostic.responseBody !== undefined) {
      return;
    }
    try {
      const response = await session.sendCommand("Network.getResponseBody", { requestId });
      const patch = applyResponseBodyBudget(
        response.body,
        response.base64Encoded,
        responseBodyMaxBytes
      );
      if (patch.responseBody === undefined) {
        return;
      }
      upsertDiagnostic({
        ...diagnostic,
        ...patch,
        evidenceRef: diagnostic.evidenceRef ?? diagnostic.id
      });
    } catch {
      // Some responses are not retained by Chromium; headers/status remain useful.
    }
  };

  const handleMessage = (event: WorkbenchBrowserDebuggerEvent): void => {
    if (event.kind === "detached") {
      available = false;
      unavailableReason = `CDP debugger detached: ${event.reason || "unknown reason"}`;
      session = null;
      unsubscribe?.();
      unsubscribe = null;
      return;
    }

    switch (event.method) {
      case "Runtime.exceptionThrown": {
        const diagnostic = normalizeCdpRuntimeExceptionThrown(event.params);
        if (diagnostic !== null) {
          emitDiagnostic(diagnostic);
        }
        break;
      }
      case "Runtime.consoleAPICalled": {
        const diagnostic = normalizeCdpConsoleApiCalled(event.params);
        if (diagnostic !== null) {
          emitDiagnostic(diagnostic);
        }
        break;
      }
      case "Log.entryAdded": {
        const diagnostic = normalizeCdpLogEntryAdded(event.params);
        if (diagnostic !== null) {
          emitDiagnostic(diagnostic);
        }
        break;
      }
      case "Network.requestWillBeSent": {
        const request = createCdpNetworkRequestState(event.params);
        if (request !== null) {
          requests.set(request.requestId, request);
        }
        break;
      }
      case "Network.responseReceived": {
        const requestId = isRecord(event.params) && typeof event.params.requestId === "string"
          ? event.params.requestId
          : undefined;
        const diagnostic = normalizeCdpNetworkResponseReceived(
          event.params,
          requestId === undefined ? undefined : requests.get(requestId)
        );
        if (diagnostic !== null) {
          const emitted = emitDiagnostic(diagnostic);
          if (requestId !== undefined) {
            responseDiagnostics.set(requestId, emitted.id);
          }
        }
        break;
      }
      case "Network.loadingFailed": {
        const requestId = isRecord(event.params) && typeof event.params.requestId === "string"
          ? event.params.requestId
          : undefined;
        const diagnostic = normalizeCdpNetworkLoadingFailed(
          event.params,
          requestId === undefined ? undefined : requests.get(requestId)
        );
        if (diagnostic !== null) {
          emitDiagnostic(diagnostic);
        }
        if (requestId !== undefined) {
          requests.delete(requestId);
          responseDiagnostics.delete(requestId);
        }
        break;
      }
      case "Network.loadingFinished": {
        const requestId = isRecord(event.params) && typeof event.params.requestId === "string"
          ? event.params.requestId
          : undefined;
        if (requestId !== undefined) {
          void enrichResponseBody(requestId).finally(() => {
            requests.delete(requestId);
            responseDiagnostics.delete(requestId);
          });
        }
        break;
      }
      case "Page.domContentEventFired":
      case "Page.loadEventFired": {
        const diagnostic = normalizeCdpPageEvent(event.method, event.params);
        if (diagnostic !== null) {
          emitDiagnostic(diagnostic);
        }
        break;
      }
      case "Page.fileChooserOpened": {
        onFileChooserOpened?.();
        break;
      }
      case "Page.frameNavigated": {
        onFileChooserClosed?.();
        break;
      }
      case "Inspector.targetCrashed": {
        emitDiagnostic({
          source: "page",
          severity: "error",
          message: "Chromium reported that the inspected page target crashed.",
          timestamp: new Date().toISOString()
        });
        break;
      }
      default:
        break;
    }
  };

  const collectRuntimePerformanceSnapshot = async (): Promise<void> => {
    if (session === null || disposed) {
      return;
    }
    try {
      const response = await session.sendCommand("Runtime.evaluate", {
        expression: createRuntimePerformanceExpression(),
        returnByValue: true,
        awaitPromise: true
      });
      const result = isRecord(response.result) ? response.result : null;
      const diagnostics = normalizePerformanceSnapshot(result?.value);
      for (const diagnostic of diagnostics) {
        emitDiagnostic(diagnostic);
      }
    } catch (error) {
      emitSessionWarning(`Performance diagnostics unavailable: ${toErrorMessage(error)}`);
    }
  };

  const start = async (): Promise<CdpAuditSessionAvailability> => {
    if (disposed) {
      return {
        available: false,
        unavailableReason: "CDP audit session was disposed."
      };
    }
    if (session !== null) {
      return available
        ? { available: true }
        : unavailableReason === undefined
          ? { available: false }
          : { available: false, unavailableReason };
    }
    if (startPromise !== null) {
      return await startPromise;
    }
    startPromise = (async () => {
      try {
        session = await acquireDebugger();
        unsubscribe = session.subscribe(handleMessage);
        for (const command of CDP_ENABLE_COMMANDS) {
          try {
            await session.sendCommand(command.method, command.params ?? {});
          } catch (error) {
            emitSessionWarning(
              `CDP domain ${command.method.replace(".enable", "")} unavailable: ${toErrorMessage(error)}`
            );
          }
        }
        try {
          await session.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
        } catch (error) {
          emitSessionWarning(
            `CDP file chooser interception unavailable: ${toErrorMessage(error)}`
          );
        }
        available = true;
        unavailableReason = undefined;
        return { available: true };
      } catch (error) {
        session = null;
        available = false;
        unavailableReason = `CDP debugger unavailable for ${targetMode} tab ${tabId}: ${toErrorMessage(error)}`;
        return {
          available: false,
          unavailableReason
        };
      } finally {
        startPromise = null;
      }
    })();
    return await startPromise;
  };

  const readDiagnostics = async (
    request: CdpAuditSessionReadRequest = {}
  ): Promise<CdpAuditSessionSnapshot> => {
    const availability = await start();
    if (availability.available) {
      await collectRuntimePerformanceSnapshot();
    }
    const filtered = filterBrowserDiagnostics(entries, request);
    const summary = buildBrowserDiagnosticsSummary(filtered);
    const evidenceRefs = filtered
      .filter((entry) =>
        entry.severity === "error"
        || entry.stackTruncated === true
        || entry.responseBody !== undefined
      )
      .map((entry) => entry.evidenceRef ?? entry.id)
      .slice(0, 40);
    return {
      ...availability,
      entries: filtered,
      summary,
      recommendedNextAction: recommendBrowserDiagnosticAction(summary, availability.available),
      evidenceRefs
    };
  };

  return {
    start,
    readDiagnostics,
    dispose: async () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      const activeSession = session;
      session = null;
      available = false;
      unavailableReason = "CDP audit session was disposed.";
      requests.clear();
      responseDiagnostics.clear();
      if (activeSession !== null) {
        await activeSession.close();
      }
    },
    isAvailable: () =>
      available
        ? { available: true }
        : unavailableReason === undefined
          ? { available: false }
          : { available: false, unavailableReason }
  };
};
