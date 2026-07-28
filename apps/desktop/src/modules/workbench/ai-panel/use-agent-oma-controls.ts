import {
  useCallback,
  type Dispatch,
  type MutableRefObject
} from "react";

import type {
  AgentMode,
  AgentSessionSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { LyraAgentDataProviderAction } from "./lyra-agent-data-provider-runtime";

export const useAgentOmaControls = ({
  desktopApi,
  ensureBackingSession,
  currentSessionIdRef,
  dispatch
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly ensureBackingSession: () => Promise<AgentSessionSnapshot | null>;
  readonly currentSessionIdRef: MutableRefObject<string | null>;
  readonly dispatch: Dispatch<LyraAgentDataProviderAction>;
}) => {
  const applyOmaSnapshot = useCallback((snapshot: AgentSessionSnapshot): void => {
    currentSessionIdRef.current = snapshot.id;
    dispatch({ type: "snapshot", snapshot });
  }, [currentSessionIdRef, dispatch]);

  const setAgentMode = useCallback(async (mode: AgentMode): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.setAgentMode({ sessionId: session.id, mode }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const addOmaAgent = useCallback(async (agentId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.addOmaAgent({ sessionId: session.id, agentId }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const removeOmaAgent = useCallback(async (agentId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.removeOmaAgent({ sessionId: session.id, agentId }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const setOmaActiveChannel = useCallback(async (channelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.setOmaActiveChannel({
      sessionId: session.id,
      channelId
    }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  return {
    setAgentMode,
    addOmaAgent,
    removeOmaAgent,
    setOmaActiveChannel
  };
};
