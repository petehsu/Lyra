export type AgentMessageProjection = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly createdAt: string;
  readonly rollbackAvailable: boolean;
};

export type AgentToolProjection = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly status: string;
};

export type AgentTodoProjection = {
  readonly id: string;
  readonly content: string;
  readonly status: string;
  readonly priority: string;
};

export type OmaAgentProjection = {
  readonly sessionAgentId: string;
  readonly agentId: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly temporary: boolean;
};

export type OmaChannelProjection = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly memberAgentIds: readonly string[];
  readonly archived: boolean;
};

export type AgentSessionProjection = {
  readonly id: string;
  readonly title: string;
  readonly agentMode: "solo" | "oma";
  readonly workingDir: string;
  readonly projectBound: boolean;
  readonly turnStatus: string;
  readonly activeTurnId?: string;
  readonly updatedAt: string;
  readonly messages: readonly AgentMessageProjection[];
  readonly tools: readonly AgentToolProjection[];
  readonly todos: readonly AgentTodoProjection[];
  readonly oma: {
    readonly activeChannelId: string;
    readonly agents: readonly OmaAgentProjection[];
    readonly availableAgents: readonly OmaAgentProjection[];
    readonly channels: readonly OmaChannelProjection[];
  } | null;
  readonly plan: Readonly<Record<string, unknown>> | null;
  readonly projectTodo: Readonly<Record<string, unknown>> | null;
};

export type AgentSessionSummaryProjection = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly messageCount: number;
  readonly updatedAt: string;
  readonly saved: boolean;
  readonly archived: boolean;
  readonly workingDir?: string;
  readonly providerLabel?: string;
  readonly model?: string;
};

export type AgentHistoryProjection = {
  readonly sessionsDir: string;
  readonly sessions: readonly AgentSessionSummaryProjection[];
};

export type AgentProjectTreeEntryProjection = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
};

export type AgentProjectTreeProjection = {
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly rootPath: string;
  readonly title: string;
  readonly selectedPath: string | null;
  readonly selectedFilePath: string | null;
  readonly editorInstanceId: string | null;
  readonly expandedPaths: readonly string[];
  readonly entries: readonly AgentProjectTreeEntryProjection[];
};

export type AgentPlanSummaryProjection = {
  readonly planId: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAtIso: string;
};

export type AgentPlanProjection = {
  readonly mode: "detail" | "manager";
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly title: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly workingDir?: string;
  readonly plans: readonly AgentPlanSummaryProjection[];
  readonly selectedPlan: Readonly<Record<string, unknown>> | null;
  readonly selectedProjectTodo: Readonly<Record<string, unknown>> | null;
};

export type AgentGitEntryProjection = {
  readonly path: string;
  readonly status: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
};

export type AgentGitProjection = {
  readonly workingDir: string;
  readonly isRepository: boolean;
  readonly branch?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly updatedAt: string;
  readonly message?: string;
  readonly summary: {
    readonly changed: number;
    readonly staged: number;
    readonly unstaged: number;
    readonly untracked: number;
    readonly conflicts: number;
  };
  readonly entries: readonly AgentGitEntryProjection[];
};

export type AgentGitDiffProjection = {
  readonly path: string;
  readonly scope: "unstaged" | "staged";
  readonly diff: string;
  readonly isBinary: boolean;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const requiredString = (value: unknown, field: string): string => {
  const parsed = stringValue(value);
  if (parsed === undefined) {
    throw new Error(`Core returned an invalid Agent field: ${field}`);
  }
  return parsed;
};

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const recordOrNull = (value: unknown): Readonly<Record<string, unknown>> | null =>
  isRecord(value) ? value : null;

const parseOmaAgent = (value: unknown): OmaAgentProjection | null => {
  if (!isRecord(value)) return null;
  const agentId = stringValue(value.agentId);
  const name = stringValue(value.name);
  if (agentId === undefined || name === undefined) return null;
  return {
    sessionAgentId: stringValue(value.sessionAgentId) ?? agentId,
    agentId,
    name,
    role: stringValue(value.role) ?? "agent",
    status: stringValue(value.status) ?? "idle",
    temporary: value.temporary === true
  };
};

const parseOmaChannel = (value: unknown): OmaChannelProjection | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (id === undefined || name === undefined) return null;
  return {
    id,
    name,
    kind: stringValue(value.kind) ?? "group",
    memberAgentIds: Array.isArray(value.memberAgentIds)
      ? value.memberAgentIds.filter((item): item is string => typeof item === "string")
      : [],
    archived: value.archived === true
  };
};

