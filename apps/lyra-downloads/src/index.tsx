import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import { resolveMessages } from "./l10n/resolve";
import { isRecord, parseDownloadsSnapshot } from "./parse";
import { DownloadsEmbeddedChrome } from "./surface";
import type { DownloadPriority, DownloadsSnapshot } from "./types";

const COMMANDS = {
  read: "lyra.core.downloads.read",
  enqueue: "lyra.core.downloads.enqueue",
  pause: "lyra.core.downloads.pause",
  resume: "lyra.core.downloads.resume",
  cancel: "lyra.core.downloads.cancel",
  retry: "lyra.core.downloads.retry",
  remove: "lyra.core.downloads.remove",
  setPriority: "lyra.core.downloads.set-priority",
  pauseAll: "lyra.core.downloads.pause-all",
  resumeAll: "lyra.core.downloads.resume-all",
  cancelAll: "lyra.core.downloads.cancel-all",
  openFile: "lyra.core.downloads.open-file",
  revealFile: "lyra.core.downloads.reveal-file"
} as const;
const DOWNLOADS_CHANGED_EVENT = "lyra.core.downloads-changed";

export { parseDownloadsSnapshot } from "./parse";
export type { DownloadsSnapshot } from "./types";

const DownloadsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = useMemo(
    () => resolveMessages(presentation.locale),
    [presentation.locale]
  );
  const restoredDraft = isRecord(opaqueState) && typeof opaqueState.urlDraft === "string"
    ? opaqueState.urlDraft
    : "";
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot | null>(null);
  const [urlDraft, setUrlDraft] = useState(restoredDraft);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(parseDownloadsSnapshot(await host.executeCommand(COMMANDS.read, {})));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => {
    void refresh();
    try {
      const subscription = host.subscribeEvent(DOWNLOADS_CHANGED_EVENT, async () => refresh());
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);

  useEffect(() => {
    updateOpaqueState({ urlDraft });
  }, [urlDraft, updateOpaqueState]);

  const run = useCallback(async (key: string, work: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await work();
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
    }
  }, [refresh]);

  const submitUrl = useCallback(() => {
    const text = urlDraft.trim();
    if (text.length === 0) return;
    void run("enqueue", async () => {
      await host.executeCommand(COMMANDS.enqueue, { text });
      setUrlDraft("");
    });
  }, [host, run, urlDraft]);

  const command = useCallback((
    key: string,
    commandId: string,
    input: Record<string, string>
  ) => {
    void run(key, () => host.executeCommand(commandId, input));
  }, [host, run]);

  return (
    <DownloadsEmbeddedChrome
      labels={labels}
      tasks={snapshot?.tasks ?? []}
      urlDraft={urlDraft}
      error={error}
      busyKey={busyKey}
      onUrlDraftChange={setUrlDraft}
      onSubmitUrl={submitUrl}
      onPause={(taskId) => command(taskId, COMMANDS.pause, { taskId })}
      onResume={(taskId) => command(taskId, COMMANDS.resume, { taskId })}
      onCancel={(taskId) => command(taskId, COMMANDS.cancel, { taskId })}
      onRetry={(taskId) => command(taskId, COMMANDS.retry, { taskId })}
      onRemove={(taskId) => command(taskId, COMMANDS.remove, { taskId })}
      onPauseAll={() => command("pause-all", COMMANDS.pauseAll, {})}
      onResumeAll={() => command("resume-all", COMMANDS.resumeAll, {})}
      onCancelAll={() => command("cancel-all", COMMANDS.cancelAll, {})}
      onOpen={(taskId) => command(taskId, COMMANDS.openFile, { taskId })}
      onReveal={(taskId) => command(taskId, COMMANDS.revealFile, { taskId })}
      onSetPriority={(taskId, priority: DownloadPriority) =>
        command(taskId, COMMANDS.setPriority, { taskId, priority })}
    />
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.downloads",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.downloads.refresh", title: "Refresh downloads" },
      { id: "lyra.downloads.pause-all", title: "Pause all downloads" },
      { id: "lyra.downloads.resume-all", title: "Resume all downloads" }
    ],
    status: [
      { id: "lyra.downloads.status", title: "Downloads" }
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
