import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import {
  createFirstPartyAppModule,
  FirstPartyNestedAppSlot,
  LyraAppState,
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
    workingDir: "项目", messages: "消息",
    tools: "工具", todos: "任务", noMessages: "还没有消息", draft: "向 Agent 发送消息…",
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
    workingDir: "Project", messages: "Messages",
    tools: "Tools", todos: "Todos", noMessages: "No messages yet", draft: "Message the Agent…",
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
    <LyraAppState
      kind={onRetry === undefined ? "loading" : "error"}
      title={message}
      {...(onRetry === undefined ? {} : { actionLabel: copy.retry, onAction: onRetry })}
    />
  );
};

const PreviewFooter = () => {
  const { presentation } = useFirstPartySurfaceContext();
  return (
    <p className="lyra-app-module-muted" style={{ margin: "8px 12px 10px" }}>
      {labels(presentation.locale).basicPreview}
    </p>
  );
};

const AgentSessionSurface = ({
  host,
  instanceId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
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

  const create = () => void run(CORE.createSession, {});
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (session === null || text.length === 0 || busy) return;
    setDraft("");
    updateOpaqueState({ sessionId: session.id });
    void run(CORE.sendTurn, {
      sessionId: session.id,
      text
    });
  };

  if (error !== null && session === null) {
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (session === null) {
    return (
      <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}>
        <SurfaceState message={copy.unavailable} />
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={create}>{copy.create}</button>
        </div>
        <PreviewFooter />
      </section>
    );
  }

  return (
    <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }} aria-label={copy.create}>
      <header className="lyra-app-module-toolbar">
        <strong>{session.title}</strong>
        <span className="lyra-app-module-muted" style={{ flex: 1 }} />
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={busy} onClick={() => void refresh()}>{copy.refresh}</button>
        {session.turnStatus === "running" ? (
          <button
            className="lyra-ui-button lyra-ui-button-destructive lyra-ui-button-size-sm"
            disabled={busy}
            onClick={() => void run(CORE.cancelTurn, { sessionId: session.id })}
          >
            {copy.cancelTurn}
          </button>
        ) : null}
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", minHeight: 0, flex: 1 }}>
        <main style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 12, gap: 10 }}>
          <div className="lyra-app-module-muted">
            {copy.workingDir}: {session.workingDir || "—"} · {session.turnStatus}
          </div>
          <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {session.messages.length === 0 ? <SurfaceState message={copy.noMessages} /> : session.messages.map((message) => (
              <article key={message.id} className="lyra-app-module-card">
                <strong style={{ fontSize: 12 }}>{message.role}</strong>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{message.text}</p>
              </article>
            ))}
          </div>
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <textarea
              className="lyra-ui-textarea"
              aria-label={copy.draft}
              value={draft}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setDraft(next);
              }}
              placeholder={copy.draft}
              rows={3}
              style={{ flex: 1 }}
            />
            <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" type="submit" disabled={busy || draft.trim().length === 0}>
              {copy.send}
            </button>
          </form>
          {error === null ? null : <p role="alert" style={{ color: "var(--lyra-status-error)" }}>{error}</p>}
        </main>
        <aside className="lyra-app-module-aside" data-edge="end">
          <h2 style={{ fontSize: 14 }}>{copy.todos}</h2>
          {session.todos.map((todo) => (
            <p key={todo.id} style={{ margin: "7px 0" }}>
              <span className="lyra-app-module-muted">{todo.status}</span> {todo.content}
            </p>
          ))}
          <h2 style={{ fontSize: 14 }}>{copy.tools}</h2>
          {session.tools.slice(-20).map((tool) => (
            <p key={tool.id} style={{ margin: "7px 0" }}>
              <span className="lyra-app-module-muted">{tool.status}</span> {tool.label}
            </p>
          ))}
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
    <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }} aria-label={copy.history}>
      <header className="lyra-app-module-toolbar">
        <strong>{copy.history}</strong>
        <input
          className="lyra-ui-input"
          aria-label={copy.search}
          value={query}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setQuery(next);
          }}
          placeholder={copy.search}
        />
        {(["all", "saved", "archived"] as const).map((value) => (
          <button
            key={value}
            className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm"
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
              updateOpaqueState({ category: value, selectedSessionId: selected?.id ?? "" });
            }}
          >
            {copy[value]}
          </button>
        ))}
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void refresh()}>{copy.refresh}</button>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 34%) minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
        <aside className="lyra-app-module-aside">
          {filtered.length === 0 ? <SurfaceState message={error ?? copy.noSessions} /> : filtered.map((session) => (
            <article key={session.id} className="lyra-app-module-card" style={{ marginBottom: 8 }}>
              <button
                className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-module-nav"
                data-active={selected?.id === session.id ? "true" : undefined}
                disabled={busy}
                onClick={() => void select(session.id)}
              >
                <strong>{session.title}</strong>
                <div className="lyra-app-module-muted">{session.messageCount} {copy.messages} · {session.status}</div>
                <div className="lyra-app-module-muted">{session.workingDir ?? ""}</div>
              </button>
              <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                <button
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                  disabled={busy}
                  onClick={() => void mutate(CORE.saveHistorySession, {
                    sessionId: session.id,
                    saved: !session.saved
                  })}
                >
                  {session.saved ? copy.unsave : copy.save}
                </button>
                <button
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                  disabled={busy}
                  onClick={() => void mutate(CORE.archiveHistorySession, {
                    sessionId: session.id,
                    archived: !session.archived
                  })}
                >
                  {session.archived ? copy.unarchive : copy.archive}
                </button>
                <button
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
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
                  className="lyra-ui-button lyra-ui-button-destructive lyra-ui-button-size-sm"
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
              <p className="lyra-app-module-muted">{selected.workingDir} · {selected.turnStatus}</p>
              {selected.messages.map((message) => (
                <article key={message.id} className="lyra-app-module-card" style={{ marginBottom: 8 }}>
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
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (tree === null) {
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
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
    <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }} aria-label={copy.project}>
      <header className="lyra-app-module-toolbar">
        <strong>{tree.title}</strong>
        <span className="lyra-app-module-muted" style={{ flex: 1 }}>{tree.rootPath}</span>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void refresh()}>{copy.refresh}</button>
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
              className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-module-nav"
              data-active={selected === entry.path ? "true" : undefined}
              style={{ display: "flex", marginBottom: 6 }}
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
              <span className="lyra-app-module-muted" style={{ width: 90 }}>
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
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={error} onRetry={() => void run(CORE.readPlan, {})} /></section>;
  }
  if (plan === null) {
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
  }
  return (
    <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }} aria-label={copy.plan}>
      <header className="lyra-app-module-toolbar">
        <strong>{planTitle(plan) || copy.plan}</strong>
        <span className="lyra-app-module-muted" style={{ flex: 1 }}>{plan.mode}</span>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={busy} onClick={() => void run(CORE.refreshPlans, {})}>
          {copy.refresh}
        </button>
        {plan.selectedPlan === null ? null : (
          <button
            className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
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
          <aside className="lyra-app-module-aside">
            <h2 style={{ fontSize: 14 }}>{copy.plans}</h2>
            {plan.plans.length === 0 ? <SurfaceState message={copy.noPlans} /> : plan.plans.map((summary) => (
              <article key={summary.planId} className="lyra-app-module-card" style={{ marginBottom: 8 }}>
                <button
                  className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-module-nav"
                  data-active={plan.selectedPlan?.planId === summary.planId ? "true" : undefined}
                  disabled={busy}
                  onClick={() => void run(CORE.openPlan, { planId: summary.planId })}
                >
                  <strong>{summary.title}</strong>
                  <div className="lyra-app-module-muted">{summary.status}</div>
                </button>
                <button
                  className="lyra-ui-button lyra-ui-button-destructive lyra-ui-button-size-sm"
                  style={{ marginTop: 7 }}
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
                className="lyra-ui-textarea"
                value={markdown}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setMarkdown(next);
                }}
                rows={20}
                style={{ fontFamily: "var(--lyra-font-mono)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
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
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
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
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--lyra-font-mono)" }}>
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
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={error} onRetry={() => void refresh()} /></section>;
  }
  if (git === null) {
    return <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }}><SurfaceState message={copy.loading} /><PreviewFooter /></section>;
  }
  return (
    <section className="lyra-app-module" style={{ display: "flex", flexDirection: "column" }} aria-label={copy.git}>
      <header className="lyra-app-module-toolbar">
        <strong>{git.branch ?? copy.git}</strong>
        <span className="lyra-app-module-muted" style={{ flex: 1 }}>
          {git.summary.changed} {copy.changes} · ↑{git.ahead} ↓{git.behind}
        </span>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void refresh()}>{copy.refresh}</button>
      </header>
      {!git.isRepository ? <SurfaceState message={git.message ?? copy.notRepo} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          <aside className="lyra-app-module-aside">
            {git.entries.map((entry) => (
              <article key={entry.path} className="lyra-app-module-card" style={{ marginBottom: 7 }}>
                <button
                  className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-module-nav"
                  data-active={selectedPath === entry.path ? "true" : undefined}
                  onClick={() => void inspect(entry.path, entry.unstaged || entry.untracked ? "unstaged" : "staged")}
                >
                  {entry.status.slice(0, 1).toUpperCase()} · {entry.path}
                </button>
                <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                  {entry.unstaged || entry.untracked ? (
                    <button
                      className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                      disabled={busy}
                      onClick={() => void mutate(CORE.stageGitFile, entry.path)}
                    >
                      {copy.stage}
                    </button>
                  ) : null}
                  {entry.staged ? (
                    <button
                      className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                      disabled={busy}
                      onClick={() => void mutate(CORE.unstageGitFile, entry.path)}
                    >
                      {copy.unstage}
                    </button>
                  ) : null}
                  <button
                    className="lyra-ui-button lyra-ui-button-destructive lyra-ui-button-size-sm"
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
                <pre style={{ whiteSpace: "pre", overflow: "auto", fontFamily: "var(--lyra-font-mono)" }}>
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
      title: "Agent",
      description: "Work with a Lyra Agent session.",
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
