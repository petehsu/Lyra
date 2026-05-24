import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  JcodeAccountRequest,
  JcodeAccountsResponse,
  JcodeConfigSnapshot,
  JcodeConfigUpdateRequest,
  JcodeAgentRolesUpdateRequest,
  JcodeProviderProfileSaveRequest,
} from "../../../shared/desktop-bridge";
import type { AiProviderModelEntry, AiProviderProfile } from "../../../shared/ai";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  SettingsAiDraft,
  SettingsAiLabels,
  SettingsAiModel,
  SettingsAiModelSelectionMode,
  SettingsAiPresetSection,
} from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
  readonly onOpenJcodeConfigFile?:
    | ((filePath: string) => void | Promise<void>)
    | undefined;
};

const emptyDraft = (): SettingsAiDraft => ({
  id: null,
  name: "lyra-agent-provider",
  providerId: "jcode",
  protocolId: "openai_chat_completions",
  presetId: null,
  connectionConfig: {},
  authConfig: {},
  secretValues: {},
  configuredSecretFields: [],
  headersText: "",
  modelSelectionMode: "custom",
  modelsText: "",
  isDefault: true,
});

const emptySections = (labels: SettingsAiLabels): readonly SettingsAiPresetSection[] => [
  { id: "mainstream", label: labels.sectionJcode, presets: [] },
  { id: "local", label: labels.sectionSessions, presets: [] },
  { id: "custom", label: labels.sectionCommands, presets: [] },
];

