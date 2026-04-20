import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { AgentApi, AgentSessionDetail } from "../../../shared/desktop-bridge";
import { trimOptionalText } from "./view-helpers";

type UseAiPanelBindProjectParams = {
  readonly agentApi: AgentApi | undefined;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
  readonly isBindingProject: boolean;
  readonly setIsBindingProject: Dispatch<SetStateAction<boolean>>;
  readonly activeSessionId: string | null;
  readonly setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  readonly activeDetail: AgentSessionDetail | null;
  readonly activeComposerModel: string | null;
  readonly selectedComposerProfileId: string | null;
  readonly newSessionTitle: string;
  readonly boundProjectPathBySession: Readonly<Record<string, string>>;
  readonly setBoundProjectPathBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setSelectedModelBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly loadSessions: () => Promise<void>;
};

type UseAiPanelBindProjectResult = {
  readonly bindProject: () => Promise<void>;
};

export const useAiPanelBindProject = ({
  agentApi,
  onRequestProjectBind,
  isBindingProject,
  setIsBindingProject,
  activeSessionId,
  setActiveSessionId,
  activeDetail,
  activeComposerModel,
  selectedComposerProfileId,
  newSessionTitle,
  boundProjectPathBySession,
  setBoundProjectPathBySession,
  setSelectedModelBySession,
  setRuntimeError,
  loadSessionDetail,
  loadSessions,
}: UseAiPanelBindProjectParams): UseAiPanelBindProjectResult => {
  const bindProject = useCallback(async (): Promise<void> => {
    if (onRequestProjectBind === undefined || isBindingProject) {
      return;
    }
    setIsBindingProject(true);
    try {
      let targetSessionId = activeSessionId;
      if (targetSessionId === null) {
        if (agentApi === undefined) {
          return;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(selectedComposerProfileId === null
            ? {}
            : { profileId: selectedComposerProfileId }),
        });
        if (activeComposerModel !== null) {
          setSelectedModelBySession((current) => ({
            ...current,
            [created.id]: activeComposerModel,
          }));
        }
        targetSessionId = created.id;
        setActiveSessionId(created.id);
        await loadSessions();
        await loadSessionDetail(created.id);
      }
      if (targetSessionId === null) {
        return;
      }
      const currentPath =
        trimOptionalText(boundProjectPathBySession[targetSessionId])
        ?? (
          activeDetail?.session.id === targetSessionId
            ? trimOptionalText(activeDetail.session.projectRoot)
            : null
        )
        ?? undefined;
      const nextPath = await onRequestProjectBind(currentPath);
      if (typeof nextPath !== "string" || nextPath.trim().length === 0) {
        return;
      }
      const normalizedPath = nextPath.trim();
      const persistedSession =
        agentApi === undefined
          ? null
          : await agentApi.bindSessionProject({
              sessionId: targetSessionId,
              projectRoot: normalizedPath,
            });
      setBoundProjectPathBySession((current) => ({
        ...current,
        [targetSessionId]:
          persistedSession?.projectRoot !== undefined
            ? persistedSession.projectRoot
            : normalizedPath,
      }));
      await loadSessionDetail(targetSessionId);
      await loadSessions();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBindingProject(false);
    }
  }, [
    activeComposerModel,
    activeDetail?.session.id,
    activeDetail?.session.projectRoot,
    activeSessionId,
    agentApi,
    boundProjectPathBySession,
    isBindingProject,
    loadSessionDetail,
    loadSessions,
    newSessionTitle,
    onRequestProjectBind,
    selectedComposerProfileId,
    setActiveSessionId,
    setBoundProjectPathBySession,
    setIsBindingProject,
    setRuntimeError,
    setSelectedModelBySession,
  ]);

  return {
    bindProject,
  };
};
