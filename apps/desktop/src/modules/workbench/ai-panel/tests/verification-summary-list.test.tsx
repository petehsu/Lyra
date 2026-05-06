import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { VerificationSummaryList } from "../verification-summary-list";
import type { AgentSessionDetail } from "../agent-ui-types";

describe("VerificationSummaryList", () => {
  test("renders compact verification rows and delivery proof state", () => {
    render(<VerificationSummaryList detail={createDetail()} />);

    expect(screen.getByLabelText("Verification")).toBeDefined();
    expect(screen.getByText("cargo test -p lyra-ai-core")).toBeDefined();
    expect(screen.getByText("Passed · . · exit 0 · 1 evidence ref")).toBeDefined();
    expect(screen.getByText("npm --prefix apps/desktop run test -- ai-panel")).toBeDefined();
    expect(screen.getByText("Failed · apps/desktop · exit 1")).toBeDefined();
    expect(screen.getByText("failed · proof pending")).toBeDefined();
  });
});

const createDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Thread",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  activeTodo: null,
  executionSummary: null,
  verificationSummary: {
    verificationPlanId: "verification_plan_1",
    sessionId: "session-1",
    status: "failed",
    requiredRunCount: 2,
    passedRunCount: 1,
    failedRunCount: 1,
    blockedRunCount: 0,
    notRunCount: 0,
    updatedAt: 3,
    runs: [
      {
        verificationRunId: "verification_run_1",
        verificationPlanId: "verification_plan_1",
        kind: "command",
        status: "passed",
        command: "cargo test -p lyra-ai-core",
        cwd: ".",
        exitCode: 0,
        artifactId: "artifact_1",
        evidenceRefs: ["evidence_1"],
        residualRisk: {},
        updatedAt: 3,
      },
      {
        verificationRunId: "verification_run_2",
        verificationPlanId: "verification_plan_1",
        kind: "command",
        status: "failed",
        command: "npm --prefix apps/desktop run test -- ai-panel",
        cwd: "apps/desktop",
        exitCode: 1,
        evidenceRefs: [],
        residualRisk: { level: "medium" },
        updatedAt: 4,
      },
    ],
  },
  deliveryProof: {
    deliveryProofId: "delivery_proof_1",
    sessionId: "session-1",
    status: "pending_verification",
    verificationRunIds: ["verification_run_1", "verification_run_2"],
    artifactRefs: ["artifact_1"],
    evidenceRefs: ["evidence_1"],
    unresolvedRisks: {},
    summary: "Delivery proof is pending verification.",
    updatedAt: 4,
  },
});
