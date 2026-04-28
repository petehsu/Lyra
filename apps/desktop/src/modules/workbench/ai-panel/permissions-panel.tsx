import { Check, FolderPlus, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LyraClientRequestPayload, LyraDesktopApi } from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type JsonRecord = Record<string, unknown>;

type ApprovalPolicyPreset = "on-request" | "on-failure" | "never" | "granular";
type ApprovalsReviewerValue = "user" | "auto_review";
type SandboxModeValue = "read-only" | "workspace-write" | "danger-full-access";

type GranularPolicyValue = {
  readonly sandbox_approval: boolean;
  readonly rules: boolean;
  readonly skill_approval: boolean;
  readonly request_permissions: boolean;
  readonly mcp_elicitations: boolean;
};

type SandboxWorkspaceWriteValue = {
  readonly writable_roots: readonly string[];
  readonly network_access: boolean;
  readonly exclude_tmpdir_env_var: boolean;
  readonly exclude_slash_tmp: boolean;
};

type ApprovalPolicyValue =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | { readonly granular: GranularPolicyValue };

type PermissionPanelState = {
  readonly policyPreset: ApprovalPolicyPreset;
  readonly granular: GranularPolicyValue;
  readonly reviewer: ApprovalsReviewerValue;
  readonly sandboxMode: SandboxModeValue;
  readonly sandboxWorkspaceWrite: SandboxWorkspaceWriteValue;
  readonly allowedPolicies: readonly ApprovalPolicyPreset[];
  readonly allowedReviewers: readonly ApprovalsReviewerValue[];
  readonly allowedSandboxModes: readonly SandboxModeValue[];
};

type AiPermissionsPanelProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly locale: WorkbenchLocale;
  readonly onClose: () => void;
};

const DEFAULT_GRANULAR: GranularPolicyValue = {
  sandbox_approval: true,
  rules: true,
  skill_approval: true,
  request_permissions: true,
  mcp_elicitations: true,
};

const DEFAULT_STATE: PermissionPanelState = {
  policyPreset: "on-request",
  granular: DEFAULT_GRANULAR,
  reviewer: "user",
  sandboxMode: "workspace-write",
  sandboxWorkspaceWrite: {
    writable_roots: [],
    network_access: false,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false,
  },
  allowedPolicies: ["on-request", "on-failure", "never", "granular"],
  allowedReviewers: ["user", "auto_review"],
  allowedSandboxModes: ["read-only", "workspace-write", "danger-full-access"],
};

const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readPolicyPreset = (value: unknown): ApprovalPolicyPreset => {
  if (value === "on-failure" || value === "never" || value === "on-request") {
    return value;
  }
  if (isRecord(value) && isRecord(value.granular)) {
    return "granular";
  }
  return "on-request";
};

const readGranularPolicy = (value: unknown): GranularPolicyValue => {
  const source = isRecord(value) && isRecord(value.granular) ? value.granular : {};
  return {
    sandbox_approval:
      typeof source.sandbox_approval === "boolean"
        ? source.sandbox_approval
        : DEFAULT_GRANULAR.sandbox_approval,
    rules:
      typeof source.rules === "boolean"
        ? source.rules
        : DEFAULT_GRANULAR.rules,
    skill_approval:
      typeof source.skill_approval === "boolean"
        ? source.skill_approval
        : DEFAULT_GRANULAR.skill_approval,
    request_permissions:
      typeof source.request_permissions === "boolean"
        ? source.request_permissions
        : DEFAULT_GRANULAR.request_permissions,
    mcp_elicitations:
      typeof source.mcp_elicitations === "boolean"
        ? source.mcp_elicitations
        : DEFAULT_GRANULAR.mcp_elicitations,
  };
};

const readReviewer = (value: unknown): ApprovalsReviewerValue =>
  value === "auto_review" ? "auto_review" : "user";

