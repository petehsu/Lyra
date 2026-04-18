import type {
  WorkbenchWebAction,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanResult,
  WorkbenchWebTargetScanScope,
} from "../../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";
import {
  buildScanAndActIntent as buildScanAndActIntentHelper,
  selectScanAndActCandidate as selectScanAndActCandidateHelper,
} from "./scan-and-act-helpers";
import type { WorkbenchWebAutomationServiceDeps } from "../types";

export const readMicroExecutorStepBudget = (
  deps: WorkbenchWebAutomationServiceDeps
): 2 | 5 | 8 => {
  switch (deps.readLyraDirectMicroExecutorBudget?.()) {
    case "1-2":
      return 2;
    case "6-8":
      return 8;
    default:
      return 5;
  }
};

export const adaptiveScanScopes = (
  preferredScope: WorkbenchWebTargetScanScope
): readonly WorkbenchWebTargetScanScope[] => {
  if (preferredScope === "expanded") {
    return ["expanded"];
  }
  if (preferredScope === "nearby") {
    return ["nearby", "expanded"];
  }
  return ["visible", "nearby", "expanded"];
};

export type WorkbenchWebScanAndActOrchestrationRuntime = {
  readonly toActionIntent: (
    action: WorkbenchWebAction,
    seed?: {
      readonly tagName?: string;
      readonly role?: string;
      readonly ariaLabel?: string;
      readonly placeholder?: string;
      readonly textSnippet?: string;
      readonly selectorPreview?: string;
    }
  ) => WorkbenchWebTargetIntent;
  readonly isActionRevealTriggerCandidate: (
    candidate: Pick<
      LiveSelectorScanCandidateRecord,
      "widgetKind" | "affordanceAction" | "ariaLabel" | "affordanceLabel" | "tooltipText" | "stateHint"
    >
  ) => boolean;
};

export const createWorkbenchWebScanAndActOrchestration = (
  runtime: WorkbenchWebScanAndActOrchestrationRuntime
): {
  readonly buildScanAndActIntent: (args: {
    readonly action: WorkbenchWebAction;
    readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  }) => WorkbenchWebTargetIntent;
  readonly selectScanAndActCandidate: (args: {
    readonly scanResult: WorkbenchWebTargetScanResult;
    readonly action: WorkbenchWebAction;
    readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  }) => LiveSelectorScanCandidateRecord | undefined;
} => {
  const { toActionIntent, isActionRevealTriggerCandidate } = runtime;

  const buildScanAndActIntent = ({
    action,
    targetHints
  }: {
    readonly action: WorkbenchWebAction;
    readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  }): WorkbenchWebTargetIntent =>
    buildScanAndActIntentHelper({
      action,
      ...(targetHints === undefined ? {} : { targetHints }),
      toActionIntent
    });

  const selectScanAndActCandidate = ({
    scanResult,
    action,
    targetHints
  }: {
    readonly scanResult: WorkbenchWebTargetScanResult;
    readonly action: WorkbenchWebAction;
    readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  }): LiveSelectorScanCandidateRecord | undefined =>
    selectScanAndActCandidateHelper({
      scanResult,
      action,
      ...(targetHints === undefined ? {} : { targetHints }),
      isActionRevealTriggerCandidate,
      toActionIntent
    });

  return {
    buildScanAndActIntent,
    selectScanAndActCandidate,
  };
};
