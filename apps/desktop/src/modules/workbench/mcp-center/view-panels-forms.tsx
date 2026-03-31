import { AlertTriangle, X } from "lucide-react";
import type { ChangeEvent } from "react";

import type { McpCatalogItem } from "../../../shared/mcp";
import type {
  McpCenterDraft,
  McpCenterEnvironmentDraft,
  McpCenterLabels,
  McpCenterPresetDraft
} from "./types";
import { LyraListPicker } from "../list-picker";
import { resolvePresetFieldDisplay } from "./view-panels-renderers";

const DraftEnvironmentRow = ({
  entry,
  labels,
  onChange,
  onRemove
}: {
  readonly entry: McpCenterEnvironmentDraft;
  readonly labels: McpCenterLabels;
  readonly onChange: (
    id: string,
    field: "key" | "mode" | "value",
    value: string
  ) => void;
  readonly onRemove: (id: string) => void;
}) => (
  <div className="lyra-mcp-center-env-row">
    <input
      className="lyra-mcp-center-input"
      value={entry.key}
      placeholder={labels.formEnvironmentKey}
      onChange={(event) => {
        onChange(entry.id, "key", event.target.value);
      }}
    />
    <LyraListPicker
      className="lyra-mcp-center-list-picker"
      ariaLabel={labels.fieldEnvironment}
      listAriaLabel={labels.fieldEnvironment}
      value={entry.mode}
      shape="rounded"
      options={[
        { value: "plain", label: labels.modePlain },
        { value: "secret", label: labels.modeSecret },
        { value: "external", label: labels.modeExternal }
      ]}
      onChange={(nextMode) => {
        onChange(entry.id, "mode", nextMode);
      }}
    />
    <input
      className="lyra-mcp-center-input"
      value={entry.value}
      placeholder={
        entry.mode === "external"
          ? labels.formEnvironmentExternal
          : entry.mode === "secret"
            ? labels.formEnvironmentSecret
            : labels.formEnvironmentValue
      }
      onChange={(event) => {
        onChange(entry.id, "value", event.target.value);
      }}
    />
    <button
      type="button"
      className="lyra-mcp-center-inline-button lyra-mcp-center-inline-button-danger"
      onClick={() => {
        onRemove(entry.id);
      }}
      aria-label={labels.actionDelete}
    >
      <X size={13} />
    </button>
  </div>
);

