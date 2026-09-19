import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

import {
  createFirstPartyAppModule,
  LyraAppState,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.downloads.read",
  enqueue: "lyra.core.downloads.enqueue",
  pause: "lyra.core.downloads.pause",
  resume: "lyra.core.downloads.resume",
  cancel: "lyra.core.downloads.cancel",
  retry: "lyra.core.downloads.retry",
  remove: "lyra.core.downloads.remove",
  pauseAll: "lyra.core.downloads.pause-all",
  resumeAll: "lyra.core.downloads.resume-all",
  cancelAll: "lyra.core.downloads.cancel-all",
  openFile: "lyra.core.downloads.open-file",
  revealFile: "lyra.core.downloads.reveal-file"
} as const;
const DOWNLOADS_CHANGED_EVENT = "lyra.core.downloads-changed";

export type DownloadTaskState =
  | "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";

export type DownloadTask = {
  readonly id: string;
  readonly url: string;
  readonly fileName: string;
  readonly savePath: string;
  readonly state: DownloadTaskState;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
  readonly canResume: boolean;
  readonly errorMessage?: string;
};

export type DownloadsSnapshot = {
  readonly tasks: readonly DownloadTask[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const finiteNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

export const parseDownloadsSnapshot = (value: unknown): DownloadsSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new Error("Core returned an invalid download snapshot.");
  }
  const tasks = value.tasks.flatMap((entry): readonly DownloadTask[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const url = stringValue(entry.url);
    const fileName = stringValue(entry.fileName);
    const savePath = stringValue(entry.savePath);
    const state = entry.state;
    if (
      id === undefined || url === undefined || fileName === undefined || savePath === undefined
      || (state !== "queued" && state !== "downloading" && state !== "paused"
        && state !== "completed" && state !== "failed" && state !== "canceled")
    ) return [];
    const errorMessage = stringValue(entry.errorMessage);
    return [{
      id, url, fileName, savePath, state,
      receivedBytes: finiteNumber(entry.receivedBytes),
      totalBytes: finiteNumber(entry.totalBytes),
      speedBytesPerSecond: finiteNumber(entry.speedBytesPerSecond),
      canResume: entry.canResume === true,
      ...(errorMessage === undefined ? {} : { errorMessage })
    }];
  });
  return { tasks };
};

const text = (locale: string) => {
  const zh = locale.toLowerCase().startsWith("zh");
  return zh ? {
    title: "下载", add: "添加下载", url: "输入下载地址", refresh: "刷新",
    pauseAll: "全部暂停", resumeAll: "全部继续", cancelAll: "全部取消",
    pause: "暂停", resume: "继续", cancel: "取消", retry: "重试", remove: "移除",
    open: "打开", reveal: "在文件夹中显示", loading: "正在读取下载任务…",
    empty: "暂无下载任务", retryLoad: "重试", selected: "已选择",
    states: {
      queued: "排队中", downloading: "下载中", paused: "已暂停",
      completed: "已完成", failed: "失败", canceled: "已取消"
    }
  } : {
    title: "Downloads", add: "Add download", url: "Enter a download URL", refresh: "Refresh",
    pauseAll: "Pause all", resumeAll: "Resume all", cancelAll: "Cancel all",
    pause: "Pause", resume: "Resume", cancel: "Cancel", retry: "Retry", remove: "Remove",
    open: "Open", reveal: "Show in folder", loading: "Loading downloads…",
    empty: "No downloads", retryLoad: "Retry", selected: "Selected",
    states: {
      queued: "Queued", downloading: "Downloading", paused: "Paused",
      completed: "Completed", failed: "Failed", canceled: "Canceled"
    }
  };
};