const readSandboxMode = (value: unknown): SandboxModeValue =>
  value === "read-only" || value === "danger-full-access" || value === "workspace-write"
    ? value
    : "workspace-write";

const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    : [];

const readSandboxWorkspaceWrite = (value: unknown): SandboxWorkspaceWriteValue => {
  if (!isRecord(value)) {
    return DEFAULT_STATE.sandboxWorkspaceWrite;
  }
  return {
    writable_roots: readStringArray(value.writable_roots),
    network_access:
      typeof value.network_access === "boolean"
        ? value.network_access
        : DEFAULT_STATE.sandboxWorkspaceWrite.network_access,
    exclude_tmpdir_env_var:
      typeof value.exclude_tmpdir_env_var === "boolean"
        ? value.exclude_tmpdir_env_var
        : DEFAULT_STATE.sandboxWorkspaceWrite.exclude_tmpdir_env_var,
    exclude_slash_tmp:
      typeof value.exclude_slash_tmp === "boolean"
        ? value.exclude_slash_tmp
        : DEFAULT_STATE.sandboxWorkspaceWrite.exclude_slash_tmp,
  };
};

const readAllowedPolicyPresets = (value: unknown): readonly ApprovalPolicyPreset[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_STATE.allowedPolicies;
  }
  const policies = value
    .map(readPolicyPreset)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
  return policies.length > 0 ? policies : DEFAULT_STATE.allowedPolicies;
};

const readAllowedReviewers = (value: unknown): readonly ApprovalsReviewerValue[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_STATE.allowedReviewers;
  }
  const reviewers = value
    .map(readReviewer)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
  return reviewers.length > 0 ? reviewers : DEFAULT_STATE.allowedReviewers;
};

const readAllowedSandboxModes = (value: unknown): readonly SandboxModeValue[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_STATE.allowedSandboxModes;
  }
  const modes = value
    .map(readSandboxMode)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
  return modes.length > 0 ? modes : DEFAULT_STATE.allowedSandboxModes;
};

const policyValueOf = (
  preset: ApprovalPolicyPreset,
  granular: GranularPolicyValue
): ApprovalPolicyValue => {
  if (preset === "granular") {
    return { granular };
  }
  return preset;
};

