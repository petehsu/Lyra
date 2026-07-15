import type { WorkbenchBrowserAgentObservation } from "../types";
import {
  verifyBrowserAgentTrajectory,
  type BrowserAgentTrajectory
} from "./browser-agent-verifier";

export type BrowserTaskJudgeStatus = "completed" | "blocked" | "incomplete" | "uncertain";

export type BrowserTaskJudgeInput = {
  readonly trajectory: BrowserAgentTrajectory;
  readonly finalObservation?: Pick<
    WorkbenchBrowserAgentObservation,
    | "url"
    | "title"
    | "elements"
    | "authChallengeSignals"
    | "blockedRegions"
    | "nextRecommendedAction"
  >;
};

export type BrowserTaskJudgeVerdict = {
  readonly status: BrowserTaskJudgeStatus;
  readonly confidence: "high" | "medium" | "low";
  readonly findings: readonly string[];
  readonly trajectory: ReturnType<typeof verifyBrowserAgentTrajectory>;
  readonly recommendedAction?: string;
};

export const judgeBrowserAgentTask = (
  input: BrowserTaskJudgeInput
): BrowserTaskJudgeVerdict => {
  const trajectory = verifyBrowserAgentTrajectory(input.trajectory);
  const findings = [...trajectory.findings];
  const observation = input.finalObservation;

  const captchaBlocked = observation?.authChallengeSignals?.some(
    (signal) => signal.kind === "captcha" && signal.confidence === "high"
  ) === true;
  const authBlocked = observation?.blockedRegions?.some(
    (region) => region.fallback === "elevate" || region.kind === "captcha"
  ) === true;
  const askUser = observation?.nextRecommendedAction === "ask_user";

  if (captchaBlocked || authBlocked || askUser) {
    findings.push("Task appears blocked by captcha or auth challenge; user action is required.");
    return {
      status: "blocked",
      confidence: "high",
      findings,
      trajectory,
      recommendedAction: "ask_user"
    };
  }

  const actSteps = input.trajectory.steps.filter((step) => step.toolPath.endsWith("/act"));
  const successfulActs = actSteps.filter((step) => step.ok);

  if (actSteps.length === 0) {
    findings.push("No browser act steps were recorded for this task trajectory.");
    return {
      status: "incomplete",
      confidence: "medium",
      findings,
      trajectory,
      recommendedAction: "lyra_lumen.map"
    };
  }

  if (trajectory.escalationRecommended) {
    findings.push("Trajectory verifier recommends escalation before declaring completion.");
    return {
      status: "incomplete",
      confidence: "medium",
      findings,
      trajectory,
      recommendedAction: "lyra_lumen_audit"
    };
  }

  if (successfulActs.length !== actSteps.length) {
    findings.push("One or more browser actions failed.");
    return {
      status: "incomplete",
      confidence: "high",
      findings,
      trajectory,
      recommendedAction: "lyra_lumen.map"
    };
  }

  if ((observation?.elements.length ?? 0) > 0) {
    findings.push(
      "Actions changed the observed page, but completion still needs structured target-state evidence."
    );
    return {
      status: "uncertain",
      confidence: trajectory.diffCoverageRate === 1 ? "medium" : "low",
      findings,
      trajectory,
      recommendedAction: "lyra_lumen.map"
    };
  }

  return {
    status: "incomplete",
    confidence: "low",
    findings: [...findings, "Final structured page observation is missing or empty."],
    trajectory,
    recommendedAction: "lyra_lumen.map"
  };
};
