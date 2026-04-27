import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LyraDesktopApi,
  SearchIndexStatusResponse,
  SearchLocalScopePreset
} from "../../../shared/desktop-bridge";

const SEARCH_INDEX_STATUS_POLL_INTERVAL_MS = 3_000;

type UseWorkbenchSearchIndexStatusParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly scopePreset: SearchLocalScopePreset;
  readonly customRoots: readonly string[];
  readonly includeHidden: boolean;
};

type WorkbenchSearchIndexStatusModel = {
  readonly searchIndexStatus: SearchIndexStatusResponse | null;
  readonly searchRebuildIndexPending: boolean;
  readonly onSearchRebuildIndex: () => void;
};

export const useWorkbenchSearchIndexStatus = ({
  desktopApi,
  scopePreset,
  customRoots,
  includeHidden
}: UseWorkbenchSearchIndexStatusParams): WorkbenchSearchIndexStatusModel => {
  const [searchIndexStatus, setSearchIndexStatus] =
    useState<SearchIndexStatusResponse | null>(null);
  const [searchRebuildIndexPending, setSearchRebuildIndexPending] = useState(false);
  const searchRebuildIndexPendingRef = useRef(false);

  const updateSearchRebuildIndexPending = useCallback((pending: boolean): void => {
    searchRebuildIndexPendingRef.current = pending;
    setSearchRebuildIndexPending(pending);
  }, []);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    let disposed = false;
    const readStatus = async (): Promise<void> => {
      try {
        const status = await desktopApi.search.readIndexStatus();
        if (!disposed) {
          setSearchIndexStatus(status);
        }
      } catch (_error) {
        // Search index status is best-effort and should not disrupt settings.
      }
    };

    void readStatus();
    const timer = setInterval(() => {
      void readStatus();
    }, SEARCH_INDEX_STATUS_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [desktopApi]);

  const onSearchRebuildIndex = useCallback((): void => {
    if (desktopApi === null || searchRebuildIndexPendingRef.current) {
      return;
    }

    updateSearchRebuildIndexPending(true);
    void desktopApi.search
      .rebuildIndex({
        scopePreset,
        customRoots,
        includeHidden,
        force: true
      })
      .then((response) => {
        setSearchIndexStatus(response.status);
      })
      .catch((_error) => {
        // Keep rebuild failures contained; the next status poll will surface state.
      })
      .finally(() => {
        updateSearchRebuildIndexPending(false);
      });
  }, [
    customRoots,
    desktopApi,
    includeHidden,
    scopePreset,
    updateSearchRebuildIndexPending
  ]);

  return {
    searchIndexStatus,
    searchRebuildIndexPending,
    onSearchRebuildIndex
  };
};

export const SEARCH_INDEX_STATUS_POLL_INTERVAL_MS_FOR_TESTS =
  SEARCH_INDEX_STATUS_POLL_INTERVAL_MS;
