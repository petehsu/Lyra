import { Check, FilePenLine, RefreshCw, Save, Trash2 } from "lucide-react";
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
};

const asJcodeConfig = (value: unknown): JcodeConfigShape =>
  (value ?? {}) as JcodeConfigShape;

export const SettingsAiView = ({ labels, model }: SettingsAiViewProps) => {
  const config = asJcodeConfig(model.jcodeConfig?.config);
  const providers = useMemo(
    () => Object.entries(config.providers ?? {}),
    [config.providers]
  );
  const accounts = model.jcodeAccounts?.accounts ?? [];
  const defaultProviderName = config.provider?.default_provider ?? "mimo-token-plan";
  const defaultProviderConfig = config.providers?.[defaultProviderName] ?? null;
  const defaultProviderModelIds = useMemo(
    () => (defaultProviderConfig?.models ?? [])
      .map((entry) => entry.id?.trim() ?? "")
      .filter((id) => id.length > 0)
      .join("\n"),
    [defaultProviderConfig?.models]
  );
  const [profileName, setProfileName] = useState("mimo-token-plan");
  const [baseUrl, setBaseUrl] = useState("https://token-plan-sgp.xiaomimimo.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("mimo-v2.5-pro");
  const [authHeader, setAuthHeader] = useState("api-key");
  const [swarmModel, setSwarmModel] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [memoryModel, setMemoryModel] = useState("");
  const [ambientModel, setAmbientModel] = useState("");

  useEffect(() => {
    setProfileName(defaultProviderName);
    setBaseUrl(defaultProviderConfig?.base_url ?? "https://token-plan-sgp.xiaomimimo.com/v1");
    setDefaultModel(
      config.provider?.default_model
      ?? defaultProviderConfig?.default_model
      ?? defaultProviderModelIds.split("\n").find((id) => id.length > 0)
      ?? "mimo-v2.5-pro"
    );
    setAuthHeader(defaultProviderConfig?.auth_header ?? "api-key");
    setApiKey("");
    setSwarmModel(config.agents?.swarm_model ?? "");
    setReviewModel(config.autoreview?.model ?? "");
    setJudgeModel(config.autojudge?.model ?? "");
    setMemoryModel(config.agents?.memory_model ?? "");
    setAmbientModel(config.ambient?.model ?? "");
  }, [
    config.agents?.memory_model,
    config.agents?.swarm_model,
    config.ambient?.model,
    config.autojudge?.model,
    config.autoreview?.model,
    config.provider?.default_model,
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
                  disabled={model.isSaving || account.active}
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
            <h3>{labels.providerProfileTitle}</h3>
          </span>
        </header>

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
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.mainModelLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </label>
          <label className="lyra-settings-ai-field">
            <span>{labels.authHeaderLabel}</span>
            <input
              className="lyra-settings-ai-input"
              type="text"
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
              disabled={model.isSaving}
              onClick={() => {
                void model.saveJcodeProviderProfile?.({
                  profileName,
                  baseUrl,
                  apiKey: apiKey.trim().length === 0 ? null : apiKey,
                  defaultModel,
                  auth: "header",
                  authHeader,
                  setDefault: true,
                  models: [{ id: defaultModel }],
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

      <div className="lyra-settings-ai-profile-grid">
        <div className="lyra-settings-ai-provider-list" aria-label={labels.commandsAriaLabel}>
          {(model.jcodeCommands ?? []).slice(0, 18).map((command) => (
            <div key={command.name} className="lyra-settings-ai-provider-row">
              <button type="button" className="lyra-settings-ai-provider-tab">
                <span>
                  <strong>{command.name}</strong>
                  <small>{command.help}</small>
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
