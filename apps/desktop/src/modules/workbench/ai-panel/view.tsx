import { MessageSquare, Plus, X } from "lucide-react";

import {
  ChromeIconButton,
  ChromeTabButton,
  ChromeTabFrame,
  ChromeTabShape,
  cx
} from "../ui-primitives";
import { AgentChatApp } from "./agent-chat-demo/AgentChatApp";
import { t } from "./agent-chat-demo/core/i18n";
import { useData } from "./agent-chat-demo/data/DataProvider";
import { HeaderControls } from "./agent-chat-demo/features/header/Header";
import type { AiPanelSessionTab } from "./session-tabs";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";

const DEFAULT_SESSION_TITLE = "新会话";

const AiPanelTabsHeader = ({
  tabs,
  activeSessionId,
  onActivateSessionTab,
  onCloseSessionTab
}: {
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeSessionId: string | null;
  readonly onActivateSessionTab?: (sessionId: string) => void;
  readonly onCloseSessionTab?: (sessionId: string) => void;
}) => {
  const { session, isTurnRunning, createSession } = useData();
  const newSessionLabel = t("header.newSession");
  const currentSessionId = session.id?.trim() || null;
  const effectiveActiveSessionId = activeSessionId ?? currentSessionId;
  const currentTab =
    currentSessionId === null
      ? null
      : ({
          sessionId: currentSessionId,
          title: session.title,
          lastKnownStatus: isTurnRunning ? "running" : null
        } satisfies AiPanelSessionTab);
  const visibleTabs =
    currentTab === null || tabs.some((tab) => tab.sessionId === currentTab.sessionId)
      ? tabs
      : [...tabs, currentTab];

  return (
    <header className="app-header ai-session-tabs-header">
      <div className="ai-session-tab-strip" role="tablist" aria-label="AI sessions">
        <div className="lyra-browser-tab-list ai-session-tab-list">
          {visibleTabs.map((tab) => {
            const active = tab.sessionId === effectiveActiveSessionId;
            const hasCurrentSnapshot = tab.sessionId === currentSessionId;
            const title = hasCurrentSnapshot
              ? session.title.trim() || tab.title || DEFAULT_SESSION_TITLE
              : tab.title.trim() || DEFAULT_SESSION_TITLE;
            const running = hasCurrentSnapshot ? isTurnRunning : tab.lastKnownStatus === "running";
            return (
              <ChromeTabFrame
                key={tab.sessionId}
                className={cx(
                  "lyra-browser-tab-item ai-session-tab-item",
                  active && "lyra-browser-tab-item-active ai-session-tab-item-active",
                  running && "lyra-browser-tab-item-agent-active ai-session-tab-item-running"
                )}
              >
                <ChromeTabShape />
                <ChromeTabButton
                  className="lyra-browser-tab-main ai-session-tab-main"
                  role="tab"
                  aria-selected={active}
                  aria-label={title}
                  title={title}
                  onClick={() => onActivateSessionTab?.(tab.sessionId)}
                >
                  <span className="lyra-browser-tab-icon ai-session-tab-icon" aria-hidden="true">
                    <MessageSquare size={14} />
                  </span>
                  <span className="lyra-browser-tab-title ai-session-tab-title">{title}</span>
                </ChromeTabButton>
                <ChromeIconButton
                  className="lyra-browser-tab-close ai-session-tab-close"
                  aria-label={`Close session tab: ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseSessionTab?.(tab.sessionId);
                  }}
                >
                  <X size={12} />
                </ChromeIconButton>
              </ChromeTabFrame>
            );
          })}
        </div>
        <ChromeIconButton
          className="lyra-browser-tab-add ai-session-tab-add"
          aria-label={newSessionLabel}
          title={newSessionLabel}
          onClick={() => {
            void createSession();
          }}
        >
          <Plus size={14} />
        </ChromeIconButton>
      </div>
      <HeaderControls showNewSessionButton={false} />
    </header>
  );
};

export const AiPanelSurface = ({
  desktopApi,
  settingsAiModel,
  activeSessionId = null,
  onActiveSessionChange,
  sessionTabs = [],
  onActivateSessionTab,
  onCloseSessionTab,
  onCreateSessionTab,
  onSessionSnapshotChange,
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
    onSessionSnapshotChange,
    onCreateSessionTab,
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
          headerSlot={
            <AiPanelTabsHeader
              tabs={sessionTabs}
              activeSessionId={activeSessionId}
              {...(onActivateSessionTab === undefined ? {} : { onActivateSessionTab })}
              {...(onCloseSessionTab === undefined ? {} : { onCloseSessionTab })}
            />
          }
          {...(locale === undefined ? {} : { locale })}
        />
      </div>
    </section>
  );
};
