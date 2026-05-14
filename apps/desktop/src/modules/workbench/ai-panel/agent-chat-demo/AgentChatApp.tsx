import { useEffect, useState } from "react";
import "./App.css";
import "./styles/tokens.css";

import { APP_CONFIG } from "./core/config";
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
}

export function AgentChatShell({ showDebugPanel = false }: AgentChatShellProps) {
  const [showDecisions, setShowDecisions] = useState(true);
  const [showPermission, setShowPermission] = useState(true);
  const { isMock } = useData();

  useEffect(() => {
    assertUsingRealData(isMock);
    document.title = APP_CONFIG.name;
  }, [isMock]);

  return (
    <div className="app">
      <Header />
      <PillsRail />
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

export interface AgentChatAppProps {
  data: DataProviderValue;
  showDebugPanel?: boolean;
}

export function AgentChatApp({
  data,
  showDebugPanel = false,
}: AgentChatAppProps) {
  return (
    <DataContextProvider value={data}>
      <AgentChatShell showDebugPanel={showDebugPanel} />
    </DataContextProvider>
  );
}
