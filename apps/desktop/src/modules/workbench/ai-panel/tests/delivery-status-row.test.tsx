import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { DeliveryStatusRow } from "../delivery-status-row";
import type { AgentSessionDetail } from "../agent-ui-types";

describe("DeliveryStatusRow", () => {
  test("renders compact failed delivery state from audit and proof", () => {
    render(<DeliveryStatusRow detail={createDetail()} />);

    expect(screen.getByLabelText("Delivery status")).toBeDefined();
    expect(screen.getByText("Delivery")).toBeDefined();
    expect(screen.getByText("Delivery proof failed. Completion audit failed.")).toBeDefined();
    expect(screen.getByText("1 failed · 1 approval")).toBeDefined();
  });

  test("does not render when no audit or proof exists", () => {
    const { container } = render(<DeliveryStatusRow detail={{ ...createDetail(), completionAudit: null, deliveryProof: null }} />);

    expect(container.firstChild).toBeNull();
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
  verificationSummary: null,
  completionAudit: {
    completionAuditId: "completion_audit_1",
    sessionId: "session-1",
    status: "failed",
    missingTodoItemIds: [],
    missingEvidenceRefs: [],
    failedVerificationRunIds: ["verification_run_1"],
    blockedVerificationRunIds: [],
    notRunVerificationRunIds: [],
    pendingApprovalTicketIds: ["approval_1"],
    residualRisks: [],
    summary: "Completion audit failed.",
    updatedAt: 3,
  },
  deliveryProof: {
    deliveryProofId: "delivery_proof_1",
    sessionId: "session-1",
    status: "failed",
    verificationRunIds: ["verification_run_1"],
    completionAuditId: "completion_audit_1",
    artifactRefs: [],
    evidenceRefs: [],
    unresolvedRisks: {},
    summary: "Delivery proof failed. Completion audit failed.",
    updatedAt: 4,
  },
});
