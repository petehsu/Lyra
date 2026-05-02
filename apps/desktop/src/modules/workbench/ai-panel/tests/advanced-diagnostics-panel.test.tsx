import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { GlobalDialogOpenRequest } from "../../global-dialog";
import { AdvancedDiagnosticsPanel } from "../advanced-diagnostics-panel";
import type { AgentAdvancedRuntimeActions } from "../use-ai-panel-surface-runtime";

const createActions = (): AgentAdvancedRuntimeActions => ({
  listLoadedThreads: vi.fn(async () => ({ data: ["thread-1"] })),
  listThreadTurns: vi.fn(async () => ({ data: [{ id: "turn-1", status: "completed" }] })),
  listCollaborationModes: vi.fn(async () => ({ data: [{ name: "default", model: "gpt-5.4" }] })),
  setThreadMemoryMode: vi.fn(async () => ({})),
  runThreadShellCommand: vi.fn(async () => ({})),
  injectThreadItems: vi.fn(async () => ({})),
  incrementElicitation: vi.fn(async () => ({ count: 1, paused: true })),
  decrementElicitation: vi.fn(async () => ({ count: 0, paused: false })),
});

afterEach(() => {
  cleanup();
});

describe("AdvancedDiagnosticsPanel", () => {
  test("requires confirmation before running shell commands", async () => {
    const actions = createActions();
    const dialogs: GlobalDialogOpenRequest[] = [];

    render(
      <AdvancedDiagnosticsPanel
        locale="en-US"
        activeThreadId="thread-1"
        actions={actions}
        openDialog={(request) => {
          dialogs.push(request);
        }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(actions.listLoadedThreads).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Shell command"), {
      target: { value: "echo hi" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run command" }));

    expect(actions.runThreadShellCommand).not.toHaveBeenCalled();
    expect(dialogs[0]?.title).toBe("Run shell command?");

    await act(async () => {
      dialogs[0]?.actions?.find((action) => action.id === "confirm")?.onSelect?.();
    });

    await waitFor(() => {
      expect(actions.runThreadShellCommand).toHaveBeenCalledWith("thread-1", "echo hi");
    });
  });

  test("validates and confirms response item injection", async () => {
    const actions = createActions();
    const dialogs: GlobalDialogOpenRequest[] = [];

    render(
      <AdvancedDiagnosticsPanel
        locale="en-US"
        activeThreadId="thread-1"
        actions={actions}
        openDialog={(request) => {
          dialogs.push(request);
        }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(actions.listCollaborationModes).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Response items"), {
      target: { value: "{\"type\":\"message\"}" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Inject items" }));
    expect(await screen.findByText("JSON must be an array.")).toBeDefined();
    expect(actions.injectThreadItems).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Response items"), {
      target: { value: "[{\"type\":\"message\"}]" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Inject items" }));
    expect(dialogs[0]?.title).toBe("Inject response items?");

    await act(async () => {
      dialogs[0]?.actions?.find((action) => action.id === "confirm")?.onSelect?.();
    });

    await waitFor(() => {
      expect(actions.injectThreadItems).toHaveBeenCalledWith("thread-1", [{ type: "message" }]);
    });
  });
});
