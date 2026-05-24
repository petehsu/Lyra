import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../../shared/desktop-bridge";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { SettingsAiModel } from "../../settings-ai";
import { AiPanelSurface } from "../view";

const snapshot: AgentSessionSnapshot = {
  id: "session-1",
  title: "Lyra Agent",
  sessionKind: "normal",
  workingDir: "/",
  projectBound: false,
  messages: [],
  tools: [],
  automation: {
    subagentModel: null,
    autoreviewEnabled: null,
    autojudgeEnabled: null
  },
  sidePanel: {
    focusedPageId: null,
    pages: []
  },
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-05-13T00:00:00.000Z"
};

const snapshotWithConversation: AgentSessionSnapshot = {
  ...snapshot,
  messages: [{
    id: "message-user-1",
    role: "user",
    text: "Plan this project",
    createdAt: "2026-05-13T00:00:01.000Z"
  }]
};

const jcodeModels = {
  sessionId: "session-1",
  currentModel: "mimo-v2.5-pro",
  currentProvider: "mimo-token-plan",
  defaultModel: "mimo-v2.5-pro",
  defaultProvider: "mimo-token-plan",
  models: [
    {
      id: "mimo-v2.5-pro",
      label: "mimo-v2.5-pro · MiMo",
      model: "mimo-v2.5-pro",
      provider: "MiMo",
      providerKey: "mimo-token-plan",
      apiMethod: "openai-compatible",
      detail: "configured",
      available: true
    },
    {
      id: "gpt-5",
      label: "gpt-5 · OpenAI",
      model: "gpt-5",
      provider: "OpenAI",
      providerKey: "openai",
      apiMethod: "openai",
      detail: "configured",
      available: true
    },
    {
      id: "unconfigured-model",
      label: "unconfigured-model · Missing",
      model: "unconfigured-model",
      provider: "Missing",
      providerKey: "missing",
      apiMethod: "openai",
      detail: "not configured",
      available: false
    }
  ],
  routes: [],
  reasoningEffort: {
    current: "low",
    options: ["none", "low", "medium", "high"],
    supported: true
  },
  serviceTier: {
    current: "priority",
    options: ["priority", "flex"],
    supported: true
  }
};

const createDesktopApi = () => {
  let listener: ((event: AgentRuntimeEvent) => void) | null = null;
  let readSnapshot = snapshot;
  let rollbackRestoreSnapshot = snapshot;
  let modelsResponse = jcodeModels;
  const createSession = vi.fn(async () => snapshot);
  const runImprove = vi.fn(async () => ({
    sessionId: "session-1",
    turnId: "turn-improve",
    status: "running" as const
  }));
  const runRefactor = vi.fn(async () => ({
    sessionId: "session-1",
    turnId: "turn-refactor",
    status: "running" as const
  }));
  const triggerPoke = vi.fn(async () => ({
    sessionId: "session-1",
    turnId: "turn-poke",
    status: "running" as const,
    sent: true,
    incompleteTodoCount: 1
  }));
  const runReview = vi.fn(async () => ({
    sessionId: "review-session",
    turnId: "turn-review",
    status: "running" as const
  }));
  const runJudge = vi.fn(async () => ({
    sessionId: "judge-session",
    turnId: "turn-judge",
    status: "running" as const
  }));
  const previewRollback = vi.fn(async (request: { messageId: string; sessionId: string }) => ({
    sessionId: request.sessionId,
    messageId: request.messageId,
    available: true,
    checkpointAt: "2026-05-13T00:00:00.000Z",
    removedMessageCount: 2,
    changedFiles: [{ path: "src/file.ts" }],
    unavailableReason: null
  }));
  const restoreRollback = vi.fn(async (request: { messageId: string; sessionId: string }) => ({
    sessionId: request.sessionId,
    messageId: request.messageId,
    snapshot: rollbackRestoreSnapshot,
    removedMessageCount: 2,
    restoredFileCount: 1
  }));
  const bindProject = vi.fn(async () => ({
    ...snapshot,
    workingDir: "/Users/petehsu/Documents/Lyra",
    projectBound: true
  }));
  const api = {
    agent: {
      createSession,
      readSession: vi.fn(async () => readSnapshot),
      sendTurn: vi.fn(async () => ({
        sessionId: "session-1",
        turnId: "turn-1",
        status: "running" as const
      })),
      cancelTurn: vi.fn(async () => ({
        sessionId: "session-1",
        status: "cancelling" as const
      })),
      submitDecision: vi.fn(async () => undefined),
      respondPermission: vi.fn(async () => undefined),
      previewRollback,
      restoreRollback,
      bindProject,
      listJcodeModels: vi.fn(async () => modelsResponse),
      switchJcodeModel: vi.fn(async () => modelsResponse),
      refreshJcodeModels: vi.fn(async () => modelsResponse),
      updateJcodeProviderOptions: vi.fn(async () => modelsResponse),
      updateJcodeAgentRoles: vi.fn(async () => ({ config: {}, commands: [] })),
      runImprove,
      runRefactor,
      triggerPoke,
      runReview,
      runJudge,
      onEvent: vi.fn((next: (event: AgentRuntimeEvent) => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      })
    }
  } as unknown as LyraDesktopApi;
  return {
    api,
    createSession,
    runImprove,
    runRefactor,
    triggerPoke,
    runReview,
    runJudge,
    bindProject,
    emit: (event: AgentRuntimeEvent) => {
      listener?.(event);
    },
    setReadSnapshot: (nextSnapshot: AgentSessionSnapshot) => {
      readSnapshot = nextSnapshot;
    },
    setRollbackRestoreSnapshot: (nextSnapshot: AgentSessionSnapshot) => {
      rollbackRestoreSnapshot = nextSnapshot;
    },
    setModelsResponse: (nextModels: typeof jcodeModels) => {
      modelsResponse = nextModels;
    }
  };
};

