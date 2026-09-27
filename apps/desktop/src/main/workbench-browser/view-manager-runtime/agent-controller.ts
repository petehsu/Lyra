import { createBrowserNativeDialogs } from "./agent-native-dialog";
import { createSurfaceDrag } from "./surface-drag";
import { createBrowserFileChooserController } from "./agent-file-chooser";
import { createBrowserAgentElevationController } from "./agent-elevation-controller";
import { createBrowserAgentFocusInputController } from "./agent-focus-input-controller";
import { createBrowserAgentInteractionExecutor } from "./agent-interaction-executor";
import { createBrowserAgentLocator } from "./agent-locator";
import { createBrowserAgentObservationEngine } from "./agent-observation-engine";
import { createBrowserAgentPageController } from "./agent-page-controller";
import { createBrowserAgentQrController } from "./agent-qr-controller";
import { createBrowserAgentPlanController } from "./agent-plan-controller";
import { createBrowserAgentStateStore } from "./agent-state-store";
import {
  executeWorkflowReplay,
  normalizeUrlForWorkflowCache,
  resolveWorkflowStepTarget
} from "./agent-workflow-runtime";
import { createBrowserAxController } from "./ax-controller";
import { createBrowserAxSnapshotStore } from "./ax-snapshot-store";
import { agentTargetAddress } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { WorkbenchBrowserAgentTargetMode } from "../types";

export type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";

