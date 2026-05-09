import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";

import type { AgentPolicySummary, AgentSecuritySummary, AgentSessionDetail } from "./agent-ui-types";

export type SecurityStatusKind =
  | "clear"
  | "safe_default"
  | "project_policy"
  | "redacted"
  | "approval_required"
  | "blocked"
  | "stale";

export type SecurityStatusModel = {
  readonly kind: SecurityStatusKind;
  readonly title: string;
  readonly detail: string;
  readonly badge: string;
  readonly tooltip: string;
  readonly icon: typeof ShieldAlert;
};

export const createSecurityStatusModel = (
  detail: AgentSessionDetail | null
): SecurityStatusModel | null => {
  const policy = detail?.policySummary ?? null;
  const security = detail?.securitySummary ?? null;
  if (policy === null && security === null) {
    return null;
  }
  const kind = statusKind(policy, security);
  const redacted = security?.recentDecisions.filter((decision) => decision.redactionApplied).length ?? 0;
  const blocked = security?.recentDecisions.filter((decision) => decision.decision === "deny").length ?? 0;
  return {
    kind,
    title: titleFor(kind, policy, redacted, blocked),
    detail: detailFor(policy, security),
    badge: badgeFor(kind, redacted, blocked),
    tooltip: tooltipFor(policy, security),
    icon: iconFor(kind),
  };
};

const statusKind = (
  policy: AgentPolicySummary | null,
  security: AgentSecuritySummary | null
): SecurityStatusKind => {
  if (security?.status === "blocked") {
    return "blocked";
  }
  if (security?.status === "approval_required") {
    return "approval_required";
  }
  if (security?.status === "redacted") {
    return "redacted";
  }
  if (policy?.source === "project_manifest") {
    return "project_policy";
  }
  if (policy?.source === "product_default" || policy?.status === "safe_default") {
    return "safe_default";
  }
  return security?.status === "stale" ? "stale" : "clear";
};

const titleFor = (
  kind: SecurityStatusKind,
  policy: AgentPolicySummary | null,
  redacted: number,
  blocked: number
): string => {
  if (kind === "blocked") {
    return blocked === 1 ? "Sensitive resource blocked" : `${blocked} resources blocked`;
  }
  if (kind === "redacted") {
    return redacted === 1 ? "1 output redacted" : `${redacted} outputs redacted`;
  }
  if (kind === "project_policy") {
    return `Policy: ${policy?.permissionDefault ?? "sandbox"}`;
  }
  if (kind === "approval_required") {
    return "Security approval required";
  }
  if (kind === "stale") {
    return "Security state stale";
  }
  return "Policy: sandbox default";
};

const detailFor = (
  policy: AgentPolicySummary | null,
  security: AgentSecuritySummary | null
): string =>
  [
    policy?.source === "project_manifest" ? "project manifest" : policy?.status,
    security?.redactionProfile === undefined ? null : `${security.redactionProfile} redaction`,
    security === null || security.activeSecretHandles === 0
      ? null
      : `${security.activeSecretHandles} active secret handles`,
    security?.lastExfiltrationAction === undefined || security.lastExfiltrationAction === null
      ? null
      : `exfiltration: ${security.lastExfiltrationAction}`,
    security?.lastCapsuleBridgeDecision === undefined || security.lastCapsuleBridgeDecision === null
      ? null
      : `capsule bridge: ${security.lastCapsuleBridgeDecision}`,
  ]
    .filter(Boolean)
    .join(" · ");

const badgeFor = (kind: SecurityStatusKind, redacted: number, blocked: number): string => {
  if (kind === "blocked") {
    return String(blocked);
  }
  if (kind === "redacted") {
    return String(redacted);
  }
  if (kind === "project_policy") {
    return "policy";
  }
  if (kind === "approval_required") {
    return "hold";
  }
  return "ok";
};

const tooltipFor = (
  policy: AgentPolicySummary | null,
  security: AgentSecuritySummary | null
): string =>
  [
    policy?.manifestPath === undefined || policy.manifestPath === null ? null : `Manifest: ${policy.manifestPath}`,
    policy?.snapshotId === undefined ? null : `Policy: ${policy.snapshotId}`,
    security?.snapshotId === undefined || security.snapshotId === null ? null : `Security: ${security.snapshotId}`,
    security === null ? null : `Active secret handles: ${security.activeSecretHandles}`,
    security?.lastExfiltrationAction === undefined || security.lastExfiltrationAction === null
      ? null
      : `Last exfiltration action: ${security.lastExfiltrationAction}`,
    security?.lastCapsuleBridgeDecision === undefined || security.lastCapsuleBridgeDecision === null
      ? null
      : `Last capsule bridge decision: ${security.lastCapsuleBridgeDecision}`,
    security?.recentDecisions.length === 0 ? null : security?.recentDecisions.map((decision) => decision.decisionId).join(", "),
  ]
    .filter(Boolean)
    .join("\n");

const iconFor = (kind: SecurityStatusKind): typeof ShieldAlert => {
  if (kind === "blocked") {
    return ShieldX;
  }
  if (kind === "redacted" || kind === "approval_required") {
    return ShieldAlert;
  }
  if (kind === "stale") {
    return ShieldQuestion;
  }
  return ShieldCheck;
};
