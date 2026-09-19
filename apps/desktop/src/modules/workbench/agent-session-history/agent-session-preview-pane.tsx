import { AppEmptyState, AppLoadingState } from "@renderer/ui/components";

import type { AgentSessionSnapshot } from "../../../shared/desktop-bridge";
import { agentSessionToChatMessages } from "../agent-session-view-model";
import { DataContextProvider, Message, createDataProviderValue } from "../ai-panel/lyra-agents";
import type { AgentSessionHistorySurfaceProps } from "./types";

export const projectFolderNameFromPath = (value: string): string => {
  const normalized = value.trim().replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return value;
  }
  const parts = normalized.split(/[\\/]+/u);
  return parts[parts.length - 1] ?? normalized;
};

export const AgentSessionPreviewPane = ({
  snapshot,
  labels,
  loading
}: {
  readonly snapshot: AgentSessionSnapshot | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly loading: boolean;
}) => {
  if (loading) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <AppLoadingState className="lyra-agent-history-preview-state" title={labels.loading} />
      </aside>
    );
  }

  if (snapshot === null) {
    return (
      <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
        <AppEmptyState
          className="lyra-agent-history-preview-empty"
          title={labels.previewEmptyTitle}
        />
      </aside>
    );
  }

  const messages = agentSessionToChatMessages(snapshot).map((message) => ({
    ...message,
    rollback: null
  }));
  const workingDir = (snapshot.workingDir ?? "").trim();
  const dataValue = createDataProviderValue({
    session: {
      id: snapshot.id,
      title: snapshot.title,
      project: snapshot.projectBound && workingDir.length > 0
        ? projectFolderNameFromPath(workingDir)
        : "",
      workingDir: workingDir.length > 0 ? workingDir : null,
      projectBound: snapshot.projectBound,
      workingDirIsHome: snapshot.workingDirIsHome === true,
      totalAdditions: 0,
      totalDeletions: 0,
      tokenEstimate: snapshot.tokenEstimate ?? null
    },
    messages,
    isTurnRunning: snapshot.turnStatus === "running",
    followActivity: snapshot.follow.activity ?? null
  });

  return (
    <aside className="lyra-agent-history-preview" aria-label={labels.previewTitle}>
      {messages.length === 0 ? (
        <AppEmptyState
          className="lyra-agent-history-preview-empty lyra-agent-history-preview-empty-inline"
          title={labels.emptyTitle}
        />
      ) : (
        <DataContextProvider value={dataValue}>
          <div
            className="lyra-agent-history-preview-chat lyra-agents-chat-scroll"
            role="log"
            aria-label={`${labels.previewTitle}: ${snapshot.title}`}
          >
            <div className="lyra-agent-history-preview-chat-inner lyra-agents-chat-inner">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </div>
          </div>
        </DataContextProvider>
      )}
    </aside>
  );
};
