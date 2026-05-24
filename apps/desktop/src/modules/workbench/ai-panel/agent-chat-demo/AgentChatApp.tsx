import { useEffect, useState } from "react";
import "./App.css";
import "./styles/tokens.css";

import { APP_CONFIG } from "./core/config";
import { setLocale, t, type Locale } from "./core/i18n";
import { assertUsingRealData } from "./styles/guards";
import {
  DataContextProvider,
  useData,
  type DataProviderValue,
} from "./data/DataProvider";
import { Header } from "./features/header";
import { PillsRail } from "./features/pills";
import { ChatView } from "./features/chat";
import { DebugPanel } from "./features/debug";

export interface AgentChatShellProps {
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
}

export function AgentChatShell({
  showDebugPanel = false,
  locale,
  showHeader = true,
}: AgentChatShellProps) {
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [showDecisions, setShowDecisions] = useState(true);
  const [showPermission, setShowPermission] = useState(true);
  const { isMock, sidePanel } = useData();

  useEffect(() => {
    assertUsingRealData(isMock);
    document.title = APP_CONFIG.name;
  }, [isMock]);

  return (
    <div className="app">
      {showHeader ? <Header /> : null}
      <PillsRail />
      {sidePanel !== null && sidePanel !== undefined && sidePanel.pages.length > 0 ? (
        <AgentSidePanelPreview />
      ) : null}
      <ChatView showDecisions={showDecisions} showPermission={showPermission} />
      {showDebugPanel && (
        <DebugPanel
          decisionsVisible={showDecisions}
          permissionVisible={showPermission}
          onToggleDecisions={() => setShowDecisions((v) => !v)}
          onTogglePermission={() => setShowPermission((v) => !v)}
        />
      )}
    </div>
  );
}

function AgentSidePanelPreview() {
  const { sidePanel } = useData();
  if (sidePanel === null || sidePanel === undefined || sidePanel.pages.length === 0) {
    return null;
  }
  const focused =
    sidePanel.pages.find((page) => page.id === sidePanel.focusedPageId) ?? sidePanel.pages[0];
  if (focused === undefined) {
    return null;
  }
  return (
    <aside className="agent-side-panel-preview" aria-label={t("sidePanel.aria")}>
      <div className="agent-side-panel-preview-head">
        <span>{focused.title}</span>
      </div>
      <pre className="agent-side-panel-preview-body">{focused.content}</pre>
    </aside>
  );
}

export interface AgentChatAppProps {
  data: DataProviderValue;
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
}

export function AgentChatApp({
  data,
  showDebugPanel = false,
  locale,
  showHeader = true,
}: AgentChatAppProps) {
  return (
    <DataContextProvider value={data}>
      <AgentChatShell
        showDebugPanel={showDebugPanel}
        showHeader={showHeader}
        {...(locale === undefined ? {} : { locale })}
      />
    </DataContextProvider>
  );
}
