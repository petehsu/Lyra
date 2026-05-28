import type {
  AgentOvernightRunSnapshot,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";

export type AgentOvernightAppId = "agent-overnight";
export type AgentOvernightAppIconKey = "agent-overnight-default";

export type AgentOvernightLabels = {
  readonly title: string;
  readonly open: string;
  readonly subtitle: string;
  readonly missionLabel: string;
  readonly missionPlaceholder: string;
  readonly durationLabel: string;
  readonly customMinutes: string;
  readonly oneHour: string;
  readonly fourHours: string;
  readonly eightHours: string;
  readonly inheritContext: string;
  readonly start: string;
  readonly starting: string;
  readonly refresh: string;
  readonly loading: string;
  readonly cancel: string;
  readonly review: string;
  readonly running: string;
  readonly idle: string;
  readonly latestRuns: string;
  readonly noRunsTitle: string;
  readonly noRunsDescription: string;
  readonly status: string;
  readonly model: string;
  readonly provider: string;
  readonly workingDir: string;
  readonly targetWake: string;
  readonly lastActivity: string;
  readonly progress: string;
  readonly taskCards: string;
  readonly events: string;
  readonly log: string;
  readonly reviewPreview: string;
  readonly transcript: string;
  readonly emptyTasks: string;
  readonly emptyEvents: string;
  readonly emptyTranscript: string;
  readonly unavailable: string;
};

export type AgentOvernightSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentOvernightLabels;
  readonly parentSessionId: string | null;
  readonly locale?: WorkbenchLocale;
};

export type AgentOvernightState = {
  readonly runs: readonly AgentOvernightRunSnapshot[];
  readonly selectedRun: AgentOvernightRunSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
};
