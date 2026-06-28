import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, PanelBottom, Square, SquareTerminal } from "lucide-react";
import {
  AppButton,
  AppIconButton,
  AppMenu,
  AppMenuContent,
  AppMenuTrigger
} from "@renderer/ui/components";
import type { TerminalDockTab } from "../../../../terminal-dock/types";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import type {
  AgentPageCitation,
  AgentPrivateTerminalSnapshot,
} from "../../../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import type { SessionMeta } from "../../core/types";
import { t } from "@workbench/i18n";
import { buildTerminalTabPageCitation } from "./terminal-tab-citation";

const ICON_SIZE = 13;
const ACTION_ICON_SIZE = 14;
const ICON_STROKE_WIDTH = 2;
const POLL_MS = 3000;

type BackgroundTerminalButtonProps = {
  readonly terminalTabs: readonly TerminalDockTab[];
  readonly getTerminalTabPanes: (tabId: string) => readonly {
    readonly sourceAgentSessionId?: string;
    readonly cwd?: string;
    readonly currentCwd?: string;
  }[];
  readonly session: SessionMeta;
  readonly workspaceTabs: readonly WorkspaceTab[];
  readonly onCiteTerminal: (citation: AgentPageCitation) => void;
  readonly onCloseTerminalTab: (tabId: string) => void;
  readonly onFocusTerminalTabInDock: (tabId: string) => void;
  readonly onOpenTerminalInWorkspace: (request: {
    readonly terminalTabId?: string | null;
  }) => void;
  readonly desktopApi?: LyraDesktopApi | null;
};

export function BackgroundTerminalButton({
  terminalTabs,
  getTerminalTabPanes,
  session,
  workspaceTabs,
  onCiteTerminal,
  onCloseTerminalTab,
  onFocusTerminalTabInDock,
  onOpenTerminalInWorkspace,
  desktopApi = null,
}: BackgroundTerminalButtonProps) {
  const sid = session.id;
  const dir = session.workingDir;

  // ponytail: private terminals live in main-process memory, not the dock
  // model. Poll via IPC because there's no reactive subscription for them.
  const [privateTerminals, setPrivateTerminals] = useState<
    readonly AgentPrivateTerminalSnapshot[]
  >([]);

  useEffect(() => {
    if (!sid || !desktopApi?.agent) {
      setPrivateTerminals([]);
      return;
    }
    const listPrivateTerminals = desktopApi.agent.listPrivateTerminals;
    if (typeof listPrivateTerminals !== "function") {
      setPrivateTerminals([]);
      return;
    }
    let cancelled = false;
    const fetchList = () => {
      listPrivateTerminals({ sessionId: sid })
        .then((list) => {
          if (!cancelled) setPrivateTerminals(list);
        })
        .catch(() => {});
    };
    fetchList();
    const timer = setInterval(fetchList, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sid, desktopApi?.agent]);

  const uiTerminals = useMemo(() => {
    if (!sid) return [];
    return terminalTabs.filter((tab) => {
      const panes = getTerminalTabPanes(tab.id);
      return panes.some((pane) =>
        pane.sourceAgentSessionId === sid
        || pane.cwd === dir
        || pane.currentCwd === dir
      );
    });
  }, [terminalTabs, getTerminalTabPanes, sid, dir]);

  const label = t("lyra-agents-composer.backgroundTerminals");
  const count = uiTerminals.length + privateTerminals.length;

  return (
    <AppMenu>
      <AppMenuTrigger asChild>
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-bg-terminal-chip"
          aria-label={label}
          title={label}
        >
          <SquareTerminal size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          <span>{label}</span>
          {count > 0 ? (
            <span className="lyra-agents-bg-terminal-count">{count}</span>
          ) : null}
        </AppButton>
      </AppMenuTrigger>
      <AppMenuContent align="start" sideOffset={4}>
        {count === 0 ? (
          <div className="lyra-agents-bg-terminal-empty">
            {t("lyra-agents-composer.backgroundTerminalsEmpty")}
          </div>
        ) : (
          <>
            {uiTerminals.map((tab) => (
              <div key={tab.id} className="lyra-agents-bg-terminal-item">
                <span className="lyra-agents-bg-terminal-item-label">
                  <SquareTerminal size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
                  <span>{tab.title.trim().length > 0 ? tab.title.trim() : tab.id}</span>
                </span>
                <span className="lyra-agents-bg-terminal-item-actions">
                  <AppIconButton
                    type="button"
                    aria-label={t("lyra-agents-composer.addToConversation")}
                    title={t("lyra-agents-composer.addToConversation")}
                    onClick={() => {
                      onCiteTerminal(buildTerminalTabPageCitation(tab, workspaceTabs));
                    }}
                  >
                    <Link2 size={ACTION_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </AppIconButton>
                  <AppIconButton
                    type="button"
                    aria-label={t("lyra-agents-composer.endTerminal")}
                    title={t("lyra-agents-composer.endTerminal")}
                    onClick={() => {
                      onCloseTerminalTab(tab.id);
                    }}
                  >
                    <Square size={ACTION_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </AppIconButton>
                  <AppIconButton
                    type="button"
                    aria-label={t("lyra-agents-composer.openInTerminalPanel")}
                    title={t("lyra-agents-composer.openInTerminalPanel")}
                    onClick={() => {
                      onFocusTerminalTabInDock(tab.id);
                    }}
                  >
                    <PanelBottom size={ACTION_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </AppIconButton>
                  <AppIconButton
                    type="button"
                    aria-label={t("lyra-agents-composer.openInWorkspace")}
                    title={t("lyra-agents-composer.openInWorkspace")}
                    onClick={() => {
                      onOpenTerminalInWorkspace({ terminalTabId: tab.id });
                    }}
                  >
                    <ExternalLink size={ACTION_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </AppIconButton>
                </span>
              </div>
            ))}
            {privateTerminals.map((pt) => (
              <div key={`private-${pt.sessionId}`} className="lyra-agents-bg-terminal-item">
                <span className="lyra-agents-bg-terminal-item-label">
                  <SquareTerminal size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
                  <span>{pt.title.trim().length > 0 ? pt.title.trim() : pt.sessionId}</span>
                </span>
                <span className="lyra-agents-bg-terminal-item-actions">
                  <AppIconButton
                    type="button"
                    aria-label={t("lyra-agents-composer.endTerminal")}
                    title={t("lyra-agents-composer.endTerminal")}
                    onClick={() => {
                      if (sid) {
                        void desktopApi?.agent?.closePrivateTerminal({
                          sessionId: sid,
                          terminalSessionId: pt.sessionId
                        });
                      }
                    }}
                  >
                    <Square size={ACTION_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </AppIconButton>
                </span>
              </div>
            ))}
          </>
        )}
      </AppMenuContent>
    </AppMenu>
  );
}
