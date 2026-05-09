import { useCallback, useEffect, useState } from "react";

import type {
  AgentVmBinding,
  AgentVmImageEntry,
  AgentVmImageListResult,
  AgentVmImageUrlDescriptor,
  AgentVmSummary,
  DownloadManagerTask
} from "../../../shared/desktop-bridge";
import type {
  AgentVmRuntimeState,
  AgentVmSurfaceProps
} from "./types";

const createInitialState = (): AgentVmRuntimeState => ({
  status: "idle",
  vms: [],
  bindings: [],
  images: [],
  busyVmId: null,
  creating: false,
  downloadingImage: false,
  provisioningStage: "idle",
  downloadTaskId: null,
  downloadReceivedBytes: 0,
  downloadTotalBytes: 0,
  downloadSpeedBytesPerSecond: 0,
  importingImage: false,
  revealingPasswordVmId: null,
  revealedPasswords: {},
  errorMessage: null,
});

const DEFAULT_AGENT_VM_IMAGE_ID = "lyra-agent-lite-ubuntu-24.04";
const DEFAULT_AGENT_VM_GUEST_WORKSPACE = "/workspace";
const DEFAULT_AGENT_VM_MEMORY_MIB = 2048;
const DEFAULT_AGENT_VM_CPU_COUNT = 2;
const IMAGE_DOWNLOAD_WAIT_TIMEOUT_MS = 60 * 60 * 1000;

type AgentVmRuntimeActions = {
  readonly refresh: () => Promise<void>;
  readonly create: () => Promise<void>;
  readonly downloadAndStart: () => Promise<void>;
  readonly importDefaultImage: () => Promise<void>;
  readonly start: (vmId: string) => Promise<void>;
  readonly stop: (vmId: string) => Promise<void>;
  readonly attach: (vmId: string) => Promise<void>;
  readonly takeover: (vmId: string) => Promise<void>;
  readonly fork: (vmId: string) => Promise<void>;
  readonly inherit: (vmId: string) => Promise<void>;
  readonly revealPassword: (vmId: string) => Promise<void>;
};

export type AgentVmRuntime = {
  readonly state: AgentVmRuntimeState;
  readonly actions: AgentVmRuntimeActions;
  readonly available: boolean;
};

