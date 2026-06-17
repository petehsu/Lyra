import { type ReactNode, useEffect, useState } from "react";

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
import { AiPanelDragAttachSurface } from "./features/chat/AiPanelDragAttachSurface";
import { DebugPanel } from "./features/debug";
import { RichText } from "./features/rich-text";
import { AppButton } from "@renderer/ui/components";

export interface LyraAgentsShellProps {
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
  headerSlot?: ReactNode;
}

export function LyraAgentsShell({
  showDebugPanel = false,
  locale,
  showHeader = true,
  headerSlot,
}: LyraAgentsShellProps) {
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
    <AiPanelDragAttachSurface>
      {headerSlot ?? (showHeader ? <Header /> : null)}
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
    </AiPanelDragAttachSurface>
  );
}

function AgentSidePanelPreview() {
  const { sidePanel } = useData();
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  useEffect(() => {
    if (sidePanel === null || sidePanel === undefined || sidePanel.pages.length === 0) {
      setSelectedPageId(null);
      return;
    }
    const focusedId = sidePanel.focusedPageId ?? sidePanel.pages[0]?.id ?? null;
    setSelectedPageId((current) => {
      if (current !== null && sidePanel.pages.some((page) => page.id === current)) {
        return current;
      }
      return focusedId;
    });
  }, [sidePanel]);

  if (sidePanel === null || sidePanel === undefined || sidePanel.pages.length === 0) {
    return null;
  }
  const focused =
    sidePanel.pages.find((page) => page.id === selectedPageId)
    ?? sidePanel.pages.find((page) => page.id === sidePanel.focusedPageId)
    ?? sidePanel.pages[0];
  if (focused === undefined) {
    return null;
  }
  const source = focused.filePath ?? focused.source ?? null;
  return (
    <aside className="lyra-agents-side-panel-preview" aria-label={t("sidePanel.aria")}>
      <div className="lyra-agents-side-panel-preview-head">
        <div className="lyra-agents-side-panel-tabs" role="tablist" aria-label={t("sidePanel.aria")}>
          {sidePanel.pages.map((page) => (
            <AppButton variant="ghost" size="sm"
              key={page.id}
              type="button"
              role="tab"
              aria-selected={page.id === focused.id}
              className={page.id === focused.id ? "lyra-agents-side-panel-tab active" : "lyra-agents-side-panel-tab"}
              onClick={() => setSelectedPageId(page.id)}
            >
              {page.title}
            </AppButton>
          ))}
        </div>
        {source !== null && source.trim().length > 0 ? (
          <span className="lyra-agents-side-panel-source" title={source}>
            {t("sidePanel.source")}: {source}
          </span>
        ) : null}
      </div>
      <div className="lyra-agents-side-panel-preview-body">
        <RichText content={focused.content} />
      </div>
    </aside>
  );
}

export interface LyraAgentsAppProps {
  data: DataProviderValue;
  showDebugPanel?: boolean;
  locale?: Locale;
  showHeader?: boolean;
  headerSlot?: ReactNode;
}

export function LyraAgentsApp({
  data,
  showDebugPanel = false,
  locale,
  showHeader = true,
  headerSlot,
}: LyraAgentsAppProps) {
  return (
    <DataContextProvider value={data}>
      <LyraAgentsShell
        showDebugPanel={showDebugPanel}
        showHeader={showHeader}
        headerSlot={headerSlot}
        {...(locale === undefined ? {} : { locale })}
      />
    </DataContextProvider>
  );
}