const formatBytes = (value: number): string => {
  if (value < 1024) return `${Math.floor(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
};
const progress = (task: DownloadTask): number =>
  task.totalBytes > 0 ? Math.max(0, Math.min(1, task.receivedBytes / task.totalBytes)) : 0;
const DownloadsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = text(presentation.locale);
  const restoredSelection = isRecord(opaqueState)
    ? stringValue(opaqueState.selectedTaskId)
    : undefined;
  const restoredDraft = isRecord(opaqueState) && typeof opaqueState.urlDraft === "string"
    ? opaqueState.urlDraft
    : "";
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(restoredSelection ?? null);
  const [urlDraft, setUrlDraft] = useState(restoredDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = parseDownloadsSnapshot(await host.executeCommand(COMMANDS.read, {}));
      setSnapshot(next);
      setSelectedTaskId((current) =>
        current !== null && next.tasks.some((task) => task.id === current)
          ? current
          : next.tasks[0]?.id ?? null
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    updateOpaqueState({
      ...(selectedTaskId === null ? {} : { selectedTaskId }),
      urlDraft
    });
  }, [selectedTaskId, updateOpaqueState, urlDraft]);
  useEffect(() => {
    try {
      const subscription = host.subscribeEvent(DOWNLOADS_CHANGED_EVENT, async () => refresh());
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);

  const selected = useMemo(
    () => snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, snapshot]
  );
  const run = useCallback(async (command: string, input: Record<string, string> = {}) => {
    setBusy(command);
    try {
      await host.executeCommand(command, input);
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [host, refresh]);
  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const textValue = urlDraft.trim();
    if (textValue.length === 0) return;
    await run(COMMANDS.enqueue, { text: textValue });
    setUrlDraft("");
  }, [run, urlDraft]);

  const hasActive = snapshot?.tasks.some(
    (task) => task.state === "queued" || task.state === "downloading"
  ) === true;
  const hasPaused = snapshot?.tasks.some((task) => task.state === "paused") === true;

  return (
    <section
      className="lyra-app-module"
      data-lyra-component="lyra.downloads"
      aria-label="downloads-surface"
      style={{ display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)" }}
    >
      <header className="lyra-app-module-toolbar">
        <strong>{labels.title}</strong>
        <span className="lyra-app-module-muted">{snapshot?.tasks.length ?? 0}</span>
        <span style={{ flex: 1 }} />
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={!hasActive || busy !== null} onClick={() => void run(COMMANDS.pauseAll)}>{labels.pauseAll}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={!hasPaused || busy !== null} onClick={() => void run(COMMANDS.resumeAll)}>{labels.resumeAll}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={!hasActive || busy !== null} onClick={() => void run(COMMANDS.cancelAll)}>{labels.cancelAll}</button>
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void refresh()}>{labels.refresh}</button>
      </header>
      <form
        onSubmit={(event) => void submit(event)}
        className="lyra-app-module-toolbar"
      >
        <input
          className="lyra-ui-input"
          aria-label={labels.url}
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          placeholder={labels.url}
        />
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={urlDraft.trim().length === 0 || busy !== null}>{labels.add}</button>
      </form>
      {error !== null ? (
        <LyraAppState
          kind="error"
          title={error}
          actionLabel={labels.retryLoad}
          onAction={() => void refresh()}
        />
      ) : snapshot === null ? (
        <LyraAppState kind="loading" title={labels.loading} />
      ) : snapshot.tasks.length === 0 ? (
        <LyraAppState kind="empty" title={labels.empty} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 40%) minmax(0, 1fr)", minHeight: 0 }}>
          <nav className="lyra-app-module-aside" aria-label={labels.title}>
            {snapshot.tasks.map((task) => {
              const ratio = progress(task);
              return (
                <button
                  key={task.id}
                  className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-module-nav"
                  data-active={task.id === selectedTaskId ? "true" : undefined}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.fileName}</strong>
                  <small className="lyra-app-module-muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                    <span>{labels.states[task.state]}</span>
                    <span>{task.totalBytes > 0 ? `${Math.round(ratio * 100)}%` : formatBytes(task.receivedBytes)}</span>
                  </small>
                  <i className="lyra-app-module-meter" aria-hidden="true">
                    <i style={{ width: `${ratio * 100}%` }} />
                  </i>
                </button>
              );
            })}
          </nav>
          {selected === null ? null : (
            <article style={{ overflow: "auto", padding: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selected.fileName}</h2>
              <p className="lyra-app-module-muted" style={{ wordBreak: "break-all" }}>{selected.url}</p>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "7px 12px", fontSize: 13 }}>
                <dt>{labels.states[selected.state]}</dt>
                <dd style={{ margin: 0 }}>{formatBytes(selected.receivedBytes)} / {selected.totalBytes > 0 ? formatBytes(selected.totalBytes) : "—"}</dd>
                <dt>{selected.speedBytesPerSecond > 0 ? `${formatBytes(selected.speedBytesPerSecond)}/s` : "—"}</dt>
                <dd style={{ margin: 0, wordBreak: "break-all" }}>{selected.savePath}</dd>
              </dl>
              {selected.errorMessage === undefined ? null : <p role="alert">{selected.errorMessage}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 18 }}>
                {(selected.state === "queued" || selected.state === "downloading")
                  ? <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.pause, { taskId: selected.id })}>{labels.pause}</button>
                  : null}
                {selected.state === "paused"
                  ? <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.resume, { taskId: selected.id })}>{labels.resume}</button>
                  : null}
                {(selected.state === "queued" || selected.state === "downloading" || selected.state === "paused")
                  ? <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.cancel, { taskId: selected.id })}>{labels.cancel}</button>
                  : null}
                {(selected.state === "failed" || selected.state === "canceled")
                  ? <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.retry, { taskId: selected.id })}>{labels.retry}</button>
                  : null}
                {selected.state === "completed"
                  ? <>
                      <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.openFile, { taskId: selected.id })}>{labels.open}</button>
                      <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.revealFile, { taskId: selected.id })}>{labels.reveal}</button>
                    </>
                  : null}
                {(selected.state === "completed" || selected.state === "failed" || selected.state === "canceled")
                  ? <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" onClick={() => void run(COMMANDS.remove, { taskId: selected.id })}>{labels.remove}</button>
                  : null}
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.downloads",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.downloads.refresh", title: "Refresh downloads", requiredCapability: "downloads:read" },
      { id: "lyra.downloads.pause-all", title: "Pause all downloads", requiredCapability: "downloads:write" },
      { id: "lyra.downloads.resume-all", title: "Resume all downloads", requiredCapability: "downloads:write" }
    ],
    status: [
      { id: "lyra.downloads.status", title: "Download manager" }
    ]
  },
  commandHandlers: {
    "lyra.downloads.refresh": (host) => host.executeCommand(COMMANDS.read, {}),
    "lyra.downloads.pause-all": (host) => host.executeCommand(COMMANDS.pauseAll, {}),
    "lyra.downloads.resume-all": (host) => host.executeCommand(COMMANDS.resumeAll, {})
  },
  surfaces: {
    downloads: {
      title: "Downloads",
      description: "Manage queued, active, paused, and completed downloads.",
      component: DownloadsSurface
    }
  }
});
export default lyraAppModule;
