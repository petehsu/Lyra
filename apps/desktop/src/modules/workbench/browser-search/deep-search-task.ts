import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  cancelDeepSearchStream,
  readDeepSearchStream,
  startDeepSearchStream
} from "./service";
import { createLoadingDeepSearchState } from "./runtime-model";
import type {
  BrowserSearchSettings,
  DeepSearchTask
} from "./runtime-types";
import type { DeepSearchViewState } from "./types";

type DeepSearchTaskServices = {
  readonly startDeepSearchStream: typeof startDeepSearchStream;
  readonly readDeepSearchStream: typeof readDeepSearchStream;
  readonly cancelDeepSearchStream: typeof cancelDeepSearchStream;
  readonly setTimeout: typeof globalThis.setTimeout;
  readonly clearTimeout: typeof globalThis.clearTimeout;
};

const defaultServices: DeepSearchTaskServices = {
  startDeepSearchStream,
  readDeepSearchStream,
  cancelDeepSearchStream,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis)
};

export type StartDeepSearchTaskOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly cacheKey: string;
  readonly tabId: string;
  readonly query: string;
  readonly requestId: string;
  readonly searchSettings: BrowserSearchSettings;
  readonly taskCache: Map<string, DeepSearchTask>;
  readonly resultCache: Map<string, DeepSearchViewState>;
  readonly publishTaskState: (cacheKey: string, task: DeepSearchTask) => void;
  readonly services?: Partial<DeepSearchTaskServices>;
};

export const startDeepSearchTask = ({
  desktopApi,
  cacheKey,
  tabId,
  query,
  requestId,
  searchSettings,
  taskCache,
  resultCache,
  publishTaskState,
  services: serviceOverrides
}: StartDeepSearchTaskOptions): DeepSearchTask => {
  const services = {
    ...defaultServices,
    ...serviceOverrides
  };
  const task: DeepSearchTask = {
    cacheKey,
    tabId,
    state: createLoadingDeepSearchState({
      query,
      requestId,
      scopePreset: searchSettings.localScopePreset,
      budgetPreset: searchSettings.deepBudgetPreset
    }),
    error: null,
    isSearching: true,
    streamId: null,
    cancel: () => undefined,
    resume: () => undefined
  };

  taskCache.set(cacheKey, task);
  publishTaskState(cacheKey, task);

  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const stopPolling = (): void => {
    if (pollTimer !== null) {
      services.clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const publish = (): void => {
    publishTaskState(cacheKey, task);
  };

  const schedulePoll = (): void => {
    stopPolling();
    pollTimer = services.setTimeout(() => {
      void pollStream();
    }, 120);
  };

  const pollStream = async (): Promise<void> => {
    if (cancelled || task.streamId === null) {
      return;
    }
    try {
      const response = await services.readDeepSearchStream({
        desktopApi,
        streamId: task.streamId
      });
      if (cancelled || response === null) {
        return;
      }
      task.state = {
        query,
        queryRequestId: requestId,
        streamId: task.streamId,
        budgetPreset: searchSettings.deepBudgetPreset,
        status: response.done
          ? (response.error === undefined ? "ready" : "error")
          : "loading",
        snapshot: response.snapshot,
        done: response.done,
        ...(response.error === undefined ? {} : { error: response.error })
      };
      task.error = response.error ?? null;
      task.isSearching = !response.done;
      if (response.done) {
        resultCache.set(cacheKey, task.state);
        publish();
        return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "deep search failed";
      task.state = {
        ...task.state,
        status: "error",
        done: true,
        error: message,
        snapshot: {
          ...task.state.snapshot,
          phase: "error",
          lastUpdatedAt: new Date().toISOString()
        }
      };
      task.error = message;
      task.isSearching = false;
      resultCache.set(cacheKey, task.state);
      publish();
      return;
    }
    publish();
    schedulePoll();
  };

  task.resume = () => {
    if (cancelled || task.streamId === null) {
      return;
    }
    task.isSearching = true;
    task.state = {
      ...task.state,
      status: "loading",
      done: false,
      snapshot: {
        ...task.state.snapshot,
        phase: task.state.snapshot.phase === "error" ? "streaming" : task.state.snapshot.phase,
        lastUpdatedAt: new Date().toISOString()
      }
    };
    publish();
    schedulePoll();
  };

  task.cancel = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    stopPolling();
    taskCache.delete(cacheKey);
    if (task.streamId !== null) {
      void services.cancelDeepSearchStream({
        desktopApi,
        streamId: task.streamId
      });
    }
  };

  void services.startDeepSearchStream({
    desktopApi,
    request: {
      query,
      budgetPreset: searchSettings.deepBudgetPreset,
      scopePreset: searchSettings.localScopePreset,
      customRoots: searchSettings.localCustomRoots,
      ...(searchSettings.localProjectRoot === undefined
        ? {}
        : { projectRoot: searchSettings.localProjectRoot }),
      includeHidden: searchSettings.localIncludeHidden,
      enableFuzzy: searchSettings.localEnableFuzzy,
      enableContent: searchSettings.localEnableContent,
      enableExtensionMatch: searchSettings.localEnableExtensionMatch,
      engines: searchSettings.searchEngines,
      enableSiteExpansion: searchSettings.deepSiteExpansionEnabled,
      enableProactiveDomainGuessing: searchSettings.deepProactiveDomainGuessingEnabled,
      crawlPolicy: searchSettings.deepCrawlPolicy
    }
  })
    .then((started) => {
      if (cancelled || started === null) {
        return;
      }
      task.streamId = started.streamId;
      task.state = {
        query,
        queryRequestId: requestId,
        streamId: started.streamId,
        budgetPreset: searchSettings.deepBudgetPreset,
        status: "loading",
        snapshot: started.snapshot,
        done: false
      };
      task.isSearching = true;
      publish();
      schedulePoll();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "deep search failed";
      task.state = {
        ...task.state,
        status: "error",
        done: true,
        error: message,
        snapshot: {
          ...task.state.snapshot,
          phase: "error",
          lastUpdatedAt: new Date().toISOString()
        }
      };
      task.error = message;
      task.isSearching = false;
      resultCache.set(cacheKey, task.state);
      publish();
    });

  return task;
};
