import type {
  AgentSessionSnapshot,
  AgentSessionSummary,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { GlobalDialogModel } from "../global-dialog";

export type AgentSessionHistoryAppId = "agent-session-history";
export type AgentSessionHistoryAppIconKey = "agent-session-history-default";

export type AgentSessionHistoryLabels = {
  readonly title: string;
  readonly searchPlaceholder: string;
  readonly refresh: string;
  readonly loading: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly errorTitle: string;
  readonly openSession: string;
  readonly openInAiPanel: string;
  readonly previewTitle: string;
  readonly previewEmptyTitle: string;
  readonly previewEmptyDescription: string;
  readonly messages: string;
  readonly groupSaved: string;
  readonly groupRecent: string;
  readonly groupArchived: string;
  readonly saved: string;
  readonly unsaved: string;
  readonly archive: string;
  readonly unarchive: string;
  readonly rename: string;
  readonly delete: string;
  readonly renameTitle: string;
  readonly renamePlaceholder: string;
  readonly saveRename: string;
  readonly clearRename: string;
  readonly cancelAction: string;
  readonly deleteConfirmTitle: string;
  readonly deleteConfirmDescription: string;
  readonly deleteConfirmAction: string;
  readonly updated: string;
  readonly workingDir: string;
  readonly modelFallback: string;
  readonly statusFallback: string;
  readonly runtimeUnavailable: string;
};

export type AgentSessionHistorySurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentSessionHistoryLabels;
  readonly activeSessionId?: string | null;
  readonly onOpenSession: (sessionId: string) => Promise<void> | void;
  readonly openDialog: GlobalDialogModel["openDialog"];
  readonly locale?: WorkbenchLocale;
};

export type AgentSessionHistoryState = {
  readonly sessionsDir: string | null;
  readonly sessions: readonly AgentSessionSummary[];
};

export type AgentSessionHistoryPreviewState = {
  readonly sessionId: string | null;
  readonly snapshot: AgentSessionSnapshot | null;
};