const profilesFromJcodeConfig = (
  snapshot: JcodeConfigSnapshot | null
): readonly AiProviderProfile[] => {
  const config = snapshot?.config as {
    provider?: {
      default_model?: string | null;
      default_provider?: string | null;
      defaultModel?: string | null;
      defaultProvider?: string | null;
    };
    providers?: Record<string, {
      base_url?: string;
      baseUrl?: string;
      default_model?: string | null;
      defaultModel?: string | null;
      models?: readonly { readonly id?: string }[];
    }>;
  } | null;
  const providers = config?.providers ?? {};
  const defaultProvider =
    config?.provider?.default_provider ?? config?.provider?.defaultProvider ?? null;
  const now = Date.now();
  return Object.entries(providers).map(([name, provider]) => {
    const defaultModel = provider.default_model ?? provider.defaultModel ?? "";
    const customModels: readonly AiProviderModelEntry[] = (provider.models ?? [])
      .map((model) => model.id?.trim() ?? "")
      .filter((id) => id.length > 0 && id !== defaultModel)
      .map((id) => ({ id, name: id, source: "custom" as const }));
    return {
      id: name,
      name,
      providerId: "custom_openai_compatible",
      protocolId: "custom_chat_completions",
      runtimeProviderId: name,
      runtimeSupported: true,
      secretStatus: "configured",
      presetId: null,
      connectionConfig: {
        baseUrl: provider.base_url ?? provider.baseUrl ?? "",
      },
      authConfig: {},
      configuredSecretFields: [],
      headers: {},
      model: defaultModel,
      customModels,
      discoveryState: { status: "idle", lastCheckedAt: null, models: [] },
      isDefault: defaultProvider === name,
      createdAt: now,
      updatedAt: now,
    };
  });
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
  onOpenJcodeConfigFile,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [jcodeConfig, setJcodeConfig] = useState<JcodeConfigSnapshot | null>(null);
  const [jcodeAccounts, setJcodeAccounts] = useState<JcodeAccountsResponse | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(() => emptyDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshJcode = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const config = await desktopApi.agent.readJcodeConfig();
    setJcodeConfig(config);
    const listAccounts = desktopApi.agent.listAccounts;
    if (typeof listAccounts === "function") {
      setJcodeAccounts(await listAccounts());
    }
    setErrorMessage(null);
  }, [desktopApi, labels.runtimeUnavailable]);

  useEffect(() => {
    void refreshJcode().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [refreshJcode]);

  const updateJcodeConfig = useCallback(async (request: JcodeConfigUpdateRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setJcodeConfig(await desktopApi.agent.updateJcodeConfig(request));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const saveJcodeProviderProfile = useCallback(async (
    request: JcodeProviderProfileSaveRequest
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setJcodeConfig(await desktopApi.agent.saveJcodeProviderProfile(request));
      setErrorMessage(null);
      await refreshJcode();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshJcode]);

  const updateJcodeAgentRoles = useCallback(async (
    request: JcodeAgentRolesUpdateRequest
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setJcodeConfig(await desktopApi.agent.updateJcodeAgentRoles(request));
      setErrorMessage(null);
      await refreshJcode();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshJcode]);

  const switchJcodeAccount = useCallback(async (request: JcodeAccountRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setJcodeAccounts(await desktopApi.agent.switchAccount(request));
      await refreshJcode();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshJcode]);

  const removeJcodeAccount = useCallback(async (request: JcodeAccountRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setJcodeAccounts(await desktopApi.agent.removeAccount(request));
      await refreshJcode();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshJcode]);

  const openJcodeConfigFile = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    if (onOpenJcodeConfigFile === undefined) {
      setErrorMessage(labels.fileEditorUnavailable);
      return;
    }
    try {
      const snapshot = jcodeConfig ?? await desktopApi.agent.readJcodeConfig();
      setJcodeConfig(snapshot);
      const configPath = snapshot.configPath?.trim() ?? "";
      if (configPath.length === 0) {
        setErrorMessage(labels.configPathUnavailable);
        return;
      }
      await onOpenJcodeConfigFile(configPath);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    desktopApi,
    jcodeConfig,
    labels.configPathUnavailable,
    labels.fileEditorUnavailable,
    labels.runtimeUnavailable,
    onOpenJcodeConfigFile
  ]);

  const profiles = useMemo(() => profilesFromJcodeConfig(jcodeConfig), [jcodeConfig]);
  const defaultProfile = profiles.find((profile) => profile.isDefault) ?? null;

  const noopAsync = useCallback(async (): Promise<void> => undefined, []);
  const noop = useCallback((): void => undefined, []);

  return {
    isSaving,
    errorMessage,
    profiles,
    presetSections: emptySections(labels),
    selectedProfileId: defaultProfile?.id ?? null,
    defaultProfileId: defaultProfile?.id ?? null,
    defaultProviderId: defaultProfile?.providerId ?? null,
    defaultModelNames: defaultProfile?.model ? [defaultProfile.model] : [],
    selectedPresetId: null,
    selectedPreset: null,
    jcodeConfig,
    jcodeAccounts,
    jcodeCommands: jcodeConfig?.commands ?? [],
    draft,
    modelSelectionMode: draft.modelSelectionMode,
    availableModels: [],
    selectProfile: noop,
    applyPreset: noop,
    updateDraftName: (value) => {
      setDraft((current) => ({ ...current, name: value }));
    },
    updateDraftModelSelectionMode: (value: SettingsAiModelSelectionMode) => {
      setDraft((current) => ({ ...current, modelSelectionMode: value }));
    },
    updateDraftHeadersText: (value) => {
      setDraft((current) => ({ ...current, headersText: value }));
    },
    updateDraftModelsText: (value) => {
      setDraft((current) => ({ ...current, modelsText: value }));
    },
    updateDraftField: (target, fieldId, value) => {
      setDraft((current) => {
        const next = { ...(target === "connection"
          ? current.connectionConfig
          : target === "auth"
            ? current.authConfig
            : current.secretValues) };
        if (value.trim().length === 0) {
          delete next[fieldId];
        } else {
          next[fieldId] = value;
        }
        if (target === "connection") return { ...current, connectionConfig: next };
        if (target === "auth") return { ...current, authConfig: next };
        return { ...current, secretValues: next };
      });
    },
    saveProfile: noopAsync,
    deleteProfile: noopAsync,
    deleteProviderModels: noopAsync,
    deleteConfiguredModel: noopAsync,
    setDefaultProfile: async (profileId: string) => {
      const profile = profiles.find((entry) => entry.id === profileId);
      await updateJcodeConfig({
        defaultProvider: profileId,
        defaultModel: profile?.model ?? null,
      });
    },
    refreshJcode,
    openJcodeConfigFile,
    updateJcodeConfig,
    saveJcodeProviderProfile,
    updateJcodeAgentRoles,
    switchJcodeAccount,
    removeJcodeAccount,
  };
};
