import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AiComputerSessionState,
  AiComputerWindowFrame
} from "../../../../shared/computer";
import type {
  LyraDesktopApi,
  LyraSystemResolvedSession
} from "../../../../shared/desktop-bridge";
import type {
  AiComputerModel,
  UseAiComputerModelOptions
} from "./types";

const normalizeSessionIds = (sessionIds: readonly string[]): readonly string[] =>
  Array.from(
    new Set(
      sessionIds
        .map((sessionId) => sessionId.trim())
        .filter((sessionId) => sessionId.length > 0)
    )
  );

const sortByUpdatedAtDesc = (
  left: AiComputerSessionState,
  right: AiComputerSessionState
): number => Number(right.updatedAt) - Number(left.updatedAt);

export const useAiComputerModel = ({
  desktopApi,
  sessionIds
}: UseAiComputerModelOptions): AiComputerModel => {
  const [hostStatus, setHostStatus] = useState<AiComputerModel["hostStatus"]>(null);
  const [statesBySessionId, setStatesBySessionId] = useState<
    Readonly<Record<string, AiComputerSessionState>>
  >({});
  const [resolvedSystemsBySessionId, setResolvedSystemsBySessionId] = useState<
    Readonly<Record<string, LyraSystemResolvedSession>>
  >({});
  const statesBySessionIdRef = useRef<Readonly<Record<string, AiComputerSessionState>>>({});
  const sessionIdsSignature = sessionIds.join("\u001f");
  const normalizedSessionIds = useMemo(
    () => normalizeSessionIds(sessionIds),
    [sessionIdsSignature]
  );

  const mergeSessionState = useCallback((state: AiComputerSessionState): void => {
    setStatesBySessionId((current) => ({
      ...current,
      [state.sessionId]: state
    }));
  }, []);

  const mergeResolvedSystem = useCallback((resolved: LyraSystemResolvedSession): void => {
    setResolvedSystemsBySessionId((current) => ({
      ...current,
      [resolved.sessionId]: resolved
    }));
  }, []);

  const decorateSessionState = useCallback((
    state: AiComputerSessionState
  ): AiComputerSessionState => {
    const resolved = resolvedSystemsBySessionId[state.sessionId];
    if (resolved === undefined) {
      return state;
    }
    return {
      ...state,
      resolvedSystemImageId: resolved.resolvedSystemImageId,
      effectiveRuntimeMode: resolved.effectiveRuntimeMode,
      effectiveShellMode: resolved.effectiveShellMode,
      systemContextState: resolved.systemContextState
    };
  }, [resolvedSystemsBySessionId]);

  const syncResolvedSession = useCallback(
    async (
      sessionId: string,
      powerState?: AiComputerSessionState["powerState"]
    ): Promise<LyraSystemResolvedSession | null> => {
      if (desktopApi === null) {
        return null;
      }
      const resolved = await desktopApi.systemImages.readResolvedSessionSystem({
        sessionId,
        ...(powerState === undefined ? {} : { computerPowerState: powerState })
      });
      mergeResolvedSystem(resolved);
      return resolved;
    },
    [desktopApi, mergeResolvedSystem]
  );

  const readSession = useCallback(
    async (sessionId: string): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.readSession({ sessionId });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    let cancelled = false;
    void desktopApi.computer.readHostStatus().then((nextStatus) => {
      if (cancelled) {
        return;
      }
      setHostStatus(nextStatus);
    });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    statesBySessionIdRef.current = statesBySessionId;
  }, [statesBySessionId]);

  useEffect(() => {
    if (desktopApi === null || normalizedSessionIds.length === 0) {
      return;
    }

    const unsubscribeFns = normalizedSessionIds.map((sessionId) =>
      desktopApi.computer.subscribeSession(sessionId, (event) => {
        mergeSessionState(event.state);
        void syncResolvedSession(event.sessionId, event.state.powerState);
      })
    );

    void Promise.all(
      normalizedSessionIds.map(async (sessionId) => {
        const state = await desktopApi.computer.readSession({ sessionId });
        mergeSessionState(state);
        await syncResolvedSession(sessionId, state.powerState);
      })
    );

    return () => {
      for (const unsubscribe of unsubscribeFns) {
        unsubscribe();
      }
    };
  }, [desktopApi, mergeSessionState, normalizedSessionIds, syncResolvedSession]);

  useEffect(() => {
    if (desktopApi === null || normalizedSessionIds.length === 0) {
      return;
    }
    const tracked = new Set(normalizedSessionIds);
    return desktopApi.systemImages.subscribeSystemEvents((event) => {
      if (event.kind === "session-updated") {
        if (tracked.has(event.sessionId)) {
          mergeResolvedSystem(event.resolved);
        }
        return;
      }

      for (const sessionId of tracked.values()) {
        const sessionState = statesBySessionIdRef.current[sessionId];
        void syncResolvedSession(sessionId, sessionState?.powerState);
      }
    });
  }, [desktopApi, mergeResolvedSystem, normalizedSessionIds, syncResolvedSession]);

  const powerOn = useCallback(
    async (
      sessionId: string,
      reason: "user" | "ai"
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.powerOn({ sessionId, reason });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const ensurePoweredOn = useCallback(
    async (
      sessionId: string,
      reason: "user" | "ai"
    ): Promise<AiComputerSessionState | null> => {
      const current = statesBySessionId[sessionId];
      if (current?.powerState === "on" || current?.powerState === "booting") {
        return current;
      }
      return powerOn(sessionId, reason);
    },
    [powerOn, statesBySessionId]
  );

  const powerOff = useCallback(
    async (sessionId: string): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.powerOff({ sessionId });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const openApp = useCallback(
    async (
      sessionId: string,
      request: {
        readonly kind: "file-manager" | "file-editor" | "terminal" | "browser";
        readonly title?: string;
        readonly appInstanceId?: string;
        readonly filePath?: string;
        readonly directoryPath?: string;
        readonly address?: string;
      }
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.openApp({
        sessionId,
        ...request
      });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const focusApp = useCallback(
    async (
      sessionId: string,
      appInstanceId: string
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.focusApp({
        sessionId,
        appInstanceId
      });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const closeApp = useCallback(
    async (
      sessionId: string,
      appInstanceId: string
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.closeApp({
        sessionId,
        appInstanceId
      });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const moveAppWindow = useCallback(
    async (
      sessionId: string,
      appInstanceId: string,
      frame: AiComputerWindowFrame
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.moveAppWindow({
        sessionId,
        appInstanceId,
        frame
      });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const resizeAppWindow = useCallback(
    async (
      sessionId: string,
      appInstanceId: string,
      frame: AiComputerWindowFrame
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.resizeAppWindow({
        sessionId,
        appInstanceId,
        frame
      });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const minimizeApp = useCallback(
    async (
      sessionId: string,
      appInstanceId: string
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.minimizeApp({ sessionId, appInstanceId });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const maximizeApp = useCallback(
    async (
      sessionId: string,
      appInstanceId: string
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.maximizeApp({ sessionId, appInstanceId });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const restoreApp = useCallback(
    async (
      sessionId: string,
      appInstanceId: string
    ): Promise<AiComputerSessionState | null> => {
      if (desktopApi === null) {
        return null;
      }
      const state = await desktopApi.computer.restoreApp({ sessionId, appInstanceId });
      mergeSessionState(state);
      void syncResolvedSession(state.sessionId, state.powerState);
      return decorateSessionState(state);
    },
    [decorateSessionState, desktopApi, mergeSessionState, syncResolvedSession]
  );

  const ensureOfficialSystemInstalled = useCallback(
    async (sessionId: string): Promise<LyraSystemResolvedSession | null> => {
      if (desktopApi === null) {
        return null;
      }
      await desktopApi.systemImages.installOfficialSeed();
      const powerState = statesBySessionIdRef.current[sessionId]?.powerState;
      return syncResolvedSession(sessionId, powerState);
    },
    [desktopApi, syncResolvedSession]
  );

  const orderedStates = useMemo(
    () => Object.values(statesBySessionId).map(decorateSessionState).sort(sortByUpdatedAtDesc),
    [decorateSessionState, statesBySessionId]
  );

  const externalFileManagerInstanceIds = useMemo(
    () =>
      orderedStates.flatMap((state) =>
        state.openApps
          .filter((app) => app.kind === "file-manager")
          .map((app) => app.id)
      ),
    [orderedStates]
  );

  const externalFileEditorInstanceIds = useMemo(
    () =>
      orderedStates.flatMap((state) =>
        state.openApps
          .filter((app) => app.kind === "file-editor")
          .map((app) => app.id)
      ),
    [orderedStates]
  );

  return {
    hostStatus,
    getSessionState: (sessionId) => {
      const state = statesBySessionId[sessionId];
      return state === undefined ? null : decorateSessionState(state);
    },
    externalFileManagerInstanceIds,
    externalFileEditorInstanceIds,
    readSession,
    ensurePoweredOn,
    powerOn,
    powerOff,
    openApp,
    focusApp,
    closeApp,
    moveAppWindow,
    resizeAppWindow,
    minimizeApp,
    maximizeApp,
    restoreApp,
    ensureOfficialSystemInstalled
  };
};
