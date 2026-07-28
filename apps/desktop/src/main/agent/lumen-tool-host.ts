import { isLyraSensitiveValueRef, type LyraSensitiveValueRef } from "../../shared/sensitive-value";
import type {
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentTargetMode,
  LumenScreenshotHighlightRegion,
  LumenScreenshotHighlightColor
} from "../workbench-browser/types";
import {
  judgeBrowserAgentTask,
  type BrowserTaskJudgeInput
} from "../workbench-browser/evals/browser-task-judge";
import {
  clampHostActionTimeoutMs,
  LUMEN_HOST_ACTION_TIMEOUT_MS
} from "../workbench-browser/view-manager-runtime/lumen-runtime-guards";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchObservedTabDescriptor } from "../../shared/workbench-observation";
import { materializeLumenCapture, materializeQrCropCapture } from "./artifact-materializer";
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
import {
  annotationColorForIndex,
  applyBrowserBlockedEnvelope,
  budgetMapResult,
  createLumenMapObservationCache,
  findActiveBrowserBlock,
  InvalidLumenElementIdError,
  isUncertainTimeoutMethod,
  LumenActionTimeoutError,
  nextRecommendedActionAfterFastLumenAction,
  readLumenAuditRequest,
  readLumenFocusDirection,
  readLumenInteraction,
  readLumenMapScope,
  readLumenPoint,
  readLumenQueryField,
  readLumenScrollBlock,
  readLumenScrollDirection,
  readLumenScrollOperation,
  readLumenSettle,
  readLumenStrategy,
  readLumenTargetMode,
  readLumenVerification,
  readLumenVisualInteraction,
  readLumenWaitUntil,
  readOptionalLumenActionEffect,
  readOptionalLumenElementId,
  readOptionalLumenPoint,
  readOptionalLumenTargetRef,
  readOptionalLumenToPoint,
  readWorkflowFields,
  truncateLumenTextContent,
  withLumenTargetIds
} from "./lumen-tool-host-helpers";