export const CustomForm = ({
  draft,
  labels,
  projectScopeAvailable,
  errorMessage,
  onFieldChange,
  onAddEnvironment,
  onUpdateEnvironment,
  onRemoveEnvironment,
  onToggleAdvanced,
  onSave,
  onCancel
}: {
  readonly draft: McpCenterDraft;
  readonly labels: McpCenterLabels;
  readonly projectScopeAvailable: boolean;
  readonly errorMessage: string | null;
  readonly onFieldChange: <K extends keyof McpCenterDraft>(
    field: K,
    value: McpCenterDraft[K]
  ) => void;
  readonly onAddEnvironment: () => void;
  readonly onUpdateEnvironment: (
    id: string,
    field: "key" | "mode" | "value",
    value: string
  ) => void;
  readonly onRemoveEnvironment: (id: string) => void;
  readonly onToggleAdvanced: () => void;
  readonly onSave: () => Promise<void>;
  readonly onCancel: () => void;
}) => (
  <section className="lyra-mcp-center-panel-shell">
    <header className="lyra-mcp-center-panel-header">
      <div>
        <h3>{draft.mode === "edit" ? labels.formEdit : labels.formNew}</h3>
        <p>{draft.mode === "edit" ? labels.details : labels.customDescription}</p>
      </div>
      <div className="lyra-mcp-center-actions">
        <button
          type="button"
          className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
          onClick={onToggleAdvanced}
        >
          {labels.toggleAdvanced}
        </button>
        <button
          type="button"
          className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
          onClick={onCancel}
        >
          {labels.actionCancel}
        </button>
        <button
          type="button"
          className="lyra-mcp-center-button"
          onClick={() => {
            void onSave();
          }}
        >
          {labels.actionSave}
        </button>
      </div>
    </header>

    {errorMessage === null ? null : (
      <div className="lyra-mcp-center-alert lyra-mcp-center-alert-error">
        <AlertTriangle size={14} />
        <span>{errorMessage}</span>
      </div>
    )}

    {draft.advancedMode ? (
      <div className="lyra-mcp-center-form-section">
        <label>
          <span>{labels.formRaw}</span>
          <textarea
            className="lyra-mcp-center-textarea lyra-mcp-center-textarea-raw"
            value={draft.rawValue}
            onChange={(event) => {
              onFieldChange("rawValue", event.target.value);
            }}
          />
        </label>
      </div>
    ) : (
      <>
        <section className="lyra-mcp-center-form-section lyra-mcp-center-form-grid">
          <label>
            <span>{labels.fieldTitle}</span>
            <input
              className="lyra-mcp-center-input"
              value={draft.title}
              onChange={(event) => {
                onFieldChange("title", event.target.value);
              }}
            />
          </label>
          <label>
            <span>{labels.fieldSummary}</span>
            <input
              className="lyra-mcp-center-input"
              value={draft.summary}
              onChange={(event) => {
                onFieldChange("summary", event.target.value);
              }}
            />
          </label>
          <label className="lyra-mcp-center-form-grid-span-2">
            <span>{labels.fieldDescription}</span>
            <textarea
              className="lyra-mcp-center-textarea"
              value={draft.description}
              onChange={(event) => {
                onFieldChange("description", event.target.value);
              }}
            />
          </label>
          <label>
            <span>{labels.fieldIconKey}</span>
            <input
              className="lyra-mcp-center-input"
              value={draft.iconKey}
              onChange={(event) => {
                onFieldChange("iconKey", event.target.value);
              }}
            />
          </label>
          <label>
            <span>{labels.recommendedScope}</span>
            <LyraListPicker
              className="lyra-mcp-center-list-picker"
              ariaLabel={labels.recommendedScope}
              listAriaLabel={labels.recommendedScope}
              value={draft.scope}
              shape="rounded"
              options={[
                { value: "global", label: labels.scopeGlobal },
                {
                  value: "project",
                  label: projectScopeAvailable ? labels.scopeProject : labels.scopeProjectUnavailable,
                  disabled: projectScopeAvailable === false
                }
              ]}
              onChange={(nextScope) => {
                onFieldChange("scope", nextScope);
              }}
            />
          </label>
          <label>
            <span>{labels.fieldTransport}</span>
            <LyraListPicker
              className="lyra-mcp-center-list-picker"
              ariaLabel={labels.fieldTransport}
              listAriaLabel={labels.fieldTransport}
              value={draft.transport}
              shape="rounded"
              options={[
                { value: "stdio", label: labels.transportStdio },
                { value: "sse", label: labels.transportSse },
                { value: "http", label: labels.transportHttp }
              ]}
              onChange={(nextTransport) => {
                onFieldChange("transport", nextTransport);
              }}
            />
          </label>
          <label>
            <span>{labels.fieldInstallKind}</span>
            <LyraListPicker
              className="lyra-mcp-center-list-picker"
              ariaLabel={labels.fieldInstallKind}
              listAriaLabel={labels.fieldInstallKind}
              value={draft.installKind}
              shape="rounded"
              options={[
                { value: "npm", label: labels.installKindNpm },
                { value: "uv", label: labels.installKindUv },
                { value: "docker", label: labels.installKindDocker },
                { value: "binary", label: labels.installKindBinary },
                { value: "manual", label: labels.installKindManual }
              ]}
              onChange={(nextInstallKind) => {
                onFieldChange("installKind", nextInstallKind);
              }}
            />
          </label>
          {draft.transport === "stdio" ? (
            <>
              <label>
                <span>{labels.fieldCommand}</span>
                <input
                  className="lyra-mcp-center-input"
                  value={draft.command}
                  onChange={(event) => {
                    onFieldChange("command", event.target.value);
                  }}
                />
              </label>
              <label>
                <span>{labels.fieldCwd}</span>
                <input
                  className="lyra-mcp-center-input"
                  value={draft.cwd}
                  onChange={(event) => {
                    onFieldChange("cwd", event.target.value);
                  }}
                />
              </label>
              <label className="lyra-mcp-center-form-grid-span-2">
                <span>{labels.fieldArguments}</span>
                <textarea
                  className="lyra-mcp-center-textarea"
                  value={draft.argsText}
                  onChange={(event) => {
                    onFieldChange("argsText", event.target.value);
                  }}
                />
              </label>
            </>
          ) : (
            <label className="lyra-mcp-center-form-grid-span-2">
              <span>{labels.fieldUrl}</span>
              <input
                className="lyra-mcp-center-input"
                value={draft.url}
                onChange={(event) => {
                  onFieldChange("url", event.target.value);
                }}
              />
            </label>
          )}
          <label className="lyra-mcp-center-checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onFieldChange("enabled", event.target.checked);
              }}
            />
            <span>{labels.enabled}</span>
          </label>
          <label className="lyra-mcp-center-checkbox">
            <input
              type="checkbox"
              checked={draft.autoStart}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onFieldChange("autoStart", event.target.checked);
              }}
            />
            <span>{labels.autoStart}</span>
          </label>
          <label className="lyra-mcp-center-form-grid-span-2">
            <span>{labels.fieldPermissions}</span>
            <textarea
              className="lyra-mcp-center-textarea"
              value={draft.permissionsText}
              onChange={(event) => {
                onFieldChange("permissionsText", event.target.value);
              }}
            />
          </label>
        </section>

        <section className="lyra-mcp-center-form-section">
          <header className="lyra-mcp-center-section-header">
            <h4>{labels.fieldEnvironment}</h4>
            <button
              type="button"
              className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
              onClick={onAddEnvironment}
            >
              {labels.actionAddEnvironment}
            </button>
          </header>
          <div className="lyra-mcp-center-env-list">
            {draft.environment.length === 0 ? (
              <p className="lyra-mcp-center-muted">{labels.noEnvironment}</p>
            ) : (
              draft.environment.map((entry) => (
                <DraftEnvironmentRow
                  key={entry.id}
                  entry={entry}
                  labels={labels}
                  onChange={onUpdateEnvironment}
                  onRemove={onRemoveEnvironment}
                />
              ))
            )}
          </div>
        </section>
      </>
    )}
  </section>
);

