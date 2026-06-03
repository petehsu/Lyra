import type { TerminalEnvironmentVariable } from "../shell/types";

export type TerminalProfileMode = "shell" | "command";

export type TerminalProfile = {
  readonly id: string;
  readonly name: string;
  readonly shell?: string;
  readonly cwd?: string;
  readonly env?: readonly TerminalEnvironmentVariable[];
  readonly startupCommand?: string;
  readonly mode?: TerminalProfileMode;
};

export type TerminalProfilePaneOptions = {
  readonly title: string;
  readonly profileId: string;
  readonly shell?: string;
  readonly cwd?: string;
  readonly env?: readonly TerminalEnvironmentVariable[];
  readonly startupCommand?: string;
  readonly mode?: TerminalProfileMode;
  readonly command?: string;
};
