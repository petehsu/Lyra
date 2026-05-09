import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { AgentActionStack } from "../agent-action-stack";

describe("AgentActionStack", () => {
  test("hides routine delivery, security, and verification status", () => {
    render(<AgentActionStack {...defaultProps()} detail={createRoutineDetail()} />);

    expect(screen.queryByText("Policy: sandbox default")).toBeNull();
    expect(screen.queryByText("Delivery")).toBeNull();
    expect(screen.queryByText("pnpm test")).toBeNull();
  });

  test("shows blocked or failed status above the composer", () => {
    render(<AgentActionStack {...defaultProps()} detail={createAttentionDetail()} />);

    expect(screen.getByText("Sensitive resource blocked")).toBeDefined();
    expect(screen.getByText(/secret redaction/u)).toBeDefined();
    expect(screen.getByText("Verification")).toBeDefined();
    expect(screen.getByText("pnpm test")).toBeDefined();
    expect(screen.queryByText("pnpm lint")).toBeNull();
    expect(screen.getByText("Delivery")).toBeDefined();
    expect(screen.getByText("Verification failed.")).toBeDefined();
  });
});

const defaultProps = () => ({
  expandedPatchKey: null,
  onPatchSelect: vi.fn(),
});

const createRoutineDetail = (): AgentSessionDetail => ({
  ...baseDetail(),
  policySummary: {
    snapshotId: "policy-1",
    source: "product_default",
    status: "safe_default",
    permissionDefault: "sandbox",
    allowedModes: ["sandbox"],
    toolPolicySummary: {
      enabledCount: 1,
      disabledCount: 0,
      commandPolicy: "safe_default",
      networkPolicy: "disabled",
    },
    warnings: [],
  },
  securitySummary: {
    snapshotId: "security-1",
    status: "clear",
    redactionProfile: "balanced",
    recentDecisions: [],
    secretFindings: {
      total: 0,
      highConfidence: 0,
    },
    activeSecretHandles: 0,
  },
  verificationSummary: {
    verificationPlanId: "verification-1",
    sessionId: "session-1",
    status: "passed",
    requiredRunCount: 1,
    passedRunCount: 1,
    failedRunCount: 0,
    blockedRunCount: 0,
    notRunCount: 0,
    runs: [{
      verificationRunId: "run-1",
      kind: "test",
      status: "passed",
      command: "pnpm test",
      evidenceRefs: [],
      residualRisk: {},
      updatedAt: 2,
    }],
    updatedAt: 2,
  },
  deliveryProof: {
    deliveryProofId: "delivery-1",
    sessionId: "session-1",
    status: "ready",
    verificationRunIds: ["run-1"],
    artifactRefs: [],
    evidenceRefs: [],
    unresolvedRisks: {},
    summary: "Ready.",
    updatedAt: 2,
  },
});

const createAttentionDetail = (): AgentSessionDetail => ({
  ...baseDetail(),
  policySummary: {
    snapshotId: "policy-1",
    source: "project_manifest",
    status: "active",
    permissionDefault: "sandbox",
    allowedModes: ["sandbox"],
    toolPolicySummary: {
      enabledCount: 1,
      disabledCount: 0,
      commandPolicy: "restricted",
      networkPolicy: "disabled",
    },
    manifestPath: "/repo/lyra.policy.json",
    warnings: [],
  },
  securitySummary: {
    snapshotId: "security-1",
    status: "blocked",
    redactionProfile: "secret",
    recentDecisions: [{
      decisionId: "decision-1",
      resourceKind: "secret",
      resourceRef: "env:API_KEY",
      decision: "deny",
      reasonCodes: ["secret"],
      riskLevel: "high",
      redactionApplied: false,
      createdAt: 2,
    }],
    secretFindings: {
      total: 1,
      highConfidence: 1,
    },
    activeSecretHandles: 0,
  },
  verificationSummary: {
    verificationPlanId: "verification-1",
    sessionId: "session-1",
    status: "failed",
    requiredRunCount: 2,
    passedRunCount: 1,
    failedRunCount: 1,
    blockedRunCount: 0,
    notRunCount: 0,
    runs: [
      {
        verificationRunId: "run-1",
        kind: "test",
        status: "failed",
        command: "pnpm test",
        exitCode: 1,
        evidenceRefs: ["evidence-1"],
        residualRisk: {},
        updatedAt: 2,
      },
      {
        verificationRunId: "run-2",
        kind: "lint",
        status: "passed",
        command: "pnpm lint",
        evidenceRefs: [],
        residualRisk: {},
        updatedAt: 2,
      },
    ],
    updatedAt: 2,
  },
  deliveryProof: {
    deliveryProofId: "delivery-1",
    sessionId: "session-1",
    status: "blocked",
    verificationRunIds: ["run-1", "run-2"],
    artifactRefs: [],
    evidenceRefs: [],
    unresolvedRisks: {},
    summary: "Verification failed.",
    updatedAt: 2,
  },
});

const baseDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    collaborationMode: "default",
    projectRoot: "/repo",
    projectName: "repo",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  activeTodo: null,
  executionSummary: null,
  verificationSummary: null,
  completionAudit: null,
  deliveryProof: null,
  longWorkSummary: null,
  followSummary: null,
});