export const PresetForm = ({
  item,
  draft,
  labels,
  onFieldChange,
  onSave,
  onCancel
}: {
  readonly item: McpCatalogItem;
  readonly draft: McpCenterPresetDraft;
  readonly labels: McpCenterLabels;
  readonly onFieldChange: (fieldId: string, value: string) => void;
  readonly onSave: () => Promise<void>;
  readonly onCancel: () => void;
}) => (
  <section className="lyra-mcp-center-panel-shell">
    <header className="lyra-mcp-center-panel-header">
      <div>
        <h3>{labels.presetTitle}</h3>
        <p>{labels.presetDescription}</p>
      </div>
      <div className="lyra-mcp-center-actions">
        <button
          type="button"
          className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
          onClick={onCancel}
        >
          {labels.actionCancel}
        </button>
        <button
          type="button"
          className="lyra-mcp-center-button"
          onClick={() => {
            void onSave();
          }}
        >
          {labels.actionInstall}
        </button>
      </div>
    </header>

    <section className="lyra-mcp-center-form-section lyra-mcp-center-form-grid">
      <label className="lyra-mcp-center-form-grid-span-2">
        <span>{labels.fieldTitle}</span>
        <input
          className="lyra-mcp-center-input"
          value={draft.title}
          onChange={(event) => {
            onFieldChange("title", event.target.value);
          }}
        />
      </label>

      {item.quickSetup?.fields.map((field) => {
        const display = resolvePresetFieldDisplay(item.id, field.id, labels);
        return (
          <label
            key={`${item.id}-${field.id}`}
            className="lyra-mcp-center-form-grid-span-2"
          >
            <span>{display.label}</span>
            <input
              className="lyra-mcp-center-input"
              value={draft.values[field.id] ?? ""}
              required={field.required}
              placeholder={display.placeholder}
              onChange={(event) => {
                onFieldChange(field.id, event.target.value);
              }}
            />
            {display.description === undefined ? null : (
              <small className="lyra-mcp-center-form-note">{display.description}</small>
            )}
          </label>
        );
      })}

      <label className="lyra-mcp-center-checkbox">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onFieldChange("enabled", String(event.target.checked));
          }}
        />
        <span>{labels.enabled}</span>
      </label>
      <label className="lyra-mcp-center-checkbox">
        <input
          type="checkbox"
          checked={draft.autoStart}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onFieldChange("autoStart", String(event.target.checked));
          }}
        />
        <span>{labels.autoStart}</span>
      </label>
    </section>
  </section>
);
