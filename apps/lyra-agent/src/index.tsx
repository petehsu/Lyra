import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";

import {
  createFirstPartyAppModule,
  FirstPartyNestedAppSlot,
  useFirstPartySurfaceContext,
  type FirstPartyNestedAppSlotProps,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import {
  isRecord,
  parseAgentGitDiffProjection,
  parseAgentGitProjection,
  parseAgentHistoryProjection,
  parseAgentPlanProjection,
  parseAgentProjectTreeProjection,
  parseAgentSessionProjection,
  type AgentGitDiffProjection,
  type AgentGitProjection,
  type AgentHistoryProjection,
  type AgentPlanProjection,
  type AgentProjectTreeProjection,
  type AgentSessionProjection
} from "./model";

type ModuleJsonValue = FirstPartySurfaceProps["opaqueState"];
type NestedAppDescriptor = Parameters<NonNullable<
  FirstPartyNestedAppSlotProps["onDescriptorChange"]
>>[0];

const CORE = {
  readSession: "lyra.core.agent.session.read",
  createSession: "lyra.core.agent.session.create",
  sendTurn: "lyra.core.agent.session.send-turn",
  cancelTurn: "lyra.core.agent.session.cancel-turn",
  setMode: "lyra.core.agent.session.set-mode",
  addOmaAgent: "lyra.core.agent.oma.add-agent",
  removeOmaAgent: "lyra.core.agent.oma.remove-agent",
  setOmaChannel: "lyra.core.agent.oma.set-channel",
  listHistory: "lyra.core.agent.history.list",
  readHistorySession: "lyra.core.agent.history.read-session",
  renameHistorySession: "lyra.core.agent.history.rename",
  saveHistorySession: "lyra.core.agent.history.save",
  archiveHistorySession: "lyra.core.agent.history.archive",
  deleteHistorySession: "lyra.core.agent.history.delete",
  readProjectTree: "lyra.core.agent.project-tree.read",
  toggleProjectDirectory: "lyra.core.agent.project-tree.toggle-directory",
  openProjectFile: "lyra.core.agent.project-tree.open-file",
  readPlan: "lyra.core.agent.plan.read",
  refreshPlans: "lyra.core.agent.plan.refresh",
  openPlan: "lyra.core.agent.plan.open",
  deletePlan: "lyra.core.agent.plan.delete",
  revisePlan: "lyra.core.agent.plan.revise",
  readGit: "lyra.core.agent.git.read",
  readGitDiff: "lyra.core.agent.git.read-diff",
  stageGitFile: "lyra.core.agent.git.stage",
  unstageGitFile: "lyra.core.agent.git.unstage",
  discardGitFile: "lyra.core.agent.git.discard"
} as const;

const labels = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    loading: "正在读取…", unavailable: "Agent 运行时不可用", retry: "重试",
    refresh: "刷新", create: "新建会话", send: "发送", cancelTurn: "停止",
    solo: "Solo", oma: "Oma（实验性）", workingDir: "项目", messages: "消息",
    tools: "工具", todos: "任务", noMessages: "还没有消息", draft: "向 Agent 发送消息…",
    agents: "成员", channels: "频道", add: "添加", remove: "移除",
    history: "会话历史", search: "搜索会话", all: "全部", saved: "已保存",
    archived: "已归档", archive: "归档", unarchive: "取消归档", save: "保存",
    unsave: "取消保存", rename: "重命名", delete: "删除", preview: "预览",
    noSessions: "没有匹配的会话", deleteSessionConfirm: "确定删除此会话？此操作无法撤销。",
    project: "项目", emptyProject: "项目目录为空", open: "打开", directory: "目录",
    plan: "计划", plans: "计划", noPlans: "没有计划", edit: "编辑", apply: "保存修订",
    discardEdit: "取消编辑", deletePlanConfirm: "确定删除此计划？此操作无法撤销。",
    git: "Git", changes: "更改", staged: "已暂存", unstaged: "未暂存",
    untracked: "未跟踪", conflicts: "冲突", stage: "暂存", unstage: "取消暂存",
    discard: "丢弃", discardConfirm: "确定丢弃这个文件的未提交更改？", selectFile: "选择文件查看差异",
    binary: "二进制差异不可显示", notRepo: "当前目录不是 Git 仓库",
    basicPreview: "这是独立 Agent 模块的 Preview 界面；完整生产界面仍由 Core 静态实现提供。"
  } : {
    loading: "Loading…", unavailable: "Agent runtime unavailable", retry: "Retry",
    refresh: "Refresh", create: "New session", send: "Send", cancelTurn: "Stop",
    solo: "Solo", oma: "Oma (Experimental)", workingDir: "Project", messages: "Messages",
    tools: "Tools", todos: "Todos", noMessages: "No messages yet", draft: "Message the Agent…",
    agents: "Members", channels: "Channels", add: "Add", remove: "Remove",
    history: "Session history", search: "Search sessions", all: "All", saved: "Saved",
    archived: "Archived", archive: "Archive", unarchive: "Unarchive", save: "Save",
    unsave: "Unsave", rename: "Rename", delete: "Delete", preview: "Preview",
    noSessions: "No matching sessions", deleteSessionConfirm: "Delete this session permanently?",
    project: "Project", emptyProject: "This project directory is empty", open: "Open", directory: "Directory",
    plan: "Plan", plans: "Plans", noPlans: "No plans", edit: "Edit", apply: "Save revision",
    discardEdit: "Cancel edit", deletePlanConfirm: "Delete this plan permanently?",
    git: "Git", changes: "Changes", staged: "Staged", unstaged: "Unstaged",
    untracked: "Untracked", conflicts: "Conflicts", stage: "Stage", unstage: "Unstage",
    discard: "Discard", discardConfirm: "Discard this file's uncommitted changes?", selectFile: "Select a file to inspect its diff",
    binary: "Binary diff cannot be displayed", notRepo: "This directory is not a Git repository",
    basicPreview: "This independent Agent module is in Preview; Core keeps the complete static production surface."
  };
};

const shellStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  color: "var(--lyra-text-primary, #202124)",
  background: "var(--lyra-surface-primary, #fff)",
  fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--lyra-border-subtle, #d5d8de)"
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 6,
  color: "inherit",
  background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 10px",
  cursor: "pointer"
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: "var(--lyra-danger, #b3261e)"
};

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 6,
  color: "inherit",
  background: "var(--lyra-surface-primary, #fff)",
  padding: "7px 9px"
};

const mutedStyle: CSSProperties = {
  color: "var(--lyra-text-secondary, #62666d)",
  fontSize: 12
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 8,
  padding: 10,
  background: "var(--lyra-surface-secondary, #f6f7f9)"
};

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const restoredString = (
  opaqueState: FirstPartySurfaceProps["opaqueState"],
  key: string
): string => isRecord(opaqueState) && typeof opaqueState[key] === "string"
  ? opaqueState[key]
  : "";

const withNestedEditorFile = (
  descriptor: NestedAppDescriptor,
  filePath: string
): NestedAppDescriptor => ({
  ...descriptor,
  opaqueState: {
    ...(isRecord(descriptor.opaqueState) ? descriptor.opaqueState : {}),
    filePath
  }
});

const SurfaceState = ({
  message,
  onRetry
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) => {
  const { presentation } = useFirstPartySurfaceContext();
  const copy = labels(presentation.locale);
  return (
    <div role={onRetry === undefined ? "status" : "alert"} style={{ margin: "auto", textAlign: "center" }}>
      <p>{message}</p>
      {onRetry === undefined ? null : (
        <button style={buttonStyle} onClick={onRetry}>{copy.retry}</button>
      )}
    </div>
  );
};

const PreviewFooter = () => {
  const { presentation } = useFirstPartySurfaceContext();
  return (
    <p style={{ ...mutedStyle, margin: "8px 12px 10px" }}>
      {labels(presentation.locale).basicPreview}
    </p>
  );
};

const AgentSessionSurface = ({
  host,
  instanceId,
  appId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const requestedMode = appId === "agent-oma" ? "oma" : "solo";
  const [session, setSession] = useState<AgentSessionProjection | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restoredSessionId = restoredString(opaqueState, "sessionId");

  const accept = useCallback((value: unknown) => {
    const next = parseAgentSessionProjection(value);
    setSession(next);
    if (next !== null) {
      updateOpaqueState({ sessionId: next.id });
    }
    setError(null);
    return next;
  }, [updateOpaqueState]);

  const refresh = useCallback(async () => {
    try {
      accept(await host.executeCommand(CORE.readSession, {
        instanceId,
        ...(session?.id === undefined && restoredSessionId.length === 0
          ? {}
          : { sessionId: session?.id ?? restoredSessionId })
      }));
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, [accept, host, instanceId, restoredSessionId, session?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (session?.turnStatus !== "running") return undefined;
    const timer = window.setInterval(() => void refresh(), 1_200);
    return () => window.clearInterval(timer);
  }, [refresh, session?.turnStatus]);

  const run = async (command: string, input: Record<string, ModuleJsonValue>) => {
    setBusy(true);
    try {
      accept(await host.executeCommand(command, input));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = () => void run(CORE.createSession, { mode: requestedMode });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (session === null || text.length === 0 || busy) return;
    setDraft("");
    updateOpaqueState({ sessionId: session.id });
    void run(CORE.sendTurn, {
      sessionId: session.id,
      text,
      ...(session.oma?.activeChannelId ? { channelId: session.oma.activeChannelId } : {})
    });
  };

  if (error !== null && session === null) {
    return <section style={shellStyle}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (session === null) {
    return (
      <section style={shellStyle}>
        <SurfaceState message={copy.unavailable} />
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <button style={buttonStyle} onClick={create}>{copy.create}</button>
        </div>
        <PreviewFooter />
      </section>
    );
  }

  return (
    <section style={shellStyle} aria-label={requestedMode === "oma" ? copy.oma : copy.solo}>
      <header style={toolbarStyle}>
        <strong>{session.agentMode === "oma" ? copy.oma : copy.solo}</strong>
        <span style={{ ...mutedStyle, flex: 1 }}>{session.title}</span>
        <button style={buttonStyle} disabled={busy} onClick={() => void refresh()}>{copy.refresh}</button>
        <button
          style={buttonStyle}
          disabled={busy}
          onClick={() => void run(CORE.setMode, {
            sessionId: session.id,
            mode: session.agentMode === "oma" ? "solo" : "oma"
          })}
        >
          {session.agentMode === "oma" ? copy.solo : copy.oma}
        </button>
        {session.turnStatus === "running" ? (
          <button
            style={dangerButtonStyle}
            disabled={busy}
            onClick={() => void run(CORE.cancelTurn, { sessionId: session.id })}
          >
            {copy.cancelTurn}
          </button>
        ) : null}
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", minHeight: 0, flex: 1 }}>
        <main style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 12, gap: 10 }}>
          <div style={{ ...mutedStyle }}>
            {copy.workingDir}: {session.workingDir || "—"} · {session.turnStatus}
          </div>
          <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {session.messages.length === 0 ? <SurfaceState message={copy.noMessages} /> : session.messages.map((message) => (
              <article key={message.id} style={cardStyle}>
                <strong style={{ fontSize: 12 }}>{message.role}</strong>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{message.text}</p>
              </article>
            ))}
          </div>
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <textarea
              aria-label={copy.draft}
              value={draft}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setDraft(next);
              }}
              placeholder={copy.draft}
              rows={3}
              style={{ ...fieldStyle, flex: 1, resize: "vertical" }}
            />
            <button style={buttonStyle} type="submit" disabled={busy || draft.trim().length === 0}>
              {copy.send}
            </button>
          </form>
          {error === null ? null : <p role="alert" style={{ color: "var(--lyra-danger, #b3261e)" }}>{error}</p>}
        </main>
        <aside style={{ borderLeft: "1px solid var(--lyra-border-subtle, #d5d8de)", overflow: "auto", padding: 12 }}>
          <h2 style={{ fontSize: 14 }}>{copy.todos}</h2>
          {session.todos.map((todo) => (
            <p key={todo.id} style={{ margin: "7px 0" }}>
              <span style={mutedStyle}>{todo.status}</span> {todo.content}
            </p>
          ))}
          <h2 style={{ fontSize: 14 }}>{copy.tools}</h2>
          {session.tools.slice(-20).map((tool) => (
            <p key={tool.id} style={{ margin: "7px 0" }}>
              <span style={mutedStyle}>{tool.status}</span> {tool.label}
            </p>
          ))}
          {session.oma === null ? null : (
            <>
              <h2 style={{ fontSize: 14 }}>{copy.channels}</h2>
              {session.oma.channels.filter((channel) => !channel.archived).map((channel) => (
                <button
                  key={channel.id}
                  style={{ ...buttonStyle, width: "100%", marginBottom: 5, textAlign: "left" }}
                  onClick={() => void run(CORE.setOmaChannel, {
                    sessionId: session.id,
                    channelId: channel.id
                  })}
                >
                  {channel.id === session.oma?.activeChannelId ? "● " : ""}{channel.name}
                </button>
              ))}
              <h2 style={{ fontSize: 14 }}>{copy.agents}</h2>
              {session.oma.agents.map((agent) => (
                <div key={agent.sessionAgentId} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ flex: 1 }}>{agent.name}</span>
                  <button
                    style={dangerButtonStyle}
                    disabled={busy}
                    onClick={() => void run(CORE.removeOmaAgent, {
                      sessionId: session.id,
                      agentId: agent.agentId
                    })}
                  >
                    {copy.remove}
                  </button>
                </div>
              ))}
              {session.oma.availableAgents
                .filter((candidate) => !session.oma?.agents.some((agent) => agent.agentId === candidate.agentId))
                .map((agent) => (
                  <div key={agent.agentId} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ flex: 1 }}>{agent.name}</span>
                    <button
                      style={buttonStyle}
                      disabled={busy}
                      onClick={() => void run(CORE.addOmaAgent, {
                        sessionId: session.id,
                        agentId: agent.agentId
                      })}
                    >
                      {copy.add}
                    </button>
                  </div>
                ))}
            </>
          )}
        </aside>
      </div>
      <PreviewFooter />
    </section>
  );
};

const AgentHistorySurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const [history, setHistory] = useState<AgentHistoryProjection | null>(null);
  const [selected, setSelected] = useState<AgentSessionProjection | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState(
    () => restoredString(opaqueState, "selectedSessionId")
  );
  const restoredSelectionAttemptRef = useRef(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "saved" | "archived">(() => {
    const restored = restoredString(opaqueState, "category");
    return restored === "saved" || restored === "archived" ? restored : "all";
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setHistory(parseAgentHistoryProjection(
        await host.executeCommand(CORE.listHistory, { limit: 500 })
      ));
      setError(null);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, [host]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = async (sessionId: string) => {
    setBusy(true);
    try {
      setSelected(parseAgentSessionProjection(
        await host.executeCommand(CORE.readHistorySession, { sessionId })
      ));
      setSelectedSessionId(sessionId);
      updateOpaqueState({ category, selectedSessionId: sessionId });
      setError(null);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (
      restoredSelectionAttemptRef.current
      || history === null
      || selected !== null
      || selectedSessionId.length === 0
    ) return;
    if (!history.sessions.some((session) => session.id === selectedSessionId)) return;
    restoredSelectionAttemptRef.current = true;
    void select(selectedSessionId);
  }, [history, selected, selectedSessionId]);

  const mutate = async (command: string, input: Record<string, ModuleJsonValue>) => {
    setBusy(true);
    try {
      await host.executeCommand(command, input);
      await refresh();
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (history?.sessions ?? []).filter((session) => {
      if (category === "saved" && !session.saved) return false;
      if (category === "archived" && !session.archived) return false;
      return needle.length === 0
        || session.title.toLowerCase().includes(needle)
        || session.workingDir?.toLowerCase().includes(needle) === true;
    });
  }, [category, history?.sessions, query]);

  return (
    <section style={shellStyle} aria-label={copy.history}>
      <header style={toolbarStyle}>
        <strong>{copy.history}</strong>
        <input
          aria-label={copy.search}
          value={query}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setQuery(next);
          }}
          placeholder={copy.search}
          style={{ ...fieldStyle, flex: 1 }}
        />
        {(["all", "saved", "archived"] as const).map((value) => (
          <button
            key={value}
            style={{ ...buttonStyle, fontWeight: category === value ? 700 : 400 }}
            onClick={() => {
              setCategory(value);
              updateOpaqueState({ category: value, selectedSessionId: selected?.id ?? "" });
            }}
          >
            {copy[value]}
          </button>
        ))}
        <button style={buttonStyle} onClick={() => void refresh()}>{copy.refresh}</button>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 34%) minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
        <aside style={{ overflow: "auto", borderRight: "1px solid var(--lyra-border-subtle, #d5d8de)", padding: 10 }}>
          {filtered.length === 0 ? <SurfaceState message={error ?? copy.noSessions} /> : filtered.map((session) => (
            <article key={session.id} style={{ ...cardStyle, marginBottom: 8 }}>
              <button
                style={{ border: 0, background: "transparent", color: "inherit", textAlign: "left", width: "100%", cursor: "pointer" }}
                disabled={busy}
                onClick={() => void select(session.id)}
              >
                <strong>{session.title}</strong>
                <div style={mutedStyle}>{session.messageCount} {copy.messages} · {session.status}</div>
                <div style={mutedStyle}>{session.workingDir ?? ""}</div>
              </button>
              <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                <button
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => void mutate(CORE.saveHistorySession, {
                    sessionId: session.id,
                    saved: !session.saved
                  })}
                >
                  {session.saved ? copy.unsave : copy.save}
                </button>
                <button
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => void mutate(CORE.archiveHistorySession, {
                    sessionId: session.id,
                    archived: !session.archived
                  })}
                >
                  {session.archived ? copy.unarchive : copy.archive}
                </button>
                <button
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => {
                    const title = window.prompt(copy.rename, session.title);
                    if (title !== null) {
                      void mutate(CORE.renameHistorySession, { sessionId: session.id, title });
                    }
                  }}
                >
                  {copy.rename}
                </button>
                <button
                  style={dangerButtonStyle}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(copy.deleteSessionConfirm)) {
                      setSelected((current) => current?.id === session.id ? null : current);
                      setSelectedSessionId((current) => current === session.id ? "" : current);
                      void mutate(CORE.deleteHistorySession, { sessionId: session.id });
                    }
                  }}
                >
                  {copy.delete}
                </button>
              </div>
            </article>
          ))}
        </aside>
        <main style={{ overflow: "auto", padding: 12 }}>
          {selected === null ? <SurfaceState message={copy.preview} /> : (
            <>
              <h1 style={{ fontSize: 18 }}>{selected.title}</h1>
              <p style={mutedStyle}>{selected.workingDir} · {selected.turnStatus}</p>
              {selected.messages.map((message) => (
                <article key={message.id} style={{ ...cardStyle, marginBottom: 8 }}>
                  <strong style={{ fontSize: 12 }}>{message.role}</strong>
                  <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{message.text}</p>
                </article>
              ))}
            </>
          )}
          {error === null ? null : <p role="alert">{error}</p>}
        </main>
      </div>
      <PreviewFooter />
    </section>
  );
};

