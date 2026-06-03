import { AgentChatApp } from "./agent-chat-demo/AgentChatApp";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";

export const AiPanelSurface = ({
  desktopApi,
  settingsAiModel,
  activeSessionId = null,
  onActiveSessionChange,
  onRequestProjectBind,
  onOpenProjectTree,
  onOpenSelfDevLab,
  onOpenOvernightLab,
  onOpenModelSettings,
  onOpenUrlInWorkbench,
  onOpenTerminalLiveSession,
  onOpenFile,
  locale,
  title
}: AiPanelSurfaceProps) => {
  const provider = useLyraAgentDataProvider(
    desktopApi,
    settingsAiModel,
    activeSessionId,
    onActiveSessionChange,
    onRequestProjectBind,
    onOpenProjectTree,
    onOpenSelfDevLab,
    onOpenOvernightLab,
    onOpenModelSettings,
    onOpenUrlInWorkbench,
    onOpenFile,
    onOpenTerminalLiveSession,
    locale
  );

  return (
    <section className="lyra-ai-panel-shell" aria-label={title}>
      {provider.error === null ? null : (
        <div className="lyra-ai-panel-error" role="status">{provider.error}</div>
      )}
      <div className="lyra-ai-panel-agent-chat">
        <AgentChatApp
          data={provider.data}
          {...(locale === undefined ? {} : { locale })}
        />
      </div>
    </section>
  );
};
