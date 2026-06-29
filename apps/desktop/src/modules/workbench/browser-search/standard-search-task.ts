import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  createLoadingSearchPayload
} from "./runtime-model";
import type {
  BrowserSearchSettings,
  StandardSearchTask
} from "./runtime-types";
import type { BrowserSearchPayload } from "./types";

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
};

export const startStandardSearchTask = ({
  cacheKey,
  tabId,
  query,
  requestId,
  taskCache,
  resultCache,
  publishTaskState
}: StartStandardSearchTaskOptions): StandardSearchTask => {
  const task: StandardSearchTask = {
    cacheKey,
    tabId,
    state: createLoadingSearchPayload({
      query,
      requestId
    }),
    error: null,
    isSearching: true,
    cancel: () => undefined
  };

  taskCache.set(cacheKey, task);
  publishTaskState(cacheKey, task);

  const finalizeTask = (): void => {
    task.isSearching = false;
    task.state = {
      ...task.state,
      lastUpdatedAt: new Date().toISOString()
    };
    resultCache.set(cacheKey, task.state);
    taskCache.delete(cacheKey);
    publishTaskState(cacheKey, task);
  };

  task.cancel = () => {
    taskCache.delete(cacheKey);
  };

  // ponytail: no web search fetching yet — the task publishes a loading state
  // and immediately finalizes. Web search results open as browser page tabs,
  // not through this task. Upgrade path: add web search fetch here and call
  // finalizeTask() when it completes.
  finalizeTask();

  return task;
};