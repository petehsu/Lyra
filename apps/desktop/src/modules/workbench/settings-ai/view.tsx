import { Check, ExternalLink, FilePenLine, KeyRound, LogIn, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef, KeyboardEvent } from "react";

import {
  AppButton,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppObjectRow,
  AppSelect,
  AppStatusMessage,
  AppSwitch,
  AppTextarea
} from "@renderer/ui/components";
import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

type AgentConfigShape = {
  readonly provider?: {
    readonly default_model?: string | null;
    readonly default_provider?: string | null;
    readonly openai_reasoning_effort?: string | null;
    readonly openai_service_tier?: string | null;
  };
  readonly providers?: Record<string, {
    readonly base_url?: string;
    readonly auth?: string;
    readonly auth_header?: string | null;
    readonly api_key_env?: string | null;
    readonly env_file?: string | null;
    readonly default_model?: string | null;
    readonly models?: readonly { readonly id?: string }[];
  }>;
  readonly agents?: {
    readonly swarm_model?: string | null;
    readonly memory_model?: string | null;
  };
  readonly autoreview?: {
    readonly model?: string | null;
  };
  readonly autojudge?: {
    readonly model?: string | null;
  };
  readonly ambient?: {
    readonly model?: string | null;
  };
  readonly safety?: {
    readonly ntfy_topic?: string | null;
    readonly ntfy_server?: string | null;
    readonly desktop_notifications?: boolean;
    readonly email_enabled?: boolean;
    readonly email_to?: string | null;
    readonly email_smtp_host?: string | null;
    readonly email_smtp_port?: number;
    readonly email_from?: string | null;
    readonly email_password?: string | null;
    readonly email_imap_host?: string | null;
    readonly email_imap_port?: number;
    readonly email_reply_enabled?: boolean;
    readonly telegram_enabled?: boolean;
    readonly telegram_bot_token?: string | null;
    readonly telegram_chat_id?: string | null;
    readonly telegram_reply_enabled?: boolean;
    readonly discord_enabled?: boolean;
    readonly discord_bot_token?: string | null;
    readonly discord_channel_id?: string | null;
    readonly discord_bot_user_id?: string | null;
    readonly discord_reply_enabled?: boolean;
  };
};

const asAgentConfig = (value: unknown): AgentConfigShape =>
  (value ?? {}) as AgentConfigShape;

const nullableTrimmed = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const optionalSecret = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalPort = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : undefined;
};

type SettingsAiSwitchRowProps = {
  readonly checked: boolean;
  readonly className?: string;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
};

