import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  cancelLocalSearchStream,
  fetchAggregatedSearchPayload,
  readLocalSearchStream,
  startLocalSearchStream
} from "./service";
import {
  createLoadingSearchPayload,
  DEFAULT_LOCAL_SCOPE_PRESET,
  DEFAULT_LOCAL_SEARCH_LIMIT
} from "./runtime-model";
import type {
  BrowserSearchSettings,
  StandardSearchTask
} from "./runtime-types";
import type { BrowserSearchPayload } from "./types";

type StandardSearchTaskServices = {
  readonly fetchAggregatedSearchPayload: typeof fetchAggregatedSearchPayload;
  readonly startLocalSearchStream: typeof startLocalSearchStream;
  readonly readLocalSearchStream: typeof readLocalSearchStream;
  readonly cancelLocalSearchStream: typeof cancelLocalSearchStream;
  readonly setTimeout: typeof globalThis.setTimeout;
  readonly clearTimeout: typeof globalThis.clearTimeout;
};

const defaultServices: StandardSearchTaskServices = {
  fetchAggregatedSearchPayload,
  startLocalSearchStream,
  readLocalSearchStream,
  cancelLocalSearchStream,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis)
};

export const LOCAL_SEARCH_STREAM_TIMEOUT_MS = 8_000;

export type StartStandardSearchTaskOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly cacheKey: string;
  readonly tabId: string;
  readonly query: string;
  readonly requestId: string;
  readonly searchSettings: BrowserSearchSettings;
  readonly taskCache: Map<string, StandardSearchTask>;
  readonly resultCache: Map<string, BrowserSearchPayload>;
  readonly publishTaskState: (cacheKey: string, task: StandardSearchTask) => void;
  readonly services?: Partial<StandardSearchTaskServices>;
};