const AgentProjectTreeSurface = ({
  host,
  instanceId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const [tree, setTree] = useState<AgentProjectTreeProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(() => restoredString(opaqueState, "selectedPath"));
  const restoredEditorChild = useMemo(() => {
    if (!isRecord(opaqueState) || !isRecord(opaqueState.editorChild)) return null;
    const child = opaqueState.editorChild;
    if (
      child.schemaVersion !== 2
      || child.appId !== "file-editor"
      || typeof child.appVersion !== "string"
      || typeof child.instanceId !== "string"
      || typeof child.route !== "string"
      || !("opaqueState" in child)
    ) {
      return null;
    }
    return child as NestedAppDescriptor;
  }, [opaqueState]);

  const refresh = useCallback(async () => {
    try {
      const next = parseAgentProjectTreeProjection(
        await host.executeCommand(CORE.readProjectTree, { instanceId })
      );
      setTree(next);
      if (next !== null) {
        setSelected(next.selectedPath ?? next.selectedFilePath ?? "");
      }
      setError(null);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, [host, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error !== null && tree === null) {
    return <section style={shellStyle}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (tree === null) {
    return <section style={shellStyle}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
  }
  const editorChild: FirstPartyNestedAppSlotProps["child"] | null =
    tree.selectedFilePath !== null && tree.editorInstanceId !== null
    ? (
        restoredEditorChild !== null
        && restoredEditorChild.instanceId === tree.editorInstanceId
        ? restoredEditorChild
        : {
            appId: "file-editor",
            instanceId: tree.editorInstanceId,
            route: "/"
          }
      )
    : null;
  const persistEditorChild = (descriptor: NestedAppDescriptor): void => {
    updateOpaqueState({
      selectedPath: tree.selectedPath ?? tree.selectedFilePath ?? selected,
      editorChild: tree.selectedFilePath === null
        ? descriptor
        : withNestedEditorFile(descriptor, tree.selectedFilePath)
    });
  };
  return (
    <section style={shellStyle} aria-label={copy.project}>
      <header style={toolbarStyle}>
        <strong>{tree.title}</strong>
        <span style={{ ...mutedStyle, flex: 1 }}>{tree.rootPath}</span>
        <button style={buttonStyle} onClick={() => void refresh()}>{copy.refresh}</button>
      </header>
      <main style={{
        display: "grid",
        gridTemplateColumns: editorChild === null ? "1fr" : "minmax(220px, 32%) minmax(0, 1fr)",
        minHeight: 0,
        flex: 1
      }}>
        <div style={{ overflow: "auto", padding: 12 }}>
          {tree.entries.length === 0 ? <SurfaceState message={copy.emptyProject} /> : tree.entries.map((entry) => (
            <button
              key={entry.id}
              style={{
                ...buttonStyle,
                display: "flex",
                width: "100%",
                marginBottom: 6,
                textAlign: "left",
                fontWeight: selected === entry.path ? 700 : 400
              }}
              onClick={() => {
                setSelected(entry.path);
                if (entry.kind === "directory") {
                  void host.executeCommand(CORE.toggleProjectDirectory, {
                    instanceId,
                    path: entry.path
                  }).then((value) => {
                    const next = parseAgentProjectTreeProjection(value);
                    setTree(next);
                    if (next !== null) {
                      updateOpaqueState({
                        selectedPath: next.selectedPath ?? next.selectedFilePath ?? entry.path,
                        ...(restoredEditorChild === null ? {} : {
                          editorChild: next.selectedFilePath === null
                            ? restoredEditorChild
                            : withNestedEditorFile(restoredEditorChild, next.selectedFilePath)
                        })
                      });
                    }
                  }).catch((cause: unknown) => setError(toMessage(cause)));
                } else {
                  void host.executeCommand(CORE.openProjectFile, {
                    instanceId,
                    path: entry.path
                  }).then((value) => {
                    const next = parseAgentProjectTreeProjection(value);
                    setTree(next);
                    if (next !== null) {
                      setSelected(next.selectedPath ?? entry.path);
                      updateOpaqueState({
                        selectedPath: next.selectedPath ?? entry.path,
                        ...(
                          restoredEditorChild === null
                          || restoredEditorChild.instanceId !== next.editorInstanceId
                            ? {}
                            : {
                                editorChild: next.selectedFilePath === null
                                  ? restoredEditorChild
                                  : withNestedEditorFile(
                                      restoredEditorChild,
                                      next.selectedFilePath
                                    )
                              }
                        )
                      });
                    }
                  }).catch((cause: unknown) => setError(toMessage(cause)));
                }
              }}
            >
              <span style={{ width: 90, ...mutedStyle }}>
                {entry.kind === "directory" ? copy.directory : copy.open}
              </span>
              <span>{entry.name}</span>
            </button>
          ))}
          {error === null ? null : <p role="alert">{error}</p>}
        </div>
        {editorChild === null ? null : (
          <FirstPartyNestedAppSlot
            slotId="project-editor"
            child={editorChild}
            onDescriptorChange={persistEditorChild}
            style={{ minHeight: 0, overflow: "hidden" }}
          />
        )}
      </main>
      <PreviewFooter />
    </section>
  );
};

const planMarkdown = (plan: AgentPlanProjection | null): string => {
  const value = plan?.selectedPlan?.markdown;
  return typeof value === "string" ? value : "";
};

const planTitle = (plan: AgentPlanProjection | null): string => {
  const value = plan?.selectedPlan?.title;
  return typeof value === "string" && value.length > 0 ? value : plan?.title ?? "";
};

const AgentPlanSurface = ({
  host,
  instanceId,
  presentation
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const [plan, setPlan] = useState<AgentPlanProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);

  const accept = useCallback((value: unknown) => {
    const next = parseAgentPlanProjection(value);
    setPlan(next);
    if (next !== null && !editing) setMarkdown(planMarkdown(next));
    setError(null);
    return next;
  }, [editing]);

  const run = useCallback(async (
    command: string,
    input: Record<string, ModuleJsonValue>
  ) => {
    setBusy(true);
    try {
      accept(await host.executeCommand(command, { instanceId, ...input }));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [accept, host, instanceId]);

  useEffect(() => {
    void run(CORE.readPlan, {});
  }, [run]);

  if (plan === null && error !== null) {
    return <section style={shellStyle}><SurfaceState message={error} onRetry={() => void run(CORE.readPlan, {})} /></section>;
  }
  if (plan === null) {
    return <section style={shellStyle}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
  }
  return (
    <section style={shellStyle} aria-label={copy.plan}>
      <header style={toolbarStyle}>
        <strong>{planTitle(plan) || copy.plan}</strong>
        <span style={{ ...mutedStyle, flex: 1 }}>{plan.mode}</span>
        <button style={buttonStyle} disabled={busy} onClick={() => void run(CORE.refreshPlans, {})}>
          {copy.refresh}
        </button>
        {plan.selectedPlan === null ? null : (
          <button
            style={buttonStyle}
            disabled={busy}
            onClick={() => {
              setMarkdown(planMarkdown(plan));
              setEditing(true);
            }}
          >
            {copy.edit}
          </button>
        )}
      </header>
      <div style={{ display: "grid", gridTemplateColumns: plan.mode === "manager" ? "300px minmax(0, 1fr)" : "1fr", minHeight: 0, flex: 1 }}>
        {plan.mode === "manager" ? (
          <aside style={{ overflow: "auto", padding: 10, borderRight: "1px solid var(--lyra-border-subtle, #d5d8de)" }}>
            <h2 style={{ fontSize: 14 }}>{copy.plans}</h2>
            {plan.plans.length === 0 ? <SurfaceState message={copy.noPlans} /> : plan.plans.map((summary) => (
              <article key={summary.planId} style={{ ...cardStyle, marginBottom: 8 }}>
                <button
                  style={{ border: 0, background: "transparent", color: "inherit", textAlign: "left", width: "100%", cursor: "pointer" }}
                  disabled={busy}
                  onClick={() => void run(CORE.openPlan, { planId: summary.planId })}
                >
                  <strong>{summary.title}</strong>
                  <div style={mutedStyle}>{summary.status}</div>
                </button>
                <button
                  style={{ ...dangerButtonStyle, marginTop: 7 }}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(copy.deletePlanConfirm)) {
                      void run(CORE.deletePlan, { planId: summary.planId });
                    }
                  }}
                >
                  {copy.delete}
                </button>
              </article>
            ))}
          </aside>
        ) : null}
        <main style={{ overflow: "auto", padding: 12 }}>
          {editing ? (
            <>
              <textarea
                value={markdown}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setMarkdown(next);
                }}
                rows={20}
                style={{ ...fieldStyle, width: "100%", fontFamily: "var(--lyra-font-mono, monospace)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  style={buttonStyle}
                  disabled={busy || markdown.trim().length === 0}
                  onClick={() => {
                    void run(CORE.revisePlan, { markdown }).then(() => {
                      setEditing(false);
                    });
                  }}
                >
                  {copy.apply}
                </button>
                <button
                  style={buttonStyle}
                  onClick={() => {
                    setEditing(false);
                    setMarkdown(planMarkdown(plan));
                  }}
                >
                  {copy.discardEdit}
                </button>
              </div>
            </>
          ) : plan.selectedPlan === null ? (
            <SurfaceState message={copy.noPlans} />
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--lyra-font-mono, monospace)" }}>
              {planMarkdown(plan)}
            </pre>
          )}
          {error === null && plan.error === null ? null : <p role="alert">{error ?? plan.error}</p>}
        </main>
      </div>
      <PreviewFooter />
    </section>
  );
};

const AgentGitSurface = ({
  host,
  instanceId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const [git, setGit] = useState<AgentGitProjection | null>(null);
  const [diff, setDiff] = useState<AgentGitDiffProjection | null>(null);
  const [selectedPath, setSelectedPath] = useState(() => restoredString(opaqueState, "selectedPath"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = useCallback((value: unknown) => {
    setGit(parseAgentGitProjection(value));
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await host.executeCommand(CORE.readGit, { instanceId }));
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, [accept, host, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inspect = async (path: string, scope: "staged" | "unstaged") => {
    setBusy(true);
    try {
      setDiff(parseAgentGitDiffProjection(
        await host.executeCommand(CORE.readGitDiff, { instanceId, path, scope })
      ));
      setSelectedPath(path);
      updateOpaqueState({ selectedPath: path });
      setError(null);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (command: string, path: string) => {
    setBusy(true);
    try {
      accept(await host.executeCommand(command, { instanceId, path }));
      setDiff(null);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (git === null && error !== null) {
    return <section style={shellStyle}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (git === null) {
    return <section style={shellStyle}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
  }
  return (
    <section style={shellStyle} aria-label={copy.git}>
      <header style={toolbarStyle}>
        <strong>{git.branch ?? copy.git}</strong>
        <span style={{ ...mutedStyle, flex: 1 }}>
          {git.summary.changed} {copy.changes} · ↑{git.ahead} ↓{git.behind}
        </span>
        <button style={buttonStyle} onClick={() => void refresh()}>{copy.refresh}</button>
      </header>
      {!git.isRepository ? <SurfaceState message={git.message ?? copy.notRepo} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          <aside style={{ overflow: "auto", padding: 10, borderRight: "1px solid var(--lyra-border-subtle, #d5d8de)" }}>
            {git.entries.map((entry) => (
              <article key={entry.path} style={{ ...cardStyle, marginBottom: 7 }}>
                <button
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    textAlign: "left",
                    width: "100%",
                    cursor: "pointer",
                    fontWeight: selectedPath === entry.path ? 700 : 400
                  }}
                  onClick={() => void inspect(entry.path, entry.unstaged || entry.untracked ? "unstaged" : "staged")}
                >
                  {entry.status.slice(0, 1).toUpperCase()} · {entry.path}
                </button>
                <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                  {entry.unstaged || entry.untracked ? (
                    <button
                      style={buttonStyle}
                      disabled={busy}
                      onClick={() => void mutate(CORE.stageGitFile, entry.path)}
                    >
                      {copy.stage}
                    </button>
                  ) : null}
                  {entry.staged ? (
                    <button
                      style={buttonStyle}
                      disabled={busy}
                      onClick={() => void mutate(CORE.unstageGitFile, entry.path)}
                    >
                      {copy.unstage}
                    </button>
                  ) : null}
                  <button
                    style={dangerButtonStyle}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(copy.discardConfirm)) {
                        void mutate(CORE.discardGitFile, entry.path);
                      }
                    }}
                  >
                    {copy.discard}
                  </button>
                </div>
              </article>
            ))}
          </aside>
          <main style={{ overflow: "auto", padding: 12 }}>
            {diff === null ? <SurfaceState message={copy.selectFile} /> : diff.isBinary ? (
              <SurfaceState message={copy.binary} />
            ) : (
              <>
                <h2 style={{ fontSize: 14 }}>{diff.path} · {diff.scope}</h2>
                <pre style={{ whiteSpace: "pre", overflow: "auto", fontFamily: "var(--lyra-font-mono, monospace)" }}>
                  {diff.diff}
                </pre>
              </>
            )}
            {error === null ? null : <p role="alert">{error}</p>}
          </main>
        </div>
      )}
      <PreviewFooter />
    </section>
  );
};

const contributions = {
  commands: [
    { id: "lyra.agent.refresh", title: "Refresh Agent surface", requiredCapability: "agent:read" },
    { id: "lyra.agent.new-session", title: "Create Agent session", requiredCapability: "agent:write" },
    { id: "lyra.agent.open-session", title: "Read Agent session", requiredCapability: "agent:read" },
    { id: "lyra.agent.refresh-plans", title: "Refresh Agent plans", requiredCapability: "agent:read" },
    { id: "lyra.agent.refresh-git", title: "Refresh Agent Git", requiredCapability: "agent:git" }
  ],
  status: [
    { id: "lyra.agent.runtime-status", title: "Agent runtime status" }
  ]
} as const;

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.agent",
  version: __LYRA_APP_VERSION__,
  surfaces: {
    "agent-solo": {
      title: "Solo",
      description: "Work with a single Lyra Agent session.",
      component: AgentSessionSurface
    },
    "agent-oma": {
      title: "Oma",
      description: "Experimental multi-agent workspace.",
      component: AgentSessionSurface
    },
    "agent-project-tree": {
      title: "Project",
      description: "Inspect and edit the Agent project tree.",
      component: AgentProjectTreeSurface
    },
    "agent-plan-board": {
      title: "Plan",
      description: "Review and update the active Agent plan.",
      component: AgentPlanSurface
    },
    "agent-git": {
      title: "Git",
      description: "Review repository status and changes.",
      component: AgentGitSurface
    },
    "agent-session-history": {
      title: "History",
      description: "Browse Agent and browser session history.",
      component: AgentHistorySurface
    }
  },
  contributions,
  commandHandlers: {
    "lyra.agent.refresh": (host, input) => host.executeCommand(CORE.readSession, input),
    "lyra.agent.new-session": (host, input) => host.executeCommand(CORE.createSession, input),
    "lyra.agent.open-session": (host, input) => host.executeCommand(CORE.readHistorySession, input),
    "lyra.agent.refresh-plans": (host, input) => host.executeCommand(CORE.refreshPlans, input),
    "lyra.agent.refresh-git": (host, input) => host.executeCommand(CORE.readGit, input)
  }
});

export default lyraAppModule;