export const useAgentVmRuntime = ({
  desktopApi,
  sessionId,
  labels,
}: Pick<AgentVmSurfaceProps, "desktopApi" | "sessionId" | "labels">): AgentVmRuntime => {
  const [state, setState] = useState<AgentVmRuntimeState>(createInitialState);
  const aiApi = desktopApi?.ai;
  const downloadsApi = desktopApi?.downloads;
  const available = aiApi !== undefined;
  const scopedSessionId = sessionId?.trim() ?? "";

  const patchDownloadTaskState = useCallback((task: DownloadManagerTask): void => {
    setState((current) => ({
      ...current,
      downloadTaskId: task.id,
      downloadReceivedBytes: task.receivedBytes,
      downloadTotalBytes: task.totalBytes,
      downloadSpeedBytesPerSecond: task.speedBytesPerSecond,
    }));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (aiApi === undefined) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: "Agent VM runtime is unavailable.",
      }));
      return;
    }
    setState((current) => ({
      ...current,
      status: current.status === "idle" ? "loading" : current.status,
      errorMessage: null,
    }));
    try {
      const [vmResult, bindingResult, imageResult] = await Promise.all([
        aiApi.listAgentVms(scopedSessionId.length === 0 ? {} : { sessionId: scopedSessionId }),
        aiApi.listAgentVmBindings(
          scopedSessionId.length === 0 ? {} : { sessionId: scopedSessionId }
        ),
        aiApi.listAgentVmImages({}),
      ]);
      setState((current) => ({
        ...current,
        status: "ready",
        vms: vmResult.vms,
        bindings: bindingResult.bindings,
        images: imageResult.images,
        errorMessage: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [aiApi, scopedSessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importDefaultImage = useCallback(async (): Promise<void> => {
    if (aiApi === undefined || desktopApi?.files === undefined || state.importingImage) {
      return;
    }
    setState((current) => ({
      ...current,
      importingImage: true,
      errorMessage: null,
    }));
    try {
      const [attachment] = await desktopApi.files.selectAttachments();
      if (attachment === undefined) {
        return;
      }
      await aiApi.importAgentVmImage({
        imageId: DEFAULT_AGENT_VM_IMAGE_ID,
        filePath: attachment.path,
        name: labels.defaultImage,
      });
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setState((current) => ({
        ...current,
        importingImage: false,
      }));
    }
  }, [aiApi, desktopApi?.files, labels.defaultImage, refresh, state.importingImage]);

  const waitForDownloadTask = useCallback(async (taskId: string): Promise<DownloadManagerTask> => {
    if (downloadsApi === undefined) {
      throw new Error(labels.downloadManagerUnavailable);
    }
    const snapshot = await downloadsApi.list();
    const existing = snapshot.tasks.find((task) => task.id === taskId);
    if (existing !== undefined) {
      patchDownloadTaskState(existing);
      if (existing.state === "completed") {
        return existing;
      }
      if (existing.state === "failed" || existing.state === "canceled") {
        throw new Error(existing.errorMessage ?? labels.downloadFailed);
      }
    }
    return new Promise<DownloadManagerTask>((resolve, reject) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const timeout = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        reject(new Error(labels.downloadFailed));
      }, IMAGE_DOWNLOAD_WAIT_TIMEOUT_MS);
      unsubscribe = downloadsApi.onEvent((event) => {
        if (event.kind !== "task-updated" || event.task.id !== taskId || settled) {
          return;
        }
        patchDownloadTaskState(event.task);
        if (event.task.state === "completed") {
          settled = true;
          window.clearTimeout(timeout);
          unsubscribe();
          resolve(event.task);
          return;
        }
        if (event.task.state === "failed" || event.task.state === "canceled") {
          settled = true;
          window.clearTimeout(timeout);
          unsubscribe();
          reject(new Error(event.task.errorMessage ?? labels.downloadFailed));
        }
      });
    });
  }, [downloadsApi, labels.downloadFailed, labels.downloadManagerUnavailable, patchDownloadTaskState]);

  const enqueueDefaultImageDownload = useCallback(async (
    imageResult: AgentVmImageListResult
  ): Promise<DownloadManagerTask> => {
    if (downloadsApi === undefined) {
      throw new Error(labels.downloadManagerUnavailable);
    }
    const defaultImage = imageResult.images.find((entry) => entry.image.id === DEFAULT_AGENT_VM_IMAGE_ID);
    const imageUrl = selectImageDownloadUrl(defaultImage, imageResult.arch);
    if (imageUrl === null) {
      throw new Error("Default Agent VM image has no download URL for this host.");
    }
    const beforeSnapshot = await downloadsApi.list();
    const beforeTaskIds = new Set(beforeSnapshot.tasks.map((task) => task.id));
    const snapshot = await downloadsApi.enqueue({
      urls: [imageUrl.url],
      maxRetries: 3,
      retryDelayMs: 1500,
    });
    const task = snapshot.tasks.find((candidate) =>
      beforeTaskIds.has(candidate.id) === false && candidate.url === imageUrl.url
    ) ?? snapshot.tasks.find((candidate) => candidate.url === imageUrl.url);
    if (task === undefined) {
      throw new Error(labels.downloadFailed);
    }
    patchDownloadTaskState(task);
    return waitForDownloadTask(task.id);
  }, [downloadsApi, labels.downloadFailed, labels.downloadManagerUnavailable, patchDownloadTaskState, waitForDownloadTask]);

  const ensureDefaultImage = useCallback(async (): Promise<void> => {
    if (aiApi === undefined) {
      return;
    }
    setState((current) => ({
      ...current,
      provisioningStage: "checking_image",
    }));
    const imageResult = await aiApi.listAgentVmImages({});
    if (hasInstalledDefaultImage(imageResult.images)) {
      return;
    }
    setState((current) => ({
      ...current,
      downloadingImage: true,
      provisioningStage: "downloading_image",
      images: imageResult.images,
    }));
    const task = await enqueueDefaultImageDownload(imageResult);
    setState((current) => ({
      ...current,
      provisioningStage: "checking_image",
      downloadingImage: false,
    }));
    await aiApi.importAgentVmImage({
      imageId: DEFAULT_AGENT_VM_IMAGE_ID,
      filePath: task.savePath,
      name: labels.defaultImage,
      arch: imageResult.arch,
    });
  }, [aiApi, enqueueDefaultImageDownload, labels.defaultImage]);

  const runVmAction = useCallback(async (
    vmId: string,
    action: () => Promise<unknown>
  ): Promise<void> => {
    if (vmId.trim().length === 0) {
      return;
    }
    setState((current) => ({
      ...current,
      busyVmId: vmId,
      errorMessage: null,
    }));
    try {
      await action();
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        busyVmId: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setState((current) => ({
        ...current,
        busyVmId: current.busyVmId === vmId ? null : current.busyVmId,
      }));
    }
  }, [refresh]);

  const create = useCallback(async (): Promise<void> => {
    if (aiApi === undefined || state.creating) {
      return;
    }
    setState((current) => ({
      ...current,
      creating: true,
      provisioningStage: "creating_vm",
      downloadTaskId: null,
      downloadReceivedBytes: 0,
      downloadTotalBytes: 0,
      downloadSpeedBytesPerSecond: 0,
      errorMessage: null,
    }));
    try {
      const targetSessionId = scopedSessionId.length === 0
        ? (await aiApi.createSession({
            title: labels.createSessionTitle,
            executionTarget: "agent_vm",
          })).session.id
        : scopedSessionId;
      await aiApi.createAgentVm({
        sessionId: targetSessionId,
        imageId: DEFAULT_AGENT_VM_IMAGE_ID,
        guestWorkspacePath: DEFAULT_AGENT_VM_GUEST_WORKSPACE,
        memoryMib: DEFAULT_AGENT_VM_MEMORY_MIB,
        cpuCount: DEFAULT_AGENT_VM_CPU_COUNT,
      });
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setState((current) => ({
        ...current,
        creating: false,
        provisioningStage: "idle",
      }));
    }
  }, [aiApi, labels.createSessionTitle, refresh, scopedSessionId, state.creating]);

  const downloadAndStart = useCallback(async (): Promise<void> => {
    if (aiApi === undefined || state.creating || state.downloadingImage) {
      return;
    }
    setState((current) => ({
      ...current,
      creating: true,
      downloadingImage: false,
      provisioningStage: "checking_image",
      downloadTaskId: null,
      downloadReceivedBytes: 0,
      downloadTotalBytes: 0,
      downloadSpeedBytesPerSecond: 0,
      errorMessage: null,
    }));
    try {
      await ensureDefaultImage();
      setState((current) => ({
        ...current,
        downloadingImage: false,
        provisioningStage: "creating_vm",
      }));
      const targetSessionId = scopedSessionId.length === 0
        ? (await aiApi.createSession({
            title: labels.createSessionTitle,
            executionTarget: "agent_vm",
          })).session.id
        : scopedSessionId;
      const created = await aiApi.createAgentVm({
        sessionId: targetSessionId,
        imageId: DEFAULT_AGENT_VM_IMAGE_ID,
        guestWorkspacePath: DEFAULT_AGENT_VM_GUEST_WORKSPACE,
        memoryMib: DEFAULT_AGENT_VM_MEMORY_MIB,
        cpuCount: DEFAULT_AGENT_VM_CPU_COUNT,
      });
      if (created.vm.vmId.trim().length > 0) {
        setState((current) => ({
          ...current,
          provisioningStage: "starting_vm",
        }));
        await aiApi.startAgentVm({ vmId: created.vm.vmId });
      }
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setState((current) => ({
        ...current,
        creating: false,
        downloadingImage: false,
        provisioningStage: "idle",
      }));
    }
  }, [
    aiApi,
    ensureDefaultImage,
    labels.createSessionTitle,
    refresh,
    scopedSessionId,
    state.creating,
    state.downloadingImage,
  ]);

  const start = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined) {
      return;
    }
    await runVmAction(vmId, () => aiApi.startAgentVm({ vmId }));
  }, [aiApi, runVmAction]);

  const stop = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined) {
      return;
    }
    await runVmAction(vmId, () => aiApi.stopAgentVm({ vmId }));
  }, [aiApi, runVmAction]);

  const attach = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined || scopedSessionId.length === 0) {
      return;
    }
    await runVmAction(vmId, () =>
      aiApi.attachAgentVm({ sessionId: scopedSessionId, vmId, attachMode: "shared" })
    );
  }, [aiApi, runVmAction, scopedSessionId]);

  const takeover = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined || scopedSessionId.length === 0) {
      return;
    }
    await runVmAction(vmId, () =>
      aiApi.takeoverAgentVm({ sessionId: scopedSessionId, vmId, reason: "user_requested" })
    );
  }, [aiApi, runVmAction, scopedSessionId]);

  const fork = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined || scopedSessionId.length === 0) {
      return;
    }
    await runVmAction(vmId, () => aiApi.forkAgentVm({ sessionId: scopedSessionId, sourceVmId: vmId }));
  }, [aiApi, runVmAction, scopedSessionId]);

  const inherit = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined || scopedSessionId.length === 0) {
      return;
    }
    await runVmAction(vmId, async () => {
      const profile = await aiApi.createAgentVmInheritanceProfile({
        sessionId: scopedSessionId,
        sourceVmId: vmId,
        include: ["login_state", "package_cache"],
      });
      await aiApi.applyAgentVmInheritanceProfile({
        sessionId: scopedSessionId,
        profileId: profile.profile.profileId,
      });
    });
  }, [aiApi, runVmAction, scopedSessionId]);

  const revealPassword = useCallback(async (vmId: string): Promise<void> => {
    if (aiApi === undefined || vmId.trim().length === 0) {
      return;
    }
    setState((current) => ({
      ...current,
      revealingPasswordVmId: vmId,
      errorMessage: null,
    }));
    try {
      const revealed = await aiApi.revealAgentVmPassword({ vmId });
      setState((current) => ({
        ...current,
        revealedPasswords: {
          ...current.revealedPasswords,
          [vmId]: revealed,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setState((current) => ({
        ...current,
        revealingPasswordVmId: current.revealingPasswordVmId === vmId
          ? null
          : current.revealingPasswordVmId,
      }));
    }
  }, [aiApi]);

  return {
    state,
    actions: {
      refresh,
      create,
      downloadAndStart,
      importDefaultImage,
      start,
      stop,
      attach,
      takeover,
      fork,
      inherit,
      revealPassword,
    },
    available,
  };
};

export const hasInstalledDefaultImage = (images: readonly AgentVmImageEntry[]): boolean =>
  images.some((entry) => entry.image.id === DEFAULT_AGENT_VM_IMAGE_ID && entry.installed);

export const selectImageDownloadUrl = (
  entry: AgentVmImageEntry | undefined,
  arch: string
): AgentVmImageUrlDescriptor | null => {
  const urls = entry?.image.urls ?? [];
  return urls.find((url) => url.arch === undefined || url.arch === null || url.arch === arch) ?? null;
};

export const mergeVmBindings = (
  vms: readonly AgentVmSummary[],
  bindings: readonly AgentVmBinding[]
): readonly AgentVmSummary[] => {
  const bindingByVmId = new Map(bindings.map((binding) => [binding.vmId, binding]));
  return vms.map((vm) => ({
    ...vm,
    binding: vm.binding ?? bindingByVmId.get(vm.vmId) ?? null,
  }));
};
