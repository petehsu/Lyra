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
  messages: [],
  tools: [],
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-05-13T00:00:00.000Z"
};

const createDesktopApi = () => {
  let listener: ((event: AgentRuntimeEvent) => void) | null = null;
  const api = {
    agent: {
      createSession: vi.fn(async () => snapshot),
      readSession: vi.fn(async () => snapshot),
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
    emit: (event: AgentRuntimeEvent) => {
      listener?.(event);
    }
  };
};

const renderPanel = (desktopApi: LyraDesktopApi) =>
  render(
    <AiPanelSurface
      variant="sidebar"
      desktopApi={desktopApi}
      title="Agent"
      emptyThreadLabel="No messages"
    />
  );

const runtimeProfile = {
  id: "profile-openai",
  name: "OpenAI",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  runtimeProviderId: "openai:profile-openai",
  runtimeSupported: true,
  secretStatus: "configured",
  presetId: "openai",
  connectionConfig: { baseUrl: "https://api.openai.com/v1" },
  authConfig: { apiKey: "test-key" },
  configuredSecretFields: ["apiKey"],
  headers: {},
  model: "gpt-5.4",
  customModels: [],
  discoveryState: { status: "idle", lastCheckedAt: null, models: [] },
  isDefault: true,
  createdAt: 0,
  updatedAt: 0
} as const;

const settingsAiModel = {
  profiles: [runtimeProfile],
  defaultProfileId: runtimeProfile.id
} as unknown as SettingsAiModel;

const renderPanelWithSettings = (desktopApi: LyraDesktopApi) =>
  render(
    <AiPanelSurface
      variant="sidebar"
      desktopApi={desktopApi}
      settingsAiModel={settingsAiModel}
      title="Agent"
      emptyThreadLabel="No messages"
    />
  );

describe("AiPanelSurface", () => {
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
        text: "Build the slice",
        providerProfileId: "lyra-default",
        providerProfile: null
      });
    });
  });

  test("sends the default runtime provider profile with the Agent turn", async () => {
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
        text: "Use the configured model",
        providerProfileId: "profile-openai",
        providerProfile: runtimeProfile
      });
    });
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
    expect(screen.getAllByText("Searching workspace").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Cancel turn"));
    expect(api.agent?.cancelTurn).toHaveBeenCalledWith({ sessionId: "session-1" });
  });
});
