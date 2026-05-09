import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AgentRuntimeEvent, AgentSessionDetail } from "../agent-ui-types";
import { useAgentWorkspaceFollow } from "../use-agent-workspace-follow";

describe("useAgentWorkspaceFollow", () => {
  test("opens read file tool targets in the workspace when follow is enabled", async () => {
    const onOpenFilePath = vi.fn();
    renderHook(() =>
      useAgentWorkspaceFollow({
        enabled: true,
        detail: createDetail([{
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "tool_operation_started",
          payload: {
            operation: {
              toolPath: "/tools/filesystem/read_file",
              args: {
                path: "src/app.ts",
                line: 12,
                column: 3,
              },
            },
          },
          timestamp: 10,
        }]),
        workspaceRoot: "/repo",
        onOpenFilePath,
      })
    );

    await waitFor(() => {
      expect(onOpenFilePath).toHaveBeenCalledWith(
        "/repo/src/app.ts",
        { line: 12, column: 3 },
        { forceReloadIfOpen: true }
      );
    });
  });

  test("ignores list and search operations", async () => {
    const onOpenFilePath = vi.fn();
    renderHook(() =>
      useAgentWorkspaceFollow({
        enabled: true,
        detail: createDetail([{
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "tool_operation_started",
          payload: {
            operation: {
              toolPath: "/tools/filesystem/list_files",
              args: { path: "src" },
            },
          },
          timestamp: 10,
        }]),
        workspaceRoot: "/repo",
        onOpenFilePath,
      })
    );

    await waitFor(() => {
      expect(onOpenFilePath).not.toHaveBeenCalled();
    });
  });

  test("does not open tool paths when read file args are missing", async () => {
    const onOpenFilePath = vi.fn();
    renderHook(() =>
      useAgentWorkspaceFollow({
        enabled: true,
        detail: createDetail([{
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "tool_operation_started",
          payload: {
            operation: {
              toolPath: "/tools/filesystem/read_file",
              path: "/tools/filesystem/read_file",
            },
          },
          timestamp: 10,
        }]),
        workspaceRoot: "/repo",
        onOpenFilePath,
      })
    );

    await waitFor(() => {
      expect(onOpenFilePath).not.toHaveBeenCalled();
    });
  });

  test("does not open virtual follow refs as workspace files", async () => {
    const onOpenFilePath = vi.fn();
    renderHook(() =>
      useAgentWorkspaceFollow({
        enabled: true,
        detail: createDetail([{
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "follow_projection_updated",
          payload: {
            operations: [{
              toolName: "read_file",
              toolPath: "/tools/filesystem/read_file",
              status: "completed",
              filePath: "tool_result_123",
              startedAt: 10,
              finishedAt: 11,
            }],
          },
          timestamp: 11,
        }]),
        workspaceRoot: "/repo",
        onOpenFilePath,
      })
    );

    await waitFor(() => {
      expect(onOpenFilePath).not.toHaveBeenCalled();
    });
  });

  test("opens live write projection targets once per follow event", async () => {
    const onOpenFilePath = vi.fn();
    const firstEvent: AgentRuntimeEvent = {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "follow_projection_updated",
      payload: {
        operations: [{
          toolName: "write_file",
          status: "running",
          filePath: "src/generated.ts",
          startedAt: 10,
          finishedAt: null,
        }],
      },
      timestamp: 10,
    };
    const { rerender } = renderHook(
      ({ detail }) =>
        useAgentWorkspaceFollow({
          enabled: true,
          detail,
          workspaceRoot: "/repo",
          onOpenFilePath,
        }),
      { initialProps: { detail: createDetail([firstEvent]) } }
    );

    await waitFor(() => {
      expect(onOpenFilePath).toHaveBeenCalledTimes(1);
    });
    expect(onOpenFilePath).toHaveBeenLastCalledWith(
      "/repo/src/generated.ts",
      undefined,
      { forceReloadIfOpen: true, allowMissing: true }
    );

    rerender({ detail: createDetail([firstEvent]) });
    expect(onOpenFilePath).toHaveBeenCalledTimes(1);

    rerender({
      detail: createDetail([{
        ...firstEvent,
        payload: {
          operations: [{
            toolName: "write_file",
            status: "completed",
            filePath: "src/generated.ts",
            startedAt: 10,
            finishedAt: 11,
          }],
        },
        timestamp: 11,
      }]),
    });

    await waitFor(() => {
      expect(onOpenFilePath).toHaveBeenCalledTimes(2);
    });
    expect(onOpenFilePath).toHaveBeenLastCalledWith(
      "/repo/src/generated.ts",
      undefined,
      { forceReloadIfOpen: true }
    );
  });

  test("does not open workspace files while follow is disabled", async () => {
    const onOpenFilePath = vi.fn();
    renderHook(() =>
      useAgentWorkspaceFollow({
        enabled: false,
        detail: createDetail([{
          sessionId: "session-1",
          turnId: "turn-1",
          phase: "tool_operation_started",
          payload: {
            operation: {
              toolPath: "/tools/filesystem/read_file",
              args: { path: "src/app.ts" },
            },
          },
          timestamp: 10,
        }]),
        workspaceRoot: "/repo",
        onOpenFilePath,
      })
    );

    await waitFor(() => {
      expect(onOpenFilePath).not.toHaveBeenCalled();
    });
  });
});

const createDetail = (runtimeEvents: readonly AgentRuntimeEvent[]): AgentSessionDetail => ({
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
  runtimeEvents,
  activeTodo: null,
  executionSummary: null,
  verificationSummary: null,
  completionAudit: null,
  deliveryProof: null,
  longWorkSummary: null,
  followSummary: null,
});