export const AiPermissionsPanel = ({
  desktopApi,
  locale,
  onClose,
}: AiPermissionsPanelProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const lyraApi = desktopApi?.lyra ?? null;
  const [state, setState] = useState<PermissionPanelState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [manualRootPath, setManualRootPath] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [configResponse, requirementsResponse] = await Promise.all([
        lyraApi.request<{ readonly config?: JsonRecord }>(createRequestPayload("config/read")),
        lyraApi.request<{ readonly requirements?: JsonRecord | null }>(
          createRequestPayload("configRequirements/read")
        ),
      ]);
      const config = isRecord(configResponse.config) ? configResponse.config : {};
      const requirements = isRecord(requirementsResponse.requirements)
        ? requirementsResponse.requirements
        : {};
      const approvalPolicy = config.approval_policy;
      setState({
        policyPreset: readPolicyPreset(approvalPolicy),
        granular: readGranularPolicy(approvalPolicy),
        reviewer: readReviewer(config.approvals_reviewer),
        sandboxMode: readSandboxMode(config.sandbox_mode),
        sandboxWorkspaceWrite: readSandboxWorkspaceWrite(config.sandbox_workspace_write),
        allowedPolicies: readAllowedPolicyPresets(requirements.allowed_approval_policies),
        allowedReviewers: readAllowedReviewers(requirements.allowed_approvals_reviewers),
        allowedSandboxModes: readAllowedSandboxModes(requirements.allowed_sandbox_modes),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [lyraApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await lyraApi.request(createRequestPayload("config/batchWrite", {
        edits: [
          {
            keyPath: "approval_policy",
            value: policyValueOf(state.policyPreset, state.granular),
            mergeStrategy: "replace",
          },
          {
            keyPath: "approvals_reviewer",
            value: state.reviewer,
            mergeStrategy: "replace",
          },
          {
            keyPath: "sandbox_mode",
            value: state.sandboxMode,
            mergeStrategy: "replace",
          },
          {
            keyPath: "sandbox_workspace_write",
            value: state.sandboxWorkspaceWrite,
            mergeStrategy: "replace",
          },
        ],
        reloadUserConfig: true,
      }));
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [
    lyraApi,
    onClose,
    state.granular,
    state.policyPreset,
    state.reviewer,
    state.sandboxMode,
    state.sandboxWorkspaceWrite
  ]);

  const policyOptions = useMemo(
    () => [
      {
        value: "on-request" as const,
        label: t("ai.permissionsPolicyAskWhenNeeded"),
        description: t("ai.permissionsPolicyAskWhenNeededDescription"),
      },
      {
        value: "on-failure" as const,
        label: t("ai.permissionsPolicyAskOnFailure"),
        description: t("ai.permissionsPolicyAskOnFailureDescription"),
      },
      {
        value: "never" as const,
        label: t("ai.permissionsPolicyNever"),
        description: t("ai.permissionsPolicyNeverDescription"),
      },
      {
        value: "granular" as const,
        label: t("ai.permissionsPolicyGranular"),
        description: t("ai.permissionsPolicyGranularDescription"),
      },
    ].filter((option) => state.allowedPolicies.includes(option.value)),
    [state.allowedPolicies, t]
  );

  const sandboxOptions = useMemo(
    () => [
      {
        value: "read-only" as const,
        label: t("ai.permissionsSandboxReadOnly"),
        description: t("ai.permissionsSandboxReadOnlyDescription"),
      },
      {
        value: "workspace-write" as const,
        label: t("ai.permissionsSandboxWorkspace"),
        description: t("ai.permissionsSandboxWorkspaceDescription"),
      },
      {
        value: "danger-full-access" as const,
        label: t("ai.permissionsSandboxFullAccess"),
        description: t("ai.permissionsSandboxFullAccessDescription"),
      },
    ].filter((option) => state.allowedSandboxModes.includes(option.value)),
    [state.allowedSandboxModes, t]
  );

  const setGranularFlag = (key: keyof GranularPolicyValue, value: boolean): void => {
    setState((current) => ({
      ...current,
      granular: {
        ...current.granular,
        [key]: value,
      },
    }));
  };

  const setWorkspaceWriteFlag = (
    key: Exclude<keyof SandboxWorkspaceWriteValue, "writable_roots">,
    value: boolean
  ): void => {
    setState((current) => ({
      ...current,
      sandboxWorkspaceWrite: {
        ...current.sandboxWorkspaceWrite,
        [key]: value,
      },
    }));
  };

  const addWritableRoots = (roots: readonly string[]): void => {
    const normalizedRoots = roots
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (normalizedRoots.length === 0) {
      return;
    }
    setState((current) => ({
      ...current,
      sandboxWorkspaceWrite: {
        ...current.sandboxWorkspaceWrite,
        writable_roots: [
          ...current.sandboxWorkspaceWrite.writable_roots,
          ...normalizedRoots,
        ].filter((entry, index, entries) => entries.indexOf(entry) === index),
      },
    }));
  };

  const removeWritableRoot = (root: string): void => {
    setState((current) => ({
      ...current,
      sandboxWorkspaceWrite: {
        ...current.sandboxWorkspaceWrite,
        writable_roots: current.sandboxWorkspaceWrite.writable_roots.filter((entry) => entry !== root),
      },
    }));
  };

  const addManualRoot = (): void => {
    const root = manualRootPath.trim();
    if (root.length === 0) {
      return;
    }
    addWritableRoots([root]);
    setManualRootPath("");
  };

  const selectWritableDirectories = async (): Promise<void> => {
    if (desktopApi?.files?.selectDirectories === undefined) {
      return;
    }
    try {
      const directories = await desktopApi.files.selectDirectories();
      addWritableRoots(directories.map((entry) => entry.path));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="lyra-ai-permissions-panel" aria-label={t("ai.permissionsTitle")}>
      <header className="lyra-ai-permissions-panel__header">
        <span className="lyra-ai-permissions-panel__title">
          <ShieldCheck size={15} aria-hidden="true" />
          <strong>{t("ai.permissionsTitle")}</strong>
        </span>
        <button
          type="button"
          className="lyra-ai-permissions-panel__icon"
          onClick={onClose}
          aria-label={t("dialog.cancel")}
          title={t("dialog.cancel")}
        >
          <X size={14} />
        </button>
      </header>
      <p className="lyra-ai-permissions-panel__description">
        {t("ai.permissionsDescription")}
      </p>
      {isLoading ? (
        <div className="lyra-ai-permissions-panel__status">{t("ai.permissionsLoading")}</div>
      ) : (
        <>
          <div className="lyra-ai-permissions-panel__grid" role="radiogroup" aria-label={t("ai.permissionsPolicyLabel")}>
            {policyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={state.policyPreset === option.value}
                className={
                  state.policyPreset === option.value
                    ? "lyra-ai-permissions-panel__choice lyra-ai-permissions-panel__choice-active"
                    : "lyra-ai-permissions-panel__choice"
                }
                onClick={() => {
                  setState((current) => ({
                    ...current,
                    policyPreset: option.value,
                  }));
                }}
              >
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>

          <div className="lyra-ai-permissions-panel__section">
            <span>{t("ai.permissionsSandboxLabel")}</span>
            <div className="lyra-ai-permissions-panel__grid" role="radiogroup" aria-label={t("ai.permissionsSandboxLabel")}>
              {sandboxOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={state.sandboxMode === option.value}
                  className={
                    state.sandboxMode === option.value
                      ? "lyra-ai-permissions-panel__choice lyra-ai-permissions-panel__choice-active"
                      : "lyra-ai-permissions-panel__choice"
                  }
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      sandboxMode: option.value,
                    }));
                  }}
                >
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
            {state.sandboxMode === "read-only" ? (
              <p className="lyra-ai-permissions-panel__note">
                {t("ai.permissionsSandboxReadOnlyNote")}
              </p>
            ) : null}
            {state.sandboxMode === "workspace-write" ? (
              <div className="lyra-ai-permissions-panel__advanced">
                <div className="lyra-ai-permissions-panel__advanced-header">
                  <strong>{t("ai.permissionsSandboxWorkspaceAdvanced")}</strong>
                  <button
                    type="button"
                    className="lyra-ai-permissions-panel__button lyra-ai-permissions-panel__button-compact"
                    disabled={desktopApi?.files?.selectDirectories === undefined}
                    onClick={() => {
                      void selectWritableDirectories();
                    }}
                  >
                    <FolderPlus size={13} aria-hidden="true" />
                    <span>{t("ai.permissionsSandboxAddDirectory")}</span>
                  </button>
                </div>
                <label className="lyra-ai-permissions-panel__input-row">
                  <span>{t("ai.permissionsSandboxManualPath")}</span>
                  <input
                    type="text"
                    value={manualRootPath}
                    placeholder={t("ai.permissionsSandboxManualPathPlaceholder")}
                    onChange={(event) => {
                      setManualRootPath(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addManualRoot();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="lyra-ai-permissions-panel__button lyra-ai-permissions-panel__button-compact"
                    onClick={addManualRoot}
                  >
                    {t("ai.permissionsSandboxAddManual")}
                  </button>
                </label>
                <div className="lyra-ai-permissions-panel__roots" aria-label={t("ai.permissionsSandboxWritableRoots")}>
                  {state.sandboxWorkspaceWrite.writable_roots.length === 0 ? (
                    <span className="lyra-ai-permissions-panel__empty">
                      {t("ai.permissionsSandboxNoWritableRoots")}
                    </span>
                  ) : (
                    state.sandboxWorkspaceWrite.writable_roots.map((root) => (
                      <span key={root} className="lyra-ai-permissions-panel__root">
                        <code>{root}</code>
                        <button
                          type="button"
                          className="lyra-ai-permissions-panel__icon"
                          onClick={() => {
                            removeWritableRoot(root);
                          }}
                          aria-label={t("ai.permissionsSandboxRemoveRoot")}
                          title={t("ai.permissionsSandboxRemoveRoot")}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div className="lyra-ai-permissions-panel__granular">
                  {([
                    ["network_access", t("ai.permissionsSandboxNetworkAccess")],
                    ["exclude_tmpdir_env_var", t("ai.permissionsSandboxExcludeTmpdirEnv")],
                    ["exclude_slash_tmp", t("ai.permissionsSandboxExcludeSlashTmp")],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        state.sandboxWorkspaceWrite[key]
                          ? "lyra-ai-permissions-panel__toggle lyra-ai-permissions-panel__toggle-active"
                          : "lyra-ai-permissions-panel__toggle"
                      }
                      onClick={() => {
                        setWorkspaceWriteFlag(key, !state.sandboxWorkspaceWrite[key]);
                      }}
                    >
                      <span>{label}</span>
                      {state.sandboxWorkspaceWrite[key] ? <Check size={13} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {state.policyPreset === "granular" ? (
            <div className="lyra-ai-permissions-panel__granular">
              {[
                ["sandbox_approval", t("ai.permissionsGranularSandbox")],
                ["rules", t("ai.permissionsGranularRules")],
                ["skill_approval", t("ai.permissionsGranularSkills")],
                ["request_permissions", t("ai.permissionsGranularRequests")],
                ["mcp_elicitations", t("ai.permissionsGranularMcp")],
              ].map(([key, label]) => {
                const typedKey = key as keyof GranularPolicyValue;
                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      state.granular[typedKey]
                        ? "lyra-ai-permissions-panel__toggle lyra-ai-permissions-panel__toggle-active"
                        : "lyra-ai-permissions-panel__toggle"
                    }
                    onClick={() => {
                      setGranularFlag(typedKey, !state.granular[typedKey]);
                    }}
                  >
                    <span>{label}</span>
                    {state.granular[typedKey] ? <Check size={13} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="lyra-ai-permissions-panel__reviewers">
            <span>{t("ai.permissionsReviewerLabel")}</span>
            <div className="lyra-ai-permissions-panel__reviewer-options" role="radiogroup">
              {state.allowedReviewers.map((reviewer) => (
                <button
                  key={reviewer}
                  type="button"
                  role="radio"
                  aria-checked={state.reviewer === reviewer}
                  className={
                    state.reviewer === reviewer
                      ? "lyra-ai-permissions-panel__reviewer lyra-ai-permissions-panel__reviewer-active"
                      : "lyra-ai-permissions-panel__reviewer"
                  }
                  onClick={() => {
                    setState((current) => ({ ...current, reviewer }));
                  }}
                >
                  {reviewer === "auto_review"
                    ? t("ai.permissionsReviewerAutoReview")
                    : t("ai.permissionsReviewerUser")}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {errorMessage === null ? null : (
        <div className="lyra-ai-permissions-panel__error">{errorMessage}</div>
      )}
      <footer className="lyra-ai-permissions-panel__footer">
        <button
          type="button"
          className="lyra-ai-permissions-panel__button"
          onClick={onClose}
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="lyra-ai-permissions-panel__button lyra-ai-permissions-panel__button-primary"
          disabled={isLoading || isSaving || lyraApi === null}
          onClick={() => {
            void save();
          }}
        >
          {isSaving ? t("dialog.savingAction") : t("ai.permissionsSave")}
        </button>
      </footer>
    </section>
  );
};
