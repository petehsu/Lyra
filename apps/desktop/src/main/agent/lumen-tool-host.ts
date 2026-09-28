import { enrichLumenStructure } from "./lumen-structure-result";
import type { VisualActRequest } from "../workbench-browser/view-manager-runtime/visual-scene-types";
import { validatePointerOptions, type PointerOptions } from "../workbench-browser/view-manager-runtime/bound-pointer";
import { browserSensitiveBoundary } from "../sensitive-values/browser-boundary";
import { browserAgentOperationContext, trackBrowserOperation } from "../workbench-browser/agent-operation-context";
import { createLumenSessionPages } from "./lumen-session-pages";
import { lumenMapResult } from "./lumen-map-result";
import { createLumenMapPager } from "./lumen-map-pager";
import { waitForLumenPage } from "./lumen-page-wait";
import { isLyraSensitiveValueRef, type LyraSensitiveValueRef } from "../../shared/sensitive-value";
import type {
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentTargetMode
} from "../workbench-browser/types";
import {
  clampHostActionTimeoutMs,
  LUMEN_HOST_ACTION_TIMEOUT_MS
} from "../workbench-browser/view-manager-runtime/lumen-runtime-guards";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { grantBrowserAuthorizeAct } from "../open-in-workbench";
import { loginMapNoteForStorage } from "./login-map-note";
import type { WorkbenchObservedTabDescriptor } from "../../shared/workbench-observation";
import {
  allocateLiveAgentBrowserPreviewTabId,
  rememberAgentBrowserPreviewTarget
} from "./agent-browser-preview-target";
import { materializeLumenCapture, materializeQrCropCapture } from "./artifact-materializer";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readOptionalBooleanField,
  readOptionalNumberField,
  readOptionalStringField,
  readRuntimeTurnId,
  readRuntimeSessionId,
  readStringField
} from "./host-payload";
import {
  NonBrowserWorkbenchTabError,
  readTabId,
  type WorkbenchBrowserTabResolver
} from "./workbench-observation-adapter";
import {
  applyBrowserBlockedEnvelope,
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
  loginManagerStorageRoot,
  resolveSensitiveValueForFill
}: {
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly tabResolver: WorkbenchBrowserTabResolver;
  readonly storageRoot: string;
  readonly loginManagerStorageRoot?: string;
  readonly resolveSensitiveValueForFill?: (
    ref: LyraSensitiveValueRef
  ) => Promise<string>;
}): { readonly handlers: AgentHostCapabilityHandlers } => {
  const {
    resolveBrowserAgentTabId: resolveWorkbenchBrowserAgentTabId,
    readWorkbenchTabWithSummaryFallback,
    listBrowserPageTabs,
    describeWorkbenchTabKind
  } = tabResolver;

  const mapPager = createLumenMapPager();

  const readLumenInputFields = (
    payload: Record<string, unknown>
  ): readonly { readonly targetRef: string; readonly text: string; readonly clear?: boolean }[] | undefined => {
    const value = payload.fields;
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("fields must be a non-empty list of targetRef and text");
    }
    return value.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("fields must be a non-empty list of targetRef and text");
      }
      const record = entry as Record<string, unknown>;
      const targetRef = record.targetRef;
      const text = record.text;
      if (typeof targetRef !== "string" || targetRef.trim().length === 0 || typeof text !== "string" || (text.length === 0 && record.clear !== true)) {
        throw new Error("fields must be a non-empty list of targetRef and text");
      }
      return {
        targetRef: targetRef.trim(),
        text,
        ...(record.clear === true ? { clear: true } : {})
      };
    });
  };

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
      browserSensitiveBoundary.remember(sensitiveRef, secret);
      return secret;
    }
    const text = payload.text;
    if (typeof text !== "string" || (text.length === 0 && payload.clear !== true)) {
      throw new Error("text must be a string; empty text requires clear=true");
    }
    return text;
  };

  const attemptPostTimeoutActionVerification = async (
    normalized: Record<string, unknown>,
    requestedMethod: string
  ): Promise<Record<string, unknown> | null> => {
    const actionMethods = [
      "lyraLumen.act",
      "lyraLumen.type",
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
    // Return ok: true so callers treat this as a successful
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


  const sessionPages = createLumenSessionPages();
  const resolveBrowserAgentTabId = (payload: Record<string, unknown>, targetMode: "live" | "isolated") => {
    const tabId = readTabId(payload);
    // A task's isolated page has its own browser instance and need not appear
    // in the user's live workbench topology. Never use this exemption for live tabs.
    if (targetMode === "isolated" && tabId && sessionPages.pages(payload).some(page => page.tabId === tabId)) {
      return Promise.resolve(tabId);
    }
    return resolveWorkbenchBrowserAgentTabId(payload, targetMode);
  };
  const withLyraLumenResult = (
    requestedMethod: string,
    handler: (payload: Record<string, unknown>) => Promise<unknown>
  ) => async (payload: unknown) => {
    let normalized = normalizePayload(payload);
    const actionTimeoutMs = clampHostActionTimeoutMs(
      readOptionalNumberField(normalized, "timeoutMs"),
      LUMEN_HOST_ACTION_TIMEOUT_MS
    );
    const operation = trackBrowserOperation(readRuntimeTurnId(normalized));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      normalized = sessionPages.prepare(requestedMethod, normalized);
      const awaitResponse = normalized.awaitResponse === true;
      if (awaitResponse && (!['lyraLumen.act','lyraLumen.type','lyraLumen.press'].includes(requestedMethod)
        || normalized.effect !== 'communicate'
        || requestedMethod === 'lyraLumen.type' && typeof normalized.thenClick !== 'string')) {
        throw new Error("awaitResponse requires an explicit communicate send (type with thenClick, act, or press). No action was executed.");
      }
      const startedAt = Date.now();
      const result = await Promise.race([
        browserAgentOperationContext.run({signal:operation.controller.signal,sessionId:readRuntimeSessionId(normalized),
          ...(readRuntimeTurnId(normalized) ? {turnId:readRuntimeTurnId(normalized)!} : {})}, async () => {
          const pendingTab = readTabId(normalized) ?? sessionPages.current(normalized);
          if (pendingTab && requestedMethod !== "lyraLumen.dialog" && requestedMethod !== "lyraLumen.navigate") {
            const pending=getBrowserBridge()?.peekAgentDialog?.(pendingTab,readLumenTargetMode(normalized));
            if(pending)return pending;
          }
          let action = await handler(normalized);
          const structureBrowser=getBrowserBridge();
          if(structureBrowser && isRecord(action))action=await enrichLumenStructure(structureBrowser,requestedMethod,normalized,action);
          if (!awaitResponse || !isRecord(action) || action.ok === false || action.status === "dialogPending") return action;
          const browser = getBrowserBridge();
          if (!browser || typeof action.tabId !== 'string' || !isRecord(action.responseWatch) || typeof action.responseWatch.operationId !== 'string') {
            return {...action, completion:'unknown', responseError:'No response observation was established. The action must not be repeated automatically.'};
          }
          try {
            const targetMode = readLumenTargetMode(normalized);
            const waited = await waitForLumenPage(browser, action.tabId, {
              ...readLumenModeRequest(normalized,targetMode), targetMode, until:'responseComplete',
              operationId:action.responseWatch.operationId, idleMs:160, scope:'full',
              timeoutMs:Math.max(0,Math.min(30000,actionTimeoutMs-(Date.now()-startedAt)-750))
            });
            return {...action, response:waited.content.content, waitState:waited.content.waitState,
              matched:waited.matched, completion:waited.matched?'conditionMet':'unknown',
              nextRecommendedAction:waited.matched?'use_returned_state':'inspect_returned_state_before_waiting',
              responseElapsedMs:waited.elapsedMs, responseTruncated:waited.content.truncated === true};
          } catch (error) {
            // A failed read after a send is not a failed send. Never invite retry.
            return {...action,completion:'unknown',responseError:String(error),nextRecommendedAction:'inspect_returned_state_before_waiting'};
          }
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            operation.controller.abort(new Error("Browser action timed out"));
            reject(new LumenActionTimeoutError(requestedMethod, actionTimeoutMs));
          }, actionTimeoutMs);
        })
      ]);
      if (isRecord(result)) {
        sessionPages.remember(normalized, result, requestedMethod);
        const context = sessionPages.summary(normalized);
        if (context && typeof result.mapAppendix === "string") result.mapAppendix += `\n${context}`;
        if (context && requestedMethod === "lyraLumen.navigate") result.message = `${result.message}\n${context}`;
      }
      return result;
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
      if (/not materialized|Unknown Workbench tab|Targets belong to different tabs/.test(message)) {
        const candidates = listBrowserPageTabs ? await listBrowserPageTabs().catch(() => []) : [];
        return { ok: false, kind: "lyraLumenResult", requestedMethod,
          error: { kind: "browserTabUnavailable", message },
          pageCandidates: candidates.map(tab => ({tabId:tab.tabId,title:tab.title,address:tab.displayAddress,active:tab.active})),
          message: `${message} Select an existing tabId with browser_map; no other tab was substituted.`,
          nextRecommendedAction: "lyra_lumen.map" };
      }
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
            "Action timed out before Lyra could confirm the result. Use lyra_lumen.read to verify whether it succeeded before retrying.",
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
    finally { operation.dispose(); if (timer !== undefined) clearTimeout(timer); }
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

  // Action failures report the action error. Historical page diagnostics are
  // available through lyraLumen.audit; attaching them here inflates every retry
  // and wrongly presents unrelated console errors as the cause of this action.
  const lyraLumenHandlers: AgentHostCapabilityHandlers = {
    "lyraLumen.dialog": withLyraLumenResult("lyraLumen.dialog", async payload => {
      const browser=getBrowserBridge();if(!browser)throw new Error("Browser capability is not available");
      const targetMode=readLumenTargetMode(payload),tabId=await resolveBrowserAgentTabId(payload,targetMode);
      const effect=readOptionalLumenActionEffect(payload);
      if(!effect || typeof payload.accept!=="boolean")throw new Error("A dialog requires accept and its effect");
      if(payload.promptText!==undefined && typeof payload.promptText!=="string")throw new Error("promptText must be a literal string");
      return browser.handleAgentDialog(tabId,{targetMode,effect,accept:payload.accept,dialogId:readStringField(payload,"dialogId"),
        ...(payload.promptText===undefined?{}:{promptText:payload.promptText})});
    }),
    "lyraLumen.drag": withLyraLumenResult("lyraLumen.drag", async payload => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload), tabId = await resolveBrowserAgentTabId(payload,targetMode);
      const effect = readOptionalLumenActionEffect(payload);
      if (!effect || effect === "observe" || effect === "unknown") throw new Error("Declare the effect of this drag");
      return browser.dragAgentElement(tabId,{targetMode,effect,targetRef:readStringField(payload,"targetRef"),toTargetRef:readStringField(payload,"toTargetRef"),
        ...(payload.modifiers === undefined ? {} : {modifiers:payload.modifiers as PointerOptions["modifiers"]}),
        ...(payload.fromPosition === undefined ? {} : {fromPosition:payload.fromPosition as PointerOptions["position"]}),
        ...(payload.toPosition === undefined ? {} : {toPosition:payload.toPosition as PointerOptions["position"]})});
    }),
    "lyraLumen.upload": withLyraLumenResult("lyraLumen.upload", async payload => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      if (payload.effect !== "upload") throw new Error("Uploading files requires effect=upload.");
      if (!Array.isArray(payload.files) || payload.files.some(path => typeof path !== "string")) {
        throw new Error("files must contain explicit absolute local file paths.");
      }
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const targetRef = readOptionalLumenTargetRef(payload), chooserId = readOptionalStringField(payload, "chooserId");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      return withLumenTargetIds(await browser.uploadAgentFiles(tabId, {
        files: payload.files as string[], effect: "upload", targetMode,
        ...(targetRef === undefined ? {} : { targetRef }), ...(chooserId === undefined ? {} : { chooserId }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      }), tabId);
    }),
    "lyraLumen.map": withLyraLumenResult("lyraLumen.map", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const view = { query: readOptionalStringField(payload, "query"), region: readOptionalStringField(payload, "region"), cursor: readOptionalStringField(payload, "cursor") };
      const key = JSON.stringify([readRuntimeSessionId(payload) ?? "", targetMode, tabId]);
      const presented = view.cursor
        ? mapPager.next(key, view, (await browser.readAgentPreviewPage(tabId, targetMode))?.url)
        : mapPager.start(key, await browser.observeAgentPage(tabId, {
          strategy: "interactiveOnly", mapScope: "document",
          ...readLumenModeRequest(payload, targetMode),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        }), view);
      const compacted = { observation: { ...presented.observation, mapAppendix: presented.mapAppendix } };
      const savedSignIn = loginMapNoteForStorage(
        compacted.observation.url,
        compacted.observation.elements,
        loginManagerStorageRoot
      );
      const mapAppendix = savedSignIn.length === 0
        ? compacted.observation.mapAppendix
        : [compacted.observation.mapAppendix, savedSignIn].filter((line) => (line ?? "").length > 0).join("\n");
      const mapResult = applyBrowserBlockedEnvelope(
        lumenMapResult(compacted.observation, mapAppendix ?? ""),
        findActiveBrowserBlock(compacted.observation.blockedRegions)
      );
      return withLumenTargetIds({
        ...mapResult,
        nextRecommendedAction:
          compacted.observation.nextRecommendedAction
          ?? (compacted.observation.elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read")
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
      const optionLabel = payload.optionLabel;
      const optionQuery = payload.optionQuery;
      const optionOffset = payload.optionOffset;
      if (optionLabel !== undefined && typeof optionLabel !== "string") throw new Error("optionLabel must be a string");
      if (optionQuery !== undefined && typeof optionQuery !== "string") throw new Error("optionQuery must be a string");
      if (optionOffset !== undefined && (!Number.isInteger(optionOffset) || Number(optionOffset) < 0)) throw new Error("optionOffset must be a nonnegative integer");
      const selectValue = payload.selectValue;
      const selectValues = payload.selectValues;
      if (selectValue !== undefined && typeof selectValue !== "string") throw new Error("selectValue must be a string");
      if (selectValues !== undefined && (!Array.isArray(selectValues) || selectValues.length > 100 || selectValues.some(value => typeof value !== "string"))) throw new Error("selectValues must be an array of strings");
      const pointer = Object.fromEntries(["modifiers", "button", "holdMs", "position"].filter(key => payload[key] !== undefined).map(key => [key, payload[key]])) as PointerOptions;
      validatePointerOptions(pointer);
      if (Object.keys(pointer).length && !targetRef) throw new Error("Pointer options require a mapped targetRef");
      if (workflow.cacheMode === "replay" && workflow.workflowId !== undefined) {
        const replayed = await browser.replayWorkflowOnPage(tabId, {
          workflowId: workflow.workflowId,
          ...(effect === undefined ? {} : { effect }),
          targetMode,
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
        return withLumenTargetIds({
          ...replayed,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(replayed)
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
        ...pointer,
        ...(optionQuery === undefined ? {} : {optionQuery}),
        ...(optionOffset === undefined ? {} : {optionOffset:optionOffset as number}),
        ...(selectValues === undefined ? {} : {selectValues: selectValues as string[]}),
        ...(payload.awaitResponse === true ? { awaitResponse: true } : {}),
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
      return withLumenTargetIds({
        ...result,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(result)
      }, tabId, elementId);
    }),
    "lyraLumen.vact": withLyraLumenResult("lyraLumen.vact", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const markedInput = typeof payload.mark === "string" || (Array.isArray(payload.steps) && payload.steps.length > 0 && payload.steps.every(step => isRecord(step) && (typeof step.mark === "string" || step.interaction === "press") && !step.point && !step.to));
      if (payload.modelSupportsImageInput === false && !markedInput) {
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
      const effect = readOptionalLumenActionEffect(payload);
      if (!effect) throw new Error("Visual input requires its effect");
      // Legacy AX callers use the semantic executor directly, never mix CSS
      // coordinates with screenshot pixels.
      const axRef = readOptionalStringField(payload, "axRef");
      if (axRef) return withLumenTargetIds(await browser.axActOnNode(tabId, {
        axRef, targetMode, interaction: payload.interaction === "hover" ? "hover" : "click", effect
      }), tabId);
      if (browser.actOnAgentVisualScene) {
        const request = { ...payload, ...(payload.modelSupportsImageInput === false ? {observe:"structure"} : {}), captureId: readOptionalStringField(payload, "captureId"),
          effect, ...readLumenModeRequest(payload, targetMode) } as unknown as VisualActRequest;
        const result = await browser.actOnAgentVisualScene(tabId, request);
        const observation = result.observation;
        if (isRecord(observation) && typeof observation.imageBase64 === "string") {
          const { imageBase64: _pixels, ...metadata } = observation;
          try {
            const imageArtifact = await materializeLumenCapture(storageRoot, tabId,
              observation as unknown as Parameters<typeof materializeLumenCapture>[2]);
            return withLumenTargetIds({ ...result, observation: metadata, imageArtifact,
              evidenceRefs: [imageArtifact.id], visual: true }, tabId);
          } catch (error) {
            // Input has already happened. Preserve its receipt if image storage fails.
            return withLumenTargetIds({ ...result, observation: metadata, visual: true,
              observationError: error instanceof Error ? error.message : String(error),
              nextRecommendedAction: "Observe the current page without repeating delivered input." }, tabId);
          }
        }
        return withLumenTargetIds({ ...result, visual: true }, tabId);
      }
      // Compatibility with older host bridges. New hosts always use the shared scene.
      const point = readOptionalLumenPoint(payload);
      if (!point) throw new Error("This host requires screenshot point coordinates");
      return withLumenTargetIds(await browser.actOnAgentVisualPoint(tabId, {
        captureId: readStringField(payload, "captureId"), point, effect,
        interaction: readLumenVisualInteraction(payload), ...readLumenModeRequest(payload, targetMode),
        ...(readOptionalLumenToPoint(payload) ? { to: readOptionalLumenToPoint(payload)! } : {}),
        ...(readOptionalNumberField(payload, "scrollDy") === undefined ? {} : { scrollDy: readOptionalNumberField(payload, "scrollDy")! }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      }), tabId);
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
      if (actionResult.ok === false || "status" in actionResult && actionResult.status === "dialogPending") {
        return withLumenTargetIds({
          ...actionResult,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: "lyra_lumen.map"
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
      const fields = readLumenInputFields(payload);
      const thenClick = readOptionalStringField(payload, "thenClick");
      if (thenClick !== undefined && !["communicate", "submitExternal", "authorize", "purchase", "delete", "upload", "download"].includes(effect ?? "")) {
        throw new Error("thenClick is a submit operation and requires its actual submission effect. For a local UI action, type with editDraft and use a separate act with an explicit interaction. No text was inserted.");
      }
      const fillText = fields === undefined ? await readSensitiveFillText(payload) : "";
      const result = await browser.typeIntoAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(effect === undefined ? {} : { effect: thenClick === undefined ? effect : "editDraft" as const }),
        text: fillText,
        clear: payload.clear === true,
        ...(fields === undefined ? {} : { fields }),
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "none" ? {} : { verification }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(payload.sensitiveValueRef === undefined
          ? {}
          : { sensitiveFill: true, inputValuePreview: "[secret:redacted]" })
      });
      if (thenClick !== undefined && result.ok && result.inputValidation?.valid === false) {
        return withLumenTargetIds({ ...result, ok:false,
          error:{kind:"input_validation_failed",message:"Text was inserted, but the field rejected its format. Submit was not clicked. Check the field's label, constraints and verification mode."},
          nextRecommendedAction:"lyra_lumen.map" }, tabId, elementId);
      }
      if (thenClick === undefined || result.ok === false
        || "status" in result && ["uncertain", "dialogPending"].includes(String(result.status))
        || "outcome" in result && result.outcome === "uncertain") {
        return withLumenTargetIds({
          ...result,
          kind: "lyraLumenActionResult",
          nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(result)
        }, tabId, elementId);
      }
      const clicked = await browser.actOnAgentElement(tabId, {
        ...(payload.awaitResponse === true ? { awaitResponse: true } : {}),
        targetRef: thenClick,
        ...(effect === undefined ? {} : { effect }),
        interaction: "click",
        ...readLumenModeRequest(payload, targetMode),
        ...(verification === "none" ? {} : { verification }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const typedMessage = "Text insertion verified; the following observation is after the requested submit click.";
      const clickMessage = clicked.message ?? (clicked.ok === false ? "Click failed." : "Clicked.");
      return withLumenTargetIds({
        ...clicked,
        inputValidation: result.inputValidation,
        inputInsertionMethod: result.inputInsertionMethod,
        inputEvidence: result.inputEvidence,
        kind: "lyraLumenActionResult",
        message: `${typedMessage}\n${clickMessage}`,
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(clicked)
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
      const verification = readLumenVerification(payload, "fast");
      const effect = readOptionalLumenActionEffect(payload);
      const repeat = readOptionalNumberField(payload, "repeat");
      const selectText = payload.selectText;
      if (selectText !== undefined && (typeof selectText !== "string" || selectText.length === 0)) {
        throw new Error("selectText must be a non-empty literal string");
      }
      const occurrence = readOptionalNumberField(payload, "occurrence");
      const result = await browser.pressAgentKey(tabId, {
        ...(payload.awaitResponse === true ? { awaitResponse: true } : {}),
        key: readStringField(payload, "key"),
        ...(repeat === undefined ? {} : { repeat }),
        ...(selectText === undefined ? {} : { selectText }),
        ...(occurrence === undefined ? {} : { occurrence }),
        ...(effect === undefined ? {} : { effect }),
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...readLumenModeRequest(payload, targetMode),
        verification,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      return withLumenTargetIds({
        ...result,
        kind: "lyraLumenActionResult",
        nextRecommendedAction: nextRecommendedActionAfterFastLumenAction(result)
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
      let explicitTabId = readTabId(payload);
      const targetMode = readLumenTargetMode(payload);
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const useFrameworkRouter = payload.useFrameworkRouter === true;
      const newTab = payload.newTab === true;
      // A URL is a destination, not a tab identity. Opening a helper website
      // must not replace the task's in-progress editor or verification form.
      if (explicitTabId !== null && !newTab) explicitTabId = await resolveBrowserAgentTabId(payload, targetMode);
      const available = targetMode === "live" && listBrowserPageTabs ? await listBrowserPageTabs() : undefined;
      const existing = !newTab && explicitTabId === null && payload.newTab !== false
        ? sessionPages.pages(payload).find(page => {
          const live = available?.find(tab => tab.tabId === page.tabId);
          return (!available || live) && (live?.displayAddress || page.url) === url;
        }) : undefined;
      const resolvedTabId = newTab ? allocateLiveAgentBrowserPreviewTabId()
        : explicitTabId ?? existing?.tabId
          ?? (payload.newTab === false ? sessionPages.current(payload) : undefined)
          ?? allocateLiveAgentBrowserPreviewTabId();
      const res = await browser.navigateAgentPage(resolvedTabId, {
        url, ...readLumenModeRequest(payload, targetMode),
        ...(useFrameworkRouter ? { useFrameworkRouter: true } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      if (typeof res.tabId !== "string" || !res.tabId) throw new Error("Navigation did not produce a browser tab identity");
      rememberAgentBrowserPreviewTarget({tabId:res.tabId,targetMode});
      sessionPages.remember(payload,{ok:true,tabId:res.tabId,url:res.address,title:res.title});
      if ("navigationState" in res && res.navigationState !== "ready") {
        return withLumenTargetIds({ok:false,kind:"lyraLumenNavigate",tabId:res.tabId,url:res.address,
          status:res.navigationState === "pending" ? "uncertain" : "failed",
          message:`Navigation ${res.navigationState} in ${res.tabId}. Read this tab to check progress; do not repeat the navigation.`,
          nextRecommendedAction:"lyra_lumen.map"},res.tabId);
      }
      grantBrowserAuthorizeAct(res.address, res.tabId ?? undefined);
      return withLumenTargetIds({
        ok: true,
        kind: "lyraLumenNavigate",
        tabId: res.tabId,
        url: res.address,
        title: res.title,
        targetMode,
        ...("browserMode" in res && res.browserMode !== undefined ? { browserMode: res.browserMode } : {}),
        message: "alreadyOpen" in res && res.alreadyOpen === true
          ? `Already open at ${res.address}. It was not loaded again.`
          : `Navigated Lyra Lumen to ${res.address}.`,
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
    "lyraLumen.read": withLyraLumenResult("lyraLumen.read", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const strategy = readLumenStrategy(payload, "focus");
      const maxChars = readOptionalNumberField(payload, "maxChars");
      const timeoutMs = readOptionalNumberField(payload, "timeoutMs");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const query = readOptionalStringField(payload, "query");
      if (query !== undefined && query.trim().length > 0) {
        const direction = payload.direction === "next" || payload.direction === "previous"
          ? payload.direction
          : "current";
        const activeIndex = readOptionalNumberField(payload, "activeIndex");
        const maxMatches = readOptionalNumberField(payload, "maxMatches");
        const result = await browser.findAgentPage(tabId, {
          query: query.trim(),
          direction,
          reveal: payload.reveal !== false,
          caseSensitive: payload.caseSensitive === true,
          ...readLumenModeRequest(payload, targetMode),
          ...(activeIndex === undefined ? {} : { activeIndex }),
          ...(maxMatches === undefined ? {} : { maxMatches }),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
        return withLumenTargetIds({
          ...result,
          ...(result.totalMatches === 0 ? {
            message: "No page-text matches. read(query) searches displayed text like Ctrl+F; it does not retrieve a field by its label or targetRef. Use map(query) to locate a named field; zero text matches does not mean that field is empty or missing."
          } : {}),
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
      const instruction = readOptionalStringField(payload, "instruction");
      const schemaHint = isRecord(payload.schema) ? payload.schema : undefined;
      if (instruction !== undefined || schemaHint !== undefined) {
        const scope = payload.scope === "full" ? "full" : "viewport";
        const extracted = await browser.readAgentPage(tabId, {
          strategy: scope === "full" ? "domFallback" : "focus",
          scope,
          ...(maxChars === undefined ? {} : { maxChars }),
          ...readLumenModeRequest(payload, targetMode),
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });
        const budgeted = truncateLumenTextContent(extracted.content);
        return withLumenTargetIds({
          ok: true,
          kind: "lyraLumenExtract",
          tabId,
          targetMode,
          ...(instruction === undefined ? {} : { instruction }),
          ...(schemaHint === undefined ? {} : { schemaHint }),
          scope,
          ...("browserMode" in (extracted ?? {}) && (extracted as { browserMode?: unknown }).browserMode !== undefined
            ? { browserMode: (extracted as { browserMode: unknown }).browserMode }
            : {}),
          url: "url" in extracted ? extracted.url : undefined,
          title: "title" in extracted ? extracted.title : undefined,
          content: budgeted.content,
          readStatus: budgeted.content.length === 0 ? "empty" : "text",
          truncated: budgeted.truncated,
          extractionMode: "renderedText",
          schemaApplied: false,
          message: "Returned rendered page text only. The instruction and schemaHint are hints for interpreting this evidence; they were not executed and no HTML/source or hidden application state was extracted. Use mapped object metadata or focused source inspection when those facts are needed. Keep the final reply aligned with the user's task.",
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      }
      const readTimeoutMs = Math.min(timeoutMs ?? 4_000, 4_000);
      const modeRequest = readLumenModeRequest(payload, targetMode);
      const readPage = (readStrategy: WorkbenchBrowserAgentObserveStrategy) =>
        browser.readAgentPage(tabId, {
          strategy: readStrategy,
          scope: payload.scope === "full" ? "full" : "viewport",
          ...modeRequest,
          ...(maxChars === undefined ? {} : { maxChars }),
          timeoutMs: readTimeoutMs
        });
      const formatRead = (
        content: Awaited<ReturnType<typeof browser.readAgentPage>>,
        readStrategy: WorkbenchBrowserAgentObserveStrategy
      ) => {
        if (readStrategy === "focus" && content.truncated !== true) {
          sessionPages.rememberText(payload, tabId, content.content, maxChars, payload.scope === "full" ? "full" : "viewport");
        }
        if (readStrategy === "domFallback") {
          return withLumenTargetIds({
            ok: true,
            kind: "lyraLumenRead",
            tabId,
            strategy: readStrategy,
            targetMode,
            ...("browserMode" in content && content.browserMode !== undefined ? { browserMode: content.browserMode } : {}),
            url: "url" in content ? content.url : undefined,
            title: "title" in content ? content.title : undefined,
            content: content.content,
            readStatus: content.content.length === 0 ? "empty" : "text",
            summary: content,
            truncated: "truncated" in content ? content.truncated : false,
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
          url: "url" in content ? content.url : undefined,
          title: "title" in content ? content.title : undefined,
          content: content.content,
          scope: payload.scope === "full" ? "full" : "viewport",
          ...(content.waitState?.coverage === undefined ? {} : { coverage: content.waitState.coverage }),
          readStatus: content.content.length === 0 ? "empty" : "text",
          ...("extractionMethod" in content ? { extractionMethod: content.extractionMethod } : {}),
          truncated: "truncated" in content ? content.truncated : false,
          ...("startChar" in content ? { startChar: content.startChar } : {}),
          ...("endChar" in content ? { endChar: content.endChar } : {}),
          ...("totalChars" in content ? { totalChars: content.totalChars } : {}),
          nextRecommendedAction: "lyra_lumen.map"
        }, tabId);
      };
      // A different strategy with the same scope uses the same extractor. Do
      // not retry it under another name or turn a failed read into empty text.
      return formatRead(await readPage(strategy), strategy);
    }),
    "lyraLumen.see": withLyraLumenResult("lyraLumen.see", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      if ((payload.representation === "structure" || payload.modelSupportsImageInput === false) && browser.describeAgentScene) {
        const observed=await browser.describeAgentScene(tabId,{...readLumenModeRequest(payload,targetMode),
          ...(typeof payload.region === "string" ? {region:payload.region}:{}),
          ...(payload.cell ? {cell:payload.cell as {row:number;column:number}}:{}),
          ...(typeof payload.offset === "number" ? {offset:payload.offset}:{}),
          ...(typeof payload.maxMarks === "number" ? {maxMarks:payload.maxMarks}:{})});
        if(observed){const {groupedTargetRefs:_grouped,...observation}=observed;return withLumenTargetIds({ok:true,kind:"lyraLumenScene",...observation},tabId);}
        if(payload.representation === "structure")return withLumenTargetIds({ok:true,kind:"lyraLumenScene",message:"No rendered region was found; use the semantic map for controls.",nextRecommendedAction:"lyra_lumen.map"},tabId);
      }
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
      const capture = await (browser.captureVisualScene ?? browser.captureAgentPage)(
        tabId,
        {
          ...readLumenModeRequest(payload, targetMode),
          highlightTargets: readOptionalBooleanField(payload, "highlightTargets") ?? true,
          downsampleForVision: readOptionalBooleanField(payload, "downsampleForVision") ?? true,
          ...(highlightTargetRefs === undefined ? {} : { highlightTargetRefs }),
          ...(typeof payload.region === "string" ? { region: payload.region } : {}),
          ...(payload.cell !== undefined ? { cell: payload.cell as { row: number; column: number } } : {}),
          ...(payload.zoom !== undefined ? { zoom: payload.zoom as number } : {}),
          ...(typeof payload.offset === "number" ? { offset: payload.offset } : {}),
          ...(typeof payload.maxMarks === "number" ? { maxMarks: payload.maxMarks } : {})
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
        ...("scene" in capture ? { scene: capture.scene } : {}),
        imageArtifact,
        evidenceRefs: [imageArtifact.id],
        message: `Captured ${capture.width}x${capture.height}. ${"scene" in capture && capture.scene.marks.length === 0
          ? "No numbered objects were resolved. Inspect this image and use an explicit point with its captureId if the intended target is visible; no additional map is required."
          : "Use a boxed mark with browser vact; reuse its mark while the object remains. For regions use position/path fractions. Occluding hit surfaces are visible targets, not confirmed buttons; choose their intended action from the current evidence."}`,
        nextRecommendedAction: "lyra_lumen.vact"
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
    "lyraLumen.wait": withLyraLumenResult("lyraLumen.wait", async (payload) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const targetMode = readLumenTargetMode(payload);
      const tabId = await resolveBrowserAgentTabId(payload, targetMode);
      const timeoutMs = Math.max(
        250,
        Math.min(30_000, readOptionalNumberField(payload, "timeoutMs") ?? 10_000)
      );
      const mapBudgetMs = Math.min(4_000, Math.floor(timeoutMs / 3));
      const waitBudgetMs = Math.max(0, timeoutMs - mapBudgetMs - 350);
      const idleMs = Math.max(
        20,
        Math.min(5_000, readOptionalNumberField(payload, "idleMs") ?? 800)
      );
      const operationId = sessionPages.responseOperation(payload, tabId);
      const until = payload.until === undefined && operationId ? "responseComplete" : readLumenWaitUntil(payload);
      if (until === "responseComplete" && !operationId) throw new Error("No tracked send exists for this task and tab. Use a concrete page condition; no wait was started.");
      const text = readOptionalStringField(payload, "text");
      const targetRef = readOptionalLumenTargetRef(payload);
      const previousText = typeof payload.previousText === "string" ? payload.previousText : undefined;
      if (until === "textContains" && !text?.trim()) throw new Error("textContains requires non-empty text");
      if (until === "textChanged" && targetRef !== undefined) throw new Error("textChanged must read the same scope as its baseline; use a target condition when specifying targetRef.");
      if ((until === "targetHidden" || until === "targetEnabled") && targetRef === undefined) {
        throw new Error(`${until} requires a targetRef from the current page map`);
      }
      const requestedMaxChars = readOptionalNumberField(payload, "maxChars");
      if (payload.scope !== undefined && payload.scope !== "viewport" && payload.scope !== "full") throw new Error("scope must be full or viewport");
      const baseline = until === "textChanged"
        ? sessionPages.requireTextBaseline(payload, tabId, previousText, requestedMaxChars, payload.scope as "viewport" | "full" | undefined)
        : undefined;
      const maxChars = baseline?.maxChars ?? requestedMaxChars;
      const scope = baseline?.scope ?? (payload.scope === "viewport" ? "viewport" : "full");
      await browser.showAgentActivity(tabId, {
        action: "wait",
        ...readLumenModeRequest(payload, targetMode),
        durationMs: Math.max(900, Math.min(5_000, timeoutMs))
      });
      const preparationStarted = Date.now();
      if (until === "targetEnabled" && targetRef !== undefined) {
        const revealed = await browser.scrollAgentPage(tabId, {
          ...readLumenModeRequest(payload, targetMode), targetRef, block: "nearest",
          behavior: "instant", autoMap: false, reason: "ensure_visible", timeoutMs: waitBudgetMs
        });
        if (!revealed.ok) return withLumenTargetIds({ ...revealed, matched: false, completion: "unknown" }, tabId);
      }
      const result = await waitForLumenPage(browser, tabId, {
        ...readLumenModeRequest(payload, targetMode),
        targetMode,
        until,
        ...(sessionPages.navigationOrigin(payload, tabId) ? { navigationFromUrl: sessionPages.navigationOrigin(payload, tabId)! } : {}),
        ...(until === "responseComplete" && operationId !== undefined ? { operationId } : {}),
        scope,
        timeoutMs: Math.max(0, waitBudgetMs - (Date.now() - preparationStarted)),
        idleMs,
        ...(maxChars === undefined ? {} : { maxChars }),
        ...(text === undefined ? {} : { text }),
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(previousText === undefined ? {} : { previousText })
      });
      // Observe controls once, after polling. Return the state needed for the
      // next decision without another model round trip or activating anything.
      let mapAppendix: string | undefined;
      let mapError: string | undefined;
      let scene: Record<string, unknown> | undefined;
      const completedResponse = until === "responseComplete" && result.matched;
      try {
        if (!completedResponse) {
          const remainingMs = timeoutMs - (Date.now() - preparationStarted) - 100;
          if (remainingMs < 250) throw new Error("Wait budget exhausted before the final map; text and condition state are retained.");
          // Reuse the current scene for dynamic regions. A wait for new state
          // does not require rediscovering all controls on the document.
          const structure = browser.describeAgentScene
            ? await browser.describeAgentScene(tabId, { targetMode }) : undefined;
          if (structure) scene = structure.scene;
          else {
            const observation = await browser.observeAgentPage(tabId, {
              strategy: "interactiveOnly", mapScope: "document", ...readLumenModeRequest(payload, targetMode), timeoutMs: Math.min(mapBudgetMs, remainingMs)
            });
            const key = JSON.stringify([readRuntimeSessionId(payload) ?? "", targetMode, tabId]);
            mapAppendix = mapPager.start(key, observation, {}, Date.now(), 3_000).mapAppendix;
          }
        }
      } catch (error) { mapError = String(error); }
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
        scope,
        waitState: result.content.waitState,
        coverage: result.content.waitState?.coverage ?? { scope, scanComplete: result.content.truncated !== true },
        ...(mapAppendix === undefined ? { mapError } : { mapAppendix }),
        ...(scene ? { scene } : {}),
        matched: result.matched,
        ...("stopReason" in result ? { stopReason: result.stopReason } : {}),
        completion: result.matched && until !== "textStable" ? "conditionMet" : "unknown",
        readStatus: result.content.content.trim().length > 0 ? "text" : "empty",
        ...(targetRef === undefined ? {} : { targetRef }),
        elapsedMs: Date.now() - preparationStarted,
        url: "url" in result.content ? result.content.url : undefined,
        title: "title" in result.content ? result.content.title : undefined,
        content: result.content.content,
        truncated: "truncated" in result.content ? result.content.truncated : false,
        message: result.matched
          ? `Wait condition '${until}' was met after ${result.elapsedMs}ms.${until === "textStable" ? " Text stability is not proof that a new reply finished; verify an expected page state." : " This confirms the requested condition only."}`
          : "stopReason" in result ? "Navigation reached another ready page without the anticipated text. Inspect the returned page and controls; the text condition was not met."
          : `Wait condition '${until}' timed out after ${result.elapsedMs}ms.`,
        nextRecommendedAction: completedResponse || scene || mapAppendix !== undefined ? "use_returned_state" : "inspect_returned_state_before_waiting"
      }, tabId);
    })
  };



  return { handlers: Object.fromEntries(Object.entries(lyraLumenHandlers).map(([method, handler]) => [method, async (payload: unknown) => {
    const safe = await browserSensitiveBoundary.sanitize(await handler(payload));
    const refs = browserSensitiveBoundary.references(safe);
    return refs.length && isRecord(safe) ? { ...safe, sensitiveValues: refs,
      sensitiveValueUsage: "Values are stored in secure storage. Use sensitiveValueRef to fill, or shell sensitiveEnv to use a ref. Never put plaintext credentials in command arguments, URLs, or files." } : safe;
  }])) };
};
