import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { SecurityStatusRow } from "../security-status-row";

describe("SecurityStatusRow", () => {
  test("renders safe default policy state", () => {
    render(<SecurityStatusRow detail={createDetail("product_default", "clear")} />);

    expect(screen.getByText("Policy: sandbox default")).toBeDefined();
    expect(screen.getByText("safe_default · strict redaction")).toBeDefined();
  });

  test("renders project manifest policy state", () => {
    render(<SecurityStatusRow detail={createDetail("project_manifest", "clear")} />);

    expect(screen.getByText("Policy: sandbox")).toBeDefined();
    expect(screen.getByText("project manifest · strict redaction")).toBeDefined();
  });

  test("renders redacted and blocked security states", () => {
    const { rerender } = render(<SecurityStatusRow detail={createDetail("project_manifest", "redacted")} />);

    expect(screen.getByText("1 output redacted")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();

    rerender(<SecurityStatusRow detail={createDetail("project_manifest", "blocked")} />);
    expect(screen.getByText("Sensitive resource blocked")).toBeDefined();
  });
});

const createDetail = (
  source: "product_default" | "project_manifest",
  securityStatus: "clear" | "redacted" | "blocked"
): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  policySummary: {
    snapshotId: "policy-1",
    source,
    status: source === "project_manifest" ? "active" : "safe_default",
    permissionDefault: "sandbox",
    allowedModes: ["sandbox"],
    toolPolicySummary: {
      enabledCount: 6,
      disabledCount: 0,
      commandPolicy: "safe_default",
      networkPolicy: "disabled",
    },
    manifestPath: source === "project_manifest" ? "/repo/.lyra/project.manifest.json" : null,
    warnings: [],
  },
  securitySummary: {
    snapshotId: "policy-1",
    status: securityStatus,
    redactionProfile: "strict",
    recentDecisions: securityStatus === "clear"
      ? []
      : [{
          decisionId: "security-1",
          resourceKind: "tool_result",
          resourceRef: "tool-result-1",
          decision: securityStatus === "blocked" ? "deny" : "allow_redacted",
          reasonCodes: ["test"],
          riskLevel: "high",
          redactionApplied: securityStatus === "redacted",
          createdAt: 3,
        }],
    secretFindings: {
      total: securityStatus === "clear" ? 0 : 1,
      highConfidence: securityStatus === "clear" ? 0 : 1,
      lastReportId: securityStatus === "clear" ? null : "report-1",
    },
  },
});
