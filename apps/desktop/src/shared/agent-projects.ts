export type AgentProject = {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly lastUsedAt: string;
  readonly available: boolean;
};

export type AgentProjectCapability = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sourceLabel?: string | null;
  readonly globalEnabled: boolean;
  readonly override: boolean | null;
  readonly enabled: boolean;
};

export type AgentProjectSettings = {
  readonly project: AgentProject;
  readonly skills: readonly AgentProjectCapability[];
  readonly mcp: readonly AgentProjectCapability[];
};

export type AgentProjectOverrideRequest = {
  readonly projectId: string;
  readonly kind: "skill" | "mcp";
  readonly itemId: string;
  readonly enabled: boolean | null;
};
