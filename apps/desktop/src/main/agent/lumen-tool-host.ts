import type {
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentScrollBlock,
  WorkbenchBrowserAgentScrollDirection,
  WorkbenchBrowserAgentTargetMode
} from "../workbench-browser/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchObservedTabDescriptor } from "../../shared/workbench-observation";
import { materializeLumenCapture } from "./artifact-materializer";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readOptionalBooleanField,
  readOptionalNumberField,
  readOptionalStringField,
  readRuntimeTurnId,
  readStringField
} from "./host-payload";
import {
  NonBrowserWorkbenchTabError,
  readTabId,
  type WorkbenchBrowserTabResolver
} from "./workbench-observation-adapter";

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


export const createLumenToolHost = ({
  getBrowserBridge,
  tabResolver,
  storageRoot,
  getBrowserFollowMode
}: {
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly tabResolver: WorkbenchBrowserTabResolver;
  readonly storageRoot: string;
  readonly getBrowserFollowMode: () => boolean;
}): { readonly handlers: AgentHostCapabilityHandlers } => {
  const {
    resolveBrowserAgentTabId,
    readWorkbenchTabWithSummaryFallback,
    describeWorkbenchTabKind
  } = tabResolver;

  const readLumenStrategy = (
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

  const readLumenInteraction = (payload: Record<string, unknown>) => {
    const value = payload.interaction;
    if (value === "double_click" || value === "doubleClick") return "doubleClick";
    if (value === "right_click" || value === "rightClick") return "rightClick";
    return value === "hover" || value === "click" ? value : "click";
  };

  const readLumenVisualInteraction = (payload: Record<string, unknown>) => {
    const value = payload.interaction;
    if (value === "double_click" || value === "doubleClick") return "doubleClick";
    if (value === "right_click" || value === "rightClick") return "rightClick";
    if (value === "hover" || value === "drag" || value === "scroll") return value;
    return "click";
  };

  const readLumenFocusDirection = (payload: Record<string, unknown>) => {
    const value = payload.direction;
    return value === "next" || value === "previous" ? value : "scan";
  };

  const readLumenScrollDirection = (
    payload: Record<string, unknown>
  ): WorkbenchBrowserAgentScrollDirection | undefined => {
    const value = payload.direction;
    return value === "up" || value === "down" || value === "left" || value === "right"
      ? value
      : undefined;
  };

  const readLumenScrollBlock = (
    payload: Record<string, unknown>
  ): WorkbenchBrowserAgentScrollBlock | undefined => {
    const value = payload.block;
    return value === "start" || value === "center" || value === "end" || value === "nearest"
      ? value
      : undefined;
  };

  const readLumenScrollOperation = (payload: Record<string, unknown>) => {
    const value = payload.action ?? payload.operation;
    if (value === "scroll_to_target" || value === "ensure_visible" || value === "scroll") {
      return value;
    }
    const toolPath = typeof payload.toolPath === "string" ? payload.toolPath : "";
    if (toolPath.endsWith("/scroll_to_target")) return "scroll_to_target";
    if (toolPath.endsWith("/ensure_visible")) return "ensure_visible";
    return "scroll";
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

  const readLumenVerification = (payload: Record<string, unknown>) => {
    const value = payload.verification ?? payload.verify;
    return value === "full" ? "full" as const : "none" as const;
  };

  const nextRecommendedActionAfterFastLumenAction = (
    result: Record<string, unknown>
  ): string => {
    if (result.ok === false) {
      return "lyra_lumen_audit";
    }
    if (result.navigationStarted === true) {
      return "lyra_lumen.wait";
    }
    if (result.pageChanged === true) {
      return "lyra_lumen.map";
    }
    return "continue_with_cached_targets";
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
    ...(getBrowserFollowMode() && targetMode === "live" ? { visibleFollow: true } : {}),
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
      throw new Error(`${fieldName} must be a stable Lyra Lumen targetRef from /tools/browser/map`);
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

  const readOptionalLumenPoint = (payload: Record<string, unknown>) => {
    if (payload.point !== undefined) {
      return readLumenPoint(payload);
    }
    const x = payload.x;
    const y = payload.y;
    if (x === undefined && y === undefined) {
      return undefined;
    }
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
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

  const readOptionalLumenToPoint = (payload: Record<string, unknown>) => {
    if (payload.to === undefined) {
      return undefined;
    }
    if (!isRecord(payload.to)) {
      throw new Error("to must be an object with numeric x and y");
    }
    return readLumenPoint({ point: payload.to });
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
              "Workbench tab ids, browser tab ids, Lumen target refs, and observation-local element ids are separate. Call /tools/browser/map for the target tab, then prefer targetRef; use numeric elementId only with the same observation.",
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
        strategy: readLumenStrategy(payload, "interactiveOnly"),
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const highConfidenceBlockingSignal = observation.authChallengeSignals
        ?.find((signal) => signal.confidence === "high" && signal.kind !== "oauth_popup");
      const highConfidenceOauthSignal = observation.authChallengeSignals
        ?.find((signal) => signal.confidence === "high" && signal.kind === "oauth_popup");
      return withLumenTargetIds({
        ...observation,
        kind: "lyraLumenMap",
        ...(highConfidenceBlockingSignal !== undefined
          ? {
            needsUserAction: {
              kind: "auth_challenge",
              reason: highConfidenceBlockingSignal.kind,
              signal: highConfidenceBlockingSignal,
              tabId,
              targetMode,
              suggestedAction: "lyra_lumen_elevate"
            }
          }
          : {}),
        nextRecommendedAction:
          highConfidenceBlockingSignal !== undefined
            ? "lyra_lumen_elevate"
            : highConfidenceOauthSignal !== undefined
              ? "browser_ax.map"
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
      const verification = readLumenVerification(payload);
      const result = elementId === undefined && targetRef === undefined
        ? await browser.actOnAgentPoint(tabId, {
          point: readLumenPoint(payload),
          interaction: readLumenInteraction(payload),
          ...readLumenModeRequest(payload, targetMode),
          ...(verification === "full" ? { verification } : {}),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        })
        : await browser.actOnAgentElement(tabId, {
          ...(elementId === undefined ? {} : { elementId }),
          ...(targetRef === undefined ? {} : { targetRef }),
          interaction: readLumenInteraction(payload),
          ...readLumenModeRequest(payload, targetMode),
          ...(verification === "full" ? { verification } : {}),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(enriched)
      }, tabId, elementId);
    }),
    "lyraLumen.vact": withLyraLumenResult("lyraLumen.vact", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      if (payload.modelSupportsImageInput === false) {
        const fallback = await browser.readAgentPage(tabId, {
          strategy: "focus",
          ...readLumenModeRequest(payload, targetMode),
          timeoutMs: timeoutMs ?? 4_000
        }).catch(() => null);
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenVactFallback",
          tabId,
          targetMode,
          ...(fallback !== null && "browserMode" in fallback && fallback.browserMode !== undefined
            ? { browserMode: fallback.browserMode }
            : {}),
          content: fallback?.content ?? "",
          truncated: fallback === null ? false : ("truncated" in fallback ? fallback.truncated : false),
          message:
            "The active model does not support image input, so Lyra skipped visual coordinate action and fell back to DOM/text extraction. Use lyra_lumen.map and lyra_lumen.act with targetRef.",
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
      const to = readOptionalLumenToPoint(payload);
      const scrollDy = readOptionalNumberField(payload, "scrollDy");
      const verification = readLumenVerification(payload);
      const result = await browser.actOnAgentVisualPoint(tabId, {
        captureId: readStringField(payload, "captureId"),
        point: readLumenPoint(payload),
        interaction: readLumenVisualInteraction(payload),
        ...readLumenModeRequest(payload, targetMode),
        ...(to === undefined ? {} : { to }),
        ...(scrollDy === undefined ? {} : { scrollDy }),
        ...(verification === "full" ? { verification } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds({
        ...result,
        visual: true,
        captureId: readStringField(payload, "captureId"),
        nextRecommendedAction:
          result.kind === "lyraLumenVactStale"
            ? "lyra_lumen.see"
            : result.nextRecommendedAction ?? "lyra_lumen.see"
      }, tabId);
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
      const verification = readLumenVerification(payload);
      const result = await browser.typeIntoAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        text: readStringField(payload, "text"),
        clear: payload.clear === true,
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "full" ? { verification } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(enriched)
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
      const verification = readLumenVerification(payload);
      const result = await browser.pressAgentKey(tabId, {
        key: readStringField(payload, "key"),
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "full" ? { verification } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(enriched)
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
      const verification = readLumenVerification(payload);
      const result = await browser.pressAgentKey(tabId, {
        key: readOptionalStringField(payload, "key") ?? "Enter",
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "full" ? { verification } : {}),
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
    "lyraLumen.scroll": withLyraLumenResult("lyraLumen.scroll", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const operation = readLumenScrollOperation(payload);
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const elementId = readOptionalLumenElementId(payload);
      const targetRef = readOptionalLumenTargetRef(payload);
      const point = readOptionalLumenPoint(payload);
      if (
        (operation === "scroll_to_target" || operation === "ensure_visible")
        && elementId === undefined
        && targetRef === undefined
        && point === undefined
      ) {
        throw new Error(`${operation} requires targetRef, elementId, or point`);
      }
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const amount = readOptionalNumberField(payload, "amount");
      const pages = readOptionalNumberField(payload, "pages");
      const autoMap = readOptionalBooleanField(payload, "autoMap");
      const direction = readLumenScrollDirection(payload);
      const block = readLumenScrollBlock(payload);
      const reason: "explicit_scroll" | "ensure_visible" =
        operation === "ensure_visible" ? "ensure_visible" : "explicit_scroll";
      const scrollRequest = {
        ...(amount === undefined ? {} : { amount }),
        ...(pages === undefined ? {} : { pages }),
        ...(block === undefined ? {} : { block }),
        ...(payload.behavior === "smooth" ? { behavior: "smooth" as const } : {}),
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(point === undefined ? {} : { point }),
        ...(autoMap === undefined ? {} : { autoMap }),
        reason,
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      };
      const result = await browser.scrollAgentPage(tabId, {
        ...scrollRequest,
        ...(operation === "scroll"
          ? { direction: direction ?? "down" }
          : direction === undefined ? {} : { direction })
      });
      return withLumenTargetIds({
        ...result,
        kind: "lyraLumenScrollResult",
        nextRecommendedAction:
          result.ok === false
            ? "lyra_lumen.map"
            : result.nextRecommendedAction ?? "lyra_lumen.map"
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
    "lyraLumen.find": withLyraLumenResult("lyraLumen.find", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const direction = payload.direction === "next" || payload.direction === "previous"
        ? payload.direction
        : "current";
      const activeIndex = readOptionalNumberField(payload, "activeIndex");
      const maxMatches = readOptionalNumberField(payload, "maxMatches");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const result = await browser.findAgentPage(tabId, {
        query: readStringField(payload, "query"),
        direction,
        reveal: payload.reveal === true,
        caseSensitive: payload.caseSensitive === true,
        ...readLumenModeRequest(payload, targetMode),
        ...(activeIndex === undefined ? {} : { activeIndex }),
        ...(maxMatches === undefined ? {} : { maxMatches }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds({
        ...result,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.locate": withLyraLumenResult("lyraLumen.locate", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const maxMatches = readOptionalNumberField(payload, "maxMatches");
      const nearbyLimit = readOptionalNumberField(payload, "nearbyLimit");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const matchMode = payload.matchMode === "exact" ? "exact" : "semantic";
      const result = await browser.locateAgentPage(tabId, {
        query: readStringField(payload, "query"),
        matchMode,
        reveal: payload.reveal !== false,
        autoMap: payload.autoMap !== false,
        caseSensitive: payload.caseSensitive === true,
        ...readLumenModeRequest(payload, targetMode),
        ...(maxMatches === undefined ? {} : { maxMatches }),
        ...(nearbyLimit === undefined ? {} : { nearbyLimit }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds(result, tabId);
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
      if (payload.modelSupportsImageInput === false) {
        const fallback = await browser.readAgentPage(tabId, {
          strategy: "focus",
          ...readLumenModeRequest(payload, targetMode),
          timeoutMs: 4_000
        }).catch(() => null);
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenSeeFallback",
          tabId,
          targetMode,
          visualCapture: {
            ok: false,
            reason: "model_does_not_support_image_input"
          },
          ...(fallback !== null && "browserMode" in fallback && fallback.browserMode !== undefined
            ? { browserMode: fallback.browserMode }
            : {}),
          content: fallback?.content ?? "",
          truncated: fallback === null ? false : ("truncated" in fallback ? fallback.truncated : false),
          message:
            "The active model does not support image input; Lyra used DOM/text extraction instead of browser visual capture.",
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
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
        ...("visualFrame" in capture && capture.visualFrame !== undefined ? { visualFrame: capture.visualFrame } : {}),
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



  return { handlers: lyraLumenHandlers };
};