export const parseAgentSessionProjection = (value: unknown): AgentSessionProjection | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("Core returned an invalid Agent session.");
  }
  const mode = value.agentMode;
  if (mode !== "solo" && mode !== "oma") {
    throw new Error("Core returned an invalid Agent mode.");
  }
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap((item): readonly AgentMessageProjection[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const role = item.role;
        const text = typeof item.text === "string" ? item.text : undefined;
        const createdAt = stringValue(item.createdAt);
        if (
          id === undefined
          || text === undefined
          || createdAt === undefined
          || (role !== "user" && role !== "assistant" && role !== "system")
        ) {
          return [];
        }
        return [{
          id,
          role,
          text,
          createdAt,
          rollbackAvailable: item.rollbackAvailable === true
        }];
      })
    : [];
  const tools = Array.isArray(value.tools)
    ? value.tools.flatMap((item): readonly AgentToolProjection[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        const label = stringValue(item.label);
        if (id === undefined || name === undefined || label === undefined) return [];
        return [{ id, name, label, status: stringValue(item.status) ?? "unknown" }];
      })
    : [];
  const todos = Array.isArray(value.todos)
    ? value.todos.flatMap((item): readonly AgentTodoProjection[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const content = stringValue(item.content);
        if (id === undefined || content === undefined) return [];
        return [{
          id,
          content,
          status: stringValue(item.status) ?? "pending",
          priority: stringValue(item.priority) ?? "normal"
        }];
      })
    : [];
  const oma = isRecord(value.oma)
    ? {
        activeChannelId: stringValue(value.oma.activeChannelId) ?? "",
        agents: Array.isArray(value.oma.agents)
          ? value.oma.agents.map(parseOmaAgent).filter((item): item is OmaAgentProjection => item !== null)
          : [],
        availableAgents: Array.isArray(value.oma.availableAgents)
          ? value.oma.availableAgents.map(parseOmaAgent).filter((item): item is OmaAgentProjection => item !== null)
          : [],
        channels: Array.isArray(value.oma.channels)
          ? value.oma.channels.map(parseOmaChannel).filter((item): item is OmaChannelProjection => item !== null)
          : []
      }
    : null;
  const activeTurnId = stringValue(value.activeTurnId);
  return {
    id: requiredString(value.id, "id"),
    title: requiredString(value.title, "title"),
    agentMode: mode,
    workingDir: typeof value.workingDir === "string" ? value.workingDir : "",
    projectBound: value.projectBound === true,
    turnStatus: requiredString(value.turnStatus, "turnStatus"),
    ...(activeTurnId === undefined ? {} : { activeTurnId }),
    updatedAt: requiredString(value.updatedAt, "updatedAt"),
    messages,
    tools,
    todos,
    oma,
    plan: recordOrNull(value.plan),
    projectTodo: recordOrNull(value.projectTodo)
  };
};

export const parseAgentHistoryProjection = (value: unknown): AgentHistoryProjection => {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw new Error("Core returned an invalid Agent history.");
  }
  return {
    sessionsDir: typeof value.sessionsDir === "string" ? value.sessionsDir : "",
    sessions: value.sessions.flatMap((item): readonly AgentSessionSummaryProjection[] => {
      if (!isRecord(item)) return [];
      const id = stringValue(item.id);
      const title = stringValue(item.title);
      const updatedAt = stringValue(item.updatedAt);
      if (id === undefined || title === undefined || updatedAt === undefined) return [];
      const workingDir = stringValue(item.workingDir);
      const providerLabel = stringValue(item.providerLabel);
      const model = stringValue(item.model);
      return [{
        id,
        title,
        status: stringValue(item.status) ?? "unknown",
        messageCount: Math.max(0, Math.floor(finiteNumber(item.messageCount))),
        updatedAt,
        saved: item.saved === true,
        archived: item.archived === true,
        ...(workingDir === undefined ? {} : { workingDir }),
        ...(providerLabel === undefined ? {} : { providerLabel }),
        ...(model === undefined ? {} : { model })
      }];
    })
  };
};

const parseTreeEntry = (value: unknown): AgentProjectTreeEntryProjection | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const path = stringValue(value.path);
  const kind = value.kind;
  if (
    id === undefined
    || name === undefined
    || path === undefined
    || (kind !== "file" && kind !== "directory")
  ) {
    return null;
  }
  const modifiedAt = stringValue(value.modifiedAt);
  return {
    id,
    name,
    path,
    kind,
    ...(typeof value.sizeBytes === "number" ? { sizeBytes: finiteNumber(value.sizeBytes) } : {}),
    ...(modifiedAt === undefined ? {} : { modifiedAt })
  };
};

