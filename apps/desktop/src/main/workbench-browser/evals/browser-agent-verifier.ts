export type BrowserAgentTrajectoryStep = {
  readonly toolPath: string;
  readonly ok: boolean;
  readonly pathTaken?: string;
  readonly elementDiffChanged?: readonly string[];
  readonly cacheHit?: boolean;
  readonly cacheMiss?: boolean;
};

export type BrowserAgentTrajectory = {
  readonly steps: readonly BrowserAgentTrajectoryStep[];
};

export type BrowserAgentVerificationReport = {
  readonly actSuccessRate: number;
  readonly diffCoverageRate: number;
  readonly cacheHitRate: number;
  readonly escalationRecommended: boolean;
  readonly findings: readonly string[];
};

export const verifyBrowserAgentTrajectory = (
  trajectory: BrowserAgentTrajectory
): BrowserAgentVerificationReport => {
  const actSteps = trajectory.steps.filter((step) => step.toolPath.endsWith("/act"));
  const successfulActs = actSteps.filter((step) => step.ok);
  const diffSteps = actSteps.filter((step) => (step.elementDiffChanged?.length ?? 0) > 0);
  const cacheHits = trajectory.steps.filter((step) => step.cacheHit === true);
  const cacheMisses = trajectory.steps.filter((step) => step.cacheMiss === true);
  const noChangeActs = actSteps.filter(
    (step) => step.ok && (step.elementDiffChanged?.length ?? 0) === 0
  );

  const findings: string[] = [];
  if (cacheMisses.length > 0) {
    findings.push(`Workflow cache missed ${cacheMisses.length} time(s); remap before replay.`);
  }
  if (noChangeActs.length > 0) {
    findings.push(`${noChangeActs.length} act(s) succeeded without observable elementDiff changes.`);
  }

  return {
    actSuccessRate: actSteps.length === 0 ? 1 : successfulActs.length / actSteps.length,
    diffCoverageRate: actSteps.length === 0 ? 1 : diffSteps.length / actSteps.length,
    cacheHitRate: trajectory.steps.length === 0 ? 0 : cacheHits.length / trajectory.steps.length,
    escalationRecommended: noChangeActs.length > 0 || cacheMisses.length > 0,
    findings
  };
};