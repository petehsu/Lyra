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
            options: [
              { label: "A", description: "a" },
              { label: "B", description: "b" }
            ]
          }
        ]
      },
      createdAt: now + 1,
      updatedAt: now + 1
    } as any, LABELS);
    expect(questionPanel?.kind).toBe("planQuestion");

    const mcpPanel = toPendingInteractionPanel({
      id: "ia-m",
      sessionId: "s-1",
      turnId: "t-3",
      kind: "mcp_elicitation",
      status: "pending",
      payload: {
        message: "Need a value from user",
        serverName: "Filesystem MCP"
      },
      createdAt: now + 2,
      updatedAt: now + 2
    } as any, LABELS);
    expect(mcpPanel?.kind).toBe("planQuestion");
    if (mcpPanel?.kind !== "planQuestion") {
      throw new Error("expected planQuestion panel");
    }
    expect(mcpPanel.request.questions[0]?.header).toBe("Filesystem MCP");
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
