import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { CommandApprovalRequest } from "../../command-approval-bar";
import { useAiPanelSessionActions } from "../use-ai-panel-session-actions";

describe("useAiPanelSessionActions", () => {
  test("creates a new session when session list is empty", async () => {
    const listSessions = vi.fn().mockResolvedValue([]);
    const createSession = vi.fn().mockResolvedValue({ id: "s-created" });

    const agentApi = {
      listSessions,
      createSession,
      getSession: vi.fn(),
      bindSessionProject: vi.fn(),
      deleteSession: vi.fn(),
      sendTurn: vi.fn(),
      enterPlanMode: vi.fn(),
      getPlan: vi.fn(),
      getPendingInteractions: vi.fn(),
      answerQuestion: vi.fn(),
      answerPlanQuestion: vi.fn(),
      resolvePlanApproval: vi.fn(),
      getMemoryConfig: vi.fn(),
      updateMemoryConfig: vi.fn(),
      submitCommandApproval: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    } as any;

    const { result } = renderHook(() => {
      const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
      const [activeDetail, setActiveDetail] = useState<any>(null);
      const [draftInput, setDraftInput] = useState("");
      const [selectedModelBySession, setSelectedModelBySession] =
        useState<Readonly<Record<string, string>>>({});
      const [boundProjectPathBySession, setBoundProjectPathBySession] =
        useState<Readonly<Record<string, string>>>({});
      const [, setProfiles] = useState<readonly any[]>([]);
      const [isLoading, setIsLoading] = useState(false);
      const [, setIsSending] = useState(false);
      const [, setIsInteractionSubmitting] = useState(false);
      const [, setRuntimeError] = useState<string | null>(null);
      const [, setFinalizingTurnId] = useState<string | null>(null);
      const [, setOptimisticUserMessages] = useState<readonly any[]>([]);
      const [isBindingProject, setIsBindingProject] = useState(false);

      const actions = useAiPanelSessionActions({
        agentApi,
        desktopApi: null,
        defaultProfileId: "p-default",
        newSessionTitle: "New Session",
        activeSessionId,
        setActiveSessionId,
        activeDetail,
        setActiveDetail,
        activeInteractionPanel: null,
        draftInput,
        setDraftInput,
        isSending: false,
        isPlanModeArmed: false,
        activeComposerModel: null,
        activeComposerModelOption: null,
        selectedComposerProfileId: null,
        setSelectedModelBySession,
        boundProjectPathBySession,
        setBoundProjectPathBySession,
        setProfiles,
        setIsLoading,
        setIsSending,
        setIsInteractionSubmitting,
        setRuntimeError,
        setFinalizingTurnId,
        setOptimisticUserMessages,
        mergePendingInteractionsForSession: () => {},
        startPendingInteractionPolling: () => () => {},
        isBindingProject,
        setIsBindingProject,
      });

      return {
        actions,
        activeSessionId,
        isLoading,
      };
    });

    await act(async () => {
      await result.current.actions.loadSessions();
    });

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({
      title: "New Session",
      profileId: "p-default",
    });
    expect(result.current.activeSessionId).toBe("s-created");
    expect(result.current.isLoading).toBe(false);
  });

  test("submits command approval only when request id matches", async () => {
    const submitCommandApproval = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      agent: {
        submitCommandApproval,
      },
    } as any;

    const request: CommandApprovalRequest = {
      id: "req-1",
      sessionId: "s-1",
      turnId: "t-1",
      toolCallId: "tc-1",
      toolName: "terminal.exec",
      toolLabel: "Terminal",
      command: "echo hi",
      riskLevel: "medium",
      riskDescription: "needs approval",
      isRepeat: false,
    };

    const { result } = renderHook(() => {
      const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
      const [activeDetail, setActiveDetail] = useState<any>(null);
      const [draftInput, setDraftInput] = useState("");
      const [, setSelectedModelBySession] =
        useState<Readonly<Record<string, string>>>({});
      const [boundProjectPathBySession, setBoundProjectPathBySession] =
        useState<Readonly<Record<string, string>>>({});
      const [, setProfiles] = useState<readonly any[]>([]);
      const [, setIsLoading] = useState(false);
      const [, setIsSending] = useState(false);
      const [, setIsInteractionSubmitting] = useState(false);
      const [, setRuntimeError] = useState<string | null>(null);
      const [, setFinalizingTurnId] = useState<string | null>(null);
      const [, setOptimisticUserMessages] = useState<readonly any[]>([]);
      const [isBindingProject, setIsBindingProject] = useState(false);

      const actions = useAiPanelSessionActions({
        agentApi: undefined,
        desktopApi,
        defaultProfileId: null,
        newSessionTitle: "New Session",
        activeSessionId,
        setActiveSessionId,
        activeDetail,
        setActiveDetail,
        activeInteractionPanel: null,
        draftInput,
        setDraftInput,
        isSending: false,
        isPlanModeArmed: false,
        activeComposerModel: null,
        activeComposerModelOption: null,
        selectedComposerProfileId: null,
        setSelectedModelBySession,
        boundProjectPathBySession,
        setBoundProjectPathBySession,
        setProfiles,
        setIsLoading,
        setIsSending,
        setIsInteractionSubmitting,
        setRuntimeError,
        setFinalizingTurnId,
        setOptimisticUserMessages,
        mergePendingInteractionsForSession: () => {},
        startPendingInteractionPolling: () => () => {},
        isBindingProject,
        setIsBindingProject,
      });

      return { actions };
    });

    await act(async () => {
      await result.current.actions.handleApprovalDecision(
        {
          requestId: "req-2",
          decision: "allow_once",
          timestamp: Date.now(),
        },
        request
      );
    });

    expect(submitCommandApproval).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.actions.handleApprovalDecision(
        {
          requestId: "req-1",
          decision: "allow_once",
          timestamp: Date.now(),
        },
        request
      );
    });

    expect(submitCommandApproval).toHaveBeenCalledWith({
      sessionId: "s-1",
      turnId: "t-1",
      toolCallId: "tc-1",
      decision: "allow_once",
    });
  });
});
