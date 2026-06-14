import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type {
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAxAuthorization,
  WorkbenchBrowserAxFocusDirection,
  WorkbenchBrowserAxInteraction,
  WorkbenchBrowserAxStrategy
} from "../workbench-browser/types";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readOptionalBooleanField,
  readOptionalNumberField,
  readOptionalStringField,
  readRuntimeToolCallId,
  readStringField
} from "./host-payload";
import {
  NonBrowserWorkbenchTabError,
  type WorkbenchBrowserTabResolver
} from "./workbench-observation-adapter";

class InvalidAxAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAxAuthorizationError";
  }
}

class WrongAxReferenceTypeError extends Error {
  readonly received: string;

  constructor(field: "targetRef" | "captureId", received: string) {
    super(
      `axRef is required. ${field} belongs to ${
        field === "captureId" ? "/tools/browser/see" : "/tools/browser/map"
      }.`
    );
    this.name = "WrongAxReferenceTypeError";
    this.received = received;
  }
}

export const createAxToolHost = ({
  getBrowserBridge,
  tabResolver,
  getBrowserFollowMode
}: {
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly tabResolver: WorkbenchBrowserTabResolver;
  readonly getBrowserFollowMode: () => boolean;
}): { readonly handlers: AgentHostCapabilityHandlers } => {
  const { resolveBrowserAgentTabId } = tabResolver;
  const consumedAxAuthorizations = new Set<string>();

  const readAxTargetMode = (payload: Record<string, unknown>): WorkbenchBrowserAgentTargetMode => {
    const value = payload.targetMode ?? payload.target;
    return value === "isolated" ? "isolated" : "live";
  };

  const visibleFollowFor = (targetMode: WorkbenchBrowserAgentTargetMode): boolean =>
    getBrowserFollowMode() && targetMode === "live";

  const readAxStrategy = (payload: Record<string, unknown>): WorkbenchBrowserAxStrategy => {
    const value = payload.strategy;
    return value === "document" || value === "auth" ? value : "interactive";
  };

  const readAxInteraction = (payload: Record<string, unknown>): WorkbenchBrowserAxInteraction => {
    const value = payload.interaction;
    if (value === "hover" || value === "focus" || value === "toggle" || value === "select") {
      return value;
    }
    return "click";
  };

  const readAxDirection = (payload: Record<string, unknown>): WorkbenchBrowserAxFocusDirection => {
    return payload.direction === "previous" ? "previous" : "next";
  };

  const readAxVerification = (payload: Record<string, unknown>): "fast" | "full" => {
    const value = payload.verification ?? payload.verify;
    return value === "full" ? "full" : "fast";
  };

  const readAxAuthorization = (value: unknown): WorkbenchBrowserAxAuthorization | undefined => {
    if (!isRecord(value)) {
      return undefined;
    }
    if (value.kind !== "lyra_ax_one_time") {
      return undefined;
    }
    const action = value.action;
    const axRef = value.axRef;
    if ((action !== "act" && action !== "press") || typeof axRef !== "string" || !axRef.startsWith("ax:")) {
      throw new InvalidAxAuthorizationError("Invalid AX authorization payload.");
    }
    return {
      kind: "lyra_ax_one_time",
      action,
      axRef,
      ...(typeof value.tabId === "string" ? { tabId: value.tabId } : {}),
      ...(value.targetMode === "live" || value.targetMode === "isolated" ? { targetMode: value.targetMode } : {}),
      ...(typeof value.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
      ...(typeof value.permissionRequestId === "string" ? { permissionRequestId: value.permissionRequestId } : {}),
      ...(typeof value.issuedAt === "string" ? { issuedAt: value.issuedAt } : {}),
      ...(typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt) ? { expiresAt: value.expiresAt } : {})
    };
  };

  const consumeAxAuthorization = (
    payload: Record<string, unknown>,
    action: "act" | "press",
    axRef: string | undefined,
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): boolean => {
    if (axRef === undefined) {
      return false;
    }
    const authorization = readAxAuthorization(payload.axAuthorization);
    if (authorization === undefined) {
      return false;
    }
    if (authorization.action !== action) {
      throw new InvalidAxAuthorizationError("AX authorization action does not match this tool call.");
    }
    if (authorization.axRef !== axRef) {
      throw new InvalidAxAuthorizationError("AX authorization axRef does not match this tool call.");
    }
    if (authorization.tabId !== undefined && authorization.tabId !== tabId) {
      throw new InvalidAxAuthorizationError("AX authorization tabId does not match this tool call.");
    }
    if (authorization.targetMode !== undefined && authorization.targetMode !== targetMode) {
      throw new InvalidAxAuthorizationError("AX authorization targetMode does not match this tool call.");
    }
    const runtimeToolCallId = readRuntimeToolCallId(payload);
    if (
      authorization.toolCallId !== undefined
      && runtimeToolCallId !== undefined
      && authorization.toolCallId !== runtimeToolCallId
    ) {
      throw new InvalidAxAuthorizationError("AX authorization toolCallId does not match this tool call.");
    }
    if (authorization.expiresAt !== undefined && authorization.expiresAt <= Date.now()) {
      throw new InvalidAxAuthorizationError("AX authorization has expired.");
    }
    const authorizationId = [
      authorization.permissionRequestId ?? "permissionless",
      authorization.toolCallId ?? runtimeToolCallId ?? "tool",
      authorization.action,
      authorization.axRef
    ].join("|");
    if (consumedAxAuthorizations.has(authorizationId)) {
      throw new InvalidAxAuthorizationError("AX authorization was already consumed.");
    }
    consumedAxAuthorizations.add(authorizationId);
    return true;
  };

  // Reject targetRef / captureId supplied where an axRef is required (spec §11.2).
  const guardAxReference = (payload: Record<string, unknown>): void => {
    if (typeof payload.axRef === "string" && payload.axRef.length > 0) {
      return;
    }
    const targetRef = readOptionalStringField(payload, "targetRef");
    if (targetRef !== undefined) {
      throw new WrongAxReferenceTypeError("targetRef", targetRef);
    }
    const captureId = readOptionalStringField(payload, "captureId");
    if (captureId !== undefined) {
      throw new WrongAxReferenceTypeError("captureId", captureId);
    }
  };

  const readAxRef = (payload: Record<string, unknown>): string => {
    guardAxReference(payload);
    const axRef = readStringField(payload, "axRef");
    if (!axRef.startsWith("ax:")) {
      throw new WrongAxReferenceTypeError("targetRef", axRef);
    }
    return axRef;
  };

  const withLyraAxResult = (
    requestedMethod: string,
    handler: (payload: Record<string, unknown>) => Promise<unknown>
  ) => async (payload: unknown) => {
    try {
      return await handler(normalizePayload(payload));
    } catch (error) {
      const handoff = isRecord(error) && isRecord(error.handoff) ? error.handoff : null;
      if (handoff !== null && handoff.kind === "browser-shared-control-interrupted") {
        const tabId = typeof handoff.tabId === "string" ? handoff.tabId : undefined;
        return {
          ok: false,
          kind: "browserAxControlHandoff",
          requestedMethod,
          ...(tabId === undefined ? {} : { tabId }),
          targetMode: "live",
          controlHandoffEvent: handoff,
          needsUserAction: {
            kind: "shared_control_interrupted",
            reason: "user_interrupted",
            ...(tabId === undefined ? {} : { tabId }),
            targetMode: "live",
            controlHandoffEvent: handoff
          },
          nextRecommendedAction: "ask_user"
        };
      }
      if (error instanceof WrongAxReferenceTypeError) {
        return {
          ok: false,
          kind: "browserAxResult",
          requestedMethod,
          error: {
            kind: "wrongReferenceType",
            message: error.message,
            received: error.received
          },
          nextRecommendedAction: "browser_ax.map"
        };
      }
      if (error instanceof InvalidAxAuthorizationError) {
        return {
          ok: false,
          kind: "browserAxResult",
          requestedMethod,
          error: {
            kind: "invalidAxAuthorization",
            message: error.message
          },
          nextRecommendedAction: "lyra_lumen.elevate"
        };
      }
      if (error instanceof NonBrowserWorkbenchTabError) {
        return {
          ok: false,
          kind: "browserAxResult",
          notApplicable: true,
          requestedMethod,
          message: "Target tab is not a browser page. Lyra AX did not run on this tab.",
          recommendedTool: "workbench_read_tab",
          nextRecommendedAction: "workbench.readTab"
        };
      }
      return {
        ok: false,
        kind: "browserAxResult",
        requestedMethod,
        error: {
          kind: "browserAxRuntimeError",
          message: error instanceof Error ? error.message : String(error)
        },
        nextRecommendedAction: "browser_ax.map"
      };
    }
  };

  const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    "lyraAx.map": withLyraAxResult("lyraAx.map", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const maxNodes = readOptionalNumberField(payload, "maxNodes");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const includeIgnored = readOptionalBooleanField(payload, "includeIgnored");
      const includeText = readOptionalBooleanField(payload, "includeText");
      const includeFrames = readOptionalBooleanField(payload, "includeFrames");
      return await browser.axMapAgentPage(tabId, {
        targetMode,
        strategy: readAxStrategy(payload),
        ...(visibleFollowFor(targetMode) ? { visibleFollow: true } : {}),
        ...(maxNodes === undefined ? {} : { maxNodes }),
        ...(includeIgnored === undefined ? {} : { includeIgnored }),
        ...(includeText === undefined ? {} : { includeText }),
        ...(includeFrames === undefined ? {} : { includeFrames }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
    }),
    "lyraAx.query": withLyraAxResult("lyraAx.query", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const snapshotId = readOptionalStringField(payload, "snapshotId");
      const role = readOptionalStringField(payload, "role");
      const nameIncludes = readOptionalStringField(payload, "nameIncludes");
      const provider = readOptionalStringField(payload, "provider");
      const visibleOnly = readOptionalBooleanField(payload, "visibleOnly");
      const maxResults = readOptionalNumberField(payload, "maxResults");
      return browser.axQueryAgentSnapshot(tabId, {
        targetMode,
        ...(snapshotId === undefined ? {} : { snapshotId }),
        ...(role === undefined ? {} : { role }),
        ...(nameIncludes === undefined ? {} : { nameIncludes }),
        ...(provider === undefined ? {} : { provider }),
        ...(visibleOnly === undefined ? {} : { visibleOnly }),
        ...(maxResults === undefined ? {} : { maxResults })
      });
    }),
    "lyraAx.act": withLyraAxResult("lyraAx.act", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const axRef = readAxRef(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const authorized = consumeAxAuthorization(payload, "act", axRef, tabId, targetMode);
      return await browser.axActOnNode(tabId, {
        axRef,
        interaction: readAxInteraction(payload),
        verification: readAxVerification(payload),
        targetMode,
        ...(authorized ? { authorized: true } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
    }),
    "lyraAx.focus": withLyraAxResult("lyraAx.focus", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const role = readOptionalStringField(payload, "role");
      const nameIncludes = readOptionalStringField(payload, "nameIncludes");
      const maxSteps = readOptionalNumberField(payload, "maxSteps");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      return await browser.axFocusAgentPage(tabId, {
        targetMode,
        direction: readAxDirection(payload),
        ...(visibleFollowFor(targetMode) ? { visibleFollow: true } : {}),
        ...(role === undefined ? {} : { role }),
        ...(nameIncludes === undefined ? {} : { nameIncludes }),
        ...(maxSteps === undefined ? {} : { maxSteps }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
    }),
    "lyraAx.press": withLyraAxResult("lyraAx.press", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const key = readStringField(payload, "key");
      const axRef = isRecord(payload) && typeof payload.axRef === "string" ? payload.axRef : undefined;
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const authorized = consumeAxAuthorization(payload, "press", axRef, tabId, targetMode);
      return await browser.axPressAgentKey(tabId, {
        key,
        targetMode,
        ...(axRef === undefined ? {} : { axRef }),
        ...(authorized ? { authorized: true } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
    }),
    "lyraAx.explain": withLyraAxResult("lyraAx.explain", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readAxTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const axRef = readOptionalStringField(payload, "axRef");
      const snapshotId = readOptionalStringField(payload, "snapshotId");
      return browser.axExplainNode(tabId, {
        targetMode,
        ...(axRef === undefined ? {} : { axRef }),
        ...(snapshotId === undefined ? {} : { snapshotId })
      });
    })
  };

  return { handlers };
};
