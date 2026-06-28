import { type ReactNode, useEffect, useState } from "react";

import { APP_CONFIG } from "./core/config";
import { setLocale, type Locale } from "@workbench/i18n";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { assertUsingRealData } from "./styles/guards";
import {
  DataContextProvider,
  useData,
  type DataProviderValue,
} from "./data/DataProvider";
import { Header } from "./features/header";
import { PillsRail } from "./features/pills";
import { ChatView } from "./features/chat";
import { AiPanelDragAttachSurface } from "./features/chat/AiPanelDragAttachSurface";
import { DebugPanel } from "./features/debug";

export interface LyraAgentsShellProps {
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
  headerSlot?: ReactNode;
  desktopApi?: LyraDesktopApi | null;
}

export function LyraAgentsShell({
  showDebugPanel = false,
  locale,
  showHeader = true,
  headerSlot,
  desktopApi = null,
}: LyraAgentsShellProps) {
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [showDecisions, setShowDecisions] = useState(true);
  const [showPermission, setShowPermission] = useState(true);
  const { isMock } = useData();

  useEffect(() => {
    assertUsingRealData(isMock);
    document.title = APP_CONFIG.name;
  }, [isMock]);

  return (
    <AiPanelDragAttachSurface>
      {headerSlot ?? (showHeader ? <Header /> : null)}
      <PillsRail />
      <ChatView
        showDecisions={showDecisions}
        showPermission={showPermission}
        desktopApi={desktopApi}
      />
      {showDebugPanel && (
        <DebugPanel
          decisionsVisible={showDecisions}
          permissionVisible={showPermission}
          onToggleDecisions={() => setShowDecisions((v) => !v)}
          onTogglePermission={() => setShowPermission((v) => !v)}
        />
      )}
    </AiPanelDragAttachSurface>
  );
}

export interface LyraAgentsAppProps {
  data: DataProviderValue;
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
  headerSlot?: ReactNode;
  desktopApi?: LyraDesktopApi | null;
}

export function LyraAgentsApp({
  data,
  showDebugPanel = false,
  locale,
  showHeader = true,
  headerSlot,
  desktopApi = null,
}: LyraAgentsAppProps) {
  return (
    <DataContextProvider value={data}>
      <LyraAgentsShell
        showDebugPanel={showDebugPanel}
        showHeader={showHeader}
        headerSlot={headerSlot}
        desktopApi={desktopApi}
        {...(locale === undefined ? {} : { locale })}
      />
    </DataContextProvider>
  );
}
