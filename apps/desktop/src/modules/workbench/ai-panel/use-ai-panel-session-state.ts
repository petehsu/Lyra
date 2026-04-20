import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";

import type { AiProviderProfile } from "../../../shared/ai";
import type { AgentSessionDetail } from "../../../shared/desktop-bridge";
import {
  resolveProfileModels,
  trimOptionalText,
} from "./view-helpers";

type UseAiPanelSessionStateParams = {
  readonly profiles: readonly AiProviderProfile[];
  readonly activeDetail: AgentSessionDetail | null;
  readonly defaultProfileId?: string | null | undefined;
  readonly defaultModelNames: readonly string[];
  readonly selectedModelBySession: Readonly<Record<string, string>>;
  readonly setSelectedModelBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly activeSessionId: string | null;
  readonly planModeArmedBySession: Readonly<Record<string, boolean>>;
  readonly setPlanModeArmedBySession: Dispatch<SetStateAction<Readonly<Record<string, boolean>>>>;
};

type ComposerModelOption = {
  readonly modelName: string;
  readonly profileId: string;
};

type UseAiPanelSessionStateResult = {
  readonly fallbackModelNames: readonly string[];
  readonly defaultConfiguredProfile: AiProviderProfile | null;
  readonly activeSessionProfile: AiProviderProfile | null;
  readonly composerModelOptions: readonly ComposerModelOption[];
  readonly composerModelNames: readonly string[];
  readonly activeComposerModel: string | null;
  readonly activeComposerModelOption: ComposerModelOption | null;
  readonly selectedComposerProfileId: string | null;
  readonly isPlanModeArmed: boolean;
};

export const useAiPanelSessionState = ({
  profiles,
  activeDetail,
  defaultProfileId,
  defaultModelNames,
  selectedModelBySession,
  setSelectedModelBySession,
  activeSessionId,
  planModeArmedBySession,
  setPlanModeArmedBySession,
}: UseAiPanelSessionStateParams): UseAiPanelSessionStateResult => {
  const fallbackModelNames = useMemo(
    () => defaultModelNames
      .map((entry) => entry.trim())
      .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index),
    [defaultModelNames]
  );

  const defaultConfiguredProfile = useMemo<AiProviderProfile | null>(
    () => profiles.find((profile) => profile.isDefault) ?? null,
    [profiles]
  );

  const activeSessionProfile = useMemo<AiProviderProfile | null>(() => {
    const activeProfileId = trimOptionalText(activeDetail?.session.profileId);
    if (activeProfileId === null) {
      return null;
    }
    return profiles.find((profile) => profile.id === activeProfileId) ?? null;
  }, [activeDetail?.session.profileId, profiles]);

  const composerModelOptions = useMemo(
    (): readonly ComposerModelOption[] => {
      const orderedProfiles: AiProviderProfile[] = [];
      const seenProfileIds = new Set<string>();
      const pushProfile = (profile: AiProviderProfile | null): void => {
        if (profile === null || seenProfileIds.has(profile.id)) {
          return;
        }
        seenProfileIds.add(profile.id);
        orderedProfiles.push(profile);
      };
      pushProfile(defaultConfiguredProfile);
      pushProfile(activeSessionProfile);
      for (const profile of profiles) {
        pushProfile(profile);
      }

      const options: ComposerModelOption[] = [];
      const seenModelNames = new Set<string>();
      for (const profile of orderedProfiles) {
        const models = resolveProfileModels(profile);
        for (const modelName of models) {
          if (seenModelNames.has(modelName)) {
            continue;
          }
          seenModelNames.add(modelName);
          options.push({
            modelName,
            profileId: profile.id
          });
        }
      }
      if (options.length > 0) {
        return options;
      }
      const fallbackProfileId =
        trimOptionalText(defaultProfileId ?? null)
        ?? trimOptionalText(activeDetail?.session.profileId)
        ?? "";
      return fallbackModelNames.map((modelName) => ({
        modelName,
        profileId: fallbackProfileId
      }));
    },
    [
      activeDetail?.session.profileId,
      activeSessionProfile,
      defaultConfiguredProfile,
      defaultProfileId,
      fallbackModelNames,
      profiles
    ]
  );

  const composerModelNames = useMemo(
    () => composerModelOptions.map((entry) => entry.modelName),
    [composerModelOptions]
  );

  const activeComposerModel = useMemo(() => {
    const fallback = composerModelNames[0] ?? null;
    if (activeSessionId === null) {
      return fallback;
    }
    const selected = trimOptionalText(selectedModelBySession[activeSessionId]);
    if (selected === null) {
      return fallback;
    }
    return composerModelNames.includes(selected) ? selected : fallback;
  }, [activeSessionId, composerModelNames, selectedModelBySession]);

  const activeComposerModelOption = useMemo(
    () =>
      activeComposerModel === null
        ? null
        : (composerModelOptions.find((entry) => entry.modelName === activeComposerModel) ?? null),
    [activeComposerModel, composerModelOptions]
  );

  const selectedComposerProfileId = useMemo(
    () =>
      trimOptionalText(activeComposerModelOption?.profileId)
      ?? trimOptionalText(defaultProfileId ?? null)
      ?? trimOptionalText(activeDetail?.session.profileId),
    [activeComposerModelOption?.profileId, activeDetail?.session.profileId, defaultProfileId]
  );

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    const fallbackModel = composerModelNames[0];
    if (fallbackModel === undefined) {
      return;
    }
    setSelectedModelBySession((current) => {
      const selected = trimOptionalText(current[activeSessionId]);
      if (selected !== null && composerModelNames.includes(selected)) {
        return current;
      }
      return {
        ...current,
        [activeSessionId]: fallbackModel
      };
    });
  }, [activeSessionId, composerModelNames, setSelectedModelBySession]);

  useEffect(() => {
    if (activeSessionId === null || activeDetail?.session.id !== activeSessionId) {
      return;
    }
    if (activeDetail.session.collaborationMode !== "plan") {
      return;
    }
    setPlanModeArmedBySession((current) => {
      if (current[activeSessionId] !== true) {
        return current;
      }
      return {
        ...current,
        [activeSessionId]: false
      };
    });
  }, [activeDetail?.session.collaborationMode, activeDetail?.session.id, activeSessionId, setPlanModeArmedBySession]);

  const isPlanModeArmed = useMemo(() => {
    if (activeSessionId === null) {
      return false;
    }
    return planModeArmedBySession[activeSessionId] === true;
  }, [activeSessionId, planModeArmedBySession]);

  return {
    fallbackModelNames,
    defaultConfiguredProfile,
    activeSessionProfile,
    composerModelOptions,
    composerModelNames,
    activeComposerModel,
    activeComposerModelOption,
    selectedComposerProfileId,
    isPlanModeArmed,
  };
};
