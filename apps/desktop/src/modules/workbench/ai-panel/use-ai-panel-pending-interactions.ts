import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";

import type { AgentApi } from "../../../shared/desktop-bridge";
import type {
  AgentPendingInteraction,
  AgentSessionDetail,
} from "../../../shared/desktop-bridge";
import {
  mergePendingInteractionLists,
  sortPendingInteractions,
  toPendingInteractionPanel,
  type ActiveInteractionPanel,
  type InteractionTextBundle,
  type PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";

type UseAiPanelPendingInteractionsParams = {
  readonly agentApi: AgentApi | undefined;
  readonly activeSessionId: string | null;
  readonly activeDetail: AgentSessionDetail | null;
  readonly interactionTextLabels: InteractionTextBundle;
  readonly setActiveDetail: Dispatch<SetStateAction<AgentSessionDetail | null>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly setIsStreamActive: Dispatch<SetStateAction<boolean>>;
};

type UseAiPanelPendingInteractionsResult = {
  readonly activeInteractionId: string | null;
  readonly setActiveInteractionId: Dispatch<SetStateAction<string | null>>;
  readonly transientInteractionPanel: PendingInteractionPanel | null;
  readonly setTransientInteractionPanel: Dispatch<SetStateAction<PendingInteractionPanel | null>>;
  readonly livePendingInteractionsRef: MutableRefObject<Readonly<Record<string, readonly AgentPendingInteraction[]>>>;
  readonly replacePendingInteractions: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
  readonly mergePendingInteractionsForSession: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
  readonly startPendingInteractionPolling: (sessionId: string) => () => void;
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly activePendingInteraction: PendingInteractionPanel | null;
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly activeInteractionPosition: number;
};

export const useAiPanelPendingInteractions = ({
  agentApi,
  activeSessionId,
  activeDetail,
  interactionTextLabels,
  setActiveDetail,
  setIsSending,
  setIsStreamActive,
}: UseAiPanelPendingInteractionsParams): UseAiPanelPendingInteractionsResult => {
  const [livePendingInteractionsBySession, setLivePendingInteractionsBySession] =
    useState<Readonly<Record<string, readonly AgentPendingInteraction[]>>>({});
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [transientInteractionPanel, setTransientInteractionPanel] =
    useState<PendingInteractionPanel | null>(null);

  const interactionPollTokenRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const livePendingInteractionsRef =
    useRef<Readonly<Record<string, readonly AgentPendingInteraction[]>>>({});

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    livePendingInteractionsRef.current = livePendingInteractionsBySession;
  }, [livePendingInteractionsBySession]);

  const syncActiveInteractionState = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      if (activeSessionIdRef.current !== sessionId) {
        return;
      }
      const pendingIds = interactions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => interaction.id);
      if (pendingIds.length > 0) {
        setIsSending(false);
        setIsStreamActive(false);
      }
      setActiveInteractionId((current) => {
        if (current !== null && pendingIds.includes(current)) {
          return current;
        }
        return pendingIds[0] ?? null;
      });
    },
    [setIsSending, setIsStreamActive]
  );

  const replacePendingInteractions = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      const nextInteractions = sortPendingInteractions(interactions);
      livePendingInteractionsRef.current = {
        ...livePendingInteractionsRef.current,
        [sessionId]: nextInteractions
      };
      setLivePendingInteractionsBySession((current) => ({
        ...current,
        [sessionId]: nextInteractions
      }));
      setActiveDetail((current) => {
        if (current === null || current.session.id !== sessionId) {
          return current;
        }
        return {
          ...current,
          pendingInteractions: nextInteractions
        };
      });
      syncActiveInteractionState(sessionId, nextInteractions);
    },
    [setActiveDetail, syncActiveInteractionState]
  );

  const mergePendingInteractionsForSession = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      const currentInteractions = livePendingInteractionsRef.current[sessionId] ?? [];
      const nextInteractions = mergePendingInteractionLists(currentInteractions, interactions);
      replacePendingInteractions(sessionId, nextInteractions);
    },
    [replacePendingInteractions]
  );

  const startPendingInteractionPolling = useCallback(
    (sessionId: string): (() => void) => {
      if (agentApi === undefined) {
        return () => {};
      }
      const pollToken = ++interactionPollTokenRef.current;
      let cancelled = false;
      void (async () => {
        while (!cancelled && interactionPollTokenRef.current === pollToken) {
          try {
            const interactions = await agentApi.getPendingInteractions({ sessionId });
            if (cancelled || interactionPollTokenRef.current !== pollToken) {
              return;
            }
            replacePendingInteractions(sessionId, interactions);
            if (interactions.some((interaction) => interaction.status === "pending")) {
              return;
            }
          } catch (_error) {
            // Ignore polling failures; runtime events and later polls can recover.
          }
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
        }
      })();
      return () => {
        cancelled = true;
        if (interactionPollTokenRef.current === pollToken) {
          interactionPollTokenRef.current += 1;
        }
      };
    },
    [agentApi, replacePendingInteractions]
  );

  useEffect(
    () => () => {
      interactionPollTokenRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    if (activeDetail === null || activeDetail.session.id !== activeSessionId) {
      return;
    }
    setLivePendingInteractionsBySession((current) => ({
      ...current,
      [activeSessionId]: mergePendingInteractionLists(
        current[activeSessionId] ?? [],
        activeDetail.pendingInteractions
      )
    }));
  }, [activeDetail, activeSessionId]);

  const mergedPendingInteractions = useMemo<readonly AgentPendingInteraction[]>(
    () => {
      const persisted = activeDetail?.pendingInteractions ?? [];
      const live =
        activeSessionId === null
          ? []
          : (livePendingInteractionsBySession[activeSessionId] ?? []);
      return mergePendingInteractionLists(persisted, live);
    },
    [activeDetail?.pendingInteractions, activeSessionId, livePendingInteractionsBySession]
  );

  const pendingInteractionQueue = useMemo<readonly PendingInteractionPanel[]>(
    () =>
      mergedPendingInteractions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => toPendingInteractionPanel(interaction, interactionTextLabels))
        .filter((interaction): interaction is PendingInteractionPanel => interaction !== null),
    [interactionTextLabels, mergedPendingInteractions]
  );

  const activeInteractionIndex = useMemo(
    () => pendingInteractionQueue.findIndex((interaction) => interaction.request.id === activeInteractionId),
    [activeInteractionId, pendingInteractionQueue]
  );

  const activePendingInteraction = useMemo<PendingInteractionPanel | null>(() => {
    if (pendingInteractionQueue.length === 0) {
      return null;
    }
    if (activeInteractionIndex >= 0) {
      return pendingInteractionQueue[activeInteractionIndex] ?? pendingInteractionQueue[0] ?? null;
    }
    return pendingInteractionQueue[0] ?? null;
  }, [activeInteractionIndex, pendingInteractionQueue]);

  const activeInteractionPanel = useMemo<ActiveInteractionPanel>(
    () =>
      activePendingInteraction
      ?? transientInteractionPanel,
    [activePendingInteraction, transientInteractionPanel]
  );

  const activeInteractionPosition = activePendingInteraction === null
    ? (transientInteractionPanel === null ? 0 : 1)
    : Math.max(
      1,
      pendingInteractionQueue.findIndex(
        (interaction) => interaction.request.id === activePendingInteraction.request.id
      ) + 1
    );

  useEffect(() => {
    if (activePendingInteraction === null || transientInteractionPanel === null) {
      return;
    }
    if (activePendingInteraction.request.id === transientInteractionPanel.request.id) {
      setTransientInteractionPanel(null);
    }
  }, [activePendingInteraction, transientInteractionPanel]);

  useEffect(() => {
    if (pendingInteractionQueue.length === 0) {
      setActiveInteractionId(null);
      return;
    }
    if (
      activeInteractionId !== null
      && pendingInteractionQueue.some((interaction) => interaction.request.id === activeInteractionId)
    ) {
      return;
    }
    setActiveInteractionId(pendingInteractionQueue[0]?.request.id ?? null);
  }, [activeInteractionId, pendingInteractionQueue]);

  return {
    activeInteractionId,
    setActiveInteractionId,
    transientInteractionPanel,
    setTransientInteractionPanel,
    livePendingInteractionsRef,
    replacePendingInteractions,
    mergePendingInteractionsForSession,
    startPendingInteractionPolling,
    pendingInteractionQueue,
    activePendingInteraction,
    activeInteractionPanel,
    activeInteractionPosition,
  };
};
