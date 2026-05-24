import type {
  AgentSelfDevStartRequest,
  AgentSelfDevStatusResponse,
  AgentSessionSnapshot,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";

export type AgentSelfDevAppId = "agent-selfdev";
export type AgentSelfDevAppIconKey = "agent-selfdev-default";

export type AgentSelfDevTarget = NonNullable<AgentSelfDevStartRequest["target"]>;

export type AgentSelfDevLabels = {
  readonly title: string;
  readonly open: string;
  readonly subtitle: string;
  readonly promptLabel: string;
  readonly promptPlaceholder: string;
  readonly targetLabel: string;
  readonly targetAgentCore: string;
  readonly targetDesktopGui: string;
  readonly targetValidation: string;
  readonly targetGeneral: string;
  readonly inheritContext: string;
  readonly start: string;
  readonly starting: string;
  readonly repo: string;
  readonly status: string;
  readonly idle: string;
  readonly running: string;
  readonly unavailable: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly restartRequired: string;
};

export type AgentSelfDevSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentSelfDevLabels;
  readonly parentSessionId: string | null;
  readonly locale?: WorkbenchLocale;
};

export type AgentSelfDevRuntimeState =
  | {
      readonly status: "empty";
      readonly session: null;
      readonly selfdevStatus: AgentSelfDevStatusResponse | null;
      readonly error: string | null;
    }
  | {
      readonly status: "ready" | "running";
      readonly session: AgentSessionSnapshot;
      readonly selfdevStatus: AgentSelfDevStatusResponse | null;
      readonly error: string | null;
    };