export const createWorkbenchBrowserAgentController = (host: WorkbenchBrowserAgentControllerHost) => {
  const stateStore = createBrowserAgentStateStore();
  const dialogs = createBrowserNativeDialogs(host);
  const files = createBrowserFileChooserController({
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    openDebuggerSessionForTarget: host.openDebuggerSessionForTarget,
    assertSharedControlCanContinue: host.assertSharedControlCanContinue,
    setPending: (tabId, mode, pending) => pending
      ? stateStore.markCdpFileChooserOpen(tabId, mode) : stateStore.markCdpFileChooserClosed(tabId, mode),
    click: (tabId, targetRef, targetMode) => interaction.actOnAgentElement(tabId, {
      targetRef, targetMode, interaction: "click", effect: "upload", verification: "fast"
    }),
    observe: (tabId, targetMode) => observeAgentPage(tabId, { targetMode, strategy: "interactiveOnly", suppressActivity: true })
  });
  const observeAgentPage: typeof observationEngine.observeAgentPage = async (tabId, request) =>
    files.decorate(await observationEngine.observeAgentPage(tabId, request), tabId, request?.targetMode ?? "live");
  const assertSharedControlCanContinue: typeof host.assertSharedControlCanContinue = tabId => {
    files.assertInputAllowed();
    host.assertSharedControlCanContinue(tabId);
  };
  const sendAgentInputEvent: typeof host.sendAgentInputEvent = (target, event) => {
    if (event.type !== "mouseUp" && event.type !== "keyUp") files.assertInputAllowed();
    host.sendAgentInputEvent(target, event);
  };
  const captureAction = <R extends { targetMode?: WorkbenchBrowserAgentTargetMode; effect?: import("../types").BrowserActionEffect }, T extends object>(
    action: (tabId: string, request: R) => Promise<T>
  ) => (tabId: string, request: R) => dialogs.capture(tabId, request, () => files.capture(tabId, request, () => action(tabId, request)));
  const axSnapshotStore = createBrowserAxSnapshotStore();
  const observationEngine = createBrowserAgentObservationEngine({
    assertSharedControlCanContinue,
    findFrameInWebContents: host.findFrameInWebContents,
    openDebuggerSessionForTarget: host.openDebuggerSessionForTarget,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readPageDiagnostics: host.readPageDiagnostics,
    rememberBrowserRestoreState: host.rememberBrowserRestoreState,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent,
    stateStore,
    updateRuntimeState: host.updateRuntimeState,
    ...(host.consumeBrowserHealthAlerts === undefined
      ? {}
      : { consumeBrowserHealthAlerts: host.consumeBrowserHealthAlerts }),
    ...(host.onBrowserHealthCaptcha === undefined
      ? {}
      : { onBrowserHealthCaptcha: host.onBrowserHealthCaptcha }),
    ...(host.onBrowserHealthPermission === undefined
      ? {}
      : { onBrowserHealthPermission: host.onBrowserHealthPermission })
  });
  const locator = createBrowserAgentLocator({
    buildFrameGraph: observationEngine.buildBrowserAgentSemanticFrameGraph,
    observeAgentPage,
    performSearchInPage: host.performSearchInPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    stateStore
  });
  const drag = createSurfaceDrag({...host,
    find: async (tabId,ref,mode) => (await locator.findAgentElement(tabId,{targetRef:ref},mode,undefined)).element,
    observe: (tabId,mode) => observeAgentPage(tabId,{targetMode:mode,strategy:"interactiveOnly",suppressActivity:true})
  });
  const plan = createBrowserAgentPlanController({
    observeAgentPage,
    locateAnchorRect: async (tabId, targetMode, anchorText, timeoutMs) => {
      const found = await locator.findAgentPage(tabId, {
        query: anchorText,
        targetMode,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const rect = found.revealRect;
      if (rect === undefined) {
        return null;
      }
      return {
        x: rect.left,
        y: rect.top,
        width: Math.max(1, rect.right - rect.left),
        height: Math.max(1, rect.bottom - rect.top)
      };
    }
  });
  const interaction = createBrowserAgentInteractionExecutor({
    assertSharedControlCanContinue,
    createVisualFrame: host.createVisualFrame,
    cssPointFromVisualFrame: host.cssPointFromVisualFrame,
    findAgentElement: locator.findAgentElement,
    findFrameInWebContents: host.findFrameInWebContents,
    markSyntheticInput: host.markSyntheticInput,
    openDebuggerSessionForTarget: host.openDebuggerSessionForTarget,
    observeAgentPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readAgentViewportState: host.readAgentViewportState,
    readVisualFrame: host.readVisualFrame,
    recordFollowAction: host.recordFollowAction,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent,
    stateStore,
    visualStaleResult: host.visualStaleResult
  });
  const focusInput = createBrowserAgentFocusInputController({
    actOnAgentElement: interaction.actOnAgentElement,
    assertSharedControlCanContinue,
    ensureAgentElementVisible: interaction.ensureAgentElementVisible,
    findAgentElement: locator.findAgentElement,
    findFrameInWebContents: host.findFrameInWebContents,
    nextRecommendedActionAfterAgentAction: interaction.nextRecommendedActionAfterAgentAction,
    observeAfterAgentInput: interaction.observeAfterAgentInput,
    observeAgentPage,
    performAgentPointerInteraction: interaction.performAgentPointerInteraction,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readFocusedElementSignature: interaction.readFocusedElementSignature,
    recordFollowAction: host.recordFollowAction,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent,
    staleElementResult: interaction.staleElementResult,
    stateStore
  });
  const page = createBrowserAgentPageController({
    buildFrameGraph: observationEngine.buildBrowserAgentSemanticFrameGraph,
    captureTargetPage: host.captureTargetPage,
    createVisualFrame: host.createVisualFrame,
    entries: host.entries,
    navigateInEntry: host.navigateInEntry,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    publishEvent: host.publishEvent,
    readBrowserAgentShadow: host.readBrowserAgentShadow,
    rememberVisualFrame: host.rememberVisualFrame,
    requireEntry: host.requireEntry,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    stateStore,
    waitForAgentPageLoad: host.waitForAgentPageLoad,
    waitForAgentPageReload: host.waitForAgentPageReload
  });
  const elevation = createBrowserAgentElevationController({
    entries: host.entries,
    observeAgentPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    publishEvent: host.publishEvent,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    waitForAgentPageLoad: host.waitForAgentPageLoad
  });
  const qr = createBrowserAgentQrController({
    captureTargetPage: host.captureTargetPage,
    createVisualFrame: host.createVisualFrame,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    rememberVisualFrame: host.rememberVisualFrame,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget
  });
  const ax = createBrowserAxController({
    openDebuggerSessionForTarget: host.openDebuggerSessionForTarget,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    recordFollowAction: host.recordFollowAction,
    assertSharedControlCanContinue,
    buildSemanticFrameGraph: observationEngine.buildBrowserAgentSemanticFrameGraph,
    nextMapEpoch: stateStore.nextMapEpoch,
    axSnapshotStore,
    ...(host.osAxAdapter === undefined ? {} : { osAxAdapter: host.osAxAdapter })
  });

  // Invalidate AX document refs in lockstep with Lumen targets (navigation/reload/clearSiteData).
  const invalidateBrowserAgentTargets = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    reason: "navigation" | "frameReload" = "navigation"
  ): void => {
    files.clear(tabId, targetMode);
    stateStore.invalidateBrowserAgentTargets(tabId, targetMode, reason);
    axSnapshotStore.invalidate(tabId, targetMode, reason);
  };

  const explainAgentTargetRef = async (
    tabId: string,
    request: { readonly targetMode?: "live" | "isolated"; readonly targetRef: string; readonly maxCandidates?: number }
  ) => {
    const targetMode = request.targetMode ?? "live";
    return stateStore.explainTargetRef({
      tabId,
      targetMode,
      targetRef: request.targetRef,
      ...(request.maxCandidates === undefined ? {} : { maxCandidates: request.maxCandidates })
    });
  };

  const dispose = (): void => {
    dialogs.dispose();
    files.dispose();
    stateStore.dispose();
    elevation.dispose();
    ax.dispose();
    axSnapshotStore.dispose();
  };

  const replayWorkflowOnPage = async (
    tabId: string,
    request: {
      readonly workflowId: string;
      readonly effect?: import("../types").BrowserActionEffect;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => {
    const targetMode = request.targetMode ?? "live";
    const target = await host.resolveBrowserAgentTarget(tabId, { targetMode }, request.timeoutMs);
    const normalizedUrl = normalizeUrlForWorkflowCache(agentTargetAddress(target));
    return executeWorkflowReplay({
      tabId,
      targetMode,
      workflowId: request.workflowId,
      normalizedUrl,
      resolveStep: async (step) =>
        resolveWorkflowStepTarget({
          tabId,
          targetMode,
          normalizedUrl,
          step,
          resolveTargetRef: (targetRef) => {
            const resolved = stateStore.resolveTargetRef(tabId, targetMode, targetRef);
            return resolved.ok ? { ok: true } : { ok: false };
          },
          observePage: () =>
            observeAgentPage(tabId, {
              strategy: "interactiveOnly",
              targetMode,
              suppressActivity: true,
              ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
            })
        }),
      actStep: async (step, resolved) =>
        captureAction(interaction.actOnAgentElement)(tabId, {
          targetRef: resolved.targetRef,
          ...(request.effect === undefined ? {} : { effect: request.effect }),
          interaction: step.interaction,
          targetMode,
          cacheMode: "off",
          ...(step.optionLabel === undefined ? {} : { optionLabel: step.optionLabel }),
          ...(step.selectValue === undefined ? {} : { selectValue: step.selectValue }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          ...(resolved.matchLevel === undefined ? {} : { matchLevel: resolved.matchLevel })
        })
    });
  };

  return {
    actOnAgentElement: captureAction(interaction.actOnAgentElement),
    markCdpFileChooserClosed: stateStore.markCdpFileChooserClosed,
    markCdpFileChooserOpen: stateStore.markCdpFileChooserOpen,
    verifyAgentActionOutcome: interaction.verifyAgentActionOutcome,
    actOnAgentPoint: captureAction(interaction.actOnAgentPoint),
    actOnAgentVisualPoint: captureAction(interaction.actOnAgentVisualPoint),
    axMapAgentPage: ax.axMapAgentPage,
    axQueryAgentSnapshot: ax.axQueryAgentSnapshot,
    axActOnNode: captureAction(ax.axActOnNode),
    axFocusAgentPage: ax.axFocusAgentPage,
    axPressAgentKey: captureAction(ax.axPressAgentKey),
    axExplainNode: ax.axExplainNode,
    axResolveAxRefBbox: ax.axResolveAxRefBbox,
    captureAgentPage: page.captureAgentPage,
    readAgentPreviewPage: page.readAgentPreviewPage,
    detectAgentPageQr: qr.detectAgentPageQr,
    completeElevationSession: elevation.completeElevationSession,
    dispose,
    elevateAgentPage: elevation.elevateAgentPage,
    explainAgentTargetRef,
    findAgentPage: locator.findAgentPage,
    focusAgentPage: focusInput.focusAgentPage,
    invalidateBrowserAgentTargets,
    locateAgentPage: locator.locateAgentPage,
    navigateAgentPage: page.navigateAgentPage,
    reloadAgentPage: page.reloadAgentPage,
    observeAgentPage,
    planAgentPage: plan.planAgentPage,
    pressAgentKey: captureAction(focusInput.pressAgentKey),
    readAgentFollowFinalPageState: page.readAgentFollowFinalPageState,
    readAgentPage: page.readAgentPage,
    replayWorkflowOnPage,
    uploadAgentFiles: files.upload,
    dragAgentElement: captureAction(drag),
    handleAgentDialog: dialogs.handle,
    peekAgentDialog: dialogs.peek,
    scheduleBrowserTargetRegistryWarmup: observationEngine.scheduleBrowserTargetRegistryWarmup,
    scrollAgentPage: interaction.scrollAgentPage,
    showAgentActivity: page.showAgentActivity,
    typeIntoAgentElement: captureAction(focusInput.typeIntoAgentElement)
  };
};
