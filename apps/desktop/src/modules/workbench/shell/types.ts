export type WorkbenchLayoutPreset = "browser" | "ide";

export type WorkbenchPanelKey = "files" | "ai" | "runtime";

export type WorkbenchTabType = "editor" | "browser" | "plugin";

export type WorkbenchTab = {
  readonly id: string;
  readonly title: string;
  readonly type: WorkbenchTabType;
  readonly subtitle?: string;
  readonly pinned: boolean;
  readonly dirty: boolean;
};

export type ShellMetric = {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly percent: number;
};

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalTabPlacement = "dock" | "workspace";
export type TerminalFollowMode = "observe" | "control" | "takeover";

export type TerminalEnvironmentVariable = {
  readonly key: string;
  readonly value: string;
};

export type TerminalDockPaneState = {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly cwd?: string;
  readonly currentCwd?: string;
  readonly shell?: string;
  readonly env?: readonly TerminalEnvironmentVariable[];
  readonly profileId?: string;
  readonly startupCommand?: string;
  readonly followMode?: TerminalFollowMode;
  readonly mode?: "command" | "shell";
  readonly command?: string;
  readonly sourceAgentSessionId?: string;
  readonly autoTitle?: string;
  readonly titleLocked?: boolean;
};

export type TerminalDockTabState = {
  readonly id: string;
  readonly title: string;
  readonly orientation: TerminalSplitDirection;
  readonly paneIds: readonly string[];
  readonly activePaneId: string;
  readonly placement: TerminalTabPlacement;
  readonly pinned?: boolean;
  readonly favorite?: boolean;
  readonly profileId?: string;
  readonly autoTitle?: string;
  readonly titleLocked?: boolean;
};

export type TerminalDockState = {
  readonly tabs: readonly TerminalDockTabState[];
  readonly panes: Readonly<Record<string, TerminalDockPaneState>>;
  readonly activeTabId: string;
};

export type WorkbenchUrlCommand = {
  readonly kind: "url";
  readonly value: string;
};

export type WorkbenchFileCommand = {
  readonly kind: "file";
  readonly value: string;
};

export type WorkbenchTaskCommand = {
  readonly kind: "task";
  readonly value: string;
};

export type WorkbenchTerminalCommand = {
  readonly kind: "command";
  readonly value: string;
};

export type WorkbenchCommand =
  | WorkbenchUrlCommand
  | WorkbenchFileCommand
  | WorkbenchTaskCommand
  | WorkbenchTerminalCommand;
