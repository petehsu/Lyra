import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import type { AiProviderProfile } from "../../../shared/ai";
import type { AgentApi, AgentPendingInteraction, AgentSessionDetail, LyraDesktopApi } from "../../../shared/desktop-bridge";
import { isSessionNotFoundError } from "./view-helpers";

type UseAiPanelSessionLoadersParams = {
  readonly agentApi: AgentApi | undefined;
  readonly desktopApi: LyraDesktopApi | null;
  readonly defaultProfileId?: string | null | undefined;
  readonly newSessionTitle: string;
  readonly setProfiles: Dispatch<SetStateAction<readonly AiProviderProfile[]>>;
  readonly setIsLoading: Dispatch<SetStateAction<boolean>>;
  readonly setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setActiveDetail: Dispatch<SetStateAction<AgentSessionDetail | null>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly mergePendingInteractionsForSession: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
};

type UseAiPanelSessionLoadersResult = {
  readonly loadProfiles: () => Promise<void>;
  readonly loadSessions: () => Promise<void>;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly invalidateSessionDetailRequests: () => void;
};

export const useAiPanelSessionLoaders = ({
  agentApi,
  desktopApi,
  defaultProfileId,
  newSessionTitle,
  setProfiles,
  setIsLoading,
  setActiveSessionId,
  setActiveDetail,
  setRuntimeError,
  mergePendingInteractionsForSession,
}: UseAiPanelSessionLoadersParams): UseAiPanelSessionLoadersResult => {
  const sessionListRequestSeqRef = useRef(0);
  const sessionDetailRequestSeqRef = useRef(0);
  const profileListRequestSeqRef = useRef(0);

  const loadProfiles = useCallback(async (): Promise<void> => {
    if (desktopApi?.ai === undefined) {
      setProfiles([]);
      return;
    }
    const requestSeq = ++profileListRequestSeqRef.current;
    try {
      const nextProfiles = await desktopApi.ai.readProfiles();
      if (requestSeq !== profileListRequestSeqRef.current) {
        return;
      }
      setProfiles(nextProfiles);
    } catch (_error) {
      if (requestSeq !== profileListRequestSeqRef.current) {
        return;
      }
      setProfiles([]);
    }
  }, [desktopApi, setProfiles]);

  const loadSessions = useCallback(async (): Promise<void> => {
    if (agentApi === undefined) {
      return;
    }
    void loadProfiles();
    const requestSeq = ++sessionListRequestSeqRef.current;
    setIsLoading(true);
    try {
      let nextSessions = await agentApi.listSessions();
      if (requestSeq !== sessionListRequestSeqRef.current) {
        return;
      }
      if (nextSessions.length === 0) {
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(defaultProfileId === null || defaultProfileId === undefined
            ? {}
            : { profileId: defaultProfileId }),
        });
        nextSessions = [created];
        if (requestSeq !== sessionListRequestSeqRef.current) {
          return;
        }
      }

      setActiveSessionId((current) => {
        if (current !== null && nextSessions.some((session) => session.id === current)) {
          return current;
        }
        return nextSessions[0]?.id ?? null;
      });
    } finally {
      setIsLoading(false);
    }
  }, [agentApi, defaultProfileId, loadProfiles, newSessionTitle, setActiveSessionId, setIsLoading]);

  const loadSessionDetail = useCallback(
    async (sessionId: string): Promise<void> => {
      if (agentApi === undefined) {
        return;
      }
      const requestSeq = ++sessionDetailRequestSeqRef.current;
      try {
        const detail = await agentApi.getSession({ sessionId });
        if (requestSeq !== sessionDetailRequestSeqRef.current) {
          return;
        }
        setActiveDetail(detail);
        mergePendingInteractionsForSession(sessionId, detail.pendingInteractions);
      } catch (error) {
        if (requestSeq !== sessionDetailRequestSeqRef.current) {
          return;
        }
        if (isSessionNotFoundError(error)) {
          setActiveDetail((current) =>
            current !== null && current.session.id === sessionId ? null : current
          );
          setActiveSessionId((current) => (current === sessionId ? null : current));
          await loadSessions();
          return;
        }
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      agentApi,
      loadSessions,
      mergePendingInteractionsForSession,
      setActiveDetail,
      setActiveSessionId,
      setRuntimeError,
    ]
  );

  const invalidateSessionDetailRequests = useCallback(() => {
    sessionDetailRequestSeqRef.current += 1;
  }, []);

  return {
    loadProfiles,
    loadSessions,
    loadSessionDetail,
    invalidateSessionDetailRequests,
  };
};
