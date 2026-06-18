import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentRuntimeEvent,
  AgentSessionSummary,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import { AgentSessionHistorySurface } from "../view";
import type { AgentSessionHistoryLabels } from "../types";
import type { BrowserHistoryEntry } from "../../browser-history/service";
import { GlobalDialogHost, useGlobalDialogModel } from "../../global-dialog";
import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../../shell/titlebar-context";

const labels: AgentSessionHistoryLabels = {
  title: "History",
  searchPlaceholder: "Search history",
  refresh: "Refresh",
  categoryFilter: "History categories",
  categorySessions: "Sessions",
  categoryArchivedSessions: "Archived sessions",
  categoryBrowserHistory: "Web history",
  loading: "Loading history",
  emptyTitle: "No history",
  emptyDescription: "No matching sessions",
  browserHistoryEmptyTitle: "No web history",
  browserHistoryEmptyDescription: "Visited pages appear here",
  openBrowserHistoryEntry: "Open web history entry",
  visited: "Visited",
  visits: "visits",
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
    workingDir: null
  },
  {
    id: "session-3",
    title: "Archived plan",
    customTitle: "Archived plan",
    shortName: "archive",
    status: "finished",
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

const browserHistory: BrowserHistoryEntry[] = [
  {
    id: "https://example.com/docs",
    url: "https://example.com/docs",
    title: "Example Docs",
    faviconUrl: "https://example.com/favicon.ico",
    visitedAt: "2026-05-15T03:10:00Z",
    visitCount: 2
  }
];

const createDesktopApi = (initialSessions: readonly AgentSessionSummary[] = baseSessions) => {
  let sessions = [...initialSessions];
  const listeners = new Set<(event: AgentRuntimeEvent) => void>();
  const readSession = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => ({
    id: sessionId,
    title: sessions.find((session) => session.id === sessionId)?.title ?? "Restored",
    workingDir: sessions.find((session) => session.id === sessionId)?.workingDir ?? null,
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
      <WorkbenchTitlebarContextProvider activeScopeId="history-scope">
        <WorkbenchTitlebarScopeProvider scopeId="history-scope">
          <AgentSessionHistorySurface
            {...props}
            openDialog={globalDialogModel.openDialog}
          />
        </WorkbenchTitlebarScopeProvider>
        <WorkbenchTitlebarContextSlot />
        <GlobalDialogHost
          state={globalDialogModel.state}
          onClose={globalDialogModel.closeDialog}
          onSelectAction={globalDialogModel.selectAction}
        />
      </WorkbenchTitlebarContextProvider>
    );
  };

  return render(<AgentHistoryWithGlobalDialog />);
};

describe("AgentSessionHistorySurface", () => {
  test("loads unified history categories without the old in-page chrome", async () => {
    const { api, listSessions } = createDesktopApi();

    const { container } = renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      browserHistory,
      onOpenSession: vi.fn(),
      onOpenBrowserHistoryEntry: vi.fn()
    });

    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledWith({ limit: 500 });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sessions 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Archived sessions 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Web history 1" })).toBeInTheDocument();
    });

    expect(screen.getByText("Fix agent storage")).toBeInTheDocument();
    expect(screen.queryByText("Review UI polish")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search history")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI / gpt-5")).not.toBeInTheDocument();
    expect(screen.queryByText("/Users/petehsu/Documents/Lyra")).not.toBeInTheDocument();
    expect(container.querySelector(".lyra-agent-history-session-row > .lyra-agent-history-row-icon")).toBeNull();
  });

  test("switches between session, project, archived, and web history categories", async () => {
    const { api } = createDesktopApi();
    const onOpenBrowserHistoryEntry = vi.fn();
    const onBrowserHistoryPreviewChange = vi.fn();
    const onBrowserHistoryPreviewHostChange = vi.fn();

    const { container } = renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      browserHistory,
      browserHistoryPreviewPageId: "history-web-preview",
      onBrowserHistoryPreviewChange,
      onBrowserHistoryPreviewHostChange,
      onOpenSession: vi.fn(),
      onOpenBrowserHistoryEntry
    });

    await screen.findByText("Fix agent storage");

    fireEvent.click(await screen.findByRole("button", { name: "Archived sessions 1" }));
    expect(screen.getByText("Archived plan")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Web history 1" }));
    const webPreview = await screen.findByRole("complementary", { name: "Web history" });
    expect(within(webPreview).queryByRole("heading", { name: "Example Docs" })).not.toBeInTheDocument();
    const pageHost = within(webPreview).getByLabelText("Example Docs");
    expect(pageHost).toHaveAttribute("data-browser-page-host", "true");
    expect(pageHost).toHaveAttribute("data-tab-id", "history-web-preview");
    expect(container.querySelector(".lyra-agent-history-site-favicon")).toHaveAttribute(
      "src",
      "https://example.com/favicon.ico"
    );
    await waitFor(() => {
      expect(onBrowserHistoryPreviewChange).toHaveBeenLastCalledWith({
        tabId: "history-web-preview",
        url: "https://example.com/docs",
        title: "Example Docs"
      });
    });
    expect(onBrowserHistoryPreviewHostChange).toHaveBeenLastCalledWith(
      "history-web-preview",
      pageHost
    );

    fireEvent.click(screen.getByRole("button", { name: "Web history: Example Docs" }));
    expect(onOpenBrowserHistoryEntry).not.toHaveBeenCalled();
    expect(within(webPreview).queryByRole("heading", { name: "Example Docs" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open web history entry: https://example.com/docs" }));
    expect(onOpenBrowserHistoryEntry).toHaveBeenCalledWith(browserHistory[0]);
  });

  test("groups project sessions by project folder with collapsible sections", async () => {
    const { api } = createDesktopApi([
      ...baseSessions,
      {
        ...baseSessions[0]!,
        id: "session-4",
        title: "Refactor project index",
        shortName: "index",
        workingDir: "/Users/petehsu/Documents/Lyra",
        saved: false,
        saveLabel: null
      },
      {
        ...baseSessions[0]!,
        id: "session-5",
        title: "Prepare launch notes",
        shortName: "launch",
        workingDir: "/Users/petehsu/Documents/Launch"
      }
    ]);

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      browserHistory,
      onOpenSession: vi.fn(),
      onOpenBrowserHistoryEntry: vi.fn()
    });

    await screen.findByRole("button", { name: "Sessions 3" });
    expect(screen.getByRole("button", { name: "Lyra 2" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Launch 1" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Fix agent storage")).toBeInTheDocument();
    expect(screen.getByText("Refactor project index")).toBeInTheDocument();
    expect(screen.getByText("Prepare launch notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lyra 2" }));
    expect(screen.getByRole("button", { name: "Lyra 2" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Fix agent storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Refactor project index")).not.toBeInTheDocument();
    expect(screen.getByText("Prepare launch notes")).toBeInTheDocument();
  });

  test("locates address-bar history suggestions in the matching category and preview pane", async () => {
    const { api, readSession } = createDesktopApi();

    const { rerender } = renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      browserHistory,
      onOpenSession: vi.fn(),
      locateRequest: {
        requestKey: 1,
        target: {
          kind: "session",
          sessionId: "session-1",
          category: "project-sessions"
        }
      }
    });

    await waitFor(() => {
      expect(readSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    });
    expect(screen.getByRole("button", { name: "Session preview: Fix agent storage" })).toBeInTheDocument();
    expect(await screen.findByText("Preview answer for session-1")).toBeInTheDocument();

    rerender(
      <WorkbenchTitlebarContextProvider activeScopeId="history-scope">
        <WorkbenchTitlebarScopeProvider scopeId="history-scope">
          <AgentSessionHistorySurface
            desktopApi={api}
            labels={labels}
            activeSessionId={null}
            browserHistory={browserHistory}
            onOpenSession={vi.fn()}
            openDialog={vi.fn()}
            locateRequest={{
              requestKey: 2,
              target: {
                kind: "browser-history",
                entryId: "https://example.com/docs"
              }
            }}
          />
        </WorkbenchTitlebarScopeProvider>
        <WorkbenchTitlebarContextSlot />
      </WorkbenchTitlebarContextProvider>
    );

    const webPreview = await screen.findByRole("complementary", { name: "Web history" });
    expect(within(webPreview).queryByRole("heading", { name: "Example Docs" })).not.toBeInTheDocument();
    expect(within(webPreview).getByLabelText("Example Docs")).toHaveAttribute("data-browser-page-host", "true");
  });

  test("filters with the address-bar query prop instead of an internal input", async () => {
    const { api } = createDesktopApi();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: null,
      query: "missing",
      onOpenSession: vi.fn()
    });

    await waitFor(() => {
      expect(screen.getByText("No history")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Search history")).not.toBeInTheDocument();
  });

  test("previews the selected session without opening the AI panel", async () => {
    const { api, readSession } = createDesktopApi();
    const onOpenSession = vi.fn();

    const { container } = renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: "session-1",
      onOpenSession
    });

    await screen.findByText("Review UI polish");
    fireEvent.click(screen.getByRole("button", { name: "Session preview: Review UI polish" }));

    await waitFor(() => {
      expect(readSession).toHaveBeenCalledWith({ sessionId: "session-2" });
    });
    expect(screen.getByText("Preview answer for session-2")).toBeInTheDocument();
    const previewPane = screen.getByRole("complementary", { name: "Session preview" });
    expect(within(previewPane).getByRole("heading", { name: "Review UI polish" })).toBeInTheDocument();
    expect(container.querySelector(".msg")).toBeNull();
    expect(screen.queryByText("OpenAI / gpt-5")).not.toBeInTheDocument();
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
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

    await screen.findByText("Review UI polish");
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

  test("routes favorite, rename, archive, and delete actions through Lyra Agent APIs", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Archive: Renamed session" }));
    await waitFor(() => {
      expect(archiveSession).toHaveBeenCalledWith({ sessionId: "session-2", archived: true });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Archived sessions 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete: Renamed session" }));
    expect(screen.getByRole("dialog", { name: "Delete session permanently?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delete permanently/u }));
    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith({ sessionId: "session-2" });
    });
  });

  test("closes the AI tab after deleting the active session", async () => {
    const { api, deleteSession, createSession } = createDesktopApi();
    const onOpenSession = vi.fn();
    const onSessionDeleted = vi.fn();

    renderAgentHistory({
      desktopApi: api,
      labels,
      activeSessionId: "session-1",
      onOpenSession,
      onSessionDeleted
    });

    fireEvent.click(await screen.findByRole("button", { name: "Project sessions 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete: Fix agent storage" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete permanently/u }));

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(onSessionDeleted).toHaveBeenCalledWith("session-1");
  });
});
