import type { WorkbenchBrowserAgentObservation } from "../types";
import {
  verifyBrowserAgentTrajectory,
  type BrowserAgentTrajectory
} from "./browser-agent-verifier";

export type BrowserTaskJudgeStatus = "completed" | "blocked" | "incomplete" | "uncertain";

export type BrowserTaskJudgeInput = {
  readonly goal?: string;
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

const normalizeGoalText = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/gu, " ").trim().toLocaleLowerCase();

const goalMentionedInObservation = (
  goal: string,
  observation: BrowserTaskJudgeInput["finalObservation"]
): boolean => {
  if (goal.length === 0 || observation === undefined) {
    return false;
  }
  const haystack = [
    observation.title,
    observation.url,
    ...observation.elements.map((element) => `${element.label} ${element.role}`)
  ].join(" ").toLocaleLowerCase();
  const tokens = goal.split(/\s+/u).filter((token) => token.length >= 4);
  if (tokens.length === 0) {
    return haystack.includes(goal);
  }
  const matched = tokens.filter((token) => haystack.includes(token));
  return matched.length >= Math.max(1, Math.ceil(tokens.length * 0.5));
};

export const judgeBrowserAgentTask = (
  input: BrowserTaskJudgeInput
): BrowserTaskJudgeVerdict => {
  const trajectory = verifyBrowserAgentTrajectory(input.trajectory);
  const findings = [...trajectory.findings];
  const observation = input.finalObservation;
  const goal = normalizeGoalText(input.goal);

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
  const goalSatisfied = goalMentionedInObservation(goal, observation);

  if (goal.length > 0 && goalSatisfied && successfulActs.length > 0 && !trajectory.escalationRecommended) {
    findings.push("Goal language appears in the final page state after successful actions.");
    return {
      status: "completed",
      confidence: trajectory.diffCoverageRate >= 0.5 ? "medium" : "low",
      findings,
      trajectory,
      recommendedAction: "lyra_lumen.map"
    };
  }

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

  if (successfulActs.length > 0 && (observation?.elements.length ?? 0) > 0) {
    return {
      status: "uncertain",
      confidence: "low",
      findings: [
        ...findings,
        goal.length > 0
          ? "Actions succeeded but the stated goal was not confirmed in the final observation."
          : "Actions succeeded; provide a goal to improve task-level judging."
      ],
      trajectory,
      recommendedAction: "lyra_lumen.map"
    };
  }

  return {
    status: "incomplete",
    confidence: "low",
    findings,
    trajectory,
    recommendedAction: "lyra_lumen.map"
  };
};