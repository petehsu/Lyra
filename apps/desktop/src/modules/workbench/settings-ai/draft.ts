import type {
  AiProviderFieldSchema,
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderProfile
} from "../../../shared/ai";
import { normalizePresetId, resolvePreset } from "./preset";
import type { SettingsAiDraft, SettingsAiModelSelectionMode } from "./types";

export const serializeMap = (value: Record<string, string>): string =>
  Object.entries(value)
    .map(([key, entry]) => `${key}: ${entry}`)
    .join("\n");

const MODEL_VALUE_DELIMITER = /[\r\n,，、;；]+/;
const PRIMARY_URL_FIELD_IDS = ["baseUrl", "endpointOverride"] as const;
const PRIMARY_SECRET_FIELD_IDS = ["apiKey", "refreshToken"] as const;
const DEFAULT_PROVIDER_ID = "lmstudio";
const DEFAULT_PROTOCOL_ID = "lmstudio_chat_completions";
export const MODEL_SELECTION_MODE_AUTH_CONFIG_KEY = "modelSelectionMode";

const draftConnectionConfig = (
  preset: AiProviderPreset | null,
  profile: AiProviderProfile | null
): Readonly<Record<string, string>> => {
  if (profile === null) {
    return { ...(preset?.defaultConnectionConfig ?? {}) };
  }
  if (preset?.connectionFields.length === 0) {
    return { ...preset.defaultConnectionConfig };
  }
  return { ...profile.connectionConfig };
};

const draftPresetId = (
  profile: AiProviderProfile | null,
  preset: AiProviderPreset | null
): string | null => {
  if (profile?.providerId === "mimo") {
    const route = profile.connectionConfig.mimoRoute ?? "";
    const baseUrl = profile.connectionConfig.baseUrl ?? "";
    if (
      normalizePresetId(profile.presetId) === "mimo_token_plan"
      || route === "token_plan"
      || baseUrl.includes("token-plan")
    ) {
      return "mimo_token_plan";
    }
    return "mimo_api";
  }
  return preset?.id ?? normalizePresetId(profile?.presetId ?? null);
};

const isModelSelectionMode = (value: string | undefined): value is SettingsAiModelSelectionMode =>
  value === "custom" || value === "all";

const draftModelSelectionMode = (
  profile: AiProviderProfile | null
): SettingsAiModelSelectionMode => {
  if (profile === null) {
    return "all";
  }
  const configuredMode = profile.authConfig[MODEL_SELECTION_MODE_AUTH_CONFIG_KEY];
  if (isModelSelectionMode(configuredMode)) {
    return configuredMode;
  }
  return profile.customModels.length > 0 || profile.discoveryState.models.length > 0
    ? "all"
    : "custom";
};

export const parseMap = (value: string): Record<string, string> =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce<Record<string, string>>((result, line) => {
      const divider = line.includes(":") ? ":" : "=";
      const [key, ...rest] = line.split(divider);
      const nextKey = key?.trim() ?? "";
      const nextValue = rest.join(divider).trim();
      if (nextKey.length > 0 && nextValue.length > 0) {
        result[nextKey] = nextValue;
      }
      return result;
    }, {});

export const serializeConfiguredModels = (
  primaryModel: string,
  models: readonly AiProviderModelEntry[]
): string => [primaryModel, ...models.map((model) => model.id)]
  .map((entry) => entry.trim())
  .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
  .join("\n");

const configuredModelLines = (value: string): readonly string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const readPrimaryConfiguredModelLine = (value: string): string =>
  configuredModelLines(value)[0] ?? "";

export const readAdditionalConfiguredModelLines = (value: string): string =>
  configuredModelLines(value).slice(1).join("\n");

export const replacePrimaryConfiguredModelLine = (
  value: string,
  primaryModel: string
): string => [
  primaryModel.trim(),
  ...configuredModelLines(value).slice(1)
]
  .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
  .join("\n");

