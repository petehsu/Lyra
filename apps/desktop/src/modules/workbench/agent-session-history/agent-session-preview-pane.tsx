import { AppButton, AppEmptyState, AppLoadingState } from "@renderer/ui/components";

import type { AgentSessionSnapshot } from "../../../shared/desktop-bridge";
import type { OmaAgentMember } from "../../../shared/agent";
import { agentSessionToChatMessages } from "../agent-session-view-model";
import { DataContextProvider, Message, createDataProviderValue } from "../ai-panel/lyra-agents";
import { t } from "../i18n";
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
  loading,
  onSelectOmaChannel
}: {
  readonly snapshot: AgentSessionSnapshot | null;
  readonly labels: AgentSessionHistorySurfaceProps["labels"];
  readonly loading: boolean;
  readonly onSelectOmaChannel?: (sessionId: string, channelId: string) => Promise<void>;
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
  const oma = snapshot.agentMode === "oma" ? snapshot.oma : null;
  const agentsById = new Map((oma?.agents ?? []).map((agent) => [agent.id, agent]));
  const avatarTone = (agentId: string): string => {
    const builtInTones: Record<string, string> = {
      "did:lyra:agent:builtin:lead": "1",
      "did:lyra:agent:builtin:builder": "2",
      "did:lyra:agent:builtin:reviewer": "3",
      "did:lyra:agent:builtin:designer": "4",
      "did:lyra:agent:builtin:researcher": "5"
    };
    return builtInTones[agentId]
      ?? `${(Array.from(agentId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5) + 1}`;
  };
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
          density="compact"
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
      {oma !== null ? (
        <div
          className="lyra-agent-history-oma-channels"
          role="tablist"
          aria-label={t("oma.channelsAriaLabel")}
        >
          {oma.channels.filter((channel) => channel.archived !== true).map((channel) => {
            const agent = agentsById.get(channel.memberAgentIds[0] ?? "");
            const members = channel.memberAgentIds
              .map((agentId) => agentsById.get(agentId))
              .filter((member): member is OmaAgentMember => member !== undefined);
            const isGroup = channel.kind === "group";
            const label = channel.kind === "direct"
              ? agent?.shortName ?? agent?.name ?? channel.name
              : channel.name || "Oma";
            const avatar = channel.kind === "direct"
              ? (agent?.avatar.value || agent?.name || label).slice(0, 2).toUpperCase()
              : label.slice(0, 2).toUpperCase();
            const channelStatus = isGroup
              ? (members.some((member) => member.status === "retrying") ? "retrying"
                : members.some((member) => member.status === "running") ? "running"
                  : members.some((member) => member.status === "queued") ? "queued"
                    : "idle")
              : agent?.status ?? "idle";
            return (
              <AppButton
                key={channel.id}
                type="button"
                variant="ghost"
                size="sm"
                className="lyra-agents-oma-channel"
                data-active={channel.id === oma.activeChannelId}
                data-group={isGroup}
                onClick={() => void onSelectOmaChannel?.(snapshot.id, channel.id)}
                aria-label={label}
                title={label}
              >
                <span className="lyra-agents-oma-avatar-stack" data-group={isGroup} aria-hidden="true">
                  {isGroup ? (
                    <span
                      className="lyra-agents-oma-group-orb"
                      data-running={channelStatus === "running"}
                      data-status={channelStatus}
                    />
                  ) : (
                    <span
                      className="lyra-agents-oma-avatar"
                      data-tone={avatarTone(agent?.agentId ?? channel.id)}
                      data-status={channelStatus}
                    >
                      {agent?.avatar.src ? (
                        <img src={`data:image/svg+xml,${encodeURIComponent(agent.avatar.src)}`} alt="" />
                      ) : avatar}
                    </span>
                  )}
                </span>
              </AppButton>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
};
