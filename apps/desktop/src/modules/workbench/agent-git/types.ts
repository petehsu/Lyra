import type {
  AgentGitChangedFile,
  AgentGitDiffResponse,
  AgentGitStatusSnapshot
} from "../../../shared/desktop-bridge";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type AgentGitAppId = "agent-git";
export type AgentGitAppIconKey = "agent-git-default";

export type AgentGitLabels = {
  readonly title: string;
  readonly open: string;
  readonly refresh: string;
  readonly loading: string;
  readonly notRepositoryTitle: string;
  readonly notRepositoryDescription: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly changes: string;
  readonly staged: string;
  readonly unstaged: string;
  readonly untracked: string;
  readonly conflicts: string;
  readonly stage: string;
  readonly unstage: string;
  readonly discard: string;
  readonly discardConfirm: string;
  readonly selectFileTitle: string;
  readonly selectFileDescription: string;
  readonly binaryDiff: string;
  readonly noDiff: string;
  readonly unavailable: string;
};

export type AgentGitSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentGitLabels;
  readonly agentSessionId: string;
  readonly rootPath: string;
  readonly title: string;
};

export type AgentGitStatusState =
  | {
      readonly kind: "loading";
      readonly snapshot: AgentGitStatusSnapshot | null;
    }
  | {
      readonly kind: "ready";
      readonly snapshot: AgentGitStatusSnapshot;
    }
  | {
      readonly kind: "error";
      readonly snapshot: AgentGitStatusSnapshot | null;
      readonly message: string;
    };

export type AgentGitDiffState =
  | {
      readonly kind: "empty";
    }
  | {
      readonly kind: "loading";
      readonly file: AgentGitChangedFile;
    }
  | {
      readonly kind: "ready";
      readonly file: AgentGitChangedFile;
      readonly diff: AgentGitDiffResponse;
    }
  | {
      readonly kind: "error";
      readonly file: AgentGitChangedFile;
      readonly message: string;
    };
