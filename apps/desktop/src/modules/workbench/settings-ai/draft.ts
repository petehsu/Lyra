import type {
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

export const serializeCustomModels = (models: readonly AiProviderModelEntry[]): string =>
  models
    .map((model) => [model.id, model.name, model.description ?? ""].filter((entry) => entry.length > 0).join(" | "))
    .join("\n");

export const parseCustomModels = (value: string): readonly AiProviderModelEntry[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, name, description] = line.split("|").map((entry) => entry.trim());
      return {
        id: id || line,
        name: name || id || line,
        ...(description ? { description } : {}),
        source: "custom" as const
      };
    });

export const toDraft = (
  profile: AiProviderProfile | null,
  presets: readonly AiProviderPreset[]
): SettingsAiDraft => {
  const preset = resolvePreset(
    presets,
    profile?.presetId ?? null,
    profile?.providerId ?? "openai",
    profile?.protocolId ?? "openai_compatible"
  );

  if (profile === null) {
    return {
      id: null,
      name: "",
      providerId: preset?.providerId ?? "openai",
      protocolId: preset?.protocolId ?? "openai_compatible",
      presetId: preset?.id ?? null,
      connectionConfig: { ...(preset?.defaultConnectionConfig ?? {}) },
      authConfig: { ...(preset?.defaultAuthConfig ?? {}) },
      secretValues: {},
      clearSecretFields: [],
      configuredSecretFields: [],
      headersText: "",
      model: preset?.defaultModel ?? "",
      customModelsText: "",
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
    model: profile.model,
    customModelsText: serializeCustomModels(profile.customModels),
    isDefault: profile.isDefault
  };
};

export const findSelectedProfile = (
  profiles: readonly AiProviderProfile[],
  selectedProfileId: string | null
): AiProviderProfile | null =>
  profiles.find((profile) => profile.id === selectedProfileId) ?? null;
