import { createBrowserAgentElevationController } from "./agent-elevation-controller";
import { createBrowserAgentFocusInputController } from "./agent-focus-input-controller";
import { createBrowserAgentInteractionExecutor } from "./agent-interaction-executor";
import { createBrowserAgentLocator } from "./agent-locator";
import { createBrowserAgentObservationEngine } from "./agent-observation-engine";
import { createBrowserAgentPageController } from "./agent-page-controller";
import { createBrowserAgentStateStore } from "./agent-state-store";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";

export type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";

export const createWorkbenchBrowserAgentController = (host: WorkbenchBrowserAgentControllerHost) => {
  const stateStore = createBrowserAgentStateStore();
  const observationEngine = createBrowserAgentObservationEngine({
    findFrameInWebContents: host.findFrameInWebContents,
    openDebuggerSessionForTarget: host.openDebuggerSessionForTarget,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readPageDiagnostics: host.readPageDiagnostics,
    rememberBrowserRestoreState: host.rememberBrowserRestoreState,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    stateStore,
    updateRuntimeState: host.updateRuntimeState
  });
  const locator = createBrowserAgentLocator({
    observeAgentPage: observationEngine.observeAgentPage,
    performSearchInPage: host.performSearchInPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    stateStore
  });
  const interaction = createBrowserAgentInteractionExecutor({
    assertSharedControlCanContinue: host.assertSharedControlCanContinue,
    createVisualFrame: host.createVisualFrame,
    cssPointFromVisualFrame: host.cssPointFromVisualFrame,
    findAgentElement: locator.findAgentElement,
    markSyntheticInput: host.markSyntheticInput,
    observeAgentPage: observationEngine.observeAgentPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readAgentViewportState: host.readAgentViewportState,
    readVisualFrame: host.readVisualFrame,
    recordFollowAction: host.recordFollowAction,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent: host.sendAgentInputEvent,
    stateStore,
    visualStaleResult: host.visualStaleResult
  });
  const focusInput = createBrowserAgentFocusInputController({
    actOnAgentElement: interaction.actOnAgentElement,
    assertSharedControlCanContinue: host.assertSharedControlCanContinue,
    ensureAgentElementVisible: interaction.ensureAgentElementVisible,
    findAgentElement: locator.findAgentElement,
    findFrameInWebContents: host.findFrameInWebContents,
    nextRecommendedActionAfterAgentAction: interaction.nextRecommendedActionAfterAgentAction,
    observeAfterAgentInput: interaction.observeAfterAgentInput,
    observeAgentPage: observationEngine.observeAgentPage,
    performAgentPointerInteraction: interaction.performAgentPointerInteraction,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readFocusedElementSignature: interaction.readFocusedElementSignature,
    recordFollowAction: host.recordFollowAction,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    sendAgentInputEvent: host.sendAgentInputEvent,
    staleElementResult: interaction.staleElementResult,
    stateStore
  });
  const page = createBrowserAgentPageController({
    captureTargetPage: host.captureTargetPage,
    createVisualFrame: host.createVisualFrame,
    entries: host.entries,
    navigateInEntry: host.navigateInEntry,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    readBrowserAgentShadow: host.readBrowserAgentShadow,
    rememberVisualFrame: host.rememberVisualFrame,
    requireEntry: host.requireEntry,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    stateStore,
    waitForAgentPageLoad: host.waitForAgentPageLoad
  });
  const elevation = createBrowserAgentElevationController({
    entries: host.entries,
    observeAgentPage: observationEngine.observeAgentPage,
    publishBrowserAgentActivity: host.publishBrowserAgentActivity,
    publishEvent: host.publishEvent,
    resolveBrowserAgentTarget: host.resolveBrowserAgentTarget,
    waitForAgentPageLoad: host.waitForAgentPageLoad
  });

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
    stateStore.dispose();
    elevation.dispose();
  };

  return {
    actOnAgentElement: interaction.actOnAgentElement,
    actOnAgentPoint: interaction.actOnAgentPoint,
    actOnAgentVisualPoint: interaction.actOnAgentVisualPoint,
    captureAgentPage: page.captureAgentPage,
    completeElevationSession: elevation.completeElevationSession,
    dispose,
    elevateAgentPage: elevation.elevateAgentPage,
    explainAgentTargetRef,
    findAgentPage: locator.findAgentPage,
    focusAgentPage: focusInput.focusAgentPage,
    invalidateBrowserAgentTargets: stateStore.invalidateBrowserAgentTargets,
    locateAgentPage: locator.locateAgentPage,
    navigateAgentPage: page.navigateAgentPage,
    observeAgentPage: observationEngine.observeAgentPage,
    pressAgentKey: focusInput.pressAgentKey,
    readAgentFollowFinalPageState: page.readAgentFollowFinalPageState,
    readAgentPage: page.readAgentPage,
    scheduleBrowserTargetRegistryWarmup: observationEngine.scheduleBrowserTargetRegistryWarmup,
    scrollAgentPage: interaction.scrollAgentPage,
    showAgentActivity: page.showAgentActivity,
    typeIntoAgentElement: focusInput.typeIntoAgentElement
  };
};
