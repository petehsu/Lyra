import { Plus, PanelBottomOpen, SplitSquareHorizontal, SplitSquareVertical } from "lucide-react";
import { useMemo } from "react";

import { TerminalPaneSurface } from "./pane-surface";
import type { TerminalDockLabels, TerminalDockPane, TerminalDockTab } from "./types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { TerminalThemePresetId } from "../terminal-theme";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type TerminalWorkspaceSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
  readonly themePresetId: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly tab: TerminalDockTab;
  readonly panes: readonly TerminalDockPane[];
  readonly onFocusPane: (paneId: string) => void;
  readonly onOpenTab: () => void;
  readonly onSplitHorizontal: () => void;
  readonly onSplitVertical: () => void;
  readonly onMoveToDock: () => void;
};

export const TerminalWorkspaceSurface = ({
  desktopApi,
  labels,
  themeSignature,
  themePresetId,
  uiThemeId,
  tab,
  panes,
  onFocusPane,
  onOpenTab,
  onSplitHorizontal,
  onSplitVertical,
  onMoveToDock
}: TerminalWorkspaceSurfaceProps) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: tab.title,
      content: (
        <>
          <span className="lyra-titlebar-context-chip">{String(panes.length)}</span>
          <div className="lyra-titlebar-context-controls">
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.newTab}
              onClick={onOpenTab}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.splitHorizontal}
              onClick={onSplitHorizontal}
            >
              <SplitSquareHorizontal size={14} />
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.splitVertical}
              onClick={onSplitVertical}
            >
              <SplitSquareVertical size={14} />
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.moveTerminalToBottom}
              onClick={onMoveToDock}
            >
              <PanelBottomOpen size={14} />
            </button>
          </div>
        </>
      )
    }),
    [
      labels.moveTerminalToBottom,
      labels.newTab,
      labels.splitHorizontal,
      labels.splitVertical,
      onMoveToDock,
      onOpenTab,
      onSplitHorizontal,
      onSplitVertical,
      panes.length,
      tab.title
    ]
  );
  useWorkbenchTitlebarContribution(contribution);

  return (
    <section className="lyra-terminal-workspace-surface" aria-label="terminal-workspace-surface">
      <section
        className={
          tab.orientation === "vertical"
            ? "lyra-terminal-panes lyra-terminal-panes-vertical"
            : "lyra-terminal-panes lyra-terminal-panes-horizontal"
        }
      >
        {panes.map((pane) => (
          <TerminalPaneSurface
            key={pane.id}
            pane={pane}
            active={pane.id === tab.activePaneId}
            desktopApi={desktopApi}
            labels={labels}
            themeSignature={themeSignature}
            themePresetId={themePresetId}
            uiThemeId={uiThemeId}
            onFocus={() => {
              onFocusPane(pane.id);
            }}
          />
        ))}
      </section>
    </section>
  );
};
