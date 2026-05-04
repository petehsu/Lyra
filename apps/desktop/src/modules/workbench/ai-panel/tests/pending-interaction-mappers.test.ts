import { describe, expect, test } from "vitest";

import {
  mergePendingInteractionLists,
  sortPendingInteractions,
  toPendingInteractionPanel,
  type InteractionTextBundle,
} from "../interaction/pending-interaction-mappers";

const LABELS: InteractionTextBundle = {
  toolTerminalSession: "Terminal Session",
  toolTerminalInput: "Terminal Input",
  toolTerminalExec: "Terminal",
  commandNeedsApproval: "Need approval",
  proposedPlanSummaryFallback: "Plan"
};

const planArtifact = {
  planId: "plan-1",
  status: "proposed",
  title: "Website plan",
  summary: "Website plan",
  objective: "Build the page",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Build", body: "Build the page" }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
};

const now = 1_700_000_000_000;

describe("pending interaction mappers", () => {
  test("maps command approval interaction", () => {
    const interaction = {
      id: "ia-1",
      sessionId: "s-1",
      turnId: "t-1",
      kind: "command_execution_approval",
      status: "pending",
      payload: {
        raw: {
          toolName: "terminal.exec",
          toolCallId: "tc-1",
          message: "approve this command",
          input: {
            command: "ls -la",
            cwd: "/repo"
          },
          metadata: {
            riskLevel: "high",
            mode: "command"
          }
        }
      },
      createdAt: now,
      updatedAt: now
    } as any;

    const panel = toPendingInteractionPanel(interaction, LABELS);
    expect(panel?.kind).toBe("commandApproval");
    if (panel?.kind !== "commandApproval") {
      throw new Error("expected commandApproval panel");
    }
    expect(panel.request.command).toBe("ls -la");
    expect(panel.request.toolLabel).toBe("Terminal");
    expect(panel.request.riskLevel).toBe("high");
    expect(panel.request.cwd).toBe("/repo");
  });

  test("maps tool input and mcp elicitation interactions", () => {
    const questionPanel = toPendingInteractionPanel({
      id: "ia-q",
      sessionId: "s-1",
      turnId: "t-2",
      kind: "tool_user_input",
      status: "pending",
      payload: {
        questions: [
          {
            id: "q1",
            header: "mode",
            question: "Pick one",
            options: null,
            isSecret: true
          }
        ]
      },
      createdAt: now + 1,
      updatedAt: now + 1
    } as any, LABELS);
    expect(questionPanel?.kind).toBe("agentQuestion");
    if (questionPanel?.kind !== "agentQuestion") {
      throw new Error("expected agentQuestion panel");
    }
    expect(questionPanel.request.questions[0]?.options).toEqual([]);
    expect(questionPanel.request.questions[0]?.allowOther).toBe(true);
    expect(questionPanel.request.questions[0]?.isSecret).toBe(true);

    const mcpPanel = toPendingInteractionPanel({
      id: "ia-m",
      sessionId: "s-1",
      turnId: "t-3",
      kind: "mcp_elicitation",
      status: "pending",
      payload: {
        message: "Need a value from user",
        serverName: "Filesystem MCP",
        mode: "form",
        _meta: { persist: ["session", "always"] },
        requestedSchema: {
          type: "object",
          properties: {
            email: {
              type: "string",
              title: "Email",
              description: "Account email",
            },
            mode: {
              type: "string",
              title: "Mode",
              enum: ["read", "write"],
              enumNames: ["Read", "Write"],
            },
            confirmed: {
              type: "boolean",
              title: "Confirmed",
              default: true,
            }
          },
          required: ["email"]
        }
      },
      createdAt: now + 2,
      updatedAt: now + 2
    } as any, LABELS);
    expect(mcpPanel?.kind).toBe("mcpElicitation");
    if (mcpPanel?.kind !== "mcpElicitation") {
      throw new Error("expected mcpElicitation panel");
    }
    expect(mcpPanel.request.serverName).toBe("Filesystem MCP");
    expect(mcpPanel.request.meta).toEqual({ persist: ["session", "always"] });
    expect(mcpPanel.request.fields.map((field) => [field.id, field.kind, field.required])).toEqual([
      ["email", "string", true],
      ["mode", "single_select", false],
      ["confirmed", "boolean", false],
    ]);
    expect(mcpPanel.request.fields[1]?.options).toEqual([
      { value: "read", label: "Read" },
      { value: "write", label: "Write" },
    ]);
    expect(mcpPanel.request.fields[2]?.defaultValue).toBe(true);
  });

  test("maps plan approval interactions", () => {
    const panel = toPendingInteractionPanel({
      id: "plan:turn-plan",
      sessionId: "thread-1",
      turnId: "turn-plan",
      kind: "plan_approval",
      status: "pending",
      payload: {
        raw: {
          planId: "plan-1",
          version: 2,
          status: "proposed",
          summary: "Website plan",
          artifact: planArtifact,
        }
      },
      createdAt: now + 3,
      updatedAt: now + 3
    } as any, LABELS);

    expect(panel?.kind).toBe("planApproval");
    if (panel?.kind !== "planApproval") {
      throw new Error("expected planApproval panel");
    }
    expect(panel.request.id).toBe("plan:turn-plan");
    expect(panel.request.turnId).toBe("turn-plan");
    expect(panel.request.planId).toBe("plan-1");
    expect(panel.request.artifact.title).toBe("Website plan");
  });

  test("sorts and merges pending interactions by timestamp and update version", () => {
    const current = [
      {
        id: "a",
        createdAt: 3,
        updatedAt: 10
      },
      {
        id: "b",
        createdAt: 1,
        updatedAt: 1
      }
    ] as any[];
    const incoming = [
      {
        id: "a",
        createdAt: 3,
        updatedAt: 11
      },
      {
        id: "c",
        createdAt: 2,
        updatedAt: 2
      }
    ] as any[];

    const sorted = sortPendingInteractions(current);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);

    const merged = mergePendingInteractionLists(current, incoming);
    expect(merged.map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(merged.find((item) => item.id === "a")?.updatedAt).toBe(11);
  });
});