const renderPanel = (
  desktopApi: LyraDesktopApi,
  onRequestProjectBind?: (currentPath?: string) => Promise<string | null>,
  onOpenProjectTree?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void,
  locale: "zh-CN" | "en-US" = "en-US",
  onOpenModelSettings?: () => Promise<void> | void
) =>
  render(
    <AiPanelSurface
      variant="sidebar"
      desktopApi={desktopApi}
      {...(onRequestProjectBind === undefined ? {} : { onRequestProjectBind })}
      {...(onOpenProjectTree === undefined ? {} : { onOpenProjectTree })}
      {...(onOpenModelSettings === undefined ? {} : { onOpenModelSettings })}
      title="Agent"
      emptyThreadLabel="No messages"
      locale={locale}
    />
  );

const settingsAiModel = {
  profiles: [],
  defaultProfileId: null,
  jcodeConfig: {
    config: {
      provider: {
        default_provider: "mimo-token-plan",
        default_model: "mimo-v2.5-pro"
      }
    },
    commands: []
  }
} as unknown as SettingsAiModel;

const renderPanelWithSettings = (desktopApi: LyraDesktopApi) =>
  render(
    <AiPanelSurface
      variant="sidebar"
      desktopApi={desktopApi}
      settingsAiModel={settingsAiModel}
      title="Agent"
      emptyThreadLabel="No messages"
      locale="en-US"
    />
  );