export const createLumenToolHost = ({
  getBrowserBridge,
  tabResolver,
  storageRoot,
  getBrowserFollowMode,
  resolveSensitiveValueForFill
}: {
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly tabResolver: WorkbenchBrowserTabResolver;
  readonly storageRoot: string;
  readonly getBrowserFollowMode: () => boolean;
  readonly resolveSensitiveValueForFill?: (
    ref: LyraSensitiveValueRef
  ) => Promise<string>;
}): { readonly handlers: AgentHostCapabilityHandlers } => {
  const {
    resolveBrowserAgentTabId,
    readWorkbenchTabWithSummaryFallback,
    listBrowserPageTabs,
    describeWorkbenchTabKind
  } = tabResolver;

  const readSensitiveFillText = async (payload: Record<string, unknown>): Promise<string> => {
    const sensitiveRef = payload.sensitiveValueRef;
    if (sensitiveRef !== undefined) {
      if (!isLyraSensitiveValueRef(sensitiveRef)) {
        throw new Error("sensitiveValueRef must be a valid lyra-sensitive-value-ref object.");
      }
      if (resolveSensitiveValueForFill === undefined) {
        throw new Error("Sensitive value fill is not available in this runtime.");
      }
      const secret = await resolveSensitiveValueForFill(sensitiveRef);
      return secret;
    }
    return readStringField(payload, "text");
  };

  const attemptPostTimeoutActionVerification = async (
    normalized: Record<string, unknown>,
    requestedMethod: string
  ): Promise<Record<string, unknown> | null> => {
    const actionMethods = [
      "lyraLumen.act",
      "lyraLumen.type",
      "lyraLumen.submit",
      "lyraLumen.press"
    ];
    if (!actionMethods.includes(requestedMethod)) {
      return null;
    }
    const browser = getBrowserBridge();
    if (browser?.verifyAgentActionOutcome === undefined) {
      return null;
    }
    try {
      const targetMode = readLumenTargetMode(normalized);
      const tabId = await resolveBrowserAgentTabId(normalized, targetMode);
      const targetRef = readOptionalLumenTargetRef(normalized);
      const elementId = readOptionalLumenElementId(normalized);
      const verification = await browser.verifyAgentActionOutcome(tabId, {
        targetMode,
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(elementId === undefined ? {} : { elementId }),
        ...(requestedMethod === "lyraLumen.type"
          ? {}
          : { interaction: readLumenInteraction(normalized) }),
        timeoutMs: 4_000
      }) as Record<string, unknown>;
      if (verification.verified !== true) {
        return null;
      }
      return {
        ok: true,
        kind: "lyraLumenActionResult",
        requestedMethod,
        status: "uncertain",
        outcome: "verified_after_timeout",
        verifiedAfterTimeout: true,
        tabId,
        targetMode,
        actionVerification: verification,
        message:
          "Action timed out before confirmation finished, but a follow-up observation detected a structural state change. Verify once with lyra_lumen.read before repeating the action.",
        nextRecommendedAction: "lyra_lumen.read"
      };
    } catch {
      return null;
    }
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

  const createLyraLumenNotApplicable = async (
    requestedMethod: string,
    targetTab: WorkbenchObservedTabDescriptor,
    payload: Record<string, unknown>
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
    const pageCandidates = listBrowserPageTabs === undefined
      ? []
      : await listBrowserPageTabs().catch(() => []);
    // Return ok: true so browser_interact treats this as a successful
    // (informational) result, not a hard failure. The model reads
    // notApplicable + pageCandidates and picks the right tab next.
    return {
      ok: true,
      kind: "lyraLumenResult",
      notApplicable: true,
      requestedMethod,
      requestedTabId: readTabId(payload) ?? targetTab.tabId,
      actualTabType: describeWorkbenchTabKind(targetTab),
      message:
        `Target tab is ${describeWorkbenchTabKind(targetTab)}, not a browser page. ` +
        "Use workbench_read_tab for this tab, or retry lyra_lumen on a browser page tab from pageCandidates.",
      recommendedTool: "workbench_read_tab",
      recommendedHostMethod: "workbench.readTab",
      tab: targetTab,
      pageCandidates: pageCandidates.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        pageKind: tab.pageKind,
        observationKind: tab.observationKind,
        displayAddress: tab.displayAddress,
        active: tab.active
      })),
      observation,
      ...(observationError === undefined ? {} : { observationError })
    };
  };

  const mapObservationCache = createLumenMapObservationCache();

  const withLyraLumenResult = (
    requestedMethod: string,
    handler: (payload: Record<string, unknown>) => Promise<unknown>
  ) => async (payload: unknown) => {
    const normalized = normalizePayload(payload);
    const actionTimeoutMs = clampHostActionTimeoutMs(
      readOptionalNumberField(normalized, "timeoutMs"),
      LUMEN_HOST_ACTION_TIMEOUT_MS
    );
    try {
      return await Promise.race([
        handler(normalized),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            reject(new LumenActionTimeoutError(requestedMethod, actionTimeoutMs));
          }, actionTimeoutMs);
        })
      ]);
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
        return await createLyraLumenNotApplicable(requestedMethod, error.tab, normalized);
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
      const message = error instanceof Error ? error.message : String(error);
      const isUncertainAction =
        error instanceof LumenActionTimeoutError
        && isUncertainTimeoutMethod(requestedMethod);
      if (isUncertainAction) {
        const verified = await attemptPostTimeoutActionVerification(normalized, requestedMethod);
        if (verified !== null) {
          return verified;
        }
        return {
          ok: false,
          kind: "lyraLumenResult",
          requestedMethod,
          status: "uncertain",
          outcome: "uncertain",
          error: {
            kind: "lyraLumenTimeout",
            message
          },
          message:
            "Action timed out before Lyra could confirm the result. Use lyra_lumen.read or lyra_lumen.find to verify whether it succeeded before retrying.",
          nextRecommendedAction: "lyra_lumen.read"
        };
      }
      return {
        ok: false,
        kind: "lyraLumenResult",
        requestedMethod,
        error: {
          kind: "lyraLumenRuntimeError",
          message
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
        mapScope: readLumenMapScope(payload) ?? "viewport",
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const mapKey = `${targetMode}:${tabId}`;
      const compacted = mapObservationCache.compact(mapKey, observation);
      const highConfidenceCaptcha = observation.authChallengeSignals
        ?.find((signal) => signal.confidence === "high" && signal.kind === "captcha");
      const highConfidenceBlockingSignal = observation.authChallengeSignals
        ?.find((signal) =>
          signal.confidence === "high"
          && signal.kind !== "oauth_popup"
          && signal.kind !== "captcha"
        );
      const highConfidenceOauthSignal = observation.authChallengeSignals
        ?.find((signal) => signal.confidence === "high" && signal.kind === "oauth_popup");
      const mapResult = applyBrowserBlockedEnvelope(
        budgetMapResult({
          ...compacted.observation,
          kind: "lyraLumenMap"
        }),
        findActiveBrowserBlock(compacted.observation.blockedRegions)
      );
      return withLumenTargetIds({
        ...mapResult,
        ...(observation.needsUserAction !== undefined
          ? { needsUserAction: observation.needsUserAction }
          : highConfidenceBlockingSignal !== undefined
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
            : highConfidenceCaptcha !== undefined
              ? {
                needsUserAction: {
                  kind: "auth_challenge",
                  reason: "captcha",
                  signal: highConfidenceCaptcha,
                  tabId,
                  targetMode,
                  suggestedAction: "ask_user"
                }
              }
              : {}),
        nextRecommendedAction:
          compacted.observation.nextRecommendedAction
          ?? (highConfidenceCaptcha !== undefined
            ? "ask_user"
            : highConfidenceBlockingSignal !== undefined
              ? "lyra_lumen_elevate"
              : highConfidenceOauthSignal !== undefined
                ? "browser_ax.map"
                : compacted.observation.elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read")
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
      const verification = readLumenVerification(payload, "fast");
      const effect = readOptionalLumenActionEffect(payload);
      const settle = readLumenSettle(payload);
      const workflow = readWorkflowFields(payload);
      const optionLabel = readOptionalStringField(payload, "optionLabel");
      const selectValue = readOptionalStringField(payload, "selectValue");
      if (workflow.cacheMode === "replay" && workflow.workflowId !== undefined) {
        const replayed = await browser.replayWorkflowOnPage(tabId, {
          workflowId: workflow.workflowId,
          ...(effect === undefined ? {} : { effect }),
          targetMode,
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
        const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, replayed);
        return withLumenTargetIds({
          ...enriched,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(enriched)
        }, tabId, elementId);
      }
      const result = elementId === undefined && targetRef === undefined
        ? await browser.actOnAgentPoint(tabId, {
          point: readLumenPoint(payload),
          ...(effect === undefined ? {} : { effect }),
          interaction: readLumenInteraction(payload),
          ...readLumenModeRequest(payload, targetMode),
          ...(verification === "none" ? {} : { verification }),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        })
        : await browser.actOnAgentElement(tabId, {
          ...(elementId === undefined ? {} : { elementId }),
          ...(targetRef === undefined ? {} : { targetRef }),
          ...(effect === undefined ? {} : { effect }),
          interaction: readLumenInteraction(payload),
          ...readLumenModeRequest(payload, targetMode),
          ...(verification === "none" ? {} : { verification }),
          ...(settle === undefined ? {} : { settle }),
          ...(workflow.workflowId === undefined ? {} : { workflowId: workflow.workflowId }),
          ...(workflow.cacheMode === "off" ? {} : { cacheMode: workflow.cacheMode }),
          ...(optionLabel === undefined ? {} : { optionLabel }),
          ...(selectValue === undefined ? {} : { selectValue }),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
      const enriched = await withLumenFailureDiagnostics(browser, tabId, targetMode, result);
      return withLumenTargetIds({
        ...enriched,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(enriched)
      }, tabId, elementId);
    }),
    "lyraLumen.plan": withLyraLumenResult("lyraLumen.plan", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const anchorText = readOptionalStringField(payload, "anchorText");
      const labelIncludesRaw = payload.labelIncludes;
      const rolesRaw = payload.roles;
      const labelIncludes = Array.isArray(labelIncludesRaw)
        ? labelIncludesRaw.filter((item): item is string => typeof item === "string")
        : undefined;
      const roles = Array.isArray(rolesRaw)
        ? rolesRaw.filter((item): item is string => typeof item === "string")
        : undefined;
      const maxCandidates = readOptionalNumberField(payload, "maxCandidates");
      const settle = readLumenSettle(payload);
      return browser.planAgentPage(tabId, {
        targetMode,
        ...(anchorText === undefined ? {} : { anchorText }),
        ...(roles === undefined ? {} : { roles }),
        ...(labelIncludes === undefined ? {} : { labelIncludes }),
        ...(maxCandidates === undefined ? {} : { maxCandidates }),
        ...(settle === undefined ? {} : { settle }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
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
      const effect = readOptionalLumenActionEffect(payload);
      const captureId = readStringField(payload, "captureId");
      const axRef = readOptionalStringField(payload, "axRef");
      // When axRef is supplied, derive the click point from the AX node's bbox
      // center instead of reading device-pixel coordinates from the screenshot.
      // The captureId is still required so the executor can verify the viewport
      // hasn't scrolled/resized since the see call.
      let point = readOptionalLumenPoint(payload);
      if (axRef !== undefined) {
        const bbox = await browser.axResolveAxRefBbox(tabId, { axRef, targetMode });
        if (!bbox.ok || bbox.bounds === undefined) {
          return withLumenTargetIds({
            ok: false,
            kind: "lyraLumenVactStale",
            tabId,
            targetMode,
            captureId,
            reason: "axref_unresolved",
            message: bbox.ok === false
              ? `Could not resolve axRef for vact: ${bbox.error.message}`
              : "The AX node has no bounding box; cannot derive a click point.",
            nextRecommendedAction: "browser_ax.map"
          }, tabId);
        }
        // bbox.bounds is in CSS pixels; the visual point is expected in
        // device-pixel space (origin = top-left of the see screenshot). The
        // executor's cssPointFromVisualFrame divides by dpr, so we pass CSS
        // coordinates here and let it convert. Use bbox center.
        point = {
          x: bbox.bounds.x + Math.round(bbox.bounds.width / 2),
          y: bbox.bounds.y + Math.round(bbox.bounds.height / 2),
          reason: `axRef ${axRef} bbox center`
        };
      }
      if (point === undefined) {
        return withLumenTargetIds({
          ok: false,
          kind: "lyraLumenVactStale",
          tabId,
          targetMode,
          captureId,
          reason: "missing_point",
          message: "vact requires either a point (device-pixel x/y) or an axRef. Provide one of them alongside captureId.",
          nextRecommendedAction: "lyra_lumen.see"
        }, tabId);
      }
      const result = await browser.actOnAgentVisualPoint(tabId, {
        captureId,
        point,
        ...(effect === undefined ? {} : { effect }),
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
        captureId,
        ...(axRef === undefined ? {} : { axRef }),
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
      const verification = readLumenVerification(payload, "fast");
      const effect = readOptionalLumenActionEffect(payload);
      const fillText = await readSensitiveFillText(payload);
      const result = await browser.typeIntoAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(effect === undefined ? {} : { effect }),
        text: fillText,
        clear: payload.clear === true,
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "none" ? {} : { verification }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(payload.sensitiveValueRef === undefined
          ? {}
          : { sensitiveFill: true, inputValuePreview: "[secret:redacted]" })
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
      const effect = readOptionalLumenActionEffect(payload);
      const result = await browser.pressAgentKey(tabId, {
        key: readStringField(payload, "key"),
        ...(effect === undefined ? {} : { effect }),
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
      const effect = readOptionalLumenActionEffect(payload);
      const result = await browser.pressAgentKey(tabId, {
        key: readOptionalStringField(payload, "key") ?? "Enter",
        ...(effect === undefined ? {} : { effect }),
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
      const useFrameworkRouter = payload.useFrameworkRouter === true;
      let resolvedTabId = explicitTabId ?? browser.readActiveTabId() ?? "";
      const res = targetMode === "live"
        ? await browser.navigate({
          address: url,
          newTab: payload.newTab === true,
          ...(useFrameworkRouter ? { useFrameworkRouter: true } : {}),
          ...(explicitTabId === null ? {} : { tabId: explicitTabId })
        })
        : await (async () => {
          resolvedTabId = await resolveBrowserAgentTabId(payload, targetMode);
          return await browser.navigateAgentPage(resolvedTabId, {
            url,
            ...readLumenModeRequest(payload, targetMode),
            ...(useFrameworkRouter ? { useFrameworkRouter: true } : {}),
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
        message: `Navigated Lyra Lumen to ${res.address}.`,
        nextRecommendedAction: "lyra_lumen.map"
      }, res.tabId ?? resolvedTabId);
    }),
    "lyraLumen.reload": withLyraLumenResult("lyraLumen.reload", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const ignoreCache = payload.ignoreCache === true;
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const res = await browser.reloadAgentPage(tabId, {
        ...readLumenModeRequest(payload, targetMode),
        ignoreCache,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenReload",
        tabId: res.tabId,
        url: res.address,
        title: res.title,
        targetMode: res.targetMode,
        reloaded: true,
        ignoreCache: res.ignoreCache,
        ...("browserMode" in res && res.browserMode !== undefined ? { browserMode: res.browserMode } : {}),
        message: res.ignoreCache
          ? "Reloaded the current Lyra browser page and bypassed cache."
          : "Reloaded the current Lyra browser page.",
        nextRecommendedAction: "lyra_lumen.map"
      }, res.tabId ?? tabId);
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
        query: readLumenQueryField(payload),
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
        query: readLumenQueryField(payload),
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
      const readTimeoutMs = Math.min(timeoutMs ?? 4_000, 4_000);
      const modeRequest = readLumenModeRequest(payload, targetMode);
      const readPage = (readStrategy: WorkbenchBrowserAgentObserveStrategy) =>
        browser.readAgentPage(tabId, {
          strategy: readStrategy,
          ...modeRequest,
          ...(maxChars === undefined ? {} : { maxChars }),
          timeoutMs: readTimeoutMs
        });
      const formatRead = (
        content: Awaited<ReturnType<typeof browser.readAgentPage>>,
        readStrategy: WorkbenchBrowserAgentObserveStrategy,
        degraded?: { readonly reason: string }
      ) => {
        if (readStrategy === "domFallback") {
          return withLumenTargetIds({
            ok: true,
            kind: "lyraLumenRead",
            tabId,
            strategy: readStrategy,
            targetMode,
            ...("browserMode" in content && content.browserMode !== undefined ? { browserMode: content.browserMode } : {}),
            content: content.content,
            summary: content,
            truncated: "truncated" in content ? content.truncated : false,
            ...(degraded === undefined ? {} : { degraded: true, warning: degraded.reason }),
            nextRecommendedAction: "lyra_lumen.map"
          }, tabId);
        }
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenRead",
          tabId,
          strategy: readStrategy,
          targetMode,
          ...("browserMode" in content && content.browserMode !== undefined ? { browserMode: content.browserMode } : {}),
          content: content.content,
          truncated: "truncated" in content ? content.truncated : false,
          ...("startChar" in content ? { startChar: content.startChar } : {}),
          ...("endChar" in content ? { endChar: content.endChar } : {}),
          ...("totalChars" in content ? { totalChars: content.totalChars } : {}),
          ...(degraded === undefined ? {} : { degraded: true, warning: degraded.reason }),
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      };
      try {
        return formatRead(await readPage(strategy), strategy);
      } catch (error) {
        const handoff = isRecord(error) && isRecord(error.handoff) ? error.handoff : null;
        if (handoff !== null && handoff.kind === "browser-shared-control-interrupted") {
          throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        if (strategy !== "domFallback") {
          try {
            return formatRead(await readPage("domFallback"), "domFallback", { reason });
          } catch {
            // Fall through to a non-failing state-only result; the model can still map/see.
          }
        }
        const state = browser.readPageState({ tabId });
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenRead",
          tabId,
          strategy,
          targetMode,
          content: "",
          degraded: true,
          warning: reason,
          pageState: state === null
            ? null
            : {
              address: state.address,
              title: state.title,
              isLoading: state.isLoading
            },
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
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
          ...(() => {
            const budgeted = truncateLumenTextContent(fallback?.content ?? "");
            return { content: budgeted.content, truncated: budgeted.truncated };
          })(),
          message:
            "The active model does not support image input; Lyra used DOM/text extraction instead of browser visual capture.",
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
      const highlightTargetRefs = Array.isArray(payload.highlightTargetRefs)
        ? payload.highlightTargetRefs.filter((value): value is string => typeof value === "string")
        : undefined;
      const annotateRequested = readOptionalBooleanField(payload, "annotate") === true;
      const annotateAxRefs = Array.isArray(payload.annotateAxRefs)
        ? payload.annotateAxRefs.filter((value): value is string => typeof value === "string")
        : undefined;
      // Build AX-derived annotation regions when annotate:true. We query the
      // latest AX snapshot for nodes with bounds, optionally filtered to the
      // caller-supplied axRefs, and convert their CSS bounds to device-pixel
      // regions so captureAgentPage can draw them as colored boxes.
      const annotationRegions: LumenScreenshotHighlightRegion[] = [];
      const annotationTable: Array<{
        readonly index: number;
        readonly axRef: string;
        readonly role: string;
        readonly name: string;
        readonly color: LumenScreenshotHighlightColor;
      }> = [];
      if (annotateRequested) {
        const query = await Promise.resolve()
          .then(() => browser.axQueryAgentSnapshot(tabId, {
            targetMode,
            maxResults: 50
          }))
          .catch(() => null);
        const allowedAxRefs = annotateAxRefs === undefined ? null : new Set(annotateAxRefs);
        const visualFrameHint = (await browser.captureAgentPage(tabId, {
          ...readLumenModeRequest(payload, targetMode),
          highlightTargets: false,
          downsampleForVision: false
        }).catch(() => null));
        const dpr = (visualFrameHint !== null && "visualFrame" in visualFrameHint && visualFrameHint.visualFrame !== undefined)
          ? visualFrameHint.visualFrame.dpr
          : 1;
        const scrollX = (visualFrameHint !== null && "visualFrame" in visualFrameHint && visualFrameHint.visualFrame !== undefined)
          ? visualFrameHint.visualFrame.scrollX
          : 0;
        const scrollY = (visualFrameHint !== null && "visualFrame" in visualFrameHint && visualFrameHint.visualFrame !== undefined)
          ? visualFrameHint.visualFrame.scrollY
          : 0;
        if (query !== null && query.ok) {
          for (let i = 0; i < query.matches.length; i += 1) {
            const match = query.matches[i]!;
            if (match.bounds === undefined) {
              continue;
            }
            if (allowedAxRefs !== null && !allowedAxRefs.has(match.axRef)) {
              continue;
            }
            const color = annotationColorForIndex(annotationRegions.length);
            const deviceBounds = {
              x: Math.round((match.bounds.x - scrollX) * dpr),
              y: Math.round((match.bounds.y - scrollY) * dpr),
              width: Math.max(1, Math.round(match.bounds.width * dpr)),
              height: Math.max(1, Math.round(match.bounds.height * dpr))
            };
            annotationRegions.push({
              targetRef: match.axRef,
              elementId: -1,
              label: match.name,
              role: match.role,
              bounds: match.bounds,
              deviceBounds,
              index: annotationRegions.length,
              color,
              axRef: match.axRef
            });
            annotationTable.push({
              index: annotationTable.length - 1,
              axRef: match.axRef,
              role: match.role,
              name: match.name,
              color
            });
          }
        }
      }
      const capture = await browser.captureAgentPage(
        tabId,
        {
          ...readLumenModeRequest(payload, targetMode),
          highlightTargets: annotateRequested ? false : (readOptionalBooleanField(payload, "highlightTargets") ?? true),
          downsampleForVision: readOptionalBooleanField(payload, "downsampleForVision") ?? true,
          ...(highlightTargetRefs === undefined || highlightTargetRefs.length === 0
            ? {}
            : { highlightTargetRefs }),
          ...(annotationRegions.length === 0 ? {} : { prebuiltHighlightRegions: annotationRegions })
        }
      ).catch(async (error: unknown) => {
        if (
          error === null
          || typeof error !== "object"
          || (error as { readonly code?: unknown }).code !== "background_visual_capture_unsupported"
        ) {
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
          ...(() => {
            const budgeted = truncateLumenTextContent(fallback?.content ?? "");
            return { content: budgeted.content, truncated: budgeted.truncated };
          })(),
          message:
            "Visual capture is unavailable while this browser tab is in the background; Lyra used text extraction instead.",
          nextRecommendedAction: "lyra_lumen.map"
        };
      });
      if ("imageBase64" in capture === false) {
        return withLumenTargetIds(capture, tabId);
      }
      const imageArtifact = await materializeLumenCapture(storageRoot, tabId, capture);
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
        ...("highlightRegions" in capture && Array.isArray(capture.highlightRegions)
          ? { highlightRegions: capture.highlightRegions }
          : {}),
        ...("highlighted" in capture && capture.highlighted === true ? { highlighted: true } : {}),
        ...("downsampled" in capture && capture.downsampled === true ? { downsampled: true } : {}),
        ...(annotationTable.length === 0 ? {} : { annotations: annotationTable }),
        imageArtifact,
        evidenceRefs: [imageArtifact.id],
        message:
          `Captured browser visual evidence ${imageArtifact.id} (${capture.width}x${capture.height})${
            "highlighted" in capture && capture.highlighted === true ? " with targetRef highlights" : ""
          }${
            annotationTable.length > 0
              ? `. Annotated ${annotationTable.length} AX node${annotationTable.length === 1 ? "" : "s"} with colored boxes; use the annotations table (index → axRef → role → name → color) to pick a target, then call /tools/browser/vact with axRef.`
              : ""
          }.`,
        nextRecommendedAction: annotationTable.length > 0 ? "lyra_lumen.vact" : "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.extract": withLyraLumenResult("lyraLumen.extract", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const instruction = readStringField(payload, "instruction");
      const scope = payload.scope === "full" ? "full" : "viewport";
      // schema is an arbitrary JSON object; pass it back to the model as a hint.
      const schemaHint = isRecord(payload.schema) ? payload.schema : undefined;
      const read = await browser.readAgentPage(tabId, {
        strategy: scope === "full" ? "domFallback" : "focus",
        ...readLumenModeRequest(payload, targetMode),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      }).catch(() => null);
      const budgeted = truncateLumenTextContent(read?.content ?? "");
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenExtract",
        tabId,
        targetMode,
        instruction,
        ...(schemaHint === undefined ? {} : { schemaHint }),
        scope,
        ...("browserMode" in (read ?? {}) && (read as { browserMode?: unknown }).browserMode !== undefined
          ? { browserMode: (read as { browserMode: unknown }).browserMode }
          : {}),
        content: budgeted.content,
        truncated: budgeted.truncated,
        message: `Read browser page for structured extraction. Conform your next reply to the provided JSON schema${
          schemaHint === undefined ? "" : " (schemaHint)"
        }. Instruction: ${instruction}`,
        nextRecommendedAction: "lyra_lumen.map"
      }, tabId);
    }),
    "lyraLumen.detectQr": withLyraLumenResult("lyraLumen.detectQr", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const regionRecord = isRecord(payload.region) ? payload.region : undefined;
      const region = regionRecord === undefined
        ? undefined
        : (() => {
            const x = Number(regionRecord.x);
            const y = Number(regionRecord.y);
            const width = Number(regionRecord.width);
            const height = Number(regionRecord.height);
            if (
              Number.isFinite(x) === false
              || Number.isFinite(y) === false
              || Number.isFinite(width) === false
              || Number.isFinite(height) === false
              || width <= 0
              || height <= 0
            ) {
              return undefined;
            }
            return {
              x: Math.round(x),
              y: Math.round(y),
              width: Math.round(width),
              height: Math.round(height)
            };
          })();
      const maxCodes = readOptionalNumberField(payload, "maxCodes");
      const cropPadding = readOptionalNumberField(payload, "cropPadding");
      const result = await browser.detectAgentPageQr(tabId, {
        ...readLumenModeRequest(payload, targetMode),
        ...(region === undefined ? {} : { region }),
        ...(maxCodes === undefined ? {} : { maxCodes }),
        cropQr: readOptionalBooleanField(payload, "cropQr") ?? true,
        includePageCapture: readOptionalBooleanField(payload, "includePageCapture") ?? false,
        ...(cropPadding === undefined ? {} : { cropPadding })
      });
      if (result.ok === false) {
        return withLumenTargetIds(result, tabId);
      }
      const evidenceRefs: string[] = [];
      const codes = await Promise.all(
        result.codes.map(async (code, index) => {
          if (code.cropArtifact === undefined) {
            return {
              payload: code.payload,
              format: code.format,
              bounds: code.bounds,
              center: code.center,
              corners: code.corners,
              confidence: code.confidence
            };
          }
          const cropArtifact = await materializeQrCropCapture(storageRoot, tabId, code.cropArtifact, index);
          evidenceRefs.push(cropArtifact.id);
          return {
            payload: code.payload,
            format: code.format,
            bounds: code.bounds,
            center: code.center,
            corners: code.corners,
            confidence: code.confidence,
            cropArtifact
          };
        })
      );
      let pageArtifact: Awaited<ReturnType<typeof materializeLumenCapture>> | undefined;
      if (result.pageCapture !== undefined) {
        pageArtifact = await materializeLumenCapture(storageRoot, tabId, result.pageCapture);
        evidenceRefs.unshift(pageArtifact.id);
      }
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenDetectQr",
        tabId,
        targetMode: result.targetMode,
        ...("browserMode" in result && result.browserMode !== undefined ? { browserMode: result.browserMode } : {}),
        codes,
        coordinateSpace: result.coordinateSpace,
        captureId: result.captureId,
        width: result.width,
        height: result.height,
        visualFrame: result.visualFrame,
        ...(pageArtifact === undefined ? {} : { pageArtifact }),
        ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
        message: result.message,
        nextRecommendedAction: result.nextRecommendedAction
      }, tabId);
    }),
    "lyraLumen.judgeTask": withLyraLumenResult("lyraLumen.judgeTask", async (payload) => {
      const trajectory = isRecord(payload.trajectory) && Array.isArray(payload.trajectory.steps)
        ? {
            steps: payload.trajectory.steps.filter((step): step is Record<string, unknown> => isRecord(step)).map((step) => ({
              toolPath: typeof step.toolPath === "string" ? step.toolPath : "unknown",
              ok: step.ok === true,
              ...(typeof step.pathTaken === "string" ? { pathTaken: step.pathTaken } : {}),
              ...(Array.isArray(step.elementDiffChanged)
                ? { elementDiffChanged: step.elementDiffChanged.filter((value): value is string => typeof value === "string") }
                : {}),
              ...(step.cacheHit === true ? { cacheHit: true } : {}),
              ...(step.cacheMiss === true ? { cacheMiss: true } : {})
            }))
          }
        : { steps: [] };
      const finalObservation = isRecord(payload.finalObservation)
        ? payload.finalObservation as BrowserTaskJudgeInput["finalObservation"]
        : undefined;
      const verdict = judgeBrowserAgentTask({
        trajectory,
        ...(finalObservation === undefined ? {} : { finalObservation })
      });
      return {
        ok: true,
        kind: "lyraLumenTaskJudge",
        status: verdict.status,
        confidence: verdict.confidence,
        findings: verdict.findings,
        trajectory: verdict.trajectory,
        ...(verdict.recommendedAction === undefined ? {} : { nextRecommendedAction: verdict.recommendedAction })
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
