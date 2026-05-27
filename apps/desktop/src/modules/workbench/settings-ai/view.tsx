import { Check, ExternalLink, FilePenLine, KeyRound, LogIn, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SettingsAiLabels, SettingsAiModel } from "./types";

type SettingsAiViewProps = {
  readonly labels: SettingsAiLabels;
  readonly model: SettingsAiModel;
};

type JcodeConfigShape = {
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

const asJcodeConfig = (value: unknown): JcodeConfigShape =>
  (value ?? {}) as JcodeConfigShape;

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

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const config = asJcodeConfig(model.jcodeConfig?.config);
  const providers = useMemo(
    () => Object.entries(config.providers ?? {}),
    [config.providers]
  );
  const accounts = model.jcodeAccounts?.accounts ?? [];
  const loginProviders = model.jcodeLoginProviders?.providers ?? [];
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
    <section className="lyra-settings-group">
      <header className="lyra-settings-group-header lyra-settings-ai-header">
        <h3>{labels.profilesTitle}</h3>
        <button
          type="button"
          className="lyra-settings-ai-action"
          onClick={() => {
            void model.openJcodeConfigFile?.();
          }}
        >
          <FilePenLine size={14} aria-hidden="true" />
          {labels.openConfigFile}
        </button>
        <button
          type="button"
          className="lyra-settings-ai-action"
          onClick={() => {
            void model.refreshJcode?.();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {labels.refreshJcode}
        </button>
      </header>

      <div className="lyra-settings-ai-profile-grid">
        <div className="lyra-settings-ai-provider-list" aria-label={labels.jcodeConfigAriaLabel}>
          <div className="lyra-settings-ai-provider-row">
            <button type="button" className="lyra-settings-ai-provider-tab lyra-settings-ai-provider-tab-active">
              <span>
                <strong>{config.provider?.default_provider ?? labels.providerAutoFallback}</strong>
                <small>{config.provider?.default_model ?? labels.defaultModelFallback}</small>
              </span>
            </button>
          </div>
        </div>

        <div className="lyra-settings-ai-provider-models">
          <div className="lyra-settings-ai-model-row">
            <button
              type="button"
              className="lyra-settings-ai-model-card lyra-settings-ai-model-card-active"
              onClick={() => {
                void model.openJcodeConfigFile?.();
              }}
            >
              <small>{labels.configFileTitle}</small>
              <strong title={model.jcodeConfig?.configPath ?? undefined}>
                {model.jcodeConfig?.configPath ?? "~/.lyra/modules/agent/config.toml"}
              </strong>
              <small title={model.jcodeConfig?.jcodeHome ?? undefined}>
                {model.jcodeConfig?.jcodeHome ?? labels.configFileDescription}
              </small>
            </button>
          </div>
          {providers.map(([name, provider]) => (
            <div key={name} className="lyra-settings-ai-model-row">
              <button
                type="button"
                className="lyra-settings-ai-model-card"
                onClick={() => {
                  void model.updateJcodeConfig?.({
                    defaultProvider: name,
                    defaultModel: provider.default_model ?? null,
                  });
                }}
              >
                <strong>{name}</strong>
                <small>{provider.default_model ?? provider.base_url ?? labels.customProviderFallback}</small>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.accountsTitle}</h3>
            <small>
              {model.jcodeAccounts?.defaultProvider ?? labels.noDefaultProvider} ·{" "}
              {model.jcodeAccounts?.defaultModel ?? labels.noDefaultModel}
            </small>
          </span>
        </header>

        <div className="lyra-settings-ai-provider-list" aria-label={labels.accountsAriaLabel}>
          {accounts.length === 0 ? (
            <div className="lyra-settings-ai-empty">
              <strong>{labels.accountsEmptyTitle}</strong>
              <span>{labels.accountsEmptyDescription}</span>
            </div>
          ) : (
            accounts.map((account) => (
              <div key={`${account.provider}:${account.label}`} className="lyra-settings-ai-provider-row">
                <button
                  type="button"
                  className={[
                    "lyra-settings-ai-provider-tab",
                    account.active ? "lyra-settings-ai-provider-tab-active" : "",
                  ].filter(Boolean).join(" ")}
                  disabled={model.isSaving || account.active || account.provider === "google"}
                  onClick={() => {
                    void model.switchJcodeAccount?.({
                      provider: account.provider,
                      label: account.label,
                    });
                  }}
                >
                  {account.active ? <Check size={14} aria-hidden="true" /> : null}
                  <span>
                    <strong>{account.label}</strong>
                    <small>
                      {account.provider} · {account.kind} ·{" "}
                      {account.configured ? labels.accountConfigured : labels.accountNotConfigured}
                      {account.detail ? ` · ${account.detail}` : ""}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="lyra-settings-ai-row-delete"
                  aria-label={`${labels.removeAccount}: ${account.label}`}
                  disabled={model.isSaving}
                  onClick={() => {
                    void model.removeJcodeAccount?.({
                      provider: account.provider,
                      label: account.label,
                    });
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))
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
            <button
              key={provider.id}
              type="button"
              className={[
                "lyra-settings-ai-login-provider",
                provider.configured ? "lyra-settings-ai-login-provider-configured" : "",
              ].filter(Boolean).join(" ")}
              disabled={model.isSaving}
              onClick={() => {
                void model.startJcodeAccountLogin?.({ provider: provider.id }).then((response) => {
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
            >
              <span className="lyra-settings-ai-login-provider-icon">
                <LogIn size={14} aria-hidden="true" />
              </span>
              <span>
                <strong>{provider.displayName}</strong>
                <small>
                  {provider.authKind} · {provider.configured ? labels.accountConfigured : labels.accountNotConfigured}
                </small>
              </span>
              <ExternalLink size={13} aria-hidden="true" />
            </button>
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
              <label className="lyra-settings-ai-field">
                <span>{labels.gmailClientIdLabel}</span>
                <input
                  className="lyra-settings-ai-input"
                  type="text"
                  value={googleClientId}
                  onChange={(event) => setGoogleClientId(event.target.value)}
                />
              </label>
              <label className="lyra-settings-ai-field">
                <span>{labels.gmailClientSecretLabel}</span>
                <input
                  className="lyra-settings-ai-input"
                  type="password"
                  autoComplete="off"
                  value={googleClientSecret}
                  onChange={(event) => setGoogleClientSecret(event.target.value)}
                />
              </label>
              <label className="lyra-settings-ai-field">
                <span>{labels.gmailAccessTierLabel}</span>
                <select
                  className="lyra-settings-ai-input"
                  value={gmailAccessTier}
                  onChange={(event) => setGmailAccessTier(event.target.value === "full" ? "full" : "readonly")}
                >
                  <option value="readonly">{labels.gmailAccessReadOnly}</option>
                  <option value="full">{labels.gmailAccessFull}</option>
                </select>
              </label>
            </div>
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <button
                  type="button"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving}
                  onClick={() => {
                    void model.startJcodeAccountLogin?.({
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
                </button>
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
            <label className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
              <span>{labels.callbackInputLabel}</span>
              <textarea
                className="lyra-settings-ai-input lyra-settings-ai-input-multiline"
                placeholder={pendingLogin.callbackHint ?? labels.callbackInputPlaceholder}
                value={callbackInput}
                onChange={(event) => setCallbackInput(event.target.value)}
              />
            </label>
            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <button
                  type="button"
                  className="lyra-settings-ai-action"
                  disabled={model.isSaving}
                  onClick={() => {
                    setPendingLogin(null);
                    setCallbackInput("");
                  }}
                >
                  {labels.cancel}
                </button>
                <button
                  type="button"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving || callbackInput.trim().length === 0}
                  onClick={() => {
                    void model.completeJcodeAccountLogin?.({
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
                </button>
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
            <button
              key={provider.id}
              type="button"
              className={[
                "lyra-settings-ai-provider-tab",
                selectedApiKeyProvider === provider.id ? "lyra-settings-ai-provider-tab-active" : "",
              ].filter(Boolean).join(" ")}
              disabled={model.isSaving}
              onClick={() => {
                setSelectedApiKeyProvider(provider.id);
                setProfileName(provider.id);
              }}
            >
              <KeyRound size={13} aria-hidden="true" />
              <span>
                <strong>{provider.displayName}</strong>
                <small>{provider.detail}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="lyra-settings-ai-form">
          <label className="lyra-settings-ai-field">
            <span>{labels.profileNameLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.urlLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.urlPlaceholder}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.mainModelLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.modelPlaceholder}
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.authHeaderLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder="Authorization"
              value={authHeader}
              onChange={(event) => setAuthHeader(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.keyLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="password"
              autoComplete="off"
              placeholder={labels.keyPlaceholder}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </div>

        {model.errorMessage === null ? null : (
          <div className="lyra-settings-ai-error" role="alert">
            {model.errorMessage}
          </div>
        )}

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving || selectedApiKeyProvider.length === 0}
              onClick={() => {
                void model.completeJcodeAccountLogin?.({
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
            </button>
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
          <label className="lyra-settings-ai-field">
            <span>{labels.roleSwarmSubagentLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.roleProviderDefaultPlaceholder}
              value={swarmModel}
              onChange={(event) => setSwarmModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.roleReviewLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.roleProviderDefaultPlaceholder}
              value={reviewModel}
              onChange={(event) => setReviewModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.roleJudgeLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.roleProviderDefaultPlaceholder}
              value={judgeModel}
              onChange={(event) => setJudgeModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.roleMemoryLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.roleMemoryDefaultPlaceholder}
              value={memoryModel}
              onChange={(event) => setMemoryModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.roleAmbientLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              placeholder={labels.roleProviderDefaultPlaceholder}
              value={ambientModel}
              onChange={(event) => setAmbientModel(event.target.value)}
            />
          </label>
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                void model.updateJcodeAgentRoles?.({
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
            </button>
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
          <label className="lyra-settings-ai-checkbox">
            <input
              type="checkbox"
              checked={desktopNotifications}
              onChange={(event) => setDesktopNotifications(event.target.checked)}
            />
            <span>{labels.desktopNotificationsLabel}</span>
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.ntfyTopicLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              value={ntfyTopic}
              onChange={(event) => setNtfyTopic(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.ntfyServerLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              value={ntfyServer}
              onChange={(event) => setNtfyServer(event.target.value)}
            />
          </label>

          <label className="lyra-settings-ai-checkbox lyra-settings-ai-field-span-2">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(event) => setEmailEnabled(event.target.checked)}
            />
            <span>{labels.emailNotificationsLabel}</span>
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailToLabel}</span>
            <input className="lyra-settings-ai-input" type="email" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailFromLabel}</span>
            <input className="lyra-settings-ai-input" type="email" value={emailFrom} onChange={(event) => setEmailFrom(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailSmtpHostLabel}</span>
            <input className="lyra-settings-ai-input" type="text" value={emailSmtpHost} onChange={(event) => setEmailSmtpHost(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailSmtpPortLabel}</span>
            <input className="lyra-settings-ai-input" type="number" min="0" max="65535" value={emailSmtpPort} onChange={(event) => setEmailSmtpPort(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailPasswordLabel}</span>
            <input className="lyra-settings-ai-input" type="password" autoComplete="off" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailImapHostLabel}</span>
            <input className="lyra-settings-ai-input" type="text" value={emailImapHost} onChange={(event) => setEmailImapHost(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.emailImapPortLabel}</span>
            <input className="lyra-settings-ai-input" type="number" min="0" max="65535" value={emailImapPort} onChange={(event) => setEmailImapPort(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-checkbox">
            <input
              type="checkbox"
              checked={emailReplyEnabled}
              onChange={(event) => setEmailReplyEnabled(event.target.checked)}
            />
            <span>{labels.emailReplyLabel}</span>
          </label>

          <label className="lyra-settings-ai-checkbox lyra-settings-ai-field-span-2">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(event) => setTelegramEnabled(event.target.checked)}
            />
            <span>{labels.telegramNotificationsLabel}</span>
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.telegramBotTokenLabel}</span>
            <input className="lyra-settings-ai-input" type="password" autoComplete="off" value={telegramBotToken} onChange={(event) => setTelegramBotToken(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.telegramChatIdLabel}</span>
            <input className="lyra-settings-ai-input" type="text" value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-checkbox">
            <input
              type="checkbox"
              checked={telegramReplyEnabled}
              onChange={(event) => setTelegramReplyEnabled(event.target.checked)}
            />
            <span>{labels.telegramReplyLabel}</span>
          </label>

          <label className="lyra-settings-ai-checkbox lyra-settings-ai-field-span-2">
            <input
              type="checkbox"
              checked={discordEnabled}
              onChange={(event) => setDiscordEnabled(event.target.checked)}
            />
            <span>{labels.discordNotificationsLabel}</span>
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.discordBotTokenLabel}</span>
            <input className="lyra-settings-ai-input" type="password" autoComplete="off" value={discordBotToken} onChange={(event) => setDiscordBotToken(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.discordChannelIdLabel}</span>
            <input className="lyra-settings-ai-input" type="text" value={discordChannelId} onChange={(event) => setDiscordChannelId(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.discordBotUserIdLabel}</span>
            <input className="lyra-settings-ai-input" type="text" value={discordBotUserId} onChange={(event) => setDiscordBotUserId(event.target.value)} />
          </label>
          <label className="lyra-settings-ai-checkbox">
            <input
              type="checkbox"
              checked={discordReplyEnabled}
              onChange={(event) => setDiscordReplyEnabled(event.target.checked)}
            />
            <span>{labels.discordReplyLabel}</span>
          </label>
        </div>

        <footer className="lyra-settings-ai-inline-editor-footer">
          <span className="lyra-settings-ai-actions">
            <button
              type="button"
              className="lyra-settings-ai-action lyra-settings-ai-action-primary"
              disabled={model.isSaving}
              onClick={() => {
                const smtpPort = optionalPort(emailSmtpPort);
                const imapPort = optionalPort(emailImapPort);
                const smtpPassword = optionalSecret(emailPassword);
                const telegramToken = optionalSecret(telegramBotToken);
                const discordToken = optionalSecret(discordBotToken);
                void model.updateJcodeConfig?.({
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
            </button>
          </span>
        </footer>
      </div>
    </section>
  );
};