describe("AiPanelSurface", () => {
  test("follows the selected Chinese locale for Agent chrome", async () => {
    const { api } = createDesktopApi();
    renderPanel(api, undefined, undefined, "zh-CN");

    await screen.findByText("Lyra Agent");
    expect(screen.getByPlaceholderText("给 Agent 发送消息")).toBeInTheDocument();
    expect(screen.getByLabelText("更多")).toBeInTheDocument();
    expect(await screen.findByLabelText("模型控制")).toBeInTheDocument();
    expect(screen.queryByLabelText("刷新模型列表")).not.toBeInTheDocument();
  });

  test("sends composer text through the Agent provider", async () => {
    const { api } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(api.agent?.readSession).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByPlaceholderText("Send a message to Agent"), {
      target: { value: "Build the slice" }
    });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(api.agent?.sendTurn).toHaveBeenCalledWith({
        sessionId: "session-1",
        text: "Build the slice"
      });
    });
  });

  test("does not send Lyra provider profile state with the Agent turn", async () => {
    const { api } = createDesktopApi();
    renderPanelWithSettings(api);

    await waitFor(() => {
      expect(api.agent?.readSession).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByPlaceholderText("Send a message to Agent"), {
      target: { value: "Use the configured model" }
    });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(api.agent?.sendTurn).toHaveBeenCalledWith({
        sessionId: "session-1",
        text: "Use the configured model"
      });
    });
  });

  test("renders message times in 24-hour format", async () => {
    const { api, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      messages: [
        {
          id: "user-time",
          role: "user",
          text: "time check",
          createdAt: "2026-05-13T20:43:00"
        },
        {
          id: "agent-time",
          role: "assistant",
          text: "done",
          createdAt: "2026-05-13T20:44:00"
        }
      ]
    });
    renderPanel(api, undefined, undefined, "zh-CN");

    expect(await screen.findByText("time check")).toBeInTheDocument();
    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("20:43");
    expect(rendered).toContain("20:44");
    expect(rendered).not.toMatch(/\b(?:AM|PM)\b/u);
  });

  test("switches models from the composer toolbar through the Lyra Agent bridge", async () => {
    const { api } = createDesktopApi();
    renderPanel(api);

    fireEvent.click(await screen.findByLabelText("Model controls"));
    expect(screen.queryByRole("option", { name: "unconfigured-model · Missing" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "gpt-5 · OpenAI" }));

    await waitFor(() => {
      expect(api.agent?.switchJcodeModel).toHaveBeenCalledWith({
        sessionId: "session-1",
        model: "gpt-5"
      });
    });
  });

  test("shows a model settings reminder instead of a fallback model when none are configured", async () => {
    const { api, setModelsResponse } = createDesktopApi();
    const openModelSettings = vi.fn();
    setModelsResponse({
      ...jcodeModels,
      currentModel: "claude-sonnet-4-6",
      currentProvider: "Anthropic",
      defaultModel: "",
      defaultProvider: "",
      models: []
    });
    renderPanel(api, undefined, undefined, "en-US", openModelSettings);

    const configureButton = await screen.findByRole("button", { name: "Configure model" });
    expect(screen.queryByText(/claude-sonnet-4-6/u)).not.toBeInTheDocument();
    fireEvent.click(configureButton);

    expect(openModelSettings).toHaveBeenCalled();
  });

  test("reloads composer model controls after Lyra Agent settings change", async () => {
    const { api, setModelsResponse } = createDesktopApi();
    const openModelSettings = vi.fn();
    setModelsResponse({
      ...jcodeModels,
      currentModel: "claude-sonnet-4-6",
      currentProvider: "Anthropic",
      defaultModel: "",
      defaultProvider: "",
      models: []
    });
    const initialSettings = {
      ...settingsAiModel,
      jcodeConfig: {
        config: {
          provider: {
            default_provider: null,
            default_model: null
          },
          providers: {}
        },
        commands: []
      }
    } as unknown as SettingsAiModel;
    const configuredSettings = {
      ...settingsAiModel,
      jcodeConfig: {
        config: {
          provider: {
            default_provider: "mimo-token-plan",
            default_model: "mimo-v2.5-pro"
          },
          providers: {
            "mimo-token-plan": {
              base_url: "https://token-plan-sgp.xiaomimimo.com/v1",
              default_model: "mimo-v2.5-pro",
              models: [{ id: "mimo-v2.5-pro" }]
            }
          }
        },
        commands: []
      },
      jcodeAccounts: {
        defaultProvider: "mimo-token-plan",
        defaultModel: "mimo-v2.5-pro",
        authStatus: {},
        accounts: []
      }
    } as unknown as SettingsAiModel;

    const { rerender } = render(
      <AiPanelSurface
        variant="sidebar"
        desktopApi={api}
        settingsAiModel={initialSettings}
        onOpenModelSettings={openModelSettings}
        title="Agent"
        emptyThreadLabel="No messages"
        locale="en-US"
      />
    );

    expect(await screen.findByRole("button", { name: "Configure model" })).toBeInTheDocument();
    setModelsResponse(jcodeModels);
    rerender(
      <AiPanelSurface
        variant="sidebar"
        desktopApi={api}
        settingsAiModel={configuredSettings}
        onOpenModelSettings={openModelSettings}
        title="Agent"
        emptyThreadLabel="No messages"
        locale="en-US"
      />
    );

    await waitFor(() => {
      expect(api.agent?.listJcodeModels).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByLabelText("Model controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configure model" })).not.toBeInTheDocument();
  });

  test("binds the current session to a real project directory from the header", async () => {
    const { api, bindProject } = createDesktopApi();
    const requestProjectBind = vi.fn(async () => "/Users/petehsu/Documents/Lyra");
    renderPanel(api, requestProjectBind);

    await screen.findByText("Lyra Agent");
    fireEvent.click(screen.getByLabelText("Bind Project"));

    await waitFor(() => {
      expect(requestProjectBind).toHaveBeenCalledWith(undefined);
      expect(bindProject).toHaveBeenCalledWith({
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });
    expect(await screen.findByText("Lyra")).toBeInTheDocument();
  });

  test("new sessions inherit the current bound project directory", async () => {
    const { api, createSession, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshotWithConversation,
      workingDir: "/Users/petehsu/Documents/Lyra",
      projectBound: true
    });
    renderPanel(api);

    await screen.findByText("Lyra");
    fireEvent.click(screen.getByLabelText("New session"));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        title: "Lyra Agent",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });
  });

  test("disables project binding while a turn is running", async () => {
    const { api, bindProject, setReadSnapshot } = createDesktopApi();
    const requestProjectBind = vi.fn(async () => "/Users/petehsu/Documents/Lyra");
    setReadSnapshot({
      ...snapshot,
      follow: { running: true, activity: "Streaming" },
      turnStatus: "running"
    });
    renderPanel(api, requestProjectBind);

    const bindButton = await screen.findByLabelText("Bind Project");
    expect(bindButton).toBeDisabled();
    fireEvent.click(bindButton);
    expect(requestProjectBind).not.toHaveBeenCalled();
    expect(bindProject).not.toHaveBeenCalled();
  });

  test("opens the bound project tree from the header even while a turn is running", async () => {
    const { api, bindProject, setReadSnapshot } = createDesktopApi();
    const requestProjectBind = vi.fn(async () => "/Users/petehsu/Documents/Other");
    const openProjectTree = vi.fn();
    setReadSnapshot({
      ...snapshot,
      workingDir: "/Users/petehsu/Documents/Lyra",
      projectBound: true,
      follow: { running: true, activity: "Streaming" },
      turnStatus: "running"
    });
    renderPanel(api, requestProjectBind, openProjectTree);

    const openButton = await screen.findByLabelText("Open Project Tree");
    expect(openButton).not.toBeDisabled();
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(openProjectTree).toHaveBeenCalledWith({
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });
    expect(requestProjectBind).not.toHaveBeenCalled();
    expect(bindProject).not.toHaveBeenCalled();
  });

  test("allows first project binding after user messages when the session is unbound", async () => {
    const { api, bindProject, setReadSnapshot } = createDesktopApi();
    const requestProjectBind = vi.fn(async () => "/Users/petehsu/Documents/Lyra");
    setReadSnapshot({
      ...snapshotWithConversation,
      workingDir: "/",
      projectBound: false
    });
    renderPanel(api, requestProjectBind);

    const bindButton = await screen.findByLabelText("Bind Project");
    expect(bindButton).not.toBeDisabled();
    fireEvent.click(bindButton);

    await waitFor(() => {
      expect(requestProjectBind).toHaveBeenCalledWith(undefined);
      expect(bindProject).toHaveBeenCalledWith({
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      });
    });
  });

  test("does not expose project rebinding after a project is bound", async () => {
    const { api, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      workingDir: "/Users/petehsu/Documents/Lyra",
      projectBound: true
    });
    renderPanel(api);

    await screen.findByText("Lyra");
    expect(screen.queryByLabelText("Change Project Binding")).not.toBeInTheDocument();
  });

  test("starts improve and refactor from the header more menu and poke from todos", async () => {
    const { api, runImprove, runRefactor, triggerPoke, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      tools: [{
        id: "todo-tool",
        name: "todo",
        label: "Todo",
        status: "completed",
        input: {
          todos: [{
            id: "todo-1",
            content: "finish GUI poke",
            status: "pending"
          }]
        },
        output: null,
        startedAt: "2026-05-13T00:00:02.000Z",
        finishedAt: "2026-05-13T00:00:02.500Z"
      }]
    });
    renderPanel(api);

    fireEvent.click(await screen.findByLabelText("More"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Improve" }));
    expect(runImprove).toHaveBeenCalledWith({
      sessionId: "session-1",
      planOnly: false,
      focus: null
    });

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Refactor" }));
    expect(runRefactor).toHaveBeenCalledWith({
      sessionId: "session-1",
      planOnly: false,
      focus: null
    });

    expect((await screen.findAllByText("finish GUI poke")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Continue unfinished todos"));
    expect(triggerPoke).toHaveBeenCalledWith({ sessionId: "session-1" });
  });

  test("starts review and judge from the header more menu", async () => {
    const { api, runReview, runJudge } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Code review" }));

    await waitFor(() => {
      expect(runReview).toHaveBeenCalledWith({ sessionId: "session-1" });
    });

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Acceptance check" }));

    await waitFor(() => {
      expect(runJudge).toHaveBeenCalledWith({ sessionId: "session-1" });
    });
  });

  test("creates a new Lyra Agent session from the panel header", async () => {
    const { api, createSession, setReadSnapshot } = createDesktopApi();
    createSession.mockResolvedValueOnce({
      ...snapshot,
      id: "session-2",
      title: "Fresh Lyra Agent",
      updatedAt: "2026-05-13T00:01:00.000Z"
    });
    setReadSnapshot(snapshotWithConversation);
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("New session"));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ title: "Lyra Agent" });
    });
    expect(await screen.findByText("Fresh Lyra Agent")).toBeInTheDocument();
  });

  test("hides the new session button while the current session is already empty", async () => {
    const { api } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("New session")).not.toBeInTheDocument();
  });

  test("renders streaming messages, tool activity, and cancel", async () => {
    const { api, emit } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    act(() => {
      emit({
        kind: "messageAppended",
        sessionId: "session-1",
        message: {
          id: "message-1",
          role: "assistant",
          text: "",
          createdAt: "2026-05-13T00:00:01.000Z"
        }
      });
      emit({
        kind: "messageDelta",
        sessionId: "session-1",
        messageId: "message-1",
        delta: "Streaming response"
      });
      emit({
        kind: "toolStarted",
        sessionId: "session-1",
        tool: {
          id: "tool-1",
          name: "search.files",
          label: "Searching workspace",
          status: "running",
          input: {},
          startedAt: "2026-05-13T00:00:02.000Z"
        }
      });
      emit({
        kind: "followStateChanged",
        sessionId: "session-1",
        follow: { running: true, activity: "Searching" }
      });
    });

    expect(await screen.findByText("Streaming response")).toBeInTheDocument();
    expect(screen.queryByText("2026-05-13T00:00:01.000Z")).not.toBeInTheDocument();
    expect(screen.getAllByText("Searching workspace").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Cancel turn"));
    expect(api.agent?.cancelTurn).toHaveBeenCalledWith({ sessionId: "session-1" });
  });

  test("keeps failed turn details visible after the session snapshot refreshes", async () => {
    const { api, emit, setReadSnapshot } = createDesktopApi();
    const runningSnapshot: AgentSessionSnapshot = {
      ...snapshot,
      messages: [
        {
          id: "user-failed",
          role: "user",
          text: "What can you do?",
          createdAt: "2026-05-13T00:00:01.000Z"
        }
      ],
      turnStatus: "running",
      activeTurnId: "turn-failed",
      follow: { running: true, activity: "Thinking" }
    };
    const failedSnapshot: AgentSessionSnapshot = {
      ...runningSnapshot,
      turnStatus: "failed",
      activeTurnId: null,
      follow: { running: false, activity: null }
    };
    setReadSnapshot(runningSnapshot);
    renderPanel(api);

    expect(await screen.findByText("What can you do?")).toBeInTheDocument();
    setReadSnapshot(failedSnapshot);
    act(() => {
      emit({
        kind: "turnFailed",
        sessionId: "session-1",
        turnId: "turn-failed",
        message: "provider request timed out"
      });
    });

    expect(await screen.findByText("The turn failed: provider request timed out"))
      .toBeInTheDocument();
  });

  test("renders Lyra Agent tool transcript as tool UI instead of user result bubbles", async () => {
    const { api, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      messages: [
        {
          id: "user-message",
          role: "user",
          text: "show my desktop",
          createdAt: "2026-05-13T00:00:01.000Z"
        },
        {
          id: "assistant-message",
          role: "assistant",
          text: "I found two files.",
          createdAt: "2026-05-13T00:00:03.000Z"
        }
      ],
      tools: [
        {
          id: "tool-1",
          name: "ls",
          label: "Read",
          status: "completed",
          input: { path: "/Users/petehsu/Desktop" },
          output: { content: "file-a\nfile-b", error: null },
          startedAt: "2026-05-13T00:00:02.000Z",
          finishedAt: "2026-05-13T00:00:02.500Z"
        }
      ],
      turnStatus: "finished"
    });
    renderPanel(api);

    expect(await screen.findByText("I found two files.")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.queryByText(/\[tool:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[result:/u)).not.toBeInTheDocument();
  });

  test("renders legacy empty assistant tool messages as tool UI", async () => {
    const { api, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      messages: [
        {
          id: "user-message",
          role: "user",
          text: "inspect desktop",
          createdAt: "2026-05-13T00:00:01.000Z"
        },
        {
          id: "assistant-tools-1",
          role: "assistant",
          text: "",
          blocks: [
            {
              type: "tool",
              id: "tool-tool-1",
              tool_id: "tool-1"
            }
          ] as unknown as NonNullable<AgentSessionSnapshot["messages"][number]["blocks"]>,
          createdAt: "2026-05-13T00:00:02.000Z"
        },
        {
          id: "assistant-tools-2",
          role: "assistant",
          text: "",
          createdAt: "2026-05-13T00:00:04.000Z"
        },
        {
          id: "assistant-final",
          role: "assistant",
          text: "Your desktop has several project folders and screenshots.",
          createdAt: "2026-05-13T00:00:05.000Z"
        }
      ],
      tools: [
        {
          id: "tool-1",
          name: "ls",
          label: "Read users",
          status: "completed",
          input: { path: "/Users" },
          output: { content: "petehsu", error: null },
          startedAt: "2026-05-13T00:00:02.000Z",
          finishedAt: "2026-05-13T00:00:02.500Z"
        },
        {
          id: "tool-2",
          name: "bash",
          label: "Run whoami",
          status: "completed",
          input: { command: "whoami" },
          output: { content: "petehsu", error: null },
          startedAt: "2026-05-13T00:00:02.000Z",
          finishedAt: "2026-05-13T00:00:02.500Z"
        },
        {
          id: "tool-3",
          name: "ls",
          label: "Read desktop",
          status: "completed",
          input: { path: "/Users/petehsu/Desktop" },
          output: { content: "Lyra", error: null },
          startedAt: "2026-05-13T00:00:04.000Z",
          finishedAt: "2026-05-13T00:00:04.500Z"
        }
      ],
      turnStatus: "finished"
    });
    renderPanel(api);

    const firstTool = await screen.findByText("Read users");
    const secondTool = screen.getByText("Run whoami");
    const thirdTool = screen.getByText("Read desktop");
    const finalText = screen.getByText("Your desktop has several project folders and screenshots.");
    expect(screen.queryByText("No response text received.")).not.toBeInTheDocument();
    expect(firstTool).toBeInTheDocument();
    expect(secondTool).toBeInTheDocument();
    expect(Boolean(thirdTool.compareDocumentPosition(finalText) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
  });

  test("renders assistant text and tools in the captured event order", async () => {
    const { api, setReadSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      messages: [
        {
          id: "user-message",
          role: "user",
          text: "inspect desktop",
          createdAt: "2026-05-13T00:00:01.000Z"
        },
        {
          id: "assistant-message",
          role: "assistant",
          text: "Let me inspect your desktop.\nI found a few folders.",
          blocks: [
            {
              type: "text",
              id: "text-0",
              text: "Let me inspect your desktop."
            },
            {
              type: "tool",
              id: "tool-tool-1",
              toolId: "tool-1"
            },
            {
              type: "text",
              id: "text-1",
              text: "I found a few folders."
            }
          ],
          createdAt: "2026-05-13T00:00:03.000Z"
        }
      ],
      tools: [
        {
          id: "tool-1",
          name: "ls",
          label: "Read",
          status: "completed",
          input: { path: "/Users/petehsu/Desktop" },
          output: { content: "Projects\nScreenshots", error: null },
          startedAt: "2026-05-13T00:00:02.000Z",
          finishedAt: "2026-05-13T00:00:02.500Z"
        }
      ],
      turnStatus: "finished"
    });
    renderPanel(api);

    const intro = await screen.findByText("Let me inspect your desktop.");
    const tool = screen.getByText("Read");
    const outro = screen.getByText("I found a few folders.");
    expect(Boolean(intro.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(Boolean(tool.compareDocumentPosition(outro) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
  });

  test("rolls back files and conversation from the user message undo action", async () => {
    const { api, setReadSnapshot, setRollbackRestoreSnapshot } = createDesktopApi();
    setReadSnapshot({
      ...snapshot,
      messages: [
        {
          id: "keep-message",
          role: "user",
          text: "keep this context",
          createdAt: "2026-05-13T00:00:00.000Z"
        },
        {
          id: "rollback-message",
          role: "user",
          text: "change files",
          createdAt: "2026-05-13T00:00:01.000Z",
          rollback: {
            available: true,
            anchorId: "anchor-1",
            checkpointAt: "2026-05-13T00:00:00.000Z"
          }
        },
        {
          id: "agent-after",
          role: "assistant",
          text: "files changed",
          createdAt: "2026-05-13T00:00:02.000Z"
        }
      ]
    });
    setRollbackRestoreSnapshot({
      ...snapshot,
      messages: [
        {
          id: "keep-message",
          role: "user",
          text: "keep this context",
          createdAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    });
    renderPanel(api, undefined, undefined, "zh-CN");

    expect(await screen.findByText("change files")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("撤回消息"));

    expect(await screen.findByText("撤销文件和对话")).toBeInTheDocument();
    expect(screen.getByText(/将移除 2 条消息并恢复 1 个文件/u)).toBeInTheDocument();
    expect(api.agent?.previewRollback).toHaveBeenCalledWith({
      sessionId: "session-1",
      messageId: "rollback-message"
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(api.agent?.restoreRollback).toHaveBeenCalledWith({
        sessionId: "session-1",
        messageId: "rollback-message",
        mode: "taskAndWorkspace"
      });
    });
    expect(screen.getByText("keep this context")).toBeInTheDocument();
    expect(screen.queryByText("change files")).not.toBeInTheDocument();
    expect(screen.queryByText("files changed")).not.toBeInTheDocument();
  });

  test("does not leave a finished empty assistant response as an ellipsis", async () => {
    const { api, emit, setReadSnapshot } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    setReadSnapshot({
      ...snapshot,
      messages: [{
        id: "message-empty",
        role: "assistant",
        text: "",
        createdAt: "2026-05-13T00:00:01.000Z"
      }],
      turnStatus: "finished"
    });
    act(() => {
      emit({
        kind: "messageAppended",
        sessionId: "session-1",
        message: {
          id: "message-empty",
          role: "assistant",
          text: "",
          createdAt: "2026-05-13T00:00:01.000Z"
        }
      });
      emit({
        kind: "turnFinished",
        sessionId: "session-1",
        turnId: "turn-1",
        status: "finished"
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("No response text received.")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("...")).not.toBeInTheDocument();
  });

  test("refreshes the final session snapshot when a turn finishes", async () => {
    const { api, emit, setReadSnapshot } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    act(() => {
      emit({
        kind: "messageAppended",
        sessionId: "session-1",
        message: {
          id: "message-refresh",
          role: "assistant",
          text: "",
          createdAt: "2026-05-13T00:00:01.000Z"
        }
      });
    });
    setReadSnapshot({
      ...snapshot,
      messages: [{
        id: "message-refresh",
        role: "assistant",
        text: "Recovered final response",
        createdAt: "2026-05-13T00:00:01.000Z"
      }],
      turnStatus: "finished"
    });
    act(() => {
      emit({
        kind: "turnFinished",
        sessionId: "session-1",
        turnId: "turn-1",
        status: "finished"
      });
    });

    expect(await screen.findByText("Recovered final response")).toBeInTheDocument();
  });

  test("ignores finished events from non-active agent sessions", async () => {
    const { api, emit } = createDesktopApi();
    renderPanel(api);

    await waitFor(() => {
      expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
    });
    act(() => {
      emit({
        kind: "sessionSnapshot",
        snapshot: {
          ...snapshot,
          id: "selfdev-session",
          title: "Self-Dev Lab",
          sessionKind: "selfdev"
        }
      });
      emit({
        kind: "turnFinished",
        sessionId: "selfdev-session",
        turnId: "turn-selfdev",
        status: "finished"
      });
    });

    expect(api.agent?.readSession).not.toHaveBeenCalledWith({
      sessionId: "selfdev-session"
    });
    expect(screen.queryByText("Self-Dev Lab")).not.toBeInTheDocument();
    expect(screen.getByText("Lyra Agent")).toBeInTheDocument();
  });
});
