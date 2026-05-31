import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentRuntimeEvent,
  AgentSessionSummary,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import { AgentSessionHistorySurface } from "../view";
import type { AgentSessionHistoryLabels } from "../types";
import { GlobalDialogHost, useGlobalDialogModel } from "../../global-dialog";

const labels: AgentSessionHistoryLabels = {
  title: "Agent History",
  searchPlaceholder: "Search sessions",
  refresh: "Refresh",
  loading: "Loading sessions",
  emptyTitle: "No sessions",
  emptyDescription: "No saved sessions yet",
  errorTitle: "Load failed",
  openSession: "Open session",
  openInAiPanel: "Open in AI Panel",
  previewTitle: "Session preview",
  previewEmptyTitle: "Select a session to preview",
  previewEmptyDescription: "Click a session to preview it here",
  messages: "messages",
  groupSaved: "Saved sessions",
  groupRecent: "Recent sessions",
  groupArchived: "Archived sessions",
  saved: "Saved",
  unsaved: "Unsave",
  archive: "Archive",
  unarchive: "Unarchive",
  rename: "Rename",
  delete: "Delete",
  renameTitle: "Rename session",
  renamePlaceholder: "Enter a session name",
  saveRename: "Save name",
  clearRename: "Clear custom name",
  cancelAction: "Cancel",
  deleteConfirmTitle: "Delete session permanently?",
  deleteConfirmDescription: "This cannot be restored.",
  deleteConfirmAction: "Delete permanently",
  updated: "Updated",
  workingDir: "Working directory",
  modelFallback: "Default model",
  statusFallback: "Default provider",
  runtimeUnavailable: "Agent runtime bridge is unavailable."
};

const baseSessions: AgentSessionSummary[] = [
  {
    id: "session-1",
    title: "Fix agent storage",
    customTitle: null,
    shortName: "storage",
    status: "saved",
    providerKey: "mimo-token-plan",
    providerLabel: "MiMo Token Plan",
    model: "mimo-v2.5-pro",
    messageCount: 4,
    createdAt: "2026-05-15T00:00:00Z",
    updatedAt: "2026-05-15T00:05:00Z",
    lastActiveAt: "2026-05-15T00:05:00Z",
    saved: true,
    saveLabel: "saved",
    archived: false,
    workingDir: "/Users/petehsu/Documents/Lyra"
  },
  {
    id: "session-2",
    title: "Review UI polish",
    customTitle: null,
    shortName: "ui",
    status: "idle",
    providerKey: "openai",
    providerLabel: "OpenAI",
    model: "gpt-5",
    messageCount: 9,
    createdAt: "2026-05-15T01:00:00Z",
    updatedAt: "2026-05-15T01:10:00Z",
    lastActiveAt: "2026-05-15T01:10:00Z",
    saved: false,
    saveLabel: null,
    archived: false,
    workingDir: "/Users/petehsu/Documents/Lyra/apps/desktop"
  },
  {
    id: "session-3",
    title: "Archived plan",
    customTitle: "Archived plan",
    shortName: "archive",
    status: "idle",
    providerKey: "openai",
    providerLabel: "OpenAI",
    model: "gpt-5",
    messageCount: 2,
    createdAt: "2026-05-15T02:00:00Z",
    updatedAt: "2026-05-15T02:10:00Z",
    lastActiveAt: "2026-05-15T02:10:00Z",
    saved: false,
    saveLabel: null,
    archived: true,
    workingDir: "/Users/petehsu/Documents/Lyra"
  }
];

const sessionWithProviderIdOnly: AgentSessionSummary = {
  ...baseSessions[0]!,
  id: "session-provider-id-only",
  title: "Provider id should not display",
  providerKey: "mimo-token-plan",
  providerLabel: null
};

