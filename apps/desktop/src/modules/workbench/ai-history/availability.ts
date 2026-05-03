import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

import { createAiHistoryRequestPayload } from "./model";

type ThreadListResponse = {
  readonly data?: readonly unknown[];
};

const readThreadListHasData = (response: ThreadListResponse): boolean =>
  Array.isArray(response.data) && response.data.length > 0;

const requestThreadListPresence = async (
  lyraApi: NonNullable<LyraDesktopApi["lyra"]>,
  archived: boolean
): Promise<boolean> => {
  const response = await lyraApi.request<ThreadListResponse>(
    createAiHistoryRequestPayload("thread/list", {
      limit: 1,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived,
      modelProviders: []
    })
  );
  return readThreadListHasData(response);
};

export const readAiHistoryHasThreads = async (
  desktopApi: LyraDesktopApi | null
): Promise<boolean> => {
  const lyraApi = desktopApi?.lyra;
  if (lyraApi === undefined) {
    return false;
  }

  try {
    const [hasActive, hasArchived] = await Promise.all([
      requestThreadListPresence(lyraApi, false),
      requestThreadListPresence(lyraApi, true)
    ]);
    return hasActive || hasArchived;
  } catch {
    return false;
  }
};
