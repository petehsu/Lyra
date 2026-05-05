import type { AiProviderFieldSchema } from "../../../../shared/ai";

export const connectionField = (
  id: string,
  label: string,
  placeholder: string,
  required = true
): AiProviderFieldSchema => ({
  id,
  label,
  kind: "url",
  scope: "connection",
  placeholder,
  required
});

export const apiKeyField = (
  required = true,
  placeholder = "sk-..."
): AiProviderFieldSchema => ({
  id: "apiKey",
  label: "API Key",
  kind: "password",
  scope: "auth",
  placeholder,
  required,
  secret: true
});
