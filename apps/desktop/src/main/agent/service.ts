import { ipcMain, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  LYRA_CHANNELS,
  type SoftwareCapabilitiesQueryRequest,
  type SoftwareCapabilitiesQueryResult,
  type WorkbenchBrowserClearSiteDataRequest,
  type WorkbenchBrowserStorageStateRequest
} from "../../shared/desktop-bridge";
import type {
  AgentClarificationRespondRequest,
  AgentGitDiffRequest,
  AgentGitDiffResponse,
  AgentGitFileRequest,
  AgentGitMutationResponse,
  AgentGitStatusRequest,
  AgentGitStatusSnapshot,
  AgentImageAttachmentMaterializeRequest,
  AgentImageAttachmentMaterializeResponse,
  AgentMemoryAuditResponse,
  AgentMemorySharedSearchRequest,
  AgentMemorySharedUpdateRequest,
  AgentMemorySnapshot,
  AgentMemoryTrimRunRequest,
  AgentPermissionRespondRequest,
  AgentRollbackPreviewResponse,
  AgentRollbackRequest,
  AgentRollbackRestoreResponse,
  AgentRuntimeEvent,
  AgentSelfDevStartRequest,
  AgentSelfDevStartResponse,
  AgentSelfDevStatusRequest,
  AgentSelfDevStatusResponse,
  AgentSessionArchiveRequest,
  AgentSessionBindProjectRequest,
  AgentSessionCreateRequest,
  AgentSessionDeleteRequest,
  AgentSessionDeleteResponse,
  AgentSessionReadRequest,
  AgentSessionRenameRequest,
  AgentSessionSaveRequest,
  AgentSessionSnapshot,
  AgentTurnCancelRequest,
  AgentTurnCancelResponse,
  AgentTurnSendRequest,
  AgentTurnSendResponse,
  AgentBrowserFollowModeSnapshot,
  AgentBrowserFollowModeUpdateRequest,
  AgentActionRunRequest,
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginRequest,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountRequest,
  AgentAccountsSnapshot,
  AgentAutomationUpdateRequest,
  AgentAutomationUpdateResponse,
  AgentBtwRunRequest,
  AgentCompactResponse,
  AgentFeedbackRunRequest,
  AgentConfigSnapshot,
  AgentConfigUpdateRequest,
  AgentRolesUpdateRequest,
  AgentGoalsRequest,
  AgentGoalsResponse,
  AgentLoginProviderCatalogSnapshot,
  AgentModelRefreshRequest,
  AgentModelCatalogRequest,
  AgentModelCatalogSnapshot,
  AgentModelSwitchRequest,
  AgentOvernightListResponse,
  AgentOvernightRunRequest,
  AgentOvernightRunResponse,
  AgentOvernightStartRequest,
  AgentOvernightStartResponse,
  AgentProviderOptionsUpdateRequest,
  AgentProviderProfileSaveRequest,
  AgentPokeRequest,
  AgentPokeResponse,
  AgentSessionActionRequest,
  AgentSessionForkResponse,
  AgentSessionSummary,
  AgentSessionListRequest,
  AgentSessionListResponse,
  AgentSidePanelActionResponse,
  AgentSubagentRunRequest,
  AgentSubagentRunResponse
} from "../../shared/agent";
import type {
  TerminalCreateRequest,
  TerminalReadResponse,
  TerminalSessionSnapshot,
  TerminalWriteRequest
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import {
  WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID,
  type WorkbenchBrowserAgentModeRequest,
  type WorkbenchBrowserAgentTargetMode
} from "../workbench-browser/types";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import type {
  WorkbenchObservedTabDescriptor,
  WorkbenchTerminalPaneDescriptor,
  WorkbenchTabExtractTextRequest,
  WorkbenchTabReadRequest,
  WorkbenchWorkspaceReadRequest
} from "../../shared/workbench-observation";

export type AgentIpcBridge = {
  readonly dispose: () => void;
};

const AGENT_RUNTIME_EVENT_NAME = "agent.runtime";

type PendingSoftwareCapabilityRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const createSoftwareCapabilityRequestId = (): string =>
  `software-capability-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const IMAGE_ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024;

const extensionForImageMediaType = (mediaType: string): string => {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    case "image/heic":
      return "heic";
    default:
      return "png";
  }
};

const safeImageAttachmentStem = (request: AgentImageAttachmentMaterializeRequest): string => {
  const seed = request.label ?? request.id ?? "agent-image";
  const sanitized = seed
    .replace(/\.[A-Za-z0-9]{1,12}$/u, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return sanitized.length === 0 ? "agent-image" : sanitized;
};

const materializeImageAttachment = (
  storageRoot: string,
  request: AgentImageAttachmentMaterializeRequest
): AgentImageAttachmentMaterializeResponse => {
  const mediaType = request.mediaType.trim().toLowerCase();
  if (!mediaType.startsWith("image/")) {
    throw new Error("Only image attachments can be materialized.");
  }

  const data = request.data.trim();
  if (data.length === 0) {
    throw new Error("Image attachment data is empty.");
  }

  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0 || buffer.length > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error("Image attachment size is invalid.");
  }

  const directory = join(storageRoot, "message-images");
  mkdirSync(directory, { recursive: true });
  const filePath = join(
    directory,
    `${Date.now()}-${randomUUID()}-${safeImageAttachmentStem(request)}.${extensionForImageMediaType(mediaType)}`
  );
  writeFileSync(filePath, buffer);
  return { path: filePath };
};

const materializeLumenCapture = (
  storageRoot: string,
  tabId: string,
  capture: {
    readonly mimeType: string;
    readonly imageBase64: string;
    readonly width: number;
    readonly height: number;
    readonly visibleOnly: boolean;
  }
) => {
  const mediaType = capture.mimeType.trim().toLowerCase();
  if (!mediaType.startsWith("image/")) {
    throw new Error("Lumen visual capture did not return an image.");
  }
  const buffer = Buffer.from(capture.imageBase64, "base64");
  if (buffer.length === 0 || buffer.length > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error("Lumen visual capture size is invalid.");
  }
  const directory = join(storageRoot, "lumen-evidence");
  mkdirSync(directory, { recursive: true });
  const artifactId = `lumen-see-${Date.now()}-${randomUUID()}`;
  const sanitizedTabId = tabId
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "browser";
  const filePath = join(
    directory,
    `${artifactId}-${sanitizedTabId}.${extensionForImageMediaType(mediaType)}`
  );
  writeFileSync(filePath, buffer);
  return {
    id: artifactId,
    kind: "image",
    mediaType,
    path: filePath,
    width: capture.width,
    height: capture.height,
    visibleOnly: capture.visibleOnly,
    sizeBytes: buffer.length,
    openTarget: {
      kind: "file",
      path: filePath
    }
  };
};

const createSoftwareCapabilityRendererClient = ({
  getWindow,
  timeoutMs = 5_000
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly timeoutMs?: number;
}) => {
  const pending = new Map<string, PendingSoftwareCapabilityRequest>();

  ipcMain.handle(
    LYRA_CHANNELS.softwareCapabilitiesQueryResult,
    (_event, result: SoftwareCapabilitiesQueryResult) => {
      const pendingRequest = pending.get(result.requestId);
      if (pendingRequest === undefined) {
        return null;
      }
      pending.delete(result.requestId);
      clearTimeout(pendingRequest.timer);
      if (result.ok) {
        pendingRequest.resolve(result.result);
      } else {
        pendingRequest.reject(
          new Error(result.error?.message ?? "software capability query failed")
        );
      }
      return null;
    }
  );

  const sendQuery = async (
    method: SoftwareCapabilitiesQueryRequest["method"],
    payload: object
  ): Promise<unknown> => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      throw new Error("Renderer window is unavailable for software capabilities.");
    }

    const requestId = createSoftwareCapabilityRequestId();
    const query = { requestId, method, payload } as SoftwareCapabilitiesQueryRequest;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Renderer software capability query timed out."));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
    });

    window.webContents.send(LYRA_CHANNELS.softwareCapabilitiesQuery, query);
    return await promise;
  };

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.softwareCapabilitiesQueryResult);
      for (const pendingRequest of pending.values()) {
        clearTimeout(pendingRequest.timer);
        pendingRequest.reject(new Error("Renderer software capability bridge disposed."));
      }
      pending.clear();
    },
    listCapabilities: async (payload: object) =>
      await sendQuery("software.listCapabilities", payload),
    inspectCapability: async (payload: object) =>
      await sendQuery("software.inspectCapability", payload),
    readState: async (payload: object) =>
      await sendQuery("software.readState", payload),
    invokeCapability: async (payload: object) =>
      await sendQuery("software.invokeCapability", payload)
  };
};

export const createAgentIpcBridge = ({
  runtimeClient,
  storageRoot,
  terminalBridge,
  getWindow,
  getBrowserBridge,
  getWorkbenchObservationService
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly terminalBridge: TerminalIpcBridge;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
}): AgentIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, payload);
  const softwareCapabilitiesClient = createSoftwareCapabilityRendererClient({ getWindow });
  let browserFollowModeEnabled = false;
  type TerminalTargetPreference = "auto" | "private" | "ui";
  type TerminalToolTarget = {
    readonly type: "private" | "ui";
    readonly sessionId: string;
    readonly terminalTabId?: string;
    readonly paneId?: string;
    readonly title?: string;
    readonly cwd?: string;
    readonly placement?: "dock" | "workspace";
  };
  type PrivateTerminalEntry = {
    readonly type: "private";
    readonly agentSessionId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly mode: "shell" | "command";
    readonly command?: string;
    readonly createdAt: string;
    lastUsedAt: string;
    cursor?: string;
  };
  const privateTerminalsByAgentSession = new Map<string, Map<string, PrivateTerminalEntry>>();
  const cursorByTerminalSessionId = new Map<string, string>();

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const event = payload as AgentRuntimeEvent;
    const browser = getBrowserBridge();
    if (browser !== null) {
      if (event.kind === "turnFinished") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: event.status === "cancelled" ? "cancelled" : "completed",
          reason: event.status
        });
      } else if (event.kind === "turnFailed") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: "failed",
          reason: event.message
        });
      } else if (event.kind === "turnInterrupted") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: "interrupted",
          reason: event.reason
        });
      }
    }
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, event);
  });

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  const normalizePayload = (payload: unknown): Record<string, unknown> =>
    isRecord(payload) ? payload : {};

  const readTabId = (payload: unknown): string | null => {
    const value = normalizePayload(payload).tabId;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };

  const resolveWorkbenchTabId = (
    requestedTabId: string,
    tabs: readonly WorkbenchObservedTabDescriptor[]
  ): string | null => {
    const exact = tabs.find((tab) => tab.tabId === requestedTabId);
    if (exact !== undefined) {
      return exact.tabId;
    }

    const suffix = `-${requestedTabId}`;
    const suffixMatches = tabs.filter((tab) => tab.tabId.endsWith(suffix));
    if (suffixMatches.length === 1) {
      return suffixMatches[0]?.tabId ?? null;
    }

    const browserTabId = `browser-tab-${requestedTabId}`;
    const browserMatch = tabs.find((tab) => tab.tabId === browserTabId);
    return browserMatch?.tabId ?? null;
  };

  const normalizeWorkbenchTabPayload = async (
    payload: unknown,
    service: WorkbenchObservationService
  ): Promise<Record<string, unknown>> => {
    const request = normalizePayload(payload);
    const requestedTabId = readTabId(request);
    if (requestedTabId === null) {
      return request;
    }
    const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
    const resolvedTabId = resolveWorkbenchTabId(requestedTabId, listed.tabs);
    return {
      ...request,
      tabId: resolvedTabId ?? requestedTabId
    };
  };

  const describeWorkbenchTabKind = (tab: WorkbenchObservedTabDescriptor): string =>
    tab.observationKind ?? tab.appId ?? tab.pageKind;

  const isBrowserPageTab = (tab: WorkbenchObservedTabDescriptor): boolean =>
    tab.pageKind === "page" || tab.observationKind === "page";

  const findActiveWorkbenchTab = (
    tabs: readonly WorkbenchObservedTabDescriptor[],
    activeTabId: string | null
  ): WorkbenchObservedTabDescriptor | null =>
    tabs.find((tab) => tab.tabId === activeTabId)
    ?? tabs.find((tab) => tab.active)
    ?? null;

  const createTabSummaryObservation = (
    tab: WorkbenchObservedTabDescriptor,
    reason: string
  ) => ({
    tab,
    observation: {
      kind: "tab-summary",
      title: tab.title,
      pageKind: tab.pageKind,
      ...(tab.appId === undefined ? {} : { appId: tab.appId }),
      active: tab.active,
      visible: tab.visible,
      focusedPane: tab.focusedPane,
      observable: tab.observable,
      reason
    }
  });

  class NonBrowserWorkbenchTabError extends Error {
    readonly tab: WorkbenchObservedTabDescriptor;

    constructor(tab: WorkbenchObservedTabDescriptor) {
      super(
        `Browser action requires a browser page tab. Use workbench.read_tab for ${describeWorkbenchTabKind(tab)} tabs.`
      );
      this.name = "NonBrowserWorkbenchTabError";
      this.tab = tab;
    }
  }

  class InvalidLumenElementIdError extends Error {
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

  const readWorkbenchTabWithSummaryFallback = async (
    payload: unknown
  ): Promise<unknown> => {
    const service = getWorkbenchObservationService();
    if (service === null) {
      throw new Error("Workbench observation capability is not available");
    }
    const request = await normalizeWorkbenchTabPayload(payload, service) as WorkbenchTabReadRequest;
    try {
      return await service.readTab(request);
    } catch (error) {
      const code =
        isRecord(error) && typeof error.code === "string" ? error.code : undefined;
      if (code !== "unsupported_tab_kind") {
        throw error;
      }
      const tabId = readTabId(request);
      if (tabId === null) {
        throw error;
      }
      const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
      const tab = listed.tabs.find((entry) => entry.tabId === tabId);
      if (tab === undefined) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return createTabSummaryObservation(tab, message);
    }
  };

  const resolveBrowserPageTabId = async (payload: unknown): Promise<string> => {
    const browser = getBrowserBridge();
    if (!browser) throw new Error("Browser capability is not available");

    const explicitTabId = readTabId(payload);
    const observationService = getWorkbenchObservationService();
    if (observationService !== null) {
      const listed = await observationService.listTabs({
        scope: "all",
        includeUnsupported: true
      });
      const activeWorkspaceTab = findActiveWorkbenchTab(listed.tabs, listed.activeTabId);
      const resolvedExplicitTabId =
        explicitTabId === null ? null : resolveWorkbenchTabId(explicitTabId, listed.tabs);
      const targetTab =
        explicitTabId === null
          ? activeWorkspaceTab
          : listed.tabs.find((tab) => tab.tabId === resolvedExplicitTabId) ?? null;
      if (targetTab !== null && !isBrowserPageTab(targetTab)) {
        throw new NonBrowserWorkbenchTabError(targetTab);
      }
      if (explicitTabId !== null && targetTab === null) {
        throw new Error(`Unknown Workbench tab: ${explicitTabId}`);
      }
      if (targetTab !== null) {
        return targetTab.tabId;
      }
    }

    return explicitTabId ?? browser.readActiveTabId() ?? "";
  };

  const resolveBrowserAgentTabId = async (
    payload: unknown,
    targetMode: "isolated" | "live"
  ): Promise<string> => {
    if (targetMode === "live" || readTabId(payload) !== null) {
      return await resolveBrowserPageTabId(payload);
    }
    try {
      const tabId = await resolveBrowserPageTabId(payload);
      return tabId.length > 0 ? tabId : WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID;
    } catch (error) {
      if (error instanceof NonBrowserWorkbenchTabError) {
        return WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID;
      }
      throw error;
    }
  };

  const workbenchHandlers: Record<string, (payload: unknown) => Promise<unknown> | unknown> = {
    "workbench.listTabs": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = normalizePayload(payload);
      return await service.listTabs({
        scope:
          request.scope === "visible" || request.scope === "active" || request.scope === "all"
            ? request.scope
            : "all",
        includeUnsupported: request.includeUnsupported !== false
      });
    },
    "workbench.readTab": readWorkbenchTabWithSummaryFallback,
    "workbench.activateTab": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = await normalizeWorkbenchTabPayload(payload, service);
      const tabId = readTabId(request);
      if (tabId === null) {
        throw new Error("tabId must be a non-empty string");
      }
      return await service.activateTab({ tabId });
    },
    "workbench.readWorkspace": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.readWorkspace(
        normalizePayload(payload) as WorkbenchWorkspaceReadRequest
      );
    },
    "workbench.extractTabText": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.extractTabText(
        await normalizeWorkbenchTabPayload(payload, service) as WorkbenchTabExtractTextRequest
      );
    }
  };

  const readNumberField = (payload: Record<string, unknown>, fieldName: string): number => {
    const value = payload[fieldName];
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(numberValue) === false) {
      throw new Error(`${fieldName} must be a finite number`);
    }
    return Math.round(numberValue);
  };

  const readOptionalNumberField = (
    payload: Record<string, unknown>,
    fieldName: string
  ): number | undefined => {
    if (payload[fieldName] === undefined) {
      return undefined;
    }
    return readNumberField(payload, fieldName);
  };

  const readStringField = (payload: Record<string, unknown>, fieldName: string): string => {
    const value = payload[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  };

  const readOptionalStringField = (
    payload: Record<string, unknown>,
    fieldName: string
  ): string | undefined => {
    if (payload[fieldName] === undefined) {
      return undefined;
    }
    return readStringField(payload, fieldName);
  };

  const readLumenAuditSeverity = (
    payload: Record<string, unknown>
  ): "info" | "warning" | "error" | readonly ("info" | "warning" | "error")[] | undefined => {
    const value = payload.severity;
    const normalize = (item: unknown): "info" | "warning" | "error" | null =>
      item === "info" || item === "warning" || item === "error" ? item : null;
    if (value === undefined) {
      return undefined;
    }
    if (Array.isArray(value)) {
      const severities = value.map(normalize);
      if (severities.some((item) => item === null)) {
        throw new Error("severity must contain only info, warning, or error");
      }
      return severities as readonly ("info" | "warning" | "error")[];
    }
    const severity = normalize(value);
    if (severity === null) {
      throw new Error("severity must be info, warning, or error");
    }
    return severity;
  };

  const readLumenAuditRequest = (
    payload: Record<string, unknown>,
    targetMode: "isolated" | "live"
  ) => {
    const maxEntries = readOptionalNumberField(payload, "maxEntries");
    const status = readOptionalNumberField(payload, "status");
    const responseBodyMaxBytes = readOptionalNumberField(payload, "responseBodyMaxBytes");
    const includeConsole = readOptionalBooleanField(payload, "includeConsole");
    const includeNetwork = readOptionalBooleanField(payload, "includeNetwork");
    const includeRuntime = readOptionalBooleanField(payload, "includeRuntime");
    const includeResponseBody = readOptionalBooleanField(payload, "includeResponseBody");
    const severity = readLumenAuditSeverity(payload);
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

  const readOptionalBooleanField = (
    payload: Record<string, unknown>,
    fieldName: string
  ): boolean | undefined => {
    if (payload[fieldName] === undefined) {
      return undefined;
    }
    const value = payload[fieldName];
    if (typeof value !== "boolean") {
      throw new Error(`${fieldName} must be a boolean`);
    }
    return value;
  };

  const readRuntimeTurnId = (payload: Record<string, unknown>): string | undefined => {
    const runtimeCancellation = payload.runtimeCancellation;
    if (runtimeCancellation === null || typeof runtimeCancellation !== "object") {
      return undefined;
    }
    const turnId = (runtimeCancellation as Record<string, unknown>).turnId;
    return typeof turnId === "string" && turnId.trim().length > 0
      ? turnId.trim()
      : undefined;
  };

  const readRuntimeSessionId = (payload: Record<string, unknown>): string => {
    const runtimeCancellation = payload.runtimeCancellation;
    if (runtimeCancellation !== null && typeof runtimeCancellation === "object") {
      const sessionId = (runtimeCancellation as Record<string, unknown>).sessionId;
      if (typeof sessionId === "string" && sessionId.trim().length > 0) {
        return sessionId.trim();
      }
    }
    const directSessionId = payload.agentSessionId ?? payload.lyraAgentSessionId;
    if (typeof directSessionId === "string" && directSessionId.trim().length > 0) {
      return directSessionId.trim();
    }
    return "agent-session-default";
  };

  const readTerminalTargetPreference = (
    payload: Record<string, unknown>
  ): TerminalTargetPreference => {
    const value = payload.target;
    if (value === "private" || value === "ui") {
      return value;
    }
    return "auto";
  };

  const readOptionalTerminalId = (
    payload: Record<string, unknown>,
    fieldName: "sessionId" | "terminalTabId" | "paneId"
  ): string | undefined => {
    const value = payload[fieldName];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  };

  const readClampedOptionalNumber = (
    payload: Record<string, unknown>,
    fieldName: string,
    fallback: number,
    min: number,
    max: number
  ): number => {
    const value = readOptionalNumberField(payload, fieldName) ?? fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  };

  const readTerminalCommand = (payload: Record<string, unknown>): string | undefined =>
    readOptionalStringField(payload, "command");

  const readTerminalMode = (
    payload: Record<string, unknown>,
    command: string | undefined
  ): "shell" | "command" => {
    if (command !== undefined) {
      return "command";
    }
    return payload.mode === "command" ? "command" : "shell";
  };

  const targetFromPrivateEntry = (entry: PrivateTerminalEntry): TerminalToolTarget => ({
    type: "private",
    sessionId: entry.sessionId,
    title: entry.title,
    ...(entry.cwd === undefined ? {} : { cwd: entry.cwd })
  });

  const targetFromUiPane = (pane: WorkbenchTerminalPaneDescriptor): TerminalToolTarget => ({
    type: "ui",
    sessionId: pane.sessionId,
    terminalTabId: pane.terminalTabId,
    paneId: pane.paneId,
    title: pane.title,
    placement: pane.placement,
    ...(pane.cwd === undefined ? {} : { cwd: pane.cwd })
  });

  const privateTerminalMapForSession = (
    agentSessionId: string
  ): Map<string, PrivateTerminalEntry> => {
    const existing = privateTerminalsByAgentSession.get(agentSessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, PrivateTerminalEntry>();
    privateTerminalsByAgentSession.set(agentSessionId, created);
    return created;
  };

  const findPrivateTerminalEntry = (
    sessionId: string,
    preferredAgentSessionId?: string
  ): PrivateTerminalEntry | null => {
    if (preferredAgentSessionId !== undefined) {
      const preferred = privateTerminalsByAgentSession
        .get(preferredAgentSessionId)
        ?.get(sessionId);
      if (preferred !== undefined) {
        return preferred;
      }
    }
    for (const terminals of privateTerminalsByAgentSession.values()) {
      const entry = terminals.get(sessionId);
      if (entry !== undefined) {
        return entry;
      }
    }
    return null;
  };

  const latestPrivateTerminalEntry = (agentSessionId: string): PrivateTerminalEntry | null => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined || terminals.size === 0) {
      return null;
    }
    return [...terminals.values()].sort((left, right) =>
      right.lastUsedAt.localeCompare(left.lastUsedAt)
    )[0] ?? null;
  };

  const rememberTerminalCursor = (target: TerminalToolTarget, cursor: string): void => {
    cursorByTerminalSessionId.set(target.sessionId, cursor);
    if (target.type !== "private") {
      return;
    }
    const entry = findPrivateTerminalEntry(target.sessionId);
    if (entry !== null) {
      entry.cursor = cursor;
      entry.lastUsedAt = new Date().toISOString();
    }
  };

  const isSessionNotFoundError = (error: unknown): boolean =>
    error instanceof Error && /session not found/i.test(error.message);

  const waitForTerminalSessionReady = async (
    sessionId: string,
    timeoutMs = 3_000
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() <= deadline) {
      try {
        await terminalBridge.readObservation({
          sessionId,
          cursor: "0",
          maxBytes: 1,
          waitMs: 25
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      lastError instanceof Error
        ? `Terminal session did not become ready: ${lastError.message}`
        : "Terminal session did not become ready."
    );
  };

  const createPrivateTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>
  ): Promise<{
    readonly target: TerminalToolTarget;
    readonly snapshot: TerminalSessionSnapshot;
  }> => {
    const command = readTerminalCommand(payload);
    const mode = readTerminalMode(payload, command);
    if (mode === "command" && command === undefined) {
      throw new Error("terminal_create mode=command requires command");
    }
    const cols = readClampedOptionalNumber(payload, "cols", 80, 1, 300);
    const rows = readClampedOptionalNumber(payload, "rows", 24, 1, 300);
    const title =
      readOptionalStringField(payload, "title")
      ?? (command === undefined ? "Agent Terminal" : command.slice(0, 80));
    const cwd = readOptionalStringField(payload, "cwd");
    const sessionId = `agent-terminal-${agentSessionId}-${randomUUID()}`;
    const request: TerminalCreateRequest = {
      sessionId,
      title,
      cols,
      rows,
      source: "user",
      mode,
      persist: false,
      ...(cwd === undefined ? {} : { cwd }),
      ...(command === undefined ? {} : { command })
    };
    const snapshot = await terminalBridge.createSession(request);
    const now = new Date().toISOString();
    const entry: PrivateTerminalEntry = {
      type: "private",
      agentSessionId,
      sessionId: snapshot.sessionId,
      title: snapshot.title,
      mode,
      createdAt: now,
      lastUsedAt: now,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
      ...(command === undefined ? {} : { command })
    };
    privateTerminalMapForSession(agentSessionId).set(snapshot.sessionId, entry);
    return {
      target: targetFromPrivateEntry(entry),
      snapshot
    };
  };

  const resolvePrivateTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    createIfMissing: boolean
  ): Promise<TerminalToolTarget> => {
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    if (requestedSessionId !== undefined) {
      const entry = findPrivateTerminalEntry(requestedSessionId, agentSessionId);
      if (entry === null) {
        throw new Error(`Private terminal session not found: ${requestedSessionId}`);
      }
      entry.lastUsedAt = new Date().toISOString();
      return targetFromPrivateEntry(entry);
    }
    const existing = latestPrivateTerminalEntry(agentSessionId);
    if (existing !== null) {
      existing.lastUsedAt = new Date().toISOString();
      return targetFromPrivateEntry(existing);
    }
    if (!createIfMissing) {
      throw new Error("No private Agent terminal exists. Call terminal_create first.");
    }
    return (await createPrivateTerminal(agentSessionId, payload)).target;
  };

  const resolveUiTerminal = async (
    payload: Record<string, unknown>,
    openIfMissing: boolean
  ): Promise<TerminalToolTarget> => {
    const service = getWorkbenchObservationService();
    if (service === null) {
      throw new Error("Workbench terminal capability is not available");
    }
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    const requestedTerminalTabId = readOptionalTerminalId(payload, "terminalTabId");
    const requestedPaneId = readOptionalTerminalId(payload, "paneId");
    const listed = await service.listTerminalPanes({});
    const explicitTarget =
      requestedSessionId !== undefined
      || requestedTerminalTabId !== undefined
      || requestedPaneId !== undefined;
    let pane =
      listed.panes.find((entry) => (
        (requestedSessionId === undefined || entry.sessionId === requestedSessionId)
        && (requestedTerminalTabId === undefined || entry.terminalTabId === requestedTerminalTabId)
        && (requestedPaneId === undefined || entry.paneId === requestedPaneId)
      ))
      ?? null;
    if (pane === null && explicitTarget) {
      throw new Error("Requested UI terminal pane was not found.");
    }
    if (pane === null) {
      pane = listed.active;
    }
    if (pane === null && openIfMissing) {
      const title = readOptionalStringField(payload, "title");
      const cwd = readOptionalStringField(payload, "cwd");
      pane = await service.openTerminalPane({
        placement: "dock",
        ...(title === undefined ? {} : { title }),
        ...(cwd === undefined ? {} : { cwd })
      });
      await waitForTerminalSessionReady(pane.sessionId);
    }
    if (pane === null) {
      throw new Error("No UI terminal pane is available. Call terminal_create first.");
    }
    try {
      const focused = await service.focusTerminalPane({
        terminalTabId: pane.terminalTabId,
        paneId: pane.paneId
      });
      pane = focused;
    } catch {
      // Focus is best-effort; the runtime session can still be controlled by id.
    }
    return targetFromUiPane(pane);
  };

  const resolveTerminalTarget = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    options: {
      readonly privateCreateIfMissing: boolean;
      readonly uiOpenIfMissing: boolean;
    }
  ): Promise<TerminalToolTarget> => {
    const preference = readTerminalTargetPreference(payload);
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    const hasUiRef =
      readOptionalTerminalId(payload, "terminalTabId") !== undefined
      || readOptionalTerminalId(payload, "paneId") !== undefined;
    if (requestedSessionId !== undefined && preference !== "ui") {
      const privateEntry = findPrivateTerminalEntry(requestedSessionId, agentSessionId);
      if (privateEntry !== null) {
        privateEntry.lastUsedAt = new Date().toISOString();
        return targetFromPrivateEntry(privateEntry);
      }
    }
    if (preference === "ui" || hasUiRef || (preference === "auto" && browserFollowModeEnabled)) {
      return await resolveUiTerminal(payload, options.uiOpenIfMissing);
    }
    return await resolvePrivateTerminal(
      agentSessionId,
      payload,
      options.privateCreateIfMissing
    );
  };

  const terminalReason = (
    requestedCursor: string | undefined,
    response: TerminalReadResponse
  ): "output" | "exit" | "timeout" => {
    const before = Number.parseInt(requestedCursor ?? "0", 10);
    const after = Number.parseInt(response.cursor, 10);
    if (Number.isFinite(before) && Number.isFinite(after) && after > before) {
      return "output";
    }
    if (!response.running && response.exitCode !== null) {
      return "exit";
    }
    return "timeout";
  };

  const terminalToolResult = (
    target: TerminalToolTarget,
    response: TerminalReadResponse,
    extra: Record<string, unknown> = {}
  ) => {
    rememberTerminalCursor(target, response.cursor);
    return {
      target,
      sessionId: target.sessionId,
      ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
      ...(target.paneId === undefined ? {} : { paneId: target.paneId }),
      cursor: response.cursor,
      output: response.output,
      running: response.running,
      exitCode: response.exitCode,
      truncated: response.truncated,
      ...extra
    };
  };

  const readTerminalOutput = async (
    target: TerminalToolTarget,
    payload: Record<string, unknown>,
    waitMs: number
  ): Promise<TerminalReadResponse> => {
    const cursor =
      readOptionalStringField(payload, "cursor")
      ?? cursorByTerminalSessionId.get(target.sessionId);
    return await terminalBridge.readObservation({
      sessionId: target.sessionId,
      ...(cursor === undefined ? {} : { cursor }),
      maxBytes: readClampedOptionalNumber(payload, "maxBytes", 16_000, 1, 262_144),
      waitMs
    });
  };

  const closePrivateTerminalsForSession = async (agentSessionId: string): Promise<void> => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined) {
      return;
    }
    privateTerminalsByAgentSession.delete(agentSessionId);
    await Promise.all(
      [...terminals.keys()].map(async (sessionId) => {
        cursorByTerminalSessionId.delete(sessionId);
        try {
          await terminalBridge.closeSession({ sessionId });
        } catch (error) {
          if (!isSessionNotFoundError(error)) {
            console.warn(`[lyra-agent] failed to close private terminal ${sessionId}:`, error);
          }
        }
      })
    );
  };

  const readLumenStrategy = (
    payload: Record<string, unknown>,
    fallback: "picker" | "focus" | "hybrid" | "domFallback" = "picker"
  ) => {
    const value = payload.strategy;
    return value === "picker"
      || value === "focus"
      || value === "hybrid"
      || value === "domFallback"
      ? value
      : fallback;
  };

  const readLumenInteraction = (payload: Record<string, unknown>) => {
    const value = payload.interaction;
    if (value === "double_click" || value === "doubleClick") return "doubleClick";
    if (value === "right_click" || value === "rightClick") return "rightClick";
    return value === "hover" || value === "click" ? value : "click";
  };

  const readLumenFocusDirection = (payload: Record<string, unknown>) => {
    const value = payload.direction;
    return value === "next" || value === "previous" ? value : "scan";
  };

  const readLumenWaitUntil = (payload: Record<string, unknown>) => {
    const value = payload.until;
    return value === "loadIdle"
      || value === "textChanged"
      || value === "textStable"
      || value === "textContains"
      ? value
      : "textStable";
  };

  const readLumenTargetMode = (payload: Record<string, unknown>): WorkbenchBrowserAgentTargetMode => {
    const value = payload.targetMode ?? payload.target;
    if (value === "live") return "live";
    if (value === "isolated") return "isolated";
    return "live";
  };

  const readLumenModeRequest = (
    payload: Record<string, unknown>,
    targetMode = readLumenTargetMode(payload)
  ): WorkbenchBrowserAgentModeRequest => ({
    targetMode,
    ...(browserFollowModeEnabled && targetMode === "live" ? { visibleFollow: true } : {}),
    ...(payload.useLiveLoginState === true || payload.authState === "borrowLiveLogin"
      ? {
          useLiveLoginState: true,
          authState: "borrowLiveLogin" as const
        }
      : {})
  });

  const readOptionalLumenElementId = (
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

  const readOptionalLumenTargetRef = (
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
      throw new Error(`${fieldName} must be a stable Lyra Lumen targetRef from lyra_lumen_map`);
    }
    return trimmed;
  };

  const readLumenPoint = (payload: Record<string, unknown>) => {
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

  const createLyraLumenNotApplicable = async (
    requestedMethod: string,
    targetTab: WorkbenchObservedTabDescriptor
  ): Promise<unknown> => {
    let observation: unknown = null;
    let observationError: string | undefined;
    try {
      observation = await readWorkbenchTabWithSummaryFallback({
        tabId: targetTab.tabId,
        detail: "full"
      });
    } catch (error) {
      observationError = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: false,
      kind: "lyraLumenResult",
      notApplicable: true,
      requestedMethod,
      message:
        `Target tab is ${describeWorkbenchTabKind(targetTab)}, not a browser page. ` +
        "Lyra Lumen did not run on this tab.",
      recommendedTool: "workbench_read_tab",
      recommendedHostMethod: "workbench.readTab",
      tab: targetTab,
      observation,
      ...(observationError === undefined ? {} : { observationError })
    };
  };

  const withLumenTargetIds = <T extends Record<string, unknown>>(
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

  const withLyraLumenResult = (
    requestedMethod: string,
    handler: (payload: Record<string, unknown>) => Promise<unknown>
  ) => async (payload: unknown) => {
    try {
      return await handler(normalizePayload(payload));
    } catch (error) {
      const handoff = isRecord(error) && isRecord(error.handoff)
        ? error.handoff
        : null;
      if (handoff !== null && handoff.kind === "browser-shared-control-interrupted") {
        return {
          ok: false,
          kind: "lyraLumenControlHandoff",
          requestedMethod,
          tabId: typeof handoff.tabId === "string" ? handoff.tabId : undefined,
          targetMode: "live",
          controlHandoffEvent: handoff,
          needsUserAction: {
            kind: "shared_control_interrupted",
            reason: "user_interrupted",
            tabId: typeof handoff.tabId === "string" ? handoff.tabId : undefined,
            targetMode: "live",
            controlHandoffEvent: handoff
          },
          nextRecommendedAction: "ask_user"
        };
      }
      if (error instanceof NonBrowserWorkbenchTabError) {
        return await createLyraLumenNotApplicable(requestedMethod, error.tab);
      }
      if (error instanceof InvalidLumenElementIdError) {
        return {
          ok: false,
          kind: "lyraLumenResult",
          requestedMethod,
          invalidIdentifier: {
            field: "elementId",
            received: error.received,
            expected: "lumenElementId"
          },
          correction: {
            message:
              "Workbench tab ids, browser tab ids, Lumen target refs, and observation-local element ids are separate. Call lyra_lumen_map for the target tab, then prefer targetRef; use numeric elementId only with the same observation.",
            recommendedTool: error.recommendedTool
          },
          nextRecommendedAction: error.recommendedTool
        };
      }
      return {
        ok: false,
        kind: "lyraLumenResult",
        requestedMethod,
        error: {
          kind: "lyraLumenRuntimeError",
          message: error instanceof Error ? error.message : String(error)
        },
        nextRecommendedAction: "lyra_lumen.map"
      };
    }
  };

  const waitForLumenPage = async (
    browser: NonNullable<ReturnType<typeof getBrowserBridge>>,
    tabId: string,
    request: {
      readonly targetMode: "isolated" | "live";
      readonly visibleFollow?: boolean;
      readonly authState?: "none" | "borrowLiveLogin";
      readonly useLiveLoginState?: boolean;
      readonly until: "loadIdle" | "textChanged" | "textStable" | "textContains";
      readonly timeoutMs: number;
      readonly idleMs: number;
      readonly maxChars?: number;
      readonly text?: string;
    }
  ) => {
    const startedAt = Date.now();
    const deadline = startedAt + request.timeoutMs;
    const pollDelayMs = Math.max(20, Math.min(250, request.idleMs));
    let firstContent: string | null = null;
    let previousContent: string | null = null;
    let stableSince = Date.now();
    let lastContent = "";
    let lastReadContent: Awaited<ReturnType<typeof browser.readAgentPage>> | null = null;

    while (Date.now() <= deadline - 320) {
      const remainingMs = deadline - Date.now();
      const readTimeoutMs = Math.max(250, Math.min(4_000, remainingMs - 60));
      const content = await browser.readAgentPage(tabId, {
        strategy: "focus",
        targetMode: request.targetMode,
        ...(request.visibleFollow === undefined ? {} : { visibleFollow: request.visibleFollow }),
        ...(request.authState === undefined ? {} : { authState: request.authState }),
        ...(request.useLiveLoginState === undefined ? {} : { useLiveLoginState: request.useLiveLoginState }),
        timeoutMs: readTimeoutMs,
        ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
      });
      lastReadContent = content;
      lastContent = content.content;
      if (firstContent === null) {
        firstContent = lastContent;
      }

      if (
        request.until === "textContains"
        && request.text !== undefined
        && lastContent.includes(request.text)
      ) {
        return { content, matched: true, elapsedMs: Date.now() - startedAt };
      }
      if (request.until === "textChanged" && firstContent !== lastContent) {
        return { content, matched: true, elapsedMs: Date.now() - startedAt };
      }

      if (previousContent !== lastContent) {
        previousContent = lastContent;
        stableSince = Date.now();
      } else if (
        (request.until === "textStable" || request.until === "loadIdle")
        && Date.now() - stableSince >= request.idleMs
      ) {
        return { content, matched: true, elapsedMs: Date.now() - startedAt };
      }

      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }

    const content = lastReadContent ?? await browser.readAgentPage(tabId, {
      strategy: "focus",
      targetMode: request.targetMode,
      ...(request.visibleFollow === undefined ? {} : { visibleFollow: request.visibleFollow }),
      ...(request.authState === undefined ? {} : { authState: request.authState }),
      ...(request.useLiveLoginState === undefined ? {} : { useLiveLoginState: request.useLiveLoginState }),
      timeoutMs: 250,
      ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
    });
    if (
      request.until === "textContains"
      && request.text !== undefined
      && content.content.includes(request.text)
    ) {
      return { content, matched: true, elapsedMs: Date.now() - startedAt };
    }
    return {
      content,
      matched: false,
      elapsedMs: Date.now() - startedAt,
      lastContent
    };
  };

  const elementRevealKey = (element: unknown): string => {
    if (!isRecord(element)) return "";
    const semanticNodeKey = typeof element.semanticNodeKey === "string" ? element.semanticNodeKey : "";
    if (semanticNodeKey.length > 0) {
      return `semantic:${semanticNodeKey}`;
    }
    const targetRef = typeof element.targetRef === "string" ? element.targetRef : "";
    if (targetRef.length > 0) {
      return `target:${targetRef}`;
    }
    const bounds = isRecord(element.bounds) ? element.bounds : {};
    return [
      element.role,
      element.label,
      element.selectorPreview,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height
    ].join("|");
  };

  const pauseForLumenIdle = async (idleMs: number): Promise<void> => {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(2_000, idleMs)))
    );
  };

  const withLumenFailureDiagnostics = async <T extends Record<string, unknown>>(
    browser: NonNullable<ReturnType<typeof getBrowserBridge>>,
    tabId: string,
    targetMode: "isolated" | "live",
    result: T
  ): Promise<T> => {
    if (result.ok !== false) {
      return result;
    }
    try {
      const audit = await browser.auditAgentPageDiagnostics(tabId, {
        targetMode,
        severity: "error",
        maxEntries: 20
      });
      const diagnostics = audit.diagnostics ?? audit.entries;
      if (diagnostics.length === 0 && audit.available !== false) {
        return result;
      }
      return {
        ...result,
        diagnostics,
        diagnosticSummary: audit.summary,
        ...(audit.evidenceRefs === undefined ? {} : { evidenceRefs: audit.evidenceRefs }),
        nextRecommendedAction: "lyra_lumen_audit"
      };
    } catch {
      return result;
    }
  };

  const lyraLumenHandlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    "lyraLumen.map": withLyraLumenResult("lyraLumen.map", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const observation = await browser.observeAgentPage(tabId, {
        strategy: readLumenStrategy(payload, "picker"),
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const highConfidenceAuthSignal = observation.authChallengeSignals
        ?.find((signal) => signal.confidence === "high");
      return withLumenTargetIds({
        ...observation,
        kind: "lyraLumenMap",
        ...(targetMode === "isolated" && highConfidenceAuthSignal !== undefined
          ? {
              needsUserAction: {
                kind: "auth_challenge",
                reason: highConfidenceAuthSignal.kind,
                signal: highConfidenceAuthSignal,
                tabId,
                targetMode,
                suggestedAction: "lyra_lumen_elevate"
              }
            }
          : {}),
        nextRecommendedAction:
          highConfidenceAuthSignal !== undefined
            ? "lyra_lumen_elevate"
            : observation.elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read"
      }, tabId);
    }),
    "lyraLumen.act": withLyraLumenResult("lyraLumen.act", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const result = elementId === undefined && targetRef === undefined
        ? await browser.actOnAgentPoint(tabId, {
            point: readLumenPoint(payload),
            interaction: readLumenInteraction(payload),
            ...readLumenModeRequest(payload, targetMode),
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          })
        : await browser.actOnAgentElement(tabId, {
            ...(elementId === undefined ? {} : { elementId }),
            ...(targetRef === undefined ? {} : { targetRef }),
            interaction: readLumenInteraction(payload),
            ...readLumenModeRequest(payload, targetMode),
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: enriched.ok === false ? "lyra_lumen_audit" : "lyra_lumen.map"
      }, tabId, elementId);
    }),
    "lyraLumen.reveal": withLyraLumenResult("lyraLumen.reveal", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const idleMs = Math.max(
        80,
        Math.min(2_000, readOptionalNumberField(payload, "idleMs") ?? 500)
      );
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const interactionPayload = {
        ...payload,
        interaction: payload.interaction ?? "hover"
      };
      const before = await browser.observeAgentPage(tabId, {
        strategy: "hybrid",
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const actionResult = elementId === undefined
        && targetRef === undefined
        ? await browser.actOnAgentPoint(tabId, {
            point: readLumenPoint(payload),
            interaction: readLumenInteraction(interactionPayload),
            ...readLumenModeRequest(payload, targetMode),
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          })
        : await browser.actOnAgentElement(tabId, {
            ...(elementId === undefined ? {} : { elementId }),
            ...(targetRef === undefined ? {} : { targetRef }),
            interaction: readLumenInteraction(interactionPayload),
            ...readLumenModeRequest(payload, targetMode),
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          });
      if (actionResult.ok === false) {
        const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, actionResult);
        return withLumenTargetIds({
          ...enriched,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: "lyra_lumen_audit"
        }, tabId, elementId);
      }
      await pauseForLumenIdle(idleMs);
      const after = await browser.observeAgentPage(tabId, {
        strategy: "hybrid",
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const beforeKeys = new Set(before.elements.map(elementRevealKey));
      const revealedElements = after.elements.filter(
        (element) => !beforeKeys.has(elementRevealKey(element))
      );
      return withLumenTargetIds({
        ...actionResult,
        kind: "lyraLumenActionResult",
        tabId,
        targetMode,
        revealed: true,
        idleMs,
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        revealedElements,
        message:
          revealedElements.length === 0
            ? "Hover reveal completed, but no new actionable elements appeared."
            : `Hover reveal exposed ${revealedElements.length} new actionable element${revealedElements.length === 1 ? "" : "s"}.`,
        nextRecommendedAction:
          revealedElements.length === 0 ? "lyra_lumen.map" : "lyra_lumen.act"
      }, tabId, elementId);
    }),
    "lyraLumen.type": withLyraLumenResult("lyraLumen.type", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.typeIntoAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        text: readStringField(payload, "text"),
        clear: payload.clear === true,
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: enriched.ok === false ? "lyra_lumen_audit" : "lyra_lumen.map"
      }, tabId, elementId);
    }),
    "lyraLumen.press": withLyraLumenResult("lyraLumen.press", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.pressAgentKey(tabId, {
        key: readStringField(payload, "key"),
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: enriched.ok === false ? "lyra_lumen_audit" : "lyra_lumen.map"
      }, tabId, elementId);
    }),
    "lyraLumen.submit": withLyraLumenResult("lyraLumen.submit", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.pressAgentKey(tabId, {
        key: readOptionalStringField(payload, "key") ?? "Enter",
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        submitted: true,
        message:
          elementId === undefined
            ? "Submitted the focused control with Chromium virtual keyboard."
            : `Submitted element ${elementId} with Chromium virtual keyboard.`,
        nextRecommendedAction: enriched.ok === false ? "lyra_lumen_audit" : "lyra_lumen.wait"
      }, tabId, elementId);
    }),
    "lyraLumen.focusScan": withLyraLumenResult("lyraLumen.focusScan", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const steps = readOptionalNumberField(payload, "steps");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.focusAgentPage(tabId, {
        direction: readLumenFocusDirection(payload),
        ...readLumenModeRequest(payload, targetMode),
        ...(steps === undefined ? {} : { steps }),
        ...(typeof payload.restoreFocus === "boolean" ? { restoreFocus: payload.restoreFocus } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds({
        ...result,
        kind: "lyraLumenFocusResult",
        nextRecommendedAction: "lyra_lumen.act"
      }, tabId);
    }),
    "lyraLumen.followAudit": withLyraLumenResult("lyraLumen.followAudit", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode({ ...payload, targetMode: payload.targetMode ?? "live" });
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const maxActions = readOptionalNumberField(payload, "maxActions");
      const sessionId = readOptionalStringField(payload, "sessionId");
      const turnId = readOptionalStringField(payload, "turnId") ?? readRuntimeTurnId(payload);
      const includeFrames = readOptionalBooleanField(payload, "includeFrames");
      const result = await browser.readAgentFollowAudit(tabId, {
        targetMode,
        ...(maxActions === undefined ? {} : { maxActions }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(turnId === undefined ? {} : { turnId }),
        ...(includeFrames === undefined ? {} : { includeFrames })
      });
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.explainTarget": withLyraLumenResult("lyraLumen.explainTarget", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode({ ...payload, targetMode: payload.targetMode ?? "live" });
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const targetRef = readOptionalLumenTargetRef(payload);
      if (targetRef === undefined) {
        throw new Error("targetRef is required for lyra_lumen_explain_target");
      }
      const maxCandidates = readOptionalNumberField(payload, "maxCandidates");
      const result = await browser.explainAgentTargetRef(tabId, {
        targetMode,
        targetRef,
        ...(maxCandidates === undefined ? {} : { maxCandidates })
      });
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: result.available ? "lyra_lumen.act" : "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.audit": withLyraLumenResult("lyraLumen.audit", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode({ ...payload, targetMode: payload.targetMode ?? "live" });
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const result = await browser.auditAgentPageDiagnostics(
        tabId,
        {
          ...readLumenAuditRequest(payload, targetMode),
          ...readLumenModeRequest(payload, targetMode)
        }
      );
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.elevate": withLyraLumenResult("lyraLumen.elevate", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode({ ...payload, targetMode: payload.targetMode ?? "isolated" });
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const result = await browser.elevateAgentPage(tabId, {
        ...readLumenModeRequest(payload, targetMode),
        ...(typeof payload.reason === "string" ? { reason: payload.reason } : {})
      });
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: result.userActionRequired ? "ask_user" : "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.completeElevation": withLyraLumenResult("lyraLumen.completeElevation", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = await resolveBrowserAgentTabId({ ...payload, targetMode: "isolated" }, "isolated");
      const result = await browser.completeElevationSession(tabId, {
        ...(typeof payload.liveTabId === "string" ? { liveTabId: payload.liveTabId } : {}),
        ...(typeof payload.elevationSessionId === "string" ? { elevationSessionId: payload.elevationSessionId } : {}),
        ...(typeof payload.timeoutMs === "number" ? { timeoutMs: payload.timeoutMs } : {})
      });
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: result.verified ? "lyra_lumen.map" : "ask_user"
      }, tabId);
    }),
    "lyraLumen.resolveControlHandoff": withLyraLumenResult("lyraLumen.resolveControlHandoff", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const tabId = await resolveBrowserAgentTabId({ ...payload, targetMode: "live" }, "live");
      const decision = typeof payload.decision === "string" ? payload.decision : "user_takeover";
      if (
        decision !== "continue_agent"
        && decision !== "user_takeover"
        && decision !== "use_isolated"
        && decision !== "cancel_task"
      ) {
        throw new Error(`Unknown shared control decision: ${decision}`);
      }
      const result = await browser.resolveSharedControlDecision(tabId, { decision });
      return withLumenTargetIds({
        ...result,
        ok: true,
        kind: "lyraLumenControlDecision",
        nextRecommendedAction: decision === "continue_agent" ? "lyra_lumen.follow_audit" : "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.navigate": withLyraLumenResult("lyraLumen.navigate", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const url = readStringField(payload, "url");
      const explicitTabId = readTabId(payload);
      const targetMode = readLumenTargetMode(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      let resolvedTabId = explicitTabId ?? browser.readActiveTabId() ?? "";
      const res = targetMode === "live"
        ? await browser.navigate({
            address: url,
            newTab: payload.newTab === true,
            ...(explicitTabId === null ? {} : { tabId: explicitTabId })
          })
        : await (async () => {
            resolvedTabId = await resolveBrowserAgentTabId(payload, targetMode);
            return await browser.navigateAgentPage(resolvedTabId, {
              url,
              ...readLumenModeRequest(payload, targetMode),
              ...(timeoutMs === undefined ? {} : { timeoutMs })
            });
          })();
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenNavigate",
        tabId: res.tabId,
        url: res.address,
        title: res.title,
        targetMode,
        ...("browserMode" in res && res.browserMode !== undefined ? { browserMode: res.browserMode } : {}),
        message: `Navigated Lyra Lumen to ${res.address}.`
      }, res.tabId ?? resolvedTabId);
    }),
    "lyraLumen.read": withLyraLumenResult("lyraLumen.read", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const strategy = readLumenStrategy(payload, "focus");
      const maxChars = readOptionalNumberField(payload, "maxChars");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const content = await browser.readAgentPage(tabId, {
        strategy,
        ...readLumenModeRequest(payload, targetMode),
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      if (strategy === "domFallback") {
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenRead",
          tabId,
          strategy,
          targetMode,
          ...("browserMode" in content && content.browserMode !== undefined ? { browserMode: content.browserMode } : {}),
          content: content.content,
          summary: content,
          truncated: "truncated" in content ? content.truncated : false,
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenRead",
        tabId,
        strategy,
        targetMode,
        ...("browserMode" in content && content.browserMode !== undefined ? { browserMode: content.browserMode } : {}),
        content: content.content,
        truncated: "truncated" in content ? content.truncated : false,
        ...("startChar" in content ? { startChar: content.startChar } : {}),
        ...("endChar" in content ? { endChar: content.endChar } : {}),
        ...("totalChars" in content ? { totalChars: content.totalChars } : {}),
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.see": withLyraLumenResult("lyraLumen.see", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const capture = await browser.captureAgentPage(
        tabId,
        readLumenModeRequest(payload, targetMode)
      ).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("background_visual_capture_unsupported") === false) {
          throw error;
        }
        const fallback = await browser.readAgentPage(tabId, {
          strategy: "focus",
          ...readLumenModeRequest(payload, targetMode),
          timeoutMs: 4_000
        }).catch(() => null);
        return {
          ok: true,
          kind: "lyraLumenSeeFallback",
          tabId,
          targetMode,
          visualCapture: {
            ok: false,
            reason: "background_visual_capture_unsupported"
          },
          ...(fallback !== null && "browserMode" in fallback && fallback.browserMode !== undefined
            ? { browserMode: fallback.browserMode }
            : {}),
          content: fallback?.content ?? "",
          truncated: fallback === null ? false : ("truncated" in fallback ? fallback.truncated : false),
          message:
            "Visual capture is unavailable while this browser tab is in the background; Lyra used text extraction instead.",
          nextRecommendedAction: "lyra_lumen.map"
        };
      });
      if ("imageBase64" in capture === false) {
        return withLumenTargetIds(capture, tabId);
      }
      const imageArtifact = materializeLumenCapture(storageRoot, tabId, capture);
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenSee",
        tabId,
        targetMode,
        ...("browserMode" in capture && capture.browserMode !== undefined ? { browserMode: capture.browserMode } : {}),
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        visibleOnly: capture.visibleOnly,
        imageArtifact,
        evidenceRefs: [imageArtifact.id],
        message:
          `Captured browser visual evidence ${imageArtifact.id} (${capture.width}x${capture.height}).`,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.wait": withLyraLumenResult("lyraLumen.wait", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = Math.max(
        250,
        Math.min(30_000, readOptionalNumberField(payload, "timeoutMs") ?? 10_000)
      );
      const waitBudgetMs = Math.max(250, timeoutMs - 350);
      const idleMs = Math.max(
        20,
        Math.min(5_000, readOptionalNumberField(payload, "idleMs") ?? 800)
      );
      const until = readLumenWaitUntil(payload);
      const text = readOptionalStringField(payload, "text");
      const maxChars = readOptionalNumberField(payload, "maxChars");
      await browser.showAgentActivity(tabId, {
        action: "wait",
        ...readLumenModeRequest(payload, targetMode),
        durationMs: Math.max(900, Math.min(5_000, timeoutMs))
      });
      const result = await waitForLumenPage(browser, tabId, {
        ...readLumenModeRequest(payload, targetMode),
        targetMode,
        until,
        timeoutMs: waitBudgetMs,
        idleMs,
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(text === undefined ? {} : { text })
      });
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenWait",
        tabId,
        targetMode,
        ...("browserMode" in result.content && result.content.browserMode !== undefined
          ? { browserMode: result.content.browserMode }
          : {}),
        until,
        timeoutMs,
        idleMs,
        matched: result.matched,
        elapsedMs: result.elapsedMs,
        content: result.content.content,
        truncated: "truncated" in result.content ? result.content.truncated : false,
        message: result.matched
          ? `Wait condition '${until}' was met after ${result.elapsedMs}ms.`
          : `Wait condition '${until}' timed out after ${result.elapsedMs}ms.`,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    })
  };

  const terminalHandlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    "terminal.list": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const privateTerminals = [
        ...(privateTerminalsByAgentSession.get(agentSessionId)?.values() ?? [])
      ].map((entry) => ({
        ...targetFromPrivateEntry(entry),
        mode: entry.mode,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        ...(entry.cursor === undefined ? {} : { cursor: entry.cursor }),
        ...(entry.command === undefined ? {} : { command: entry.command })
      }));
      let uiTerminals: readonly WorkbenchTerminalPaneDescriptor[] = [];
      try {
        uiTerminals = (await getWorkbenchObservationService()?.listTerminalPanes({}))?.panes ?? [];
      } catch {
        uiTerminals = [];
      }
      const terminals = [
        ...privateTerminals,
        ...uiTerminals.map((pane) => targetFromUiPane(pane))
      ];
      return {
        target: {
          type: "list",
          preferred: browserFollowModeEnabled ? "ui" : "private"
        },
        terminals,
        cursor: "",
        output: terminals.length === 0 ? "No terminal sessions are available." : "",
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.create": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const preference = readTerminalTargetPreference(request);
      const command = readTerminalCommand(request);
      const useUi = preference === "ui" || (preference === "auto" && browserFollowModeEnabled);
      if (useUi) {
        const target = await resolveUiTerminal(request, true);
        await waitForTerminalSessionReady(target.sessionId);
        if (command !== undefined) {
          await terminalBridge.write({
            sessionId: target.sessionId,
            text: command,
            appendNewline: true,
            source: "user"
          });
        }
        const response = await readTerminalOutput(target, request, command === undefined ? 0 : 500);
        return terminalToolResult(target, response, {
          command,
          mode: command === undefined ? "shell" : "command"
        });
      }

      const { target, snapshot } = await createPrivateTerminal(agentSessionId, request);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        cursor: "0",
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs: snapshot.mode === "command" ? 500 : 0
      });
      return terminalToolResult(target, response, {
        mode: snapshot.mode,
        ...(snapshot.command === undefined ? {} : { command: snapshot.command })
      });
    },
    "terminal.read": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const response = await readTerminalOutput(target, request, 0);
      return terminalToolResult(target, response);
    },
    "terminal.wait": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const requestedCursor =
        readOptionalStringField(request, "cursor")
        ?? cursorByTerminalSessionId.get(target.sessionId);
      const waitMs = readClampedOptionalNumber(request, "waitMs", 1_000, 0, 30_000);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs
      });
      return terminalToolResult(target, response, {
        reason: terminalReason(requestedCursor, response)
      });
    },
    "terminal.write": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing:
          readTerminalTargetPreference(request) !== "ui" && !browserFollowModeEnabled,
        uiOpenIfMissing: false
      });
      const data = typeof request.data === "string" ? request.data : undefined;
      const text = typeof request.text === "string" ? request.text : undefined;
      type TerminalWriteKey = NonNullable<TerminalWriteRequest["keys"]>[number];
      const allowedKeys = new Set<TerminalWriteKey>([
        "enter",
        "escape",
        "tab",
        "ctrl_c",
        "ctrl_d",
        "up",
        "down",
        "left",
        "right",
        "page_up",
        "page_down",
        "home",
        "end"
      ]);
      const keys = Array.isArray(request.keys)
        ? request.keys.filter(
            (key): key is TerminalWriteKey =>
              typeof key === "string" && allowedKeys.has(key as TerminalWriteKey)
          )
        : undefined;
      if (data === undefined && text === undefined && (keys === undefined || keys.length === 0)) {
        throw new Error("terminal_write requires data, text, or keys");
      }
      await terminalBridge.write({
        sessionId: target.sessionId,
        source: "user",
        ...(data === undefined ? {} : { data }),
        ...(text === undefined ? {} : { text }),
        ...(keys === undefined ? {} : { keys }),
        ...(typeof request.appendNewline === "boolean"
          ? { appendNewline: request.appendNewline }
          : {})
      });
      const cursor = cursorByTerminalSessionId.get(target.sessionId);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        ...(cursor === undefined ? {} : { cursor }),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs: 250
      });
      return terminalToolResult(target, response, {
        wrote:
          data !== undefined
            ? `${data.length} bytes`
            : text !== undefined
              ? text
              : keys?.join(", ")
      });
    },
    "terminal.close": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      try {
        await terminalBridge.closeSession({ sessionId: target.sessionId });
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
      }
      cursorByTerminalSessionId.delete(target.sessionId);
      if (target.type === "private") {
        privateTerminalsByAgentSession.get(agentSessionId)?.delete(target.sessionId);
      } else {
        await getWorkbenchObservationService()?.closeTerminalPane({
          sessionId: target.sessionId,
          ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
          ...(target.paneId === undefined ? {} : { paneId: target.paneId })
        });
      }
      return {
        target,
        sessionId: target.sessionId,
        cursor: "",
        output: "Terminal closed.",
        running: false,
        exitCode: null,
        truncated: false
      };
    }
  };

  const normalizeSoftwarePayload = (payload: unknown): Record<string, unknown> => {
    const request = normalizePayload(payload);
    const capabilityId =
      typeof request.capabilityId === "string" && request.capabilityId.trim().length > 0
        ? request.capabilityId.trim()
        : undefined;
    const actionId =
      typeof request.actionId === "string" && request.actionId.trim().length > 0
        ? request.actionId.trim()
        : capabilityId;
    return {
      ...request,
      ...(capabilityId === undefined ? {} : { capabilityId }),
      ...(actionId === undefined ? {} : { actionId })
    };
  };

  const hostCapabilityHandlers = {
    ...workbenchHandlers,
    ...lyraLumenHandlers,
    ...terminalHandlers,
    "workbench.browser.readSessionSnapshot": () => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser session recovery capability is not available");
      return browser.readSessionSnapshot();
    },
    "workbench.browser.readStorageState": async (payload: unknown) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser storage state capability is not available");
      return await browser.readStorageState(
        normalizePayload(payload) as WorkbenchBrowserStorageStateRequest
      );
    },
    "workbench.browser.clearSiteData": async (payload: unknown) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser storage clear capability is not available");
      return await browser.clearSiteData(
        normalizePayload(payload) as WorkbenchBrowserClearSiteDataRequest
      );
    },
    "software.listCapabilities": async (payload: unknown) =>
      await softwareCapabilitiesClient.listCapabilities(normalizePayload(payload)),
    "software.inspectCapability": async (payload: unknown) =>
      await softwareCapabilitiesClient.inspectCapability(normalizeSoftwarePayload(payload)),
    "software.readState": async (payload: unknown) =>
      await softwareCapabilitiesClient.readState(normalizeSoftwarePayload(payload)),
    "software.invokeCapability": async (payload: unknown) =>
      await softwareCapabilitiesClient.invokeCapability(normalizeSoftwarePayload(payload))
  };

  for (const [method, handler] of Object.entries(hostCapabilityHandlers)) {
    runtimeClient.registerRequestHandler(method, handler);
  }

  const handlers: Array<readonly [string, (_event: Electron.IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.agentSessionCreate,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.create",
          (payload as AgentSessionCreateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRead,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.read",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionList,
      (_event, payload) =>
        requestRuntime<AgentSessionListResponse>(
          "agent.session.list",
          (payload as AgentSessionListRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionSave,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.save",
          payload as AgentSessionSaveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionUnsave,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.unsave",
          payload as AgentSessionDeleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRename,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.rename",
          payload as AgentSessionRenameRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionArchive,
      (_event, payload) =>
        requestRuntime<AgentSessionSummary>(
          "agent.session.archive",
          payload as AgentSessionArchiveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionDelete,
      async (_event, payload) => {
        const request = payload as AgentSessionDeleteRequest;
        const response = await requestRuntime<AgentSessionDeleteResponse>(
          "agent.session.delete",
          request
        );
        await closePrivateTerminalsForSession(request.sessionId);
        return response;
      }
    ],
    [
      LYRA_CHANNELS.agentSessionBindProject,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.bindProject",
          payload as AgentSessionBindProjectRequest
        )
    ],
    [
      LYRA_CHANNELS.agentImageAttachmentMaterialize,
      (_event, payload) =>
        materializeImageAttachment(
          storageRoot,
          payload as AgentImageAttachmentMaterializeRequest
        )
    ],
    [
      LYRA_CHANNELS.agentBrowserFollowRead,
      () => ({
        enabled: browserFollowModeEnabled
      } satisfies AgentBrowserFollowModeSnapshot)
    ],
    [
      LYRA_CHANNELS.agentBrowserFollowUpdate,
      (_event, payload) => {
        const request = normalizePayload(payload) as AgentBrowserFollowModeUpdateRequest;
        browserFollowModeEnabled = request.enabled === true;
        if (!browserFollowModeEnabled) {
          getBrowserBridge()?.finishAgentFollowSessions({
            status: "cancelled",
            reason: "follow_disabled"
          });
        }
        return {
          enabled: browserFollowModeEnabled
        } satisfies AgentBrowserFollowModeSnapshot;
      }
    ],
    [
      LYRA_CHANNELS.agentSelfDevStart,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStartResponse>(
          "agent.selfdev.start",
          (payload as AgentSelfDevStartRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevStatus,
      (_event, payload) =>
        requestRuntime<AgentSelfDevStatusResponse>(
          "agent.selfdev.status",
          (payload as AgentSelfDevStatusRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSelfDevSendTurn,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.selfdev.sendTurn",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnStart,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.start",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnSend,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.send",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnResume,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.resume",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnCancel,
      (_event, payload) =>
        requestRuntime<AgentTurnCancelResponse>(
          "agent.turn.cancel",
          payload as AgentTurnCancelRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnRetry,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.retry",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySnapshot,
      (_event, payload) =>
        requestRuntime<AgentMemorySnapshot>(
          "agent.memory.snapshot",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemoryAudit,
      (_event, payload) =>
        requestRuntime<AgentMemoryAuditResponse>(
          "agent.memory.audit",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemoryTrimRun,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.trim.run",
          (payload as AgentMemoryTrimRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemoryRecoverRun,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.recover.run",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySharedSearch,
      (_event, payload) =>
        requestRuntime<{ readonly records: readonly unknown[] }>(
          "agent.memory.shared.search",
          (payload as AgentMemorySharedSearchRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentMemorySharedUpdate,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.memory.shared.update",
          payload as AgentMemorySharedUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackPreview,
      (_event, payload) =>
        requestRuntime<AgentRollbackPreviewResponse>(
          "agent.rollback.preview",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRollbackRestore,
      (_event, payload) =>
        requestRuntime<AgentRollbackRestoreResponse>(
          "agent.rollback.restore",
          payload as AgentRollbackRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStatus,
      (_event, payload) =>
        requestRuntime<AgentGitStatusSnapshot>(
          "agent.git.status",
          payload as AgentGitStatusRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiff,
      (_event, payload) =>
        requestRuntime<AgentGitDiffResponse>(
          "agent.git.diff",
          payload as AgentGitDiffRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitStage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.stage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitUnstage,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.unstage",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGitDiscard,
      (_event, payload) =>
        requestRuntime<AgentGitMutationResponse>(
          "agent.git.discard",
          payload as AgentGitFileRequest
        )
    ],
    [
      LYRA_CHANNELS.agentClarificationRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.clarification.respond",
          payload as AgentClarificationRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPermissionRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.permission.respond",
          payload as AgentPermissionRespondRequest
        )
    ],
    [
      LYRA_CHANNELS.agentConfigRead,
      () => requestRuntime<AgentConfigSnapshot>("agent.config.read")
    ],
    [
      LYRA_CHANNELS.agentConfigUpdate,
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.config.update",
          (payload as AgentConfigUpdateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentProviderProfileSave,
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.provider.profile.save",
          payload as AgentProviderProfileSaveRequest
        )
    ],
    [
      LYRA_CHANNELS.agentModelsList,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.list",
          (payload as AgentModelCatalogRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentModelSwitch,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.switch",
          payload as AgentModelSwitchRequest
        )
    ],
    [
      LYRA_CHANNELS.agentModelRefresh,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.models.refresh",
          (payload as AgentModelRefreshRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentProviderOptionsUpdate,
      (_event, payload) =>
        requestRuntime<AgentModelCatalogSnapshot>(
          "agent.provider.options.update",
          payload as AgentProviderOptionsUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentRolesUpdate,
      (_event, payload) =>
        requestRuntime<AgentConfigSnapshot>(
          "agent.roles.update",
          payload as AgentRolesUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentImproveRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.improve",
          (payload as AgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentRefactorRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.refactor",
          (payload as AgentActionRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentPokeTrigger,
      (_event, payload) =>
        requestRuntime<AgentPokeResponse>(
          "agent.action.poke",
          (payload as AgentPokeRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentReviewRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.review",
          (payload as AgentFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentJudgeRun,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.action.judge",
          (payload as AgentFeedbackRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSubagentRun,
      (_event, payload) =>
        requestRuntime<AgentSubagentRunResponse>(
          "agent.subagent.run",
          payload as AgentSubagentRunRequest
        )
    ],
    [
      LYRA_CHANNELS.agentBtwRun,
      (_event, payload) =>
        requestRuntime<AgentSidePanelActionResponse>(
          "agent.btw.run",
          payload as AgentBtwRunRequest
        )
    ],
    [
      LYRA_CHANNELS.agentSessionSplit,
      (_event, payload) =>
        requestRuntime<AgentSessionForkResponse>(
          "agent.session.split",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionTransfer,
      (_event, payload) =>
        requestRuntime<AgentSessionForkResponse>(
          "agent.session.transfer",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionCompact,
      (_event, payload) =>
        requestRuntime<AgentCompactResponse>(
          "agent.session.compact",
          (payload as AgentSessionActionRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionAutomationUpdate,
      (_event, payload) =>
        requestRuntime<AgentAutomationUpdateResponse>(
          "agent.session.automation.update",
          payload as AgentAutomationUpdateRequest
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsList,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.list",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsOpen,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.open",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsResume,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.resume",
          (payload as AgentGoalsRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentGoalsShow,
      (_event, payload) =>
        requestRuntime<AgentGoalsResponse>(
          "agent.goals.show",
          payload as AgentGoalsRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsList,
      () => requestRuntime<AgentAccountsSnapshot>("agent.accounts.list")
    ],
    [
      LYRA_CHANNELS.agentAccountsLogin,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.login",
          payload as AgentAccountLoginRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginProviders,
      () => requestRuntime<AgentLoginProviderCatalogSnapshot>("agent.accounts.loginProviders")
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginStart,
      (_event, payload) =>
        requestRuntime<AgentAccountLoginStartResponse>(
          "agent.accounts.loginStart",
          payload as AgentAccountLoginStartRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsLoginComplete,
      (_event, payload) =>
        requestRuntime<AgentAccountLoginCompleteResponse>(
          "agent.accounts.loginComplete",
          payload as AgentAccountLoginCompleteRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsSwitch,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.switch",
          payload as AgentAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.agentAccountsRemove,
      (_event, payload) =>
        requestRuntime<AgentAccountsSnapshot>(
          "agent.accounts.remove",
          payload as AgentAccountRequest
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightStart,
      (_event, payload) =>
        requestRuntime<AgentOvernightStartResponse>(
          "agent.overnight.start",
          payload as AgentOvernightStartRequest
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightList,
      () => requestRuntime<AgentOvernightListResponse>("agent.overnight.list")
    ],
    [
      LYRA_CHANNELS.agentOvernightStatus,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.status",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightLog,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.log",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightReview,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.review",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentOvernightCancel,
      (_event, payload) =>
        requestRuntime<AgentOvernightRunResponse>(
          "agent.overnight.cancel",
          (payload as AgentOvernightRunRequest | undefined) ?? {}
        )
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      softwareCapabilitiesClient.dispose();
      for (const agentSessionId of [...privateTerminalsByAgentSession.keys()]) {
        void closePrivateTerminalsForSession(agentSessionId);
      }
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      for (const method of Object.keys(hostCapabilityHandlers)) {
        runtimeClient.unregisterRequestHandler(method);
      }
    }
  };
};