export const replaceAdditionalConfiguredModelLines = (
  value: string,
  additionalModelsText: string
): string => [
  readPrimaryConfiguredModelLine(value),
  ...configuredModelLines(additionalModelsText)
]
  .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
  .join("\n");

export const toggleAdditionalConfiguredModelLine = (
  value: string,
  modelId: string
): string => {
  const primaryModel = readPrimaryConfiguredModelLine(value);
  const normalizedModelId = modelId.trim();
  if (normalizedModelId.length === 0 || normalizedModelId === primaryModel) {
    return value;
  }
  const additionalLines = configuredModelLines(value).slice(1);
  const nextAdditionalLines = additionalLines.includes(normalizedModelId)
    ? additionalLines.filter((line) => line !== normalizedModelId)
    : [...additionalLines, normalizedModelId];
  return [primaryModel, ...nextAdditionalLines]
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .join("\n");
};

export const appendAdditionalConfiguredModelLines = (
  value: string,
  modelIds: readonly string[]
): string => {
  const primaryModel = readPrimaryConfiguredModelLine(value);
  return [
    primaryModel,
    ...configuredModelLines(value).slice(1),
    ...modelIds.map((modelId) => modelId.trim())
  ]
    .filter((line, index, lines) =>
      line.length > 0 && line !== primaryModel && lines.indexOf(line) === index
    )
    .reduce<string[]>((lines, line) => [...lines, line], primaryModel.length > 0 ? [primaryModel] : [])
    .join("\n");
};

type ParsedModelEntry = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
};

const pushParsedModelEntry = (
  result: ParsedModelEntry[],
  value: string
): void => {
  const normalized = value.trim();
  if (normalized.length === 0 || result.some((entry) => entry.id === normalized)) {
    return;
  }
  result.push({
    id: normalized,
    name: normalized
  });
};

export const parseConfiguredModelEntries = (value: string): readonly ParsedModelEntry[] => {
  const result: ParsedModelEntry[] = [];
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      if (line.includes("|")) {
        const [id, name, description] = line.split("|").map((entry) => entry.trim());
        const normalizedId = id || name || line;
        if (normalizedId.length === 0 || result.some((entry) => entry.id === normalizedId)) {
          return;
        }
        result.push({
          id: normalizedId,
          name: name || normalizedId,
          ...(description ? { description } : {})
        });
        return;
      }
      line
        .split(MODEL_VALUE_DELIMITER)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .forEach((entry) => {
          pushParsedModelEntry(result, entry);
        });
    });
  return result;
};

export const parseCustomModels = (value: string): readonly AiProviderModelEntry[] =>
  parseConfiguredModelEntries(value).map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    source: "custom" as const
  }));

export const resolveConfiguredModels = (
  value: string,
  knownModels: readonly AiProviderModelEntry[],
  fallbackModel: string
): {
  readonly primaryModel: string;
  readonly customModels: readonly AiProviderModelEntry[];
  readonly modelIds: readonly string[];
} => {
  const parsed = parseConfiguredModelEntries(value);
  const fallbackId = fallbackModel.trim();
  const modelIds = (parsed.length > 0 ? parsed.map((entry) => entry.id) : [fallbackId])
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
  const knownById = new Map(knownModels.map((entry) => [entry.id, entry]));
  return {
    primaryModel: modelIds[0] ?? fallbackId,
    customModels: modelIds.slice(1).map((id) => {
      const known = knownById.get(id);
      const parsedEntry = parsed.find((entry) => entry.id === id);
      return known ?? {
        id,
        name: parsedEntry?.name ?? id,
        ...(parsedEntry?.description ? { description: parsedEntry.description } : {}),
        source: "custom" as const
      };
    }),
    modelIds
  };
};

const resolvePrimaryFieldId = (
  fields: readonly AiProviderFieldSchema[],
  preferredIds: readonly string[],
  predicate: (field: AiProviderFieldSchema) => boolean
): string | null =>
  preferredIds.find((fieldId) => fields.some((field) => field.id === fieldId && predicate(field)))
  ?? fields.find(predicate)?.id
  ?? null;