const SettingsAiSwitchRow = ({
  checked,
  className,
  label,
  onCheckedChange
}: SettingsAiSwitchRowProps) => (
  <div className={["lyra-settings-ai-switch-row", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppSwitch
      checked={checked}
      aria-label={label}
      onCheckedChange={onCheckedChange}
    />
  </div>
);

type SettingsAiInputFieldProps = Omit<ComponentPropsWithoutRef<typeof AppInput>, "className" | "onChange" | "value"> & {
  readonly className?: string;
  readonly inputClassName?: string;
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly value: string;
};

const SettingsAiInputField = ({
  className,
  inputClassName,
  label,
  onValueChange,
  value,
  ...inputProps
}: SettingsAiInputFieldProps) => (
  <label className={["lyra-settings-ai-field", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppInput
      className={["lyra-settings-ai-input", inputClassName ?? ""].filter(Boolean).join(" ")}
      value={value}
      onChange={(event) => setValueFromEvent(event.target.value, onValueChange)}
      {...inputProps}
    />
  </label>
);

type SettingsAiTextareaFieldProps = Omit<ComponentPropsWithoutRef<typeof AppTextarea>, "className" | "onChange" | "value"> & {
  readonly className?: string;
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly textareaClassName?: string;
  readonly value: string;
};

const SettingsAiTextareaField = ({
  className,
  label,
  onValueChange,
  textareaClassName,
  value,
  ...textareaProps
}: SettingsAiTextareaFieldProps) => (
  <label className={["lyra-settings-ai-field", className ?? ""].filter(Boolean).join(" ")}>
    <span>{label}</span>
    <AppTextarea
      className={["lyra-settings-ai-input lyra-settings-ai-input-multiline", textareaClassName ?? ""].filter(Boolean).join(" ")}
      value={value}
      onChange={(event) => setValueFromEvent(event.target.value, onValueChange)}
      {...textareaProps}
    />
  </label>
);

const setValueFromEvent = (
  value: string,
  onValueChange: (value: string) => void
): void => {
  onValueChange(value);
};

const activateRowFromKeyboard = (
  event: KeyboardEvent,
  onActivate: () => void
): void => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onActivate();
};

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const config = asAgentConfig(model.agentConfig?.config);
  const providers = useMemo(
    () => Object.entries(config.providers ?? {}),
    [config.providers]
  );
  const accounts = model.agentAccounts?.accounts ?? [];
  const loginProviders = model.agentLoginProviders?.providers ?? [];
  const googleLoginProvider = loginProviders.find((provider) => provider.id === "google");
  const oauthLoginProviders = loginProviders.filter((provider) =>
    provider.requiresCallback && provider.id !== "google"
  );
  const apiKeyLoginProviders = loginProviders.filter((provider) => provider.requiresApiKey);
  const defaultProviderName = config.provider?.default_provider ?? "";
  const defaultProviderConfig = config.providers?.[defaultProviderName] ?? null;
  const defaultProviderModelIds = useMemo(
    () => (defaultProviderConfig?.models ?? [])
      .map((entry) => entry.id?.trim() ?? "")
      .filter((id) => id.length > 0)
      .join("\n"),
    [defaultProviderConfig?.models]
  );
  const [selectedApiKeyProvider, setSelectedApiKeyProvider] = useState("openai-compatible");
  const [profileName, setProfileName] = useState("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [pendingLogin, setPendingLogin] = useState<{
    readonly provider: string;
    readonly label?: string | null;
    readonly flowId: string;
    readonly callbackHint?: string | null;
    readonly instructions: string;
  } | null>(null);
  const [callbackInput, setCallbackInput] = useState("");
  const [swarmModel, setSwarmModel] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [memoryModel, setMemoryModel] = useState("");
  const [ambientModel, setAmbientModel] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [gmailAccessTier, setGmailAccessTier] = useState<"readonly" | "full">("readonly");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [ntfyServer, setNtfyServer] = useState("https://ntfy.sh");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSmtpHost, setEmailSmtpHost] = useState("");
  const [emailSmtpPort, setEmailSmtpPort] = useState("587");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailImapHost, setEmailImapHost] = useState("");
  const [emailImapPort, setEmailImapPort] = useState("993");
  const [emailReplyEnabled, setEmailReplyEnabled] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramReplyEnabled, setTelegramReplyEnabled] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [discordBotUserId, setDiscordBotUserId] = useState("");
  const [discordReplyEnabled, setDiscordReplyEnabled] = useState(false);

  useEffect(() => {
    if (defaultProviderName.length > 0) {
      setProfileName(defaultProviderName);
    }
    setBaseUrl(defaultProviderConfig?.base_url ?? "");
    setDefaultModel(
      config.provider?.default_model
      ?? defaultProviderConfig?.default_model
      ?? defaultProviderModelIds.split("\n").find((id) => id.length > 0)
      ?? ""
    );
    setAuthHeader(defaultProviderConfig?.auth_header ?? "");
    setApiKey("");
    setSwarmModel(config.agents?.swarm_model ?? "");
    setReviewModel(config.autoreview?.model ?? "");
    setJudgeModel(config.autojudge?.model ?? "");
    setMemoryModel(config.agents?.memory_model ?? "");
    setAmbientModel(config.ambient?.model ?? "");
    setDesktopNotifications(config.safety?.desktop_notifications ?? true);
    setNtfyTopic(config.safety?.ntfy_topic ?? "");
    setNtfyServer(config.safety?.ntfy_server ?? "https://ntfy.sh");
    setEmailEnabled(config.safety?.email_enabled ?? false);
    setEmailTo(config.safety?.email_to ?? "");
    setEmailSmtpHost(config.safety?.email_smtp_host ?? "");
    setEmailSmtpPort(String(config.safety?.email_smtp_port ?? 587));
    setEmailFrom(config.safety?.email_from ?? "");
    setEmailPassword("");
    setEmailImapHost(config.safety?.email_imap_host ?? "");
    setEmailImapPort(String(config.safety?.email_imap_port ?? 993));
    setEmailReplyEnabled(config.safety?.email_reply_enabled ?? false);
    setTelegramEnabled(config.safety?.telegram_enabled ?? false);
    setTelegramBotToken("");
    setTelegramChatId(config.safety?.telegram_chat_id ?? "");
    setTelegramReplyEnabled(config.safety?.telegram_reply_enabled ?? false);
    setDiscordEnabled(config.safety?.discord_enabled ?? false);
    setDiscordBotToken("");
    setDiscordChannelId(config.safety?.discord_channel_id ?? "");
    setDiscordBotUserId(config.safety?.discord_bot_user_id ?? "");
    setDiscordReplyEnabled(config.safety?.discord_reply_enabled ?? false);
  }, [
    config.agents?.memory_model,
    config.agents?.swarm_model,
    config.ambient?.model,
    config.autojudge?.model,
    config.autoreview?.model,
    config.provider?.default_model,
    config.safety?.desktop_notifications,
    config.safety?.discord_bot_user_id,
    config.safety?.discord_channel_id,
    config.safety?.discord_enabled,
    config.safety?.discord_reply_enabled,
    config.safety?.email_enabled,
    config.safety?.email_from,
    config.safety?.email_imap_host,
    config.safety?.email_imap_port,
    config.safety?.email_reply_enabled,
    config.safety?.email_smtp_host,
    config.safety?.email_smtp_port,
    config.safety?.email_to,
    config.safety?.ntfy_server,
    config.safety?.ntfy_topic,
    config.safety?.telegram_chat_id,
    config.safety?.telegram_enabled,
    config.safety?.telegram_reply_enabled,
    defaultProviderConfig?.auth_header,
    defaultProviderConfig?.base_url,
    defaultProviderConfig?.default_model,
    defaultProviderModelIds,
    defaultProviderName,
  ]);

  return (
    <section className="lyra-settings-ai-stack">
      <header className="lyra-settings-ai-page-header">
        <h3>{labels.profilesTitle}</h3>
        <AppButton
          variant="outline"
          size="sm"
          className="lyra-settings-ai-action"
          onClick={() => {
            void model.openAgentConfigFile?.();
          }}
        >
          <FilePenLine size={14} aria-hidden="true" />
          {labels.openConfigFile}
        </AppButton>
        <AppButton
          variant="outline"
          size="sm"
          className="lyra-settings-ai-action"
          onClick={() => {
            void model.refreshAgent?.();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {labels.refreshAgent}
        </AppButton>
      </header>

      <div className="lyra-settings-ai-profile-grid">
        <div className="lyra-settings-ai-provider-list" aria-label={labels.agentConfigAriaLabel}>
          <div className="lyra-settings-ai-provider-row">
            <AppObjectRow
              as="div"
              active
              className="lyra-settings-ai-provider-tab lyra-settings-ai-provider-tab-active"
              title={config.provider?.default_provider ?? labels.providerAutoFallback}
              description={config.provider?.default_model ?? labels.defaultModelFallback}
            />
          </div>
        </div>

        <div className="lyra-settings-ai-provider-models">
          <div className="lyra-settings-ai-model-row">
            <AppObjectRow
              className="lyra-settings-ai-model-card lyra-settings-ai-model-card-active"
              active
              meta={labels.configFileTitle}
              title={model.agentConfig?.configPath ?? "~/.lyra/modules/agent/config.toml"}
              description={model.agentConfig?.agentHome ?? labels.configFileDescription}
              onClick={() => {
                void model.openAgentConfigFile?.();
              }}
            />
          </div>
          {providers.map(([name, provider]) => (
            <div key={name} className="lyra-settings-ai-model-row">
              <AppObjectRow
                className="lyra-settings-ai-model-card"
                title={name}
                description={provider.default_model ?? provider.base_url ?? labels.customProviderFallback}
                onClick={() => {
                  void model.updateAgentConfig?.({
                    defaultProvider: name,
                    defaultModel: provider.default_model ?? null,
                  });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.accountsTitle}</h3>
            <small>
              {model.agentAccounts?.defaultProvider ?? labels.noDefaultProvider} ·{" "}
              {model.agentAccounts?.defaultModel ?? labels.noDefaultModel}
            </small>
          </span>
        </header>

        <div className="lyra-settings-ai-provider-list" aria-label={labels.accountsAriaLabel}>
          {accounts.length === 0 ? (
            <AppEmptyState
              align="start"
              density="compact"
              className="lyra-settings-ai-empty"
              title={labels.accountsEmptyTitle}
              description={labels.accountsEmptyDescription}
            />
          ) : (
            accounts.map((account) => {
              const disabled = model.isSaving || account.active || account.provider === "google";
              const switchAccount = (): void => {
                if (disabled) return;
                void model.switchAgentAccount?.({
                  provider: account.provider,
                  label: account.label,
                });
              };

              return (
                <div key={`${account.provider}:${account.label}`} className="lyra-settings-ai-provider-row">
                  <AppObjectRow
                    as="div"
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    active={account.active}
                    aria-disabled={disabled ? "true" : undefined}
                    className={[
                      "lyra-settings-ai-provider-tab",
                      account.active ? "lyra-settings-ai-provider-tab-active" : "",
                    ].filter(Boolean).join(" ")}
                    icon={account.active ? <Check size={14} aria-hidden="true" /> : undefined}
                    title={account.label}
                    description={`${account.provider} · ${account.kind} · ${
                      account.configured ? labels.accountConfigured : labels.accountNotConfigured
                    }${account.detail ? ` · ${account.detail}` : ""}`}
                    actions={(
                      <AppIconButton
                        tone="danger"
                        className="lyra-settings-ai-row-delete"
                        aria-label={`${labels.removeAccount}: ${account.label}`}
                        disabled={model.isSaving}
                        onClick={() => {
                          void model.removeAgentAccount?.({
                            provider: account.provider,
                            label: account.label,
                          });
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </AppIconButton>
                    )}
                    onClick={switchAccount}
                    onKeyDown={(event) => activateRowFromKeyboard(event, switchAccount)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.loginProvidersTitle}</h3>
            <small>{labels.loginProvidersDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-login-provider-grid">
          {oauthLoginProviders.map((provider) => (
            <AppObjectRow
              key={provider.id}
              className={[
                "lyra-settings-ai-login-provider",
                provider.configured ? "lyra-settings-ai-login-provider-configured" : "",
              ].filter(Boolean).join(" ")}
              disabled={model.isSaving}
              icon={<LogIn size={14} aria-hidden="true" />}
              title={provider.displayName}
              description={`${provider.authKind} · ${provider.configured ? labels.accountConfigured : labels.accountNotConfigured}`}
              meta={<ExternalLink size={13} aria-hidden="true" />}
              onClick={() => {
                void model.startAgentAccountLogin?.({ provider: provider.id }).then((response) => {
                  if (response === null) return;
                  setPendingLogin({
                    provider: response.provider,
                    label: response.label ?? null,
                    flowId: response.flowId,
                    callbackHint: response.callbackHint ?? null,
                    instructions: response.instructions,
                  });
                  setCallbackInput("");
                });
              }}
            />
          ))}
        </div>

        {googleLoginProvider === undefined ? null : (
          <div className="lyra-settings-ai-oauth-panel">
            <span className="lyra-settings-ai-inline-editor-title-copy">
              <strong>{labels.gmailLoginTitle}</strong>
              <small>{labels.gmailLoginDescription}</small>
              <small>
                {googleLoginProvider.authKind} · {googleLoginProvider.configured ? labels.accountConfigured : labels.accountNotConfigured}
              </small>
            </span>
            <div className="lyra-settings-ai-form">
              <SettingsAiInputField
                label={labels.gmailClientIdLabel}
                type="text"
                value={googleClientId}
                onValueChange={setGoogleClientId}
              />
              <SettingsAiInputField
                label={labels.gmailClientSecretLabel}
                type="password"
                autoComplete="off"
                value={googleClientSecret}
                onValueChange={setGoogleClientSecret}
              />
              <label className="lyra-settings-ai-field">
                <span>{labels.gmailAccessTierLabel}</span>
                <AppSelect
                  ariaLabel={labels.gmailAccessTierLabel}
                  className="lyra-settings-ai-select"
                  value={gmailAccessTier}
                  options={[
                    { value: "readonly", label: labels.gmailAccessReadOnly },
                    { value: "full", label: labels.gmailAccessFull }
                  ]}
                  onValueChange={(nextValue) => {
                    setGmailAccessTier(nextValue === "full" ? "full" : "readonly");
                  }}
                />
              </label>
            </div>
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <AppButton
                  variant="default"
                  size="sm"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving}
                  onClick={() => {
                    void model.startAgentAccountLogin?.({
                      provider: "google",
                      googleClientId: nullableTrimmed(googleClientId),
                      googleClientSecret: nullableTrimmed(googleClientSecret),
                      gmailAccessTier,
                    }).then((response) => {
                      if (response === null) return;
                      setPendingLogin({
                        provider: response.provider,
                        label: response.label ?? null,
                        flowId: response.flowId,
                        callbackHint: response.callbackHint ?? null,
                        instructions: response.instructions,
                      });
                      setCallbackInput("");
                      setGoogleClientSecret("");
                    });
                  }}
                >
                  <LogIn size={14} aria-hidden="true" />
                  {labels.startLogin}
                </AppButton>
              </span>
            </footer>
          </div>
        )}

        {pendingLogin === null ? null : (
          <div className="lyra-settings-ai-oauth-panel">
            <span className="lyra-settings-ai-inline-editor-title-copy">
              <strong>{pendingLogin.label ?? pendingLogin.provider}</strong>
              <small>{pendingLogin.instructions}</small>
              <small>{labels.loginCallbackDescription}</small>
            </span>
            <SettingsAiTextareaField
              className="lyra-settings-ai-field-span-2"
              label={labels.callbackInputLabel}
              placeholder={pendingLogin.callbackHint ?? labels.callbackInputPlaceholder}
              value={callbackInput}
              onValueChange={setCallbackInput}
            />
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <AppButton
                  variant="outline"
                  size="sm"
                  className="lyra-settings-ai-action"
                  disabled={model.isSaving}
                  onClick={() => {
                    setPendingLogin(null);
                    setCallbackInput("");
                  }}
                >
                  {labels.cancel}
                </AppButton>
                <AppButton
                  variant="default"
                  size="sm"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving || callbackInput.trim().length === 0}
                  onClick={() => {
                    void model.completeAgentAccountLogin?.({
                      provider: pendingLogin.provider,
                      flowId: pendingLogin.flowId,
                      label: pendingLogin.label ?? null,
                      callbackInput,
                      setDefault: true,
                    }).then((response) => {
                      if (response === null) return;
                      setPendingLogin(null);
                      setCallbackInput("");
                    });
                  }}
                >
                  <Check size={14} aria-hidden="true" />
                  {labels.completeLogin}
                </AppButton>
              </span>
            </footer>
          </div>
        )}
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.apiKeyProviderTitle}</h3>
            <small>{labels.apiKeyProviderDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-api-provider-strip">
          {apiKeyLoginProviders.map((provider) => (
            <AppObjectRow
              key={provider.id}
              className={[
                "lyra-settings-ai-provider-tab",
                selectedApiKeyProvider === provider.id ? "lyra-settings-ai-provider-tab-active" : "",
              ].filter(Boolean).join(" ")}
              active={selectedApiKeyProvider === provider.id}
              disabled={model.isSaving}
              icon={<KeyRound size={13} aria-hidden="true" />}
              title={provider.displayName}
              description={provider.detail}
              onClick={() => {
                setSelectedApiKeyProvider(provider.id);
                setProfileName(provider.id);
              }}
            />
          ))}
        </div>

        <div className="lyra-settings-ai-form">
          <SettingsAiInputField
            label={labels.profileNameLabel}
            type="text"
            value={profileName}
            onValueChange={setProfileName}
          />
          <SettingsAiInputField
            label={labels.urlLabel}
            type="text"
            placeholder={labels.urlPlaceholder}
            value={baseUrl}
            onValueChange={setBaseUrl}
          />
          <SettingsAiInputField
            label={labels.mainModelLabel}
            type="text"
            placeholder={labels.modelPlaceholder}
            value={defaultModel}
            onValueChange={setDefaultModel}
          />
          <SettingsAiInputField
            label={labels.authHeaderLabel}
            type="text"
            placeholder="Authorization"
            value={authHeader}
            onValueChange={setAuthHeader}
          />
          <SettingsAiInputField
            label={labels.keyLabel}
            type="password"
            autoComplete="off"
            placeholder={labels.keyPlaceholder}
            value={apiKey}
            onValueChange={setApiKey}
          />
        </div>

        {model.errorMessage === null ? null : (
          <AppStatusMessage className="lyra-settings-ai-error" tone="error" role="alert">
            {model.errorMessage}
          </AppStatusMessage>
        )}

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <AppButton
              variant="default"
              size="sm"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving || selectedApiKeyProvider.length === 0}
              onClick={() => {
                void model.completeAgentAccountLogin?.({
                  provider: selectedApiKeyProvider,
                  profileName,
                  baseUrl: baseUrl.trim().length === 0 ? null : baseUrl,
                  apiKey: apiKey.trim().length === 0 ? null : apiKey,
                  defaultModel: defaultModel.trim().length === 0 ? null : defaultModel,
                  authHeader: authHeader.trim().length === 0 ? null : authHeader,
                  setDefault: true,
                });
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveProfile}
            </AppButton>
          </span>
        </footer>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.roleModelsTitle}</h3>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <SettingsAiInputField
            label={labels.roleSwarmSubagentLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={swarmModel}
            onValueChange={setSwarmModel}
          />
          <SettingsAiInputField
            label={labels.roleReviewLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={reviewModel}
            onValueChange={setReviewModel}
          />
          <SettingsAiInputField
            label={labels.roleJudgeLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={judgeModel}
            onValueChange={setJudgeModel}
          />
          <SettingsAiInputField
            label={labels.roleMemoryLabel}
            type="text"
            placeholder={labels.roleMemoryDefaultPlaceholder}
            value={memoryModel}
            onValueChange={setMemoryModel}
          />
          <SettingsAiInputField
            label={labels.roleAmbientLabel}
            type="text"
            placeholder={labels.roleProviderDefaultPlaceholder}
            value={ambientModel}
            onValueChange={setAmbientModel}
          />
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <AppButton
              variant="default"
              size="sm"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                void model.updateAgentRoles?.({
                  swarmModel,
                  reviewModel,
                  judgeModel,
                  memoryModel,
                  ambientModel,
                });
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveRoleModels}
            </AppButton>
          </span>
        </footer>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.notificationsTitle}</h3>
            <small>{labels.notificationsDescription}</small>
          </span>
        </header>

        <div className="lyra-settings-ai-form">
          <SettingsAiSwitchRow
            checked={desktopNotifications}
            label={labels.desktopNotificationsLabel}
            onCheckedChange={setDesktopNotifications}
          />
          <label className="lyra-settings-ai-field">
            <span>{labels.ntfyTopicLabel}</span>
            <AppInput
              className="lyra-settings-ai-input"
              type="text"
              value={ntfyTopic}
              onChange={(event) => setNtfyTopic(event.target.value)}
            />
          </label>
          <SettingsAiInputField
            label={labels.ntfyServerLabel}
            type="text"
            value={ntfyServer}
            onValueChange={setNtfyServer}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={emailEnabled}
            label={labels.emailNotificationsLabel}
            onCheckedChange={setEmailEnabled}
          />
          <SettingsAiInputField
            label={labels.emailToLabel}
            type="email"
            value={emailTo}
            onValueChange={setEmailTo}
          />
          <SettingsAiInputField
            label={labels.emailFromLabel}
            type="email"
            value={emailFrom}
            onValueChange={setEmailFrom}
          />
          <SettingsAiInputField
            label={labels.emailSmtpHostLabel}
            type="text"
            value={emailSmtpHost}
            onValueChange={setEmailSmtpHost}
          />
          <SettingsAiInputField
            label={labels.emailSmtpPortLabel}
            type="number"
            min="0"
            max="65535"
            value={emailSmtpPort}
            onValueChange={setEmailSmtpPort}
          />
          <SettingsAiInputField
            label={labels.emailPasswordLabel}
            type="password"
            autoComplete="off"
            value={emailPassword}
            onValueChange={setEmailPassword}
          />
          <SettingsAiInputField
            label={labels.emailImapHostLabel}
            type="text"
            value={emailImapHost}
            onValueChange={setEmailImapHost}
          />
          <SettingsAiInputField
            label={labels.emailImapPortLabel}
            type="number"
            min="0"
            max="65535"
            value={emailImapPort}
            onValueChange={setEmailImapPort}
          />
          <SettingsAiSwitchRow
            checked={emailReplyEnabled}
            label={labels.emailReplyLabel}
            onCheckedChange={setEmailReplyEnabled}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={telegramEnabled}
            label={labels.telegramNotificationsLabel}
            onCheckedChange={setTelegramEnabled}
          />
          <SettingsAiInputField
            label={labels.telegramBotTokenLabel}
            type="password"
            autoComplete="off"
            value={telegramBotToken}
            onValueChange={setTelegramBotToken}
          />
          <SettingsAiInputField
            label={labels.telegramChatIdLabel}
            type="text"
            value={telegramChatId}
            onValueChange={setTelegramChatId}
          />
          <SettingsAiSwitchRow
            checked={telegramReplyEnabled}
            label={labels.telegramReplyLabel}
            onCheckedChange={setTelegramReplyEnabled}
          />

          <SettingsAiSwitchRow
            className="lyra-settings-ai-field-span-2"
            checked={discordEnabled}
            label={labels.discordNotificationsLabel}
            onCheckedChange={setDiscordEnabled}
          />
          <SettingsAiInputField
            label={labels.discordBotTokenLabel}
            type="password"
            autoComplete="off"
            value={discordBotToken}
            onValueChange={setDiscordBotToken}
          />
          <SettingsAiInputField
            label={labels.discordChannelIdLabel}
            type="text"
            value={discordChannelId}
            onValueChange={setDiscordChannelId}
          />
          <SettingsAiInputField
            label={labels.discordBotUserIdLabel}
            type="text"
            value={discordBotUserId}
            onValueChange={setDiscordBotUserId}
          />
          <SettingsAiSwitchRow
            checked={discordReplyEnabled}
            label={labels.discordReplyLabel}
            onCheckedChange={setDiscordReplyEnabled}
          />
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <AppButton
              variant="default"
              size="sm"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                const smtpPort = optionalPort(emailSmtpPort);
                const imapPort = optionalPort(emailImapPort);
                const smtpPassword = optionalSecret(emailPassword);
                const telegramToken = optionalSecret(telegramBotToken);
                const discordToken = optionalSecret(discordBotToken);
                void model.updateAgentConfig?.({
                  desktopNotifications,
                  ntfyTopic: nullableTrimmed(ntfyTopic),
                  ntfyServer: nullableTrimmed(ntfyServer),
                  emailEnabled,
                  emailTo: nullableTrimmed(emailTo),
                  emailSmtpHost: nullableTrimmed(emailSmtpHost),
                  ...(smtpPort === undefined ? {} : { emailSmtpPort: smtpPort }),
                  emailFrom: nullableTrimmed(emailFrom),
                  ...(smtpPassword === undefined ? {} : { emailPassword: smtpPassword }),
                  emailImapHost: nullableTrimmed(emailImapHost),
                  ...(imapPort === undefined ? {} : { emailImapPort: imapPort }),
                  emailReplyEnabled,
                  telegramEnabled,
                  ...(telegramToken === undefined ? {} : { telegramBotToken: telegramToken }),
                  telegramChatId: nullableTrimmed(telegramChatId),
                  telegramReplyEnabled,
                  discordEnabled,
                  ...(discordToken === undefined ? {} : { discordBotToken: discordToken }),
                  discordChannelId: nullableTrimmed(discordChannelId),
                  discordBotUserId: nullableTrimmed(discordBotUserId),
                  discordReplyEnabled,
                });
              }}
            >
              <Save size={14} aria-hidden="true" />
              {labels.saveNotifications}
            </AppButton>
          </span>
        </footer>
      </div>
    </section>
  );
};
