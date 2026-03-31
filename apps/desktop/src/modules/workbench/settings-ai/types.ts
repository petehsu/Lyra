import type {
  AiModelDiscoveryResult,
  AiProviderCatalogItem,
  AiProviderId,
  AiProtocolId,
  AiProviderPreset,
  AiProviderProfile
} from "../../../shared/ai";

export type SettingsAiLabels = {
  readonly categoryLabel: string;
  readonly profilesTitle: string;
  readonly providerTitle: string;
  readonly connectionTitle: string;
  readonly statusTitle: string;
  readonly addProfile: string;
  readonly saveProfile: string;
  readonly deleteProfile: string;
  readonly setDefaultProfile: string;
  readonly clearApiKey: string;
  readonly testConnection: string;
  readonly discoverModels: string;
  readonly refreshModels: string;
  readonly profileNameLabel: string;
  readonly profileNamePlaceholder: string;
  readonly modelLabel: string;
  readonly modelPlaceholder: string;
  readonly headersLabel: string;
  readonly headersPlaceholder: string;
  readonly customModelsLabel: string;
  readonly customModelsPlaceholder: string;
  readonly defaultBadge: string;
  readonly defaultProfileLabel: string;
  readonly statusIdle: string;
  readonly statusSaved: string;
  readonly statusDeleted: string;
  readonly statusDefaultUpdated: string;
  readonly statusLastChecked: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly recommendedSection: string;
  readonly allSection: string;
  readonly customSection: string;
  readonly secretConfigured: string;
  readonly secretMissing: string;
  readonly noDiscoveredModels: string;
  readonly capabilityLabel: string;
  readonly capabilityFull: string;
  readonly capabilityStatic: string;
  readonly capabilityPending: string;
  readonly modelSourceDynamic: string;
  readonly modelSourcePreset: string;
  readonly modelSourceCustom: string;
};

export type SettingsAiDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly providerId: AiProviderId;
  readonly protocolId: AiProtocolId;
  readonly presetId: string | null;
  readonly connectionConfig: Record<string, string>;
  readonly authConfig: Record<string, string>;
  readonly secretValues: Record<string, string>;
  readonly clearSecretFields: readonly string[];
  readonly configuredSecretFields: readonly string[];
  readonly headersText: string;
  readonly model: string;
  readonly customModelsText: string;
  readonly isDefault: boolean;
};

export type SettingsAiModel = {
  readonly profiles: readonly AiProviderProfile[];
  readonly providerCatalog: readonly AiProviderCatalogItem[];
  readonly presetCatalog: readonly AiProviderPreset[];
  readonly selectedProfileId: string | null;
  readonly draft: SettingsAiDraft;
  readonly discoveryResult: AiModelDiscoveryResult | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isTesting: boolean;
  readonly isDiscovering: boolean;
  readonly statusMessage: string;
  readonly statusTone: "neutral" | "success" | "error";
  readonly lastCheckedAt: number | null;
  readonly selectProfile: (profileId: string) => void;
  readonly createProfileDraft: () => void;
  readonly selectPreset: (presetId: string) => void;
  readonly updateName: (value: string) => void;
  readonly updateModel: (value: string) => void;
  readonly updateDraftField: (
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ) => void;
  readonly updateHeadersText: (value: string) => void;
  readonly updateCustomModelsText: (value: string) => void;
  readonly clearSecretField: (fieldId: string) => void;
  readonly saveProfile: () => Promise<void>;
  readonly deleteProfile: () => Promise<void>;
  readonly setDefaultProfile: () => Promise<void>;
  readonly testConnection: () => Promise<void>;
  readonly discoverModels: () => Promise<void>;
  readonly refreshDiscoveredModels: () => Promise<void>;
};
