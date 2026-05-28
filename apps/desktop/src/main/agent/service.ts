import { ipcMain, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  LYRA_CHANNELS,
  type SoftwareCapabilitiesQueryRequest,
  type SoftwareCapabilitiesQueryResult
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
import type { LyraRuntimeClient } from "../runtime-client";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID } from "../workbench-browser/types";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import type {
  WorkbenchObservedTabDescriptor,
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
    invokeCapability: async (payload: object) =>
      await sendQuery("software.invokeCapability", payload)
  };
};

export const createAgentIpcBridge = ({
  runtimeClient,
  storageRoot,
  getWindow,
  getBrowserBridge,
  getWorkbenchObservationService
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
}): AgentIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, payload);
  const softwareCapabilitiesClient = createSoftwareCapabilityRendererClient({ getWindow });
  let browserFollowModeEnabled = false;

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, payload as AgentRuntimeEvent);
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

  const readLumenTargetMode = (payload: Record<string, unknown>) => {
    if (browserFollowModeEnabled) {
      return "live";
    }
    const value = payload.targetMode ?? payload.target;
    if (value === "live") return "live";
    if (value === "isolated") return "isolated";
    return "isolated";
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
      recommendedTool: "workbench.readTab",
      tab: targetTab,
      observation,
      ...(observationError === undefined ? {} : { observationError })
    };
  };

  const withLyraLumenResult = (
    requestedMethod: string,
    handler: (payload: Record<string, unknown>) => Promise<unknown>
  ) => async (payload: unknown) => {
    try {
      return await handler(normalizePayload(payload));
    } catch (error) {
      if (error instanceof NonBrowserWorkbenchTabError) {
        return await createLyraLumenNotApplicable(requestedMethod, error.tab);
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

    while (Date.now() <= deadline) {
      const content = await browser.readAgentPage(tabId, {
        strategy: "focus",
        targetMode: request.targetMode,
        ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
      });
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

    const content = await browser.readAgentPage(tabId, {
      strategy: "focus",
      targetMode: request.targetMode,
      ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
    });
    return {
      content,
      matched: false,
      elapsedMs: Date.now() - startedAt,
      lastContent
    };
  };

  const elementRevealKey = (element: unknown): string => {
    if (!isRecord(element)) return "";
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

  const lyraLumenHandlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    "lyraLumen.map": withLyraLumenResult("lyraLumen.map", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const observation = await browser.observeAgentPage(tabId, {
        strategy: readLumenStrategy(payload, "picker"),
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return {
        ...observation,
        kind: "lyraLumenMap",
        nextRecommendedAction: observation.elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read"
      };
    }),
    "lyraLumen.act": withLyraLumenResult("lyraLumen.act", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = payload.elementId === undefined
        ? await browser.actOnAgentPoint(tabId, {
            point: readLumenPoint(payload),
            interaction: readLumenInteraction(payload),
            targetMode,
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          })
        : await browser.actOnAgentElement(tabId, {
            elementId: readNumberField(payload, "elementId"),
            interaction: readLumenInteraction(payload),
            targetMode,
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          });
      return {
        ...result,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: "lyra_lumen.map"
      };
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
      const interactionPayload = {
        ...payload,
        interaction: payload.interaction ?? "hover"
      };
      const before = await browser.observeAgentPage(tabId, {
        strategy: "hybrid",
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const actionResult = payload.elementId === undefined
        ? await browser.actOnAgentPoint(tabId, {
            point: readLumenPoint(payload),
            interaction: readLumenInteraction(interactionPayload),
            targetMode,
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          })
        : await browser.actOnAgentElement(tabId, {
            elementId: readNumberField(payload, "elementId"),
            interaction: readLumenInteraction(interactionPayload),
            targetMode,
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          });
      if (actionResult.ok === false) {
        return {
          ...actionResult,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: "lyra_lumen.map"
        };
      }
      await pauseForLumenIdle(idleMs);
      const after = await browser.observeAgentPage(tabId, {
        strategy: "hybrid",
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const beforeKeys = new Set(before.elements.map(elementRevealKey));
      const revealedElements = after.elements.filter(
        (element) => !beforeKeys.has(elementRevealKey(element))
      );
      return {
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
      };
    }),
    "lyraLumen.type": withLyraLumenResult("lyraLumen.type", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalNumberField(payload, "elementId");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.typeIntoAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        text: readStringField(payload, "text"),
        clear: payload.clear === true,
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return { ...result, kind: "lyraLumenActionResult", nextRecommendedAction: "lyra_lumen.map" };
    }),
    "lyraLumen.press": withLyraLumenResult("lyraLumen.press", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalNumberField(payload, "elementId");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.pressAgentKey(tabId, {
        key: readStringField(payload, "key"),
        ...(elementId === undefined ? {} : { elementId }),
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return { ...result, kind: "lyraLumenActionResult", nextRecommendedAction: "lyra_lumen.map" };
    }),
    "lyraLumen.submit": withLyraLumenResult("lyraLumen.submit", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalNumberField(payload, "elementId");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.pressAgentKey(tabId, {
        key: readOptionalStringField(payload, "key") ?? "Enter",
        ...(elementId === undefined ? {} : { elementId }),
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return {
        ...result,
        kind: "lyraLumenActionResult",
        submitted: true,
        message:
          elementId === undefined
            ? "Submitted the focused control with Chromium virtual keyboard."
            : `Submitted element ${elementId} with Chromium virtual keyboard.`,
        nextRecommendedAction: "lyra_lumen.wait"
      };
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
        targetMode,
        ...(steps === undefined ? {} : { steps }),
        ...(typeof payload.restoreFocus === "boolean" ? { restoreFocus: payload.restoreFocus } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return { ...result, kind: "lyraLumenFocusResult", nextRecommendedAction: "lyra_lumen.act" };
    }),
    "lyraLumen.navigate": withLyraLumenResult("lyraLumen.navigate", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const url = readStringField(payload, "url");
      const explicitTabId = readTabId(payload);
      const targetMode = readLumenTargetMode(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const res = targetMode === "live"
        ? await browser.navigate({
            address: url,
            newTab: payload.newTab === true,
            ...(explicitTabId === null ? {} : { tabId: explicitTabId })
          })
        : await browser.navigateAgentPage(await resolveBrowserAgentTabId(payload, targetMode), {
            url,
            targetMode,
            ...(timeoutMs === undefined ? {} : { timeoutMs })
          });
      return {
        ok: true,
        kind: "lyraLumenNavigate",
        tabId: res.tabId,
        url: res.address,
        title: res.title,
        targetMode,
        message: `Navigated Lyra Lumen to ${res.address}.`
      };
    }),
    "lyraLumen.read": withLyraLumenResult("lyraLumen.read", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const strategy = readLumenStrategy(payload, "focus");
      const maxChars = readOptionalNumberField(payload, "maxChars");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const content = await browser.readAgentPage(tabId, {
        strategy,
        targetMode,
        ...(maxChars === undefined ? {} : { maxChars })
      });
      if (strategy === "domFallback") {
        return {
          ok: true,
          kind: "lyraLumenRead",
          tabId,
          strategy,
          targetMode,
          content: content.content,
          summary: content,
          truncated: "truncated" in content ? content.truncated : false,
          nextRecommendedAction: "lyra_lumen.map"
        };
      }
      return {
        ok: true,
        kind: "lyraLumenRead",
        tabId,
        strategy,
        targetMode,
        content: content.content,
        truncated: "truncated" in content ? content.truncated : false,
        ...("startChar" in content ? { startChar: content.startChar } : {}),
        ...("endChar" in content ? { endChar: content.endChar } : {}),
        ...("totalChars" in content ? { totalChars: content.totalChars } : {}),
        nextRecommendedAction: "lyra_lumen.map"
      };
    }),
    "lyraLumen.see": withLyraLumenResult("lyraLumen.see", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const capture = await browser.captureAgentPage(tabId, { targetMode });
      return {
        ok: true,
        kind: "lyraLumenSee",
        tabId,
        targetMode,
        mimeType: capture.mimeType,
        imageBase64: capture.imageBase64,
        width: capture.width,
        height: capture.height,
        visibleOnly: capture.visibleOnly,
        screenshot: {
          mediaType: capture.mimeType,
          data: capture.imageBase64,
          width: capture.width,
          height: capture.height
        },
        nextRecommendedAction: "lyra_lumen.map"
      };
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
      const idleMs = Math.max(
        20,
        Math.min(5_000, readOptionalNumberField(payload, "idleMs") ?? 800)
      );
      const until = readLumenWaitUntil(payload);
      const text = readOptionalStringField(payload, "text");
      const maxChars = readOptionalNumberField(payload, "maxChars");
      const result = await waitForLumenPage(browser, tabId, {
        targetMode,
        until,
        timeoutMs,
        idleMs,
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(text === undefined ? {} : { text })
      });
      return {
        ok: true,
        kind: "lyraLumenWait",
        tabId,
        targetMode,
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
      };
    })
  };

  const hostCapabilityHandlers = {
    ...workbenchHandlers,
    ...lyraLumenHandlers,
    "software.listCapabilities": async (payload: unknown) =>
      await softwareCapabilitiesClient.listCapabilities(normalizePayload(payload)),
    "software.inspectCapability": async (payload: unknown) =>
      await softwareCapabilitiesClient.inspectCapability(normalizePayload(payload)),
    "software.invokeCapability": async (payload: unknown) =>
      await softwareCapabilitiesClient.invokeCapability(normalizePayload(payload))
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
      (_event, payload) =>
        requestRuntime<AgentSessionDeleteResponse>(
          "agent.session.delete",
          payload as AgentSessionDeleteRequest
        )
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
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      for (const method of Object.keys(hostCapabilityHandlers)) {
        runtimeClient.unregisterRequestHandler(method);
      }
    }
  };
};