export const startStandardSearchTask = ({
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
}: StartStandardSearchTaskOptions): StandardSearchTask => {
  const services = {
    ...defaultServices,
    ...serviceOverrides
  };
  const localLimit = searchSettings.localLimit ?? DEFAULT_LOCAL_SEARCH_LIMIT;
  const task: StandardSearchTask = {
    cacheKey,
    tabId,
    state: createLoadingSearchPayload({
      query,
      requestId,
      scopePreset: DEFAULT_LOCAL_SCOPE_PRESET
    }),
    error: null,
    isSearching: true,
    cancel: () => undefined
  };

  taskCache.set(cacheKey, task);
  publishTaskState(cacheKey, task);

  let cancelled = false;
  let localStreamId: string | null = null;
  let localStreamPollTimer: ReturnType<typeof setTimeout> | null = null;
  let localStreamTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let localStreamCompleted = false;
  let pendingCount = 2;

  const clearLocalStreamTimer = (): void => {
    if (localStreamPollTimer !== null) {
      services.clearTimeout(localStreamPollTimer);
      localStreamPollTimer = null;
    }
  };

  const clearLocalStreamTimeout = (): void => {
    if (localStreamTimeoutTimer !== null) {
      services.clearTimeout(localStreamTimeoutTimer);
      localStreamTimeoutTimer = null;
    }
  };

  const updateTaskState = (
    updater: (current: BrowserSearchPayload) => BrowserSearchPayload
  ): void => {
    if (cancelled) {
      return;
    }
    task.state = updater(task.state);
    publishTaskState(cacheKey, task);
  };

  const updateTaskError = (message: string | null): void => {
    task.error = message;
    publishTaskState(cacheKey, task);
  };

  const finalizeTask = (): void => {
    if (cancelled) {
      return;
    }
    task.isSearching = false;
    task.state = {
      ...task.state,
      lastUpdatedAt: new Date().toISOString()
    };
    resultCache.set(cacheKey, task.state);
    taskCache.delete(cacheKey);
    publishTaskState(cacheKey, task);
  };

  const completeOne = (): void => {
    if (cancelled) {
      return;
    }
    pendingCount -= 1;
    if (pendingCount <= 0) {
      finalizeTask();
    }
  };

  const completeLocalStream = (): void => {
    if (localStreamCompleted) {
      return;
    }
    localStreamCompleted = true;
    clearLocalStreamTimer();
    clearLocalStreamTimeout();
    completeOne();
  };

  task.cancel = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    clearLocalStreamTimer();
    clearLocalStreamTimeout();
    taskCache.delete(cacheKey);
    if (localStreamId !== null) {
      void services.cancelLocalSearchStream({
        desktopApi,
        streamId: localStreamId
      });
    }
  };

  void services.fetchAggregatedSearchPayload({
    desktopApi,
    query,
    searchEngines: searchSettings.searchEngines,
    resultsPerEngine: searchSettings.resultsPerEngine
  })
    .then((payload) => {
      updateTaskState((current) => ({
        ...current,
        web: {
          status: "ready",
          payload
        }
      }));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "web search failed";
      updateTaskError(task.error ?? message);
      updateTaskState((current) => ({
        ...current,
        web: {
          status: "error",
          payload: current.web.payload,
          error: message
        }
      }));
    })
    .finally(() => {
      completeOne();
    });

  const beginLocalSearch = async (): Promise<void> => {
    try {
      const started = await services.startLocalSearchStream({
        desktopApi,
        request: {
          query,
          limit: localLimit,
          ...(searchSettings.localProjectRoot === undefined
            ? {}
            : { context: { projectRoot: searchSettings.localProjectRoot } })
        }
      });
      if (cancelled) {
        return;
      }
      if (started === null) {
        completeLocalStream();
        return;
      }
      localStreamId = started.streamId;
      updateTaskState((current) => ({
        ...current,
        local: {
          ...current.local,
          payload: {
            ...current.local.payload,
            query: started.query,
            scopePreset: started.scopePreset,
            roots: started.roots
          }
        }
      }));
      localStreamTimeoutTimer = services.setTimeout(() => {
        if (cancelled || localStreamCompleted || localStreamId === null) {
          return;
        }
        const timedOutStreamId = localStreamId;
        localStreamId = null;
        void services.cancelLocalSearchStream({
          desktopApi,
          streamId: timedOutStreamId
        });
        updateTaskState((current) => ({
          ...current,
          local: {
            ...current.local,
            status: "ready"
          }
        }));
        completeLocalStream();
      }, LOCAL_SEARCH_STREAM_TIMEOUT_MS);

      const pollLocalStream = async (): Promise<void> => {
        if (cancelled || localStreamCompleted || localStreamId === null) {
          return;
        }
        try {
          const snapshot = await services.readLocalSearchStream({
            desktopApi,
            streamId: localStreamId,
            limit: localLimit
          });
          if (cancelled || localStreamCompleted) {
            return;
          }
          if (snapshot === null) {
            completeLocalStream();
            return;
          }
          updateTaskState((current) => ({
            ...current,
            local: {
              ...current.local,
              status:
                snapshot.done
                  ? (snapshot.error === undefined ? "ready" : "error")
                  : "loading",
              payload: snapshot.payload,
              ...(snapshot.error === undefined ? {} : { error: snapshot.error })
            }
          }));
          if (snapshot.error !== undefined) {
            updateTaskError(task.error ?? snapshot.error ?? "local search failed");
          }
          if (snapshot.done) {
            completeLocalStream();
            return;
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "local search failed";
          updateTaskError(task.error ?? message);
          updateTaskState((current) => ({
            ...current,
            local: {
              ...current.local,
              status: "error",
              error: message
            }
          }));
          completeLocalStream();
          return;
        }
        localStreamPollTimer = services.setTimeout(() => {
          void pollLocalStream();
        }, 55);
      };

      void pollLocalStream();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "local search failed";
      updateTaskError(task.error ?? message);
      updateTaskState((current) => ({
        ...current,
        local: {
          ...current.local,
          status: "error",
          error: message
        }
      }));
      completeLocalStream();
    }
  };

  void beginLocalSearch();

  return task;
};
