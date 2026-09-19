import { useEffect } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { isProjectTreeFindQuery } from "../shell/navigation-input";
import {
  getProjectTreeFileSearch,
  setProjectTreeFileSearch
} from "./file-search";

const SEARCH_DEBOUNCE_MS = 300;

export const useProjectTreeOmniboxSearch = ({
  desktopApi,
  instanceId,
  rootPath,
  query
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly instanceId: string | undefined;
  readonly rootPath: string | null;
  readonly query: string;
}): void => {
  useEffect(() => {
    if (instanceId === undefined) {
      return;
    }
    const trimmed = query.trim();
    if (rootPath === null || rootPath.length === 0 || isProjectTreeFindQuery(trimmed) === false) {
      setProjectTreeFileSearch(instanceId, null);
      return;
    }

    const previous = getProjectTreeFileSearch(instanceId);
    if (
      previous?.query === trimmed &&
      previous.rootPath === rootPath &&
      previous.status === "ready"
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const previousNow = getProjectTreeFileSearch(instanceId);
      setProjectTreeFileSearch(instanceId, {
        query: trimmed,
        rootPath,
        status: "searching",
        hits: previousNow?.rootPath === rootPath ? previousNow.hits : [],
        truncated: previousNow?.rootPath === rootPath ? previousNow.truncated : false,
        collapsedFilePaths: previousNow?.query === trimmed ? previousNow.collapsedFilePaths : []
      });
      void (async () => {
        const searchText = desktopApi?.files?.searchText;
        if (searchText === undefined) {
          if (cancelled === false) {
            setProjectTreeFileSearch(instanceId, {
              query: trimmed,
              rootPath,
              status: "ready",
              hits: [],
              truncated: false,
              collapsedFilePaths: []
            });
          }
          return;
        }
        try {
          const result = await searchText({
            rootPath,
            query: trimmed
          });
          if (cancelled) {
            return;
          }
          setProjectTreeFileSearch(instanceId, {
            query: trimmed,
            rootPath,
            status: "ready",
            hits: result.hits,
            truncated: result.truncated,
            collapsedFilePaths: []
          });
        } catch {
          if (cancelled) {
            return;
          }
          setProjectTreeFileSearch(instanceId, {
            query: trimmed,
            rootPath,
            status: "ready",
            hits: [],
            truncated: false,
            collapsedFilePaths: []
          });
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [desktopApi, instanceId, query, rootPath]);
};