const createDesktopApi = (initialSessions: readonly AgentSessionSummary[] = baseSessions) => {
  let sessions = [...initialSessions];
  const listeners = new Set<(event: AgentRuntimeEvent) => void>();
  const readSession = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => ({
    id: sessionId,
    title: sessions.find((session) => session.id === sessionId)?.title ?? "Restored",
    workingDir: sessions.find((session) => session.id === sessionId)?.workingDir ?? "/",
    projectBound: true,
    messages: [
      {
        id: `${sessionId}-user`,
        role: "user" as const,
        text: "Show the latest work",
        createdAt: "2026-05-15T01:11:00Z"
      },
      {
        id: `${sessionId}-assistant`,
        role: "assistant" as const,
        text: `Preview answer for ${sessionId}`,
        createdAt: "2026-05-15T01:12:00Z"
      }
    ],
    tools: [
      {
        id: `${sessionId}-tool`,
        name: "grep",
        label: "Search",
        status: "completed" as const,
        input: { query: "history" },
        output: { content: "done" },
        startedAt: "2026-05-15T01:11:30Z",
        finishedAt: "2026-05-15T01:11:40Z"
      }
    ],
    turnStatus: "idle",
    activeTurnId: null,
    follow: { running: false, activity: null },
    updatedAt: "2026-05-15T01:10:00Z"
  }));
  const listSessions = vi.fn(async () => ({
    sessionsDir: "/Users/petehsu/.lyra/modules/agent/sessions",
    sessions
  }));
  const saveSession = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => {
    sessions = sessions.map((session) =>
      session.id === sessionId ? { ...session, saved: true } : session
    );
    return sessions.find((session) => session.id === sessionId) as AgentSessionSummary;
  });
  const unsaveSession = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => {
    sessions = sessions.map((session) =>
      session.id === sessionId ? { ...session, saved: false, saveLabel: null } : session
    );
    return sessions.find((session) => session.id === sessionId) as AgentSessionSummary;
  });
  const renameSession = vi.fn(async (
    { sessionId, title }: { readonly sessionId: string; readonly title?: string | null }
  ) => {
    sessions = sessions.map((session) =>
      session.id === sessionId
        ? { ...session, title: title ?? "Generated title", customTitle: title ?? null }
        : session
    );
    return sessions.find((session) => session.id === sessionId) as AgentSessionSummary;
  });
  const archiveSession = vi.fn(async (
    { sessionId, archived }: { readonly sessionId: string; readonly archived: boolean }
  ) => {
    sessions = sessions.map((session) =>
      session.id === sessionId ? { ...session, archived } : session
    );
    return sessions.find((session) => session.id === sessionId) as AgentSessionSummary;
  });
  const deleteSession = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => {
    sessions = sessions.filter((session) => session.id !== sessionId);
    return { sessionId, deleted: true as const };
  });
  const createSession = vi.fn(async () => ({
    id: "session-new",
    title: "Lyra Agent",
    workingDir: "/",
    projectBound: false,
    messages: [],
    tools: [],
    turnStatus: "idle" as const,
    activeTurnId: null,
    follow: { running: false, activity: null },
    updatedAt: "2026-05-15T03:10:00Z"
  }));
  const api = {
    agent: {
      listSessions,
      readSession,
      saveSession,
      unsaveSession,
      renameSession,
      archiveSession,
      deleteSession,
      createSession,
      onEvent: (listener: (event: AgentRuntimeEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    }
  } as unknown as LyraDesktopApi;
  return {
    api,
    listSessions,
    readSession,
    saveSession,
    unsaveSession,
    renameSession,
    archiveSession,
    deleteSession,
    createSession,
    emitAgentEvent: (event: AgentRuntimeEvent) => {
      listeners.forEach((listener) => listener(event));
    }
  };
};

type AgentHistoryTestProps = Omit<
  ComponentProps<typeof AgentSessionHistorySurface>,
  "openDialog"
>;

const renderAgentHistory = (props: AgentHistoryTestProps) => {
  const AgentHistoryWithGlobalDialog = () => {
    const globalDialogModel = useGlobalDialogModel();
    return (
      <>
        <AgentSessionHistorySurface
          {...props}
          openDialog={globalDialogModel.openDialog}
        />
        <GlobalDialogHost
          state={globalDialogModel.state}
          onClose={globalDialogModel.closeDialog}
          onSelectAction={globalDialogModel.selectAction}
        />
      </>
    );
  };

  return render(<AgentHistoryWithGlobalDialog />);
};

describe("AgentSessionHistorySurface", () => {
  test("loads, groups, and filters Lyra Agent sessions", async () => {
    const { api, listSessions } = createDesktopApi();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      onOpenSession: vi.fn()
    });

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledWith({ limit: 500 });
    });
    expect(screen.getByRole("heading", { name: "Saved sessions 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent sessions 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived sessions 1" })).toBeInTheDocument();
    expect(screen.getByText("Fix agent storage")).toBeInTheDocument();
    expect(screen.getByText("Review UI polish")).toBeInTheDocument();
    expect(screen.getByText("Archived plan")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "gpt-5" }
    });

    expect(screen.queryByText("Fix agent storage")).not.toBeInTheDocument();
    expect(screen.getByText("Review UI polish")).toBeInTheDocument();
    expect(screen.getByText("Archived plan")).toBeInTheDocument();
  });

  test("uses providerLabel for display instead of providerKey", async () => {
    const { api } = createDesktopApi([sessionWithProviderIdOnly]);

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      onOpenSession: vi.fn()
    });

    await screen.findByText("Provider id should not display");
    expect(screen.getByText(`Default provider / ${sessionWithProviderIdOnly.model}`))
      .toBeInTheDocument();
    expect(screen.queryByText(`mimo-token-plan / ${sessionWithProviderIdOnly.model}`))
      .not.toBeInTheDocument();
  });

  test("previews the selected session without opening the AI panel", async () => {
    const { api, readSession } = createDesktopApi();
    const onOpenSession = vi.fn();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: "session-1",
      onOpenSession
    });

    await screen.findByText("Fix agent storage");
    fireEvent.click(screen.getByRole("button", { name: "Session preview: Review UI polish" }));

    await waitFor(() => {
      expect(readSession).toHaveBeenCalledWith({ sessionId: "session-2" });
    });
    expect(screen.getByText("Preview answer for session-2")).toBeInTheDocument();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  test("opens a previewed session in the AI panel only from the row icon", async () => {
    const { api, readSession } = createDesktopApi();
    const onOpenSession = vi.fn();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: "session-1",
      onOpenSession
    });

    await screen.findByText("Fix agent storage");
    fireEvent.click(screen.getByRole("button", { name: "Open in AI Panel: Review UI polish" }));

    expect(onOpenSession).toHaveBeenCalledWith("session-2");
    expect(readSession).not.toHaveBeenCalledWith({ sessionId: "session-2" });
  });

  test("updates the preview from runtime events for the selected session only", async () => {
    const { api, emitAgentEvent } = createDesktopApi();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      onOpenSession: vi.fn()
    });

    await screen.findByText("Review UI polish");
    fireEvent.click(screen.getByRole("button", { name: "Session preview: Review UI polish" }));
    await screen.findByText("Preview answer for session-2");

    act(() => {
      emitAgentEvent({
        kind: "messageDelta",
        sessionId: "session-2",
        messageId: "session-2-assistant",
        delta: " updated"
      });
      emitAgentEvent({
        kind: "messageDelta",
        sessionId: "session-1",
        messageId: "session-1-assistant",
        delta: " ignored"
      });
    });

    expect(screen.getByText("Preview answer for session-2 updated")).toBeInTheDocument();
    expect(screen.queryByText(/ignored/u)).not.toBeInTheDocument();
  });

  test("routes favorite, archive, rename, and delete actions through Lyra Agent APIs", async () => {
    const {
      api,
      saveSession,
      archiveSession,
      renameSession,
      deleteSession
    } = createDesktopApi();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      onOpenSession: vi.fn()
    });

    await screen.findByText("Review UI polish");
    fireEvent.click(screen.getByRole("button", { name: "Saved: Review UI polish" }));
    await waitFor(() => {
      expect(saveSession).toHaveBeenCalledWith({ sessionId: "session-2", label: null });
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive: Review UI polish" }));
    await waitFor(() => {
      expect(archiveSession).toHaveBeenCalledWith({ sessionId: "session-2", archived: true });
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename: Review UI polish" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a session name"), {
      target: { value: "Renamed session" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Save name/u }));
    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith({
        sessionId: "session-2",
        title: "Renamed session"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete: Renamed session" }));
    expect(screen.getByRole("dialog", { name: "Delete session permanently?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delete permanently/u }));
    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith({ sessionId: "session-2" });
    });
  });

  test("creates and opens a fresh session after deleting the active session", async () => {
    const { api, deleteSession, createSession } = createDesktopApi();
    const onOpenSession = vi.fn();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: "session-1",
      onOpenSession
    });

    await screen.findByText("Fix agent storage");
    fireEvent.click(screen.getByRole("button", { name: "Delete: Fix agent storage" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete permanently/u }));

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    });
    expect(createSession).toHaveBeenCalledWith({ title: "Lyra Agent" });
    expect(onOpenSession).toHaveBeenCalledWith("session-new");
  });
});
