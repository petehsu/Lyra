import { useMemo } from "react";

import { TerminalPaneSurface } from "./pane-surface";
import type {
  TerminalDockLabels,
  TerminalDockPane,
  TerminalDockTab
} from "./types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type TerminalWorkspaceSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
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
  uiThemeId,
  tab,
  panes,
  onFocusPane
}: TerminalWorkspaceSurfaceProps) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: tab.title,
      content: (
        <span className="lyra-titlebar-context-chip">{String(panes.length)}</span>
      )
    }),
    [panes.length, tab.title]
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
