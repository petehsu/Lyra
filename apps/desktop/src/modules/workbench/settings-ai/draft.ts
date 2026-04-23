import type {
  AiProviderFieldSchema,
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderProfile
} from "../../../shared/ai";
import { resolvePreset } from "./preset";
import type { SettingsAiDraft } from "./types";

export const serializeMap = (value: Record<string, string>): string =>
  Object.entries(value)
    .map(([key, entry]) => `${key}: ${entry}`)
    .join("\n");

const MODEL_VALUE_DELIMITER = /[\r\n,，、;；]+/;
const PRIMARY_URL_FIELD_IDS = ["baseUrl", "endpointOverride"] as const;
const PRIMARY_SECRET_FIELD_IDS = ["apiKey", "refreshToken"] as const;
const DEFAULT_PROVIDER_ID = "lmstudio";
const DEFAULT_PROTOCOL_ID = "lmstudio_chat_completions";

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
      presetId: preset?.id ?? null,
      connectionConfig: { ...(preset?.defaultConnectionConfig ?? {}) },
      authConfig: { ...(preset?.defaultAuthConfig ?? {}) },
      secretValues: {},
      clearSecretFields: [],
      configuredSecretFields: [],
      headersText: "",
      modelsText: serializeConfiguredModels(preset?.defaultModel ?? "", []),
      isDefault: false
    };
  }

  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    protocolId: profile.protocolId,
    presetId: profile.presetId,
    connectionConfig: { ...profile.connectionConfig },
    authConfig: { ...profile.authConfig },
    secretValues: {},
    clearSecretFields: [],
    configuredSecretFields: [...profile.configuredSecretFields],
    headersText: serializeMap({ ...profile.headers }),
    modelsText: serializeConfiguredModels(profile.model, profile.customModels),
    isDefault: profile.isDefault
  };
};

export const findSelectedProfile = (
  profiles: readonly AiProviderProfile[],
  selectedProfileId: string | null
): AiProviderProfile | null =>
  profiles.find((profile) => profile.id === selectedProfileId) ?? null;
