import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type {
  McpCatalogItem,
  McpEffectiveServerConfig,
  McpIntrospectionSnapshot,
  McpRuntimeStatus,
  McpValidationResult
} from "../../../shared/mcp";
import type { McpCenterLabels, McpCenterPresetDraft } from "./types";
import { PresetForm } from "./view-panels-forms";
import {
  CapabilityList,
  Field,
  describeEnvironmentEntry,
  renderCatalogIcon,
  renderInstallKindLabel,
  renderRuntimeLabel,
  renderTransportLabel
} from "./view-panels-renderers";

export const CatalogPanel = ({
  catalog,
  selectedCatalogId,
  presetDraft,
  labels,
  onSelect,
  onOpenPreset,
  onUpdatePresetField,
  onSavePreset,
  onCancelPreset,
  onInstall
}: {
  readonly catalog: readonly McpCatalogItem[];
  readonly selectedCatalogId: string | null;
  readonly presetDraft: McpCenterPresetDraft | null;
  readonly labels: McpCenterLabels;
  readonly onSelect: (catalogId: string) => void;
  readonly onOpenPreset: (catalogId: string) => void;
  readonly onUpdatePresetField: (fieldId: string, value: string) => void;
  readonly onSavePreset: () => Promise<void>;
  readonly onCancelPreset: () => void;
  readonly onInstall: (templateId: string) => Promise<void>;
}) => {
  const selectedItem =
    catalog.find((item) => item.id === selectedCatalogId) ?? catalog[0] ?? null;

  return (
    <section className="lyra-mcp-center-panel-shell">
      <header className="lyra-mcp-center-panel-header">
        <div>
          <h3>{labels.catalog}</h3>
          <p>{labels.catalogDescription}</p>
        </div>
      </header>

      {catalog.length === 0 ? (
        <div className="lyra-mcp-center-empty-state">{labels.emptyCatalog}</div>
      ) : (
        <div className="lyra-mcp-center-catalog-layout">
          <div className="lyra-mcp-center-catalog-list">
            {catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === selectedItem?.id
                    ? "lyra-mcp-center-catalog-item lyra-mcp-center-catalog-item-active"
                    : "lyra-mcp-center-catalog-item"
                }
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                <span className="lyra-mcp-center-server-icon">
                  {renderCatalogIcon(item.iconKey)}
                </span>
                <span className="lyra-mcp-center-catalog-copy">
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                </span>
              </button>
            ))}
          </div>

          {selectedItem === null ? null : presetDraft !== null &&
            presetDraft.templateId === selectedItem.id ? (
            <PresetForm
              item={selectedItem}
              draft={presetDraft}
              labels={labels}
              onFieldChange={onUpdatePresetField}
              onSave={onSavePreset}
              onCancel={onCancelPreset}
            />
          ) : (
            <div className="lyra-mcp-center-catalog-detail">
              <header className="lyra-mcp-center-detail-header">
                <div className="lyra-mcp-center-detail-title">
                  <span className="lyra-mcp-center-server-icon lyra-mcp-center-server-icon-large">
                    {renderCatalogIcon(selectedItem.iconKey)}
                  </span>
                  <div>
                    <h3>{selectedItem.title}</h3>
                    <p>{selectedItem.description ?? selectedItem.summary}</p>
                  </div>
                </div>
                {selectedItem.quickSetup === undefined ? (
                  <button
                    type="button"
                    className="lyra-mcp-center-button"
                    onClick={() => {
                      void onInstall(selectedItem.id);
                    }}
                  >
                    {labels.actionInstall}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="lyra-mcp-center-button"
                    onClick={() => {
                      onOpenPreset(selectedItem.id);
                    }}
                  >
                    {labels.actionQuickSetup}
                  </button>
                )}
              </header>

              <div className="lyra-mcp-center-detail-grid">
                <Field
                  label={labels.fieldTransport}
                  value={selectedItem.transports
                    .map((transport) => renderTransportLabel(transport, labels))
                    .join(" / ")}
                />
                <Field
                  label={labels.fieldInstallKind}
                  value={renderInstallKindLabel(selectedItem.installKind, labels)}
                />
                <Field
                  label={labels.recommendedScope}
                  value={
                    selectedItem.recommendedScope === "project"
                      ? labels.scopeProject
                      : labels.scopeGlobal
                  }
                />
                <Field
                  label={labels.fieldSource}
                  value={selectedItem.official ? labels.sourceOfficial : labels.sourceCustom}
                />
              </div>

              <section className="lyra-mcp-center-detail-section">
                <header className="lyra-mcp-center-section-header">
                  <h4>{labels.fieldPermissions}</h4>
                </header>
                {selectedItem.permissions.length === 0 ? (
                  <p className="lyra-mcp-center-muted">{labels.noPermissions}</p>
                ) : (
                  <div className="lyra-mcp-center-tag-row">
                    {selectedItem.permissions.map((permission) => (
                      <span key={permission} className="lyra-mcp-center-tag">
                        {permission}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="lyra-mcp-center-detail-section">
                <header className="lyra-mcp-center-section-header">
                  <h4>{labels.fieldCapabilities}</h4>
                </header>
                <div className="lyra-mcp-center-capability-grid">
                  <CapabilityList
                    title={labels.fieldTools}
                    items={selectedItem.tools}
                    emptyLabel={labels.noIntrospection}
                  />
                  <CapabilityList
                    title={labels.fieldResources}
                    items={selectedItem.resources}
                    emptyLabel={labels.noIntrospection}
                  />
                  <CapabilityList
                    title={labels.fieldPrompts}
                    items={selectedItem.prompts}
                    emptyLabel={labels.noIntrospection}
                  />
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export const DetailsPanel = ({
  server,
  runtimeStatus,
  labels,
  validation,
  introspection,
  onEdit,
  onValidate,
  onReadIntrospection,
  onStart,
  onStop,
  onRestart,
  onDelete
}: {
  readonly server: McpEffectiveServerConfig | null;
  readonly runtimeStatus: McpRuntimeStatus | null;
  readonly labels: McpCenterLabels;
  readonly validation: McpValidationResult | undefined;
  readonly introspection: McpIntrospectionSnapshot | undefined;
  readonly onEdit: (serverId: string) => void;
  readonly onValidate: (serverId: string) => Promise<void>;
  readonly onReadIntrospection: (serverId: string) => Promise<void>;
  readonly onStart: (serverId: string) => Promise<void>;
  readonly onStop: (serverId: string) => Promise<void>;
  readonly onRestart: (serverId: string) => Promise<void>;
  readonly onDelete: (serverId: string) => Promise<void>;
}) => {
  if (server === null) {
    return <div className="lyra-mcp-center-empty-state">{labels.emptySelection}</div>;
  }

  const resolvedRuntimeStatus = runtimeStatus ?? server.runtimeStatus;
  const canStart =
    resolvedRuntimeStatus.phase === "stopped" || resolvedRuntimeStatus.phase === "error";
  const canStop =
    resolvedRuntimeStatus.phase === "running" || resolvedRuntimeStatus.phase === "starting";

  return (
    <section className="lyra-mcp-center-panel-shell">
      <header className="lyra-mcp-center-detail-header">
        <div className="lyra-mcp-center-detail-title">
          <span className="lyra-mcp-center-server-icon lyra-mcp-center-server-icon-large">
            {renderCatalogIcon(server.iconKey)}
          </span>
          <div>
            <h3>{server.title}</h3>
            <p>{server.description ?? server.summary}</p>
          </div>
        </div>

        <div className="lyra-mcp-center-actions">
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={() => {
              onEdit(server.id);
            }}
          >
            {labels.actionEdit}
          </button>
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={() => {
              void onValidate(server.id);
            }}
          >
            {labels.actionValidate}
          </button>
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={() => {
              void onReadIntrospection(server.id);
            }}
          >
            {labels.actionReadCapabilities}
          </button>
          {canStart ? (
            <button
              type="button"
              className="lyra-mcp-center-button"
              onClick={() => {
                void onStart(server.id);
              }}
            >
              {labels.actionStart}
            </button>
          ) : null}
          {canStop ? (
            <button
              type="button"
              className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
              onClick={() => {
                void onStop(server.id);
              }}
            >
              {labels.actionStop}
            </button>
          ) : null}
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={() => {
              void onRestart(server.id);
            }}
          >
            {labels.actionRestart}
          </button>
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-danger"
            onClick={() => {
              void onDelete(server.id);
            }}
          >
            {labels.actionDelete}
          </button>
        </div>
      </header>

      <div className="lyra-mcp-center-detail-grid">
        <Field
          label={labels.fieldTransport}
          value={renderTransportLabel(server.transport, labels)}
        />
        <Field
          label={labels.fieldInstallKind}
          value={renderInstallKindLabel(server.installKind, labels)}
        />
        <Field
          label={labels.fieldRuntime}
          value={renderRuntimeLabel(resolvedRuntimeStatus.phase, labels)}
        />
        <Field
          label={labels.fieldSource}
          value={server.source === "catalog" ? labels.sourceOfficial : labels.sourceCustom}
        />
      </div>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldOverride}</h4>
        </header>
        <div className="lyra-mcp-center-tag-row">
          <span className="lyra-mcp-center-tag">
            {server.effectiveScope === "project" ? labels.scopeProject : labels.scopeGlobal}
          </span>
          {server.inheritedFromGlobal ? (
            <span className="lyra-mcp-center-tag">{labels.inheritedFromGlobal}</span>
          ) : (
            <span className="lyra-mcp-center-tag">{labels.projectOverrideInactive}</span>
          )}
          {server.overriddenFields.map((field) => (
            <span key={field} className="lyra-mcp-center-tag">
              {field}
            </span>
          ))}
        </div>
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldEnvironment}</h4>
        </header>
        {server.environment.length === 0 ? (
          <p className="lyra-mcp-center-muted">{labels.noEnvironment}</p>
        ) : (
          <div className="lyra-mcp-center-kv-list">
            {server.environment.map((entry) => (
              <div key={server.id + "-" + entry.key} className="lyra-mcp-center-kv-item">
                <span>{entry.key}</span>
                <strong>{describeEnvironmentEntry(entry, labels)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {server.command === undefined && server.url === undefined ? null : (
        <section className="lyra-mcp-center-detail-section">
          <header className="lyra-mcp-center-section-header">
            <h4>{labels.fieldConnection}</h4>
          </header>
          <div className="lyra-mcp-center-kv-list">
            {server.command === undefined ? null : (
              <div className="lyra-mcp-center-kv-item">
                <span>{labels.fieldCommand}</span>
                <strong>{server.command}</strong>
              </div>
            )}
            {server.args.length === 0 ? null : (
              <div className="lyra-mcp-center-kv-item">
                <span>{labels.fieldArguments}</span>
                <strong>{server.args.join(" ")}</strong>
              </div>
            )}
            {server.cwd === undefined ? null : (
              <div className="lyra-mcp-center-kv-item">
                <span>{labels.fieldCwd}</span>
                <strong>{server.cwd}</strong>
              </div>
            )}
            {server.url === undefined ? null : (
              <div className="lyra-mcp-center-kv-item">
                <span>{labels.fieldUrl}</span>
                <strong>{server.url}</strong>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldPermissions}</h4>
        </header>
        {server.permissions.length === 0 ? (
          <p className="lyra-mcp-center-muted">{labels.noPermissions}</p>
        ) : (
          <div className="lyra-mcp-center-tag-row">
            {server.permissions.map((permission) => (
              <span key={permission} className="lyra-mcp-center-tag">
                {permission}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldValidation}</h4>
        </header>
        {validation === undefined ? (
          <p className="lyra-mcp-center-muted">{labels.validationIdle}</p>
        ) : (
          <div
            className={
              validation.ok
                ? "lyra-mcp-center-alert lyra-mcp-center-alert-success"
                : "lyra-mcp-center-alert lyra-mcp-center-alert-error"
            }
          >
            {validation.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <div>
              <strong>{validation.ok ? labels.validationOk : labels.validationFailed}</strong>
              <p>{validation.summary}</p>
              {validation.diagnostics.length === 0 ? null : (
                <ul className="lyra-mcp-center-diagnostics">
                  {validation.diagnostics.map((diagnostic) => (
                    <li key={diagnostic}>{diagnostic}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldCapabilities}</h4>
        </header>
        <div className="lyra-mcp-center-capability-grid">
          <CapabilityList
            title={labels.fieldTools}
            items={introspection?.tools ?? []}
            emptyLabel={labels.noIntrospection}
          />
          <CapabilityList
            title={labels.fieldResources}
            items={introspection?.resources ?? []}
            emptyLabel={labels.noIntrospection}
          />
          <CapabilityList
            title={labels.fieldPrompts}
            items={introspection?.prompts ?? []}
            emptyLabel={labels.noIntrospection}
          />
        </div>
      </section>

      {resolvedRuntimeStatus.message === undefined && server.lastError === undefined ? null : (
        <section className="lyra-mcp-center-detail-section">
          <header className="lyra-mcp-center-section-header">
            <h4>{labels.fieldLastError}</h4>
          </header>
          <div className="lyra-mcp-center-alert lyra-mcp-center-alert-inline">
            <AlertTriangle size={14} />
            <span>{server.lastError ?? resolvedRuntimeStatus.message}</span>
          </div>
        </section>
      )}
    </section>
  );
};
