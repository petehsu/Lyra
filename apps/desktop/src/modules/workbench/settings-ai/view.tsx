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
    readonly defaultProvider?: string | null;
    readonly defaultModel?: string | null;
  };
  readonly providers?: Record<string, {
    readonly label?: string | null;
    readonly routeId?: string | null;
    readonly protocolId?: string | null;
    readonly protocolFamily?: string | null;
    readonly baseUrl?: string | null;
    readonly authHeader?: string | null;
    readonly defaultModel?: string | null;
    readonly models?: readonly {
      readonly id?: string;
      readonly supportsImageInput?: boolean;
      readonly supportsToolCalling?: boolean;
      readonly supportsStreaming?: boolean;
    }[];
  }>;
  readonly roles?: {
    readonly swarmModel?: string | null;
    readonly reviewModel?: string | null;
    readonly judgeModel?: string | null;
    readonly memoryModel?: string | null;
    readonly ambientModel?: string | null;
  };
  readonly notifications?: {
    readonly ntfyTopic?: string | null;
    readonly ntfyServer?: string | null;
    readonly desktopNotifications?: boolean;
    readonly emailEnabled?: boolean;
    readonly emailTo?: string | null;
    readonly emailSmtpHost?: string | null;
    readonly emailSmtpPort?: number;
    readonly emailFrom?: string | null;
    readonly emailPassword?: string | null;
    readonly emailImapHost?: string | null;
    readonly emailImapPort?: number;
    readonly emailReplyEnabled?: boolean;
    readonly telegramEnabled?: boolean;
    readonly telegramBotToken?: string | null;
    readonly telegramChatId?: string | null;
    readonly telegramReplyEnabled?: boolean;
    readonly discordEnabled?: boolean;
    readonly discordBotToken?: string | null;
    readonly discordChannelId?: string | null;
    readonly discordBotUserId?: string | null;
    readonly discordReplyEnabled?: boolean;
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

const splitModelIds = (value: string): string[] =>
  value
    .split(/[\n,，、;；]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const uniqueModelIds = (...groups: readonly string[][]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
  }
  return result;
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
  const profiles = model.profiles;
  const routeById = useMemo(
    () => new Map((model.agentProviderCatalog?.routes ?? []).map((route) => [route.id, route])),
    [model.agentProviderCatalog?.routes]
  );
  const accounts = model.agentAccounts?.accounts ?? [];
  const loginProviders = model.agentLoginProviders?.providers ?? [];
  const googleLoginProvider = loginProviders.find((provider) => provider.id === "google");
  const oauthLoginProviders = loginProviders.filter((provider) =>
    provider.requiresCallback && provider.id !== "google"
  );
  const quickSetupRoutes = model.quickSetupRoutes;
  const localRoutes = model.localRoutes;
  const defaultProviderName = model.defaultProfileId ?? config.provider?.defaultProvider ?? "";
  const defaultProfile = profiles.find((profile) => profile.id === defaultProviderName) ?? null;
  const defaultProviderConfig = config.providers?.[defaultProviderName] ?? null;
  const [selectedApiKeyProvider, setSelectedApiKeyProvider] = useState("openai");
  const [profileName, setProfileName] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [selectedLocalProvider, setSelectedLocalProvider] = useState("");
  const [localProfileName, setLocalProfileName] = useState("");
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [localDefaultModel, setLocalDefaultModel] = useState("");
  const [localAuthHeader, setLocalAuthHeader] = useState("");
  const [localModelIds, setLocalModelIds] = useState("");
  const [localSupportsImageInput, setLocalSupportsImageInput] = useState(true);
  const [localSupportsToolCalling, setLocalSupportsToolCalling] = useState(true);
  const [localSupportsStreaming, setLocalSupportsStreaming] = useState(true);
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
  const selectedQuickSetupRoute = quickSetupRoutes.find((route) => route.id === selectedApiKeyProvider) ?? null;
  const selectedQuickSetupProfile = selectedQuickSetupRoute === null
    ? null
    : profiles.find((profile) => profile.routeId === selectedQuickSetupRoute.id) ?? null;
  const selectedLocalRoute = localRoutes.find((route) => route.id === selectedLocalProvider) ?? null;
  const selectedLocalProfile = selectedLocalRoute === null
    ? null
    : profiles.find((profile) => profile.routeId === selectedLocalRoute.id) ?? null;
  const selectedLocalConfig = selectedLocalProfile === null
    ? null
    : config.providers?.[selectedLocalProfile.id] ?? null;

  useEffect(() => {
    if (
      quickSetupRoutes.length > 0
      && !quickSetupRoutes.some((route) => route.id === selectedApiKeyProvider)
    ) {
      setSelectedApiKeyProvider(quickSetupRoutes[0]?.id ?? "");
    }
  }, [quickSetupRoutes, selectedApiKeyProvider]);

  useEffect(() => {
    if (
      localRoutes.length > 0
      && !localRoutes.some((route) => route.id === selectedLocalProvider)
    ) {
      setSelectedLocalProvider(localRoutes[0]?.id ?? "");
    }
  }, [localRoutes, selectedLocalProvider]);

  useEffect(() => {
    const editableProfile = selectedQuickSetupProfile;
    const editableRoute = selectedQuickSetupRoute;
    setProfileName(editableProfile?.id ?? editableRoute?.id ?? defaultProviderName);
    setBaseUrl(editableProfile?.baseUrl ?? editableRoute?.defaultBaseUrl ?? "");
    setDefaultModel(
      editableProfile?.defaultModel
      ?? defaultProviderConfig?.defaultModel
      ?? defaultProfile?.defaultModel
      ?? ""
    );
    setAuthHeader(editableProfile?.authHeader ?? "");
    setApiKey("");
    setSwarmModel(config.roles?.swarmModel ?? "");
    setReviewModel(config.roles?.reviewModel ?? "");
    setJudgeModel(config.roles?.judgeModel ?? "");
    setMemoryModel(config.roles?.memoryModel ?? "");
    setAmbientModel(config.roles?.ambientModel ?? "");
    setDesktopNotifications(config.notifications?.desktopNotifications ?? true);
    setNtfyTopic(config.notifications?.ntfyTopic ?? "");
    setNtfyServer(config.notifications?.ntfyServer ?? "https://ntfy.sh");
    setEmailEnabled(config.notifications?.emailEnabled ?? false);
    setEmailTo(config.notifications?.emailTo ?? "");
    setEmailSmtpHost(config.notifications?.emailSmtpHost ?? "");
    setEmailSmtpPort(String(config.notifications?.emailSmtpPort ?? 587));
    setEmailFrom(config.notifications?.emailFrom ?? "");
    setEmailPassword("");
    setEmailImapHost(config.notifications?.emailImapHost ?? "");
    setEmailImapPort(String(config.notifications?.emailImapPort ?? 993));
    setEmailReplyEnabled(config.notifications?.emailReplyEnabled ?? false);
    setTelegramEnabled(config.notifications?.telegramEnabled ?? false);
    setTelegramBotToken("");
    setTelegramChatId(config.notifications?.telegramChatId ?? "");
    setTelegramReplyEnabled(config.notifications?.telegramReplyEnabled ?? false);
    setDiscordEnabled(config.notifications?.discordEnabled ?? false);
    setDiscordBotToken("");
    setDiscordChannelId(config.notifications?.discordChannelId ?? "");
    setDiscordBotUserId(config.notifications?.discordBotUserId ?? "");
    setDiscordReplyEnabled(config.notifications?.discordReplyEnabled ?? false);
  }, [
    config.notifications?.desktopNotifications,
    config.notifications?.discordBotUserId,
    config.notifications?.discordChannelId,
    config.notifications?.discordEnabled,
    config.notifications?.discordReplyEnabled,
    config.notifications?.emailEnabled,
    config.notifications?.emailFrom,
    config.notifications?.emailImapHost,
    config.notifications?.emailImapPort,
    config.notifications?.emailReplyEnabled,
    config.notifications?.emailSmtpHost,
    config.notifications?.emailSmtpPort,
    config.notifications?.emailTo,
    config.notifications?.ntfyServer,
    config.notifications?.ntfyTopic,
    config.notifications?.telegramChatId,
    config.notifications?.telegramEnabled,
    config.notifications?.telegramReplyEnabled,
    config.provider?.defaultModel,
    config.roles?.ambientModel,
    config.roles?.judgeModel,
    config.roles?.memoryModel,
    config.roles?.reviewModel,
    config.roles?.swarmModel,
    defaultProfile?.defaultModel,
    defaultProviderConfig?.defaultModel,
    defaultProviderName,
    selectedQuickSetupProfile?.authHeader,
    selectedQuickSetupProfile?.baseUrl,
    selectedQuickSetupProfile?.defaultModel,
    selectedQuickSetupProfile?.id,
    selectedQuickSetupRoute?.defaultBaseUrl,
    selectedQuickSetupRoute?.id,
  ]);

  useEffect(() => {
    const editableProfile = selectedLocalProfile;
    const editableRoute = selectedLocalRoute;
    const providerModels = selectedLocalConfig?.models ?? [];
    setLocalProfileName(editableProfile?.id ?? editableRoute?.id ?? "");
    setLocalBaseUrl(editableProfile?.baseUrl ?? editableRoute?.defaultBaseUrl ?? "");
    setLocalDefaultModel(
      editableProfile?.defaultModel
      ?? selectedLocalConfig?.defaultModel
      ?? ""
    );
    setLocalAuthHeader(editableProfile?.authHeader ?? "");
    setLocalApiKey("");
    setLocalModelIds(
      providerModels
        .map((entry) => entry.id?.trim() ?? "")
        .filter((id) => id.length > 0)
        .join("\n")
    );
    setLocalSupportsImageInput(editableProfile?.capabilities.supportsImageInput ?? true);
    setLocalSupportsToolCalling(editableProfile?.capabilities.supportsToolCalling ?? true);
    setLocalSupportsStreaming(editableProfile?.capabilities.supportsStreaming ?? true);
  }, [
    selectedLocalConfig?.defaultModel,
    selectedLocalConfig?.models,
    selectedLocalProfile?.authHeader,
    selectedLocalProfile?.baseUrl,
    selectedLocalProfile?.capabilities.supportsImageInput,
    selectedLocalProfile?.capabilities.supportsStreaming,
    selectedLocalProfile?.capabilities.supportsToolCalling,
    selectedLocalProfile?.defaultModel,
    selectedLocalProfile?.id,
    selectedLocalRoute?.defaultBaseUrl,
    selectedLocalRoute?.id,
  ]);

  const localModelEntries = useMemo(() => {
    const ids = uniqueModelIds(
      splitModelIds(localModelIds),
      localDefaultModel.trim().length === 0 ? [] : [localDefaultModel.trim()],
    );
    return ids.map((id) => ({
      id,
      supportsImageInput: localSupportsImageInput,
      supportsToolCalling: localSupportsToolCalling,
      supportsStreaming: localSupportsStreaming,
    }));
  }, [
    localDefaultModel,
    localModelIds,
    localSupportsImageInput,
    localSupportsStreaming,
    localSupportsToolCalling,
  ]);

  const buildLocalProviderProfileRequest = () => {
    if (selectedLocalRoute === null) return null;
    const profile = localProfileName.trim().length === 0
      ? selectedLocalRoute.id
      : localProfileName.trim();
    return {
      profileName: profile,
      routeId: selectedLocalRoute.id,
      baseUrl: localBaseUrl.trim().length === 0
        ? selectedLocalRoute.defaultBaseUrl ?? ""
        : localBaseUrl.trim(),
      apiKey: localApiKey.trim().length === 0 ? null : localApiKey,
      defaultModel: localDefaultModel.trim().length === 0 ? null : localDefaultModel.trim(),
      auth: localAuthHeader.trim().length > 0
        ? "header" as const
        : localApiKey.trim().length > 0
          ? "bearer" as const
          : "none" as const,
      authHeader: localAuthHeader.trim().length === 0 ? null : localAuthHeader.trim(),
      setDefault: true,
      models: localModelEntries,
    };
  };

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
              title={defaultProfile?.label ?? defaultProviderName ?? labels.providerAutoFallback}
              description={defaultProfile?.defaultModel ?? config.provider?.defaultModel ?? labels.defaultModelFallback}
            />
          </div>
        </div>

        <div className="lyra-settings-ai-provider-models">
          <div className="lyra-settings-ai-model-row">
            <AppObjectRow
              className="lyra-settings-ai-model-card lyra-settings-ai-model-card-active"
              active
              meta={labels.configFileTitle}
              title={model.agentConfig?.configPath ?? "~/.lyra/modules/agent/state.json"}
              description={model.agentConfig?.agentHome ?? labels.configFileDescription}
              onClick={() => {
                void model.openAgentConfigFile?.();
              }}
            />
          </div>
          {profiles.map((profile) => {
            const route = routeById.get(profile.routeId) ?? null;
            return (
              <div key={profile.id} className="lyra-settings-ai-model-row">
              <AppObjectRow
                className="lyra-settings-ai-model-card"
                title={profile.id}
                description={[
                  route?.label ?? profile.routeId,
                  profile.defaultModel ?? profile.baseUrl ?? labels.customProviderFallback,
                ].filter((value) => value !== null && value !== "").join(" · ")}
                onClick={() => {
                  void model.setDefaultProfile(profile.id);
                }}
              />
              </div>
            );
          })}
        </div>
      </div>

      <div className="lyra-settings-ai-inline-editor">
        <header className="lyra-settings-ai-inline-editor-header">
          <span className="lyra-settings-ai-inline-editor-title-copy">
            <h3>{labels.localProviderTitle}</h3>
            <small>{labels.localProviderDescription}</small>
          </span>
        </header>

        {localRoutes.length === 0 ? (
          <AppEmptyState
            align="start"
            density="compact"
            className="lyra-settings-ai-empty"
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <>
            <div className="lyra-settings-ai-api-provider-strip">
              {localRoutes.map((route) => (
                <AppObjectRow
                  key={route.id}
                  className={[
                    "lyra-settings-ai-provider-tab",
                    selectedLocalProvider === route.id ? "lyra-settings-ai-provider-tab-active" : "",
                  ].filter(Boolean).join(" ")}
                  active={selectedLocalProvider === route.id}
                  disabled={model.isSaving}
                  icon={<KeyRound size={13} aria-hidden="true" />}
                  title={route.label}
                  description={route.description}
                  onClick={() => {
                    setSelectedLocalProvider(route.id);
                  }}
                />
              ))}
            </div>

            <div className="lyra-settings-ai-form">
              <SettingsAiInputField
                label={labels.profileNameLabel}
                type="text"
                value={localProfileName}
                onValueChange={setLocalProfileName}
              />
              <SettingsAiInputField
                label={labels.urlLabel}
                type="text"
                placeholder={selectedLocalRoute?.defaultBaseUrl ?? labels.urlPlaceholder}
                value={localBaseUrl}
                onValueChange={setLocalBaseUrl}
              />
              <SettingsAiInputField
                label={labels.mainModelLabel}
                type="text"
                placeholder={labels.modelPlaceholder}
                value={localDefaultModel}
                onValueChange={setLocalDefaultModel}
              />
              <SettingsAiInputField
                label={labels.authHeaderLabel}
                type="text"
                placeholder="Authorization"
                value={localAuthHeader}
                onValueChange={setLocalAuthHeader}
              />
              <SettingsAiInputField
                label={labels.keyLabel}
                type="password"
                autoComplete="off"
                placeholder={labels.keyPlaceholder}
                value={localApiKey}
                onValueChange={setLocalApiKey}
              />
              <SettingsAiTextareaField
                className="lyra-settings-ai-field-span-2"
                label={labels.localModelsLabel}
                placeholder={labels.localModelsPlaceholder}
                value={localModelIds}
                onValueChange={setLocalModelIds}
              />
              <div className="lyra-settings-ai-field lyra-settings-ai-field-span-2">
                <span>{labels.localCapabilitiesTitle}</span>
                <SettingsAiSwitchRow
                  checked={localSupportsImageInput}
                  label={labels.localSupportsImageInput}
                  onCheckedChange={setLocalSupportsImageInput}
                />
                <SettingsAiSwitchRow
                  checked={localSupportsToolCalling}
                  label={labels.localSupportsToolCalling}
                  onCheckedChange={setLocalSupportsToolCalling}
                />
                <SettingsAiSwitchRow
                  checked={localSupportsStreaming}
                  label={labels.localSupportsStreaming}
                  onCheckedChange={setLocalSupportsStreaming}
                />
              </div>
            </div>

            <footer className="lyra-settings-ai-inline-editor-footer">
              <span className="lyra-settings-ai-actions">
                <AppButton
                  variant="outline"
                  size="sm"
                  className="lyra-settings-ai-action"
                  disabled={model.isSaving || selectedLocalRoute === null}
                  onClick={() => {
                    const request = buildLocalProviderProfileRequest();
                    if (request === null) return;
                    void model.saveAgentProviderProfile?.(request);
                  }}
                >
                  <Save size={14} aria-hidden="true" />
                  {labels.saveProfile}
                </AppButton>
                <AppButton
                  variant="default"
                  size="sm"
                  className="lyra-settings-ai-action lyra-settings-ai-action-primary"
                  disabled={model.isSaving || selectedLocalRoute === null}
                  onClick={() => {
                    const request = buildLocalProviderProfileRequest();
                    if (request === null) return;
                    void (async () => {
                      await model.saveAgentProviderProfile?.(request);
                      await model.refreshAgentModels?.(request.profileName);
                    })();
                  }}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {labels.saveAndDiscoverModels}
                </AppButton>
              </span>
            </footer>
          </>
        )}
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
          {quickSetupRoutes.map((route) => (
            <AppObjectRow
              key={route.id}
              className={[
                "lyra-settings-ai-provider-tab",
                selectedApiKeyProvider === route.id ? "lyra-settings-ai-provider-tab-active" : "",
              ].filter(Boolean).join(" ")}
              active={selectedApiKeyProvider === route.id}
              disabled={model.isSaving}
              icon={<KeyRound size={13} aria-hidden="true" />}
              title={route.label}
              description={route.description}
              onClick={() => {
                setSelectedApiKeyProvider(route.id);
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
            placeholder={selectedQuickSetupRoute?.defaultBaseUrl ?? labels.urlPlaceholder}
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
                void model.saveAgentProviderProfile?.({
                  profileName,
                  routeId: selectedApiKeyProvider,
                  baseUrl: baseUrl.trim().length === 0
                    ? selectedQuickSetupRoute?.defaultBaseUrl ?? ""
                    : baseUrl,
                  apiKey: apiKey.trim().length === 0 ? null : apiKey,
                  defaultModel: defaultModel.trim().length === 0 ? null : defaultModel,
                  auth: authHeader.trim().length === 0 ? "bearer" : "header",
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