export const parseAgentProjectTreeProjection = (value: unknown): AgentProjectTreeProjection | null => {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error("Core returned an invalid Agent project tree.");
  }
  return {
    instanceId: requiredString(value.instanceId, "projectTree.instanceId"),
    agentSessionId: requiredString(value.agentSessionId, "projectTree.agentSessionId"),
    rootPath: requiredString(value.rootPath, "projectTree.rootPath"),
    title: requiredString(value.title, "projectTree.title"),
    selectedPath: typeof value.selectedPath === "string" ? value.selectedPath : null,
    selectedFilePath:
      typeof value.selectedFilePath === "string" ? value.selectedFilePath : null,
    editorInstanceId:
      typeof value.editorInstanceId === "string" ? value.editorInstanceId : null,
    expandedPaths: Array.isArray(value.expandedPaths)
      ? value.expandedPaths.filter((item): item is string => typeof item === "string")
      : [],
    entries: value.entries.map(parseTreeEntry).filter(
      (item): item is AgentProjectTreeEntryProjection => item !== null
    )
  };
};

const parsePlanSummary = (value: unknown): AgentPlanSummaryProjection | null => {
  if (!isRecord(value)) return null;
  const planId = stringValue(value.planId);
  const title = stringValue(value.title);
  if (planId === undefined || title === undefined) return null;
  return {
    planId,
    title,
    status: stringValue(value.status) ?? "unknown",
    updatedAtIso: stringValue(value.updatedAtIso) ?? ""
  };
};

export const parseAgentPlanProjection = (value: unknown): AgentPlanProjection | null => {
  if (value === null) return null;
  if (!isRecord(value) || (value.mode !== "detail" && value.mode !== "manager")) {
    throw new Error("Core returned an invalid Agent plan state.");
  }
  const workingDir = stringValue(value.workingDir);
  return {
    mode: value.mode,
    instanceId: requiredString(value.instanceId, "plan.instanceId"),
    agentSessionId: requiredString(value.agentSessionId, "plan.agentSessionId"),
    title: requiredString(value.title, "plan.title"),
    loading: value.loading === true,
    error: typeof value.error === "string" ? value.error : null,
    ...(workingDir === undefined ? {} : { workingDir }),
    plans: Array.isArray(value.plans)
      ? value.plans.map(parsePlanSummary).filter((item): item is AgentPlanSummaryProjection => item !== null)
      : [],
    selectedPlan: recordOrNull(value.selectedPlan ?? value.plan),
    selectedProjectTodo: recordOrNull(value.selectedProjectTodo ?? value.projectTodo)
  };
};

export const parseAgentGitProjection = (value: unknown): AgentGitProjection => {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.entries)) {
    throw new Error("Core returned an invalid Agent Git state.");
  }
  const branch = stringValue(value.branch);
  const message = stringValue(value.message);
  return {
    workingDir: requiredString(value.workingDir, "git.workingDir"),
    isRepository: value.isRepository === true,
    ...(branch === undefined ? {} : { branch }),
    ahead: Math.max(0, Math.floor(finiteNumber(value.ahead))),
    behind: Math.max(0, Math.floor(finiteNumber(value.behind))),
    updatedAt: requiredString(value.updatedAt, "git.updatedAt"),
    ...(message === undefined ? {} : { message }),
    summary: {
      changed: Math.max(0, Math.floor(finiteNumber(value.summary.changed))),
      staged: Math.max(0, Math.floor(finiteNumber(value.summary.staged))),
      unstaged: Math.max(0, Math.floor(finiteNumber(value.summary.unstaged))),
      untracked: Math.max(0, Math.floor(finiteNumber(value.summary.untracked))),
      conflicts: Math.max(0, Math.floor(finiteNumber(value.summary.conflicts)))
    },
    entries: value.entries.flatMap((item): readonly AgentGitEntryProjection[] => {
      if (!isRecord(item)) return [];
      const path = stringValue(item.path);
      if (path === undefined) return [];
      return [{
        path,
        status: stringValue(item.status) ?? "modified",
        staged: item.staged === true,
        unstaged: item.unstaged === true,
        untracked: item.untracked === true,
        conflicted: item.conflicted === true
      }];
    })
  };
};

export const parseAgentGitDiffProjection = (value: unknown): AgentGitDiffProjection => {
  if (!isRecord(value) || (value.scope !== "unstaged" && value.scope !== "staged")) {
    throw new Error("Core returned an invalid Agent Git diff.");
  }
  return {
    path: requiredString(value.path, "gitDiff.path"),
    scope: value.scope,
    diff: typeof value.diff === "string" ? value.diff : "",
    isBinary: value.isBinary === true
  };
};
