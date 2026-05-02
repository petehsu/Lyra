import type { AiProviderIconKey } from "../../../shared/ai";

const OPENCODE_PROVIDER_SPRITE_URL = new URL(
  "./assets/provider-icons/opencode-sprite.svg",
  import.meta.url
).toString();

const ICON_ID_BY_KEY: Record<string, string> = {
  openai: "openai",
  azure_openai: "azure",
  openrouter: "openrouter",
  anthropic: "anthropic",
  google_ai: "google",
  vertex_ai: "google-vertex",
  amazon_bedrock: "amazon-bedrock",
  ollama: "ollama-cloud",
  lmstudio: "lmstudio",
  deepseek: "deepseek",
  xai: "xai",
  mistral: "mistral",
  moonshot: "moonshotai",
  groq: "groq",
  together: "togetherai",
  fireworks: "fireworks-ai",
  siliconflow: "siliconflow",
  nebius: "nebius",
  cerebras: "cerebras",
  vercel_ai_gateway: "vercel",
  mimo: "xiaomi",
  custom_openai_compatible: "synthetic"
};

const resolveIconId = (iconKey: AiProviderIconKey): string =>
  ICON_ID_BY_KEY[iconKey] ?? "synthetic";

type SettingsAiProviderIconProps = {
  readonly iconKey: AiProviderIconKey;
  readonly title: string;
};

export const SettingsAiProviderIcon = ({
  iconKey,
  title
}: SettingsAiProviderIconProps) => {
  const iconId = resolveIconId(iconKey);
  return (
    <span className="lyra-settings-provider-icon-shell" aria-hidden="true">
      <svg className="lyra-settings-provider-icon" viewBox="0 0 40 40" focusable="false">
        <title>{title}</title>
        <use href={`${OPENCODE_PROVIDER_SPRITE_URL}#${iconId}`} />
      </svg>
    </span>
  );
};
