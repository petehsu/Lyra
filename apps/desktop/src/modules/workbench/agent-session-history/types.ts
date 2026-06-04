import type {
  AgentSessionSnapshot,
  AgentSessionSummary,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type { BrowserHistoryEntry } from "../browser-history/service";
import type { WorkbenchLocale } from "../i18n";
import type { GlobalDialogModel } from "../global-dialog";

export type AgentSessionHistoryAppId = "agent-session-history";
export type AgentSessionHistoryAppIconKey = "agent-session-history-default";
export type AgentSessionHistoryCategory =
  | "sessions"
  | "project-sessions"
  | "archived-sessions"
  | "browser-history";

export type AgentSessionHistoryLocateRequest = {
  readonly requestKey: number;
  readonly target:
    | {
        readonly kind: "session";
        readonly sessionId: string;
        readonly category: Exclude<AgentSessionHistoryCategory, "browser-history">;
      }
    | {
        readonly kind: "browser-history";
        readonly entryId: string;
      };
};

export type AgentSessionHistoryBrowserPreviewPage = {
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
};

export type AgentSessionHistoryLabels = {
  readonly title: string;
  readonly searchPlaceholder: string;
  readonly refresh: string;
  readonly categoryFilter: string;
  readonly categorySessions: string;
  readonly categoryProjectSessions: string;
  readonly categoryArchivedSessions: string;
  readonly categoryBrowserHistory: string;
  readonly loading: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly browserHistoryEmptyTitle: string;
  readonly browserHistoryEmptyDescription: string;
  readonly openBrowserHistoryEntry: string;
  readonly visited: string;
  readonly visits: string;
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
  readonly query?: string;
  readonly refreshRequestKey?: number;
  readonly locateRequest?: AgentSessionHistoryLocateRequest | null;
  readonly browserHistory?: readonly BrowserHistoryEntry[];
  readonly browserHistoryPreviewPageId?: string;
  readonly onBrowserHistoryPreviewChange?: (
    page: AgentSessionHistoryBrowserPreviewPage | null
  ) => void;
  readonly onBrowserHistoryPreviewHostChange?: (
    tabId: string,
    element: HTMLElement | null
  ) => void;
  readonly onOpenSession: (sessionId: string) => Promise<void> | void;
  readonly onOpenBrowserHistoryEntry?: (entry: BrowserHistoryEntry) => Promise<void> | void;
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