export const resolvePrimaryUrlFieldId = (preset: AiProviderPreset | null): string | null =>
  preset === null
    ? "baseUrl"
    : resolvePrimaryFieldId(
        preset.connectionFields,
        PRIMARY_URL_FIELD_IDS,
        (field) => field.scope === "connection" && (field.kind === "url" || field.id === "baseUrl" || field.id === "endpointOverride")
      );

export const resolvePrimarySecretFieldId = (preset: AiProviderPreset | null): string | null =>
  preset === null
    ? "apiKey"
    : resolvePrimaryFieldId(
        preset.authFields,
        PRIMARY_SECRET_FIELD_IDS,
        (field) => field.scope === "auth" && field.secret === true
      );

export const readPrimaryConnectionValue = (
  preset: AiProviderPreset | null,
  connectionConfig: Record<string, string>
): string => {
  const fieldId = resolvePrimaryUrlFieldId(preset);
  return fieldId === null ? "" : (connectionConfig[fieldId] ?? "");
};

export const readPrimarySecretValue = (
  preset: AiProviderPreset | null,
  secretValues: Record<string, string>
): string => {
  const fieldId = resolvePrimarySecretFieldId(preset);
  return fieldId === null ? "" : (secretValues[fieldId] ?? "");
};

export const hasConfiguredPrimarySecret = (
  preset: AiProviderPreset | null,
  configuredSecretFields: readonly string[]
): boolean => {
  const fieldId = resolvePrimarySecretFieldId(preset);
  return fieldId === null ? false : configuredSecretFields.includes(fieldId);
};

export const additionalConnectionFields = (
  preset: AiProviderPreset | null
): readonly AiProviderFieldSchema[] => {
  const primaryFieldId = resolvePrimaryUrlFieldId(preset);
  return preset?.connectionFields.filter((field) => field.id !== primaryFieldId) ?? [];
};

export const additionalAuthFields = (
  preset: AiProviderPreset | null
): readonly AiProviderFieldSchema[] => {
  const primaryFieldId = resolvePrimarySecretFieldId(preset);
  return preset?.authFields.filter((field) => field.id !== primaryFieldId) ?? [];
};

export const toDraft = (
  profile: AiProviderProfile | null,
  presets: readonly AiProviderPreset[]
): SettingsAiDraft => {
  const preset = resolvePreset(
    presets,
    profile?.presetId ?? null,
    profile?.providerId ?? DEFAULT_PROVIDER_ID,
    profile?.protocolId ?? DEFAULT_PROTOCOL_ID
  );

  if (profile === null) {
    return {
      id: null,
      name: "",
      providerId: preset?.providerId ?? DEFAULT_PROVIDER_ID,
      protocolId: preset?.protocolId ?? DEFAULT_PROTOCOL_ID,
      presetId: draftPresetId(null, preset),
      connectionConfig: draftConnectionConfig(preset, null),
      authConfig: { ...(preset?.defaultAuthConfig ?? {}) },
      secretValues: {},
      configuredSecretFields: [],
      headersText: "",
      modelSelectionMode: "all",
      modelsText: serializeConfiguredModels(preset?.defaultModel ?? "", []),
      isDefault: false
    };
  }

  const configuredModels = [
    ...profile.customModels,
    ...profile.discoveryState.models
  ];

  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    protocolId: profile.protocolId,
    presetId: draftPresetId(profile, preset),
    connectionConfig: draftConnectionConfig(preset, profile),
    authConfig: { ...profile.authConfig },
    secretValues: {},
    configuredSecretFields: [...profile.configuredSecretFields],
    headersText: "",
    modelSelectionMode: draftModelSelectionMode(profile),
    modelsText: serializeConfiguredModels(profile.model, configuredModels),
    isDefault: profile.isDefault
  };
};

export const findSelectedProfile = (
  profiles: readonly AiProviderProfile[],
  selectedProfileId: string | null
): AiProviderProfile | null =>
  profiles.find((profile) => profile.id === selectedProfileId) ?? null;
