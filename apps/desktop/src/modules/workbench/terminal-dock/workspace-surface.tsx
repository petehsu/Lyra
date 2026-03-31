import { TerminalPaneSurface } from "./pane-surface";
import type { TerminalDockLabels, TerminalDockPane, TerminalDockTab } from "./types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { TerminalThemePresetId } from "../terminal-theme";

export type TerminalWorkspaceSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
  readonly themePresetId: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly tab: TerminalDockTab;
  readonly panes: readonly TerminalDockPane[];
  readonly onFocusPane: (paneId: string) => void;
};

export const TerminalWorkspaceSurface = ({
  desktopApi,
  labels,
  themeSignature,
  themePresetId,
  uiThemeId,
  tab,
  panes,
  onFocusPane
}: TerminalWorkspaceSurfaceProps) => (
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
