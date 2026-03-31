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

export type AiMode = "assist" | "agent";

export type AiPlanStepState = "todo" | "running" | "done";

export type AiPlanStep = {
  readonly id: string;
  readonly label: string;
  readonly state: AiPlanStepState;
};

export type AiActionStatus = "pending" | "running" | "success" | "failed";

export type AiActionEvent = {
  readonly id: string;
  readonly action: string;
  readonly status: AiActionStatus;
  readonly timestamp: string;
};

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalItem = {
  readonly id: string;
  readonly summary: string;
  readonly status: ApprovalStatus;
};

export type AiThreadRole = "assistant" | "user";

export type AiThreadMessage = {
  readonly id: string;
  readonly role: AiThreadRole;
  readonly content: string;
};

export type ShellMetric = {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly percent: number;
};

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalTabPlacement = "dock" | "workspace";

export type TerminalDockPaneState = {
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly cwd?: string;
  readonly shell?: string;
};

export type TerminalDockTabState = {
  readonly id: string;
  readonly title: string;
  readonly orientation: TerminalSplitDirection;
  readonly paneIds: readonly string[];
  readonly activePaneId: string;
  readonly placement: TerminalTabPlacement;
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
