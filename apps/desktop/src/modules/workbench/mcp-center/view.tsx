import { AlertTriangle, Package, RefreshCw, Wrench } from "lucide-react";

import { selectVisibleMcpServers } from "./selectors";
import type { McpCenterLabels, McpCenterModel } from "./types";
import {
  CatalogPanel,
  CustomForm,
  DetailsPanel,
  renderCatalogIcon,
  renderRuntimeLabel
} from "./view-panels";

export type McpCenterSurfaceProps = {
  readonly model: McpCenterModel;
  readonly labels: McpCenterLabels;
};

export const McpCenterSurface = ({ model, labels }: McpCenterSurfaceProps) => {
  const { state } = model;
  const visibleServers = selectVisibleMcpServers(state);
  const selectedServer =
    state.effectiveConfig.servers.find((server) => server.id === state.selectedServerId) ?? null;
  const projectScopeAvailable = state.effectiveConfig.resolvedProjectRoot !== undefined;

  return (
    <section className="lyra-mcp-center-surface" aria-label="ai-mcp-surface">
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar">
        <section className="lyra-mcp-center-main">
          <header className="lyra-mcp-center-toolbar">
            <div className="lyra-mcp-center-toolbar-filters">
              <div className="lyra-mcp-center-scope-tabs">
                <button
                  type="button"
                  className={
                    state.preferredScope === "global"
                      ? "lyra-mcp-center-tab lyra-mcp-center-tab-active"
                      : "lyra-mcp-center-tab"
                  }
                  onClick={() => { model.setPreferredScope("global"); }}
                >
                  {labels.scopeGlobal}
                </button>
                <button
                  type="button"
                  className={
                    state.preferredScope === "project"
                      ? "lyra-mcp-center-tab lyra-mcp-center-tab-active"
                      : "lyra-mcp-center-tab"
                  }
                  disabled={projectScopeAvailable === false}
                  onClick={() => { model.setPreferredScope("project"); }}
                >
                  {projectScopeAvailable ? labels.scopeProject : labels.scopeProjectUnavailable}
                </button>
              </div>
              <div className="lyra-mcp-center-status-pills">
                {(
                  [
                    ["all", labels.statusAll],
                    ["running", labels.statusRunning],
                    ["stopped", labels.statusStopped],
                    ["error", labels.statusError]
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      state.statusFilter === value
                        ? "lyra-mcp-center-pill lyra-mcp-center-pill-active"
                        : "lyra-mcp-center-pill"
                    }
                    onClick={() => { model.setStatusFilter(value); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lyra-mcp-center-actions">
              <button
                type="button"
                className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                onClick={() => { void model.load(); }}
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                onClick={model.openCatalog}
              >
                <Package size={14} />
                <span>{labels.actionInstall}</span>
              </button>
              <button
                type="button"
                className="lyra-mcp-center-button"
                onClick={model.openCustom}
              >
                <Wrench size={14} />
                <span>{labels.actionOpenCustom}</span>
              </button>
            </div>
          </header>

          {state.errorMessage === null ? null : (
            <div className="lyra-mcp-center-banner">
              <AlertTriangle size={14} />
              <span>{state.errorMessage}</span>
            </div>
          )}

          <div className="lyra-mcp-center-body">
            <section className="lyra-mcp-center-list-panel">
              {visibleServers.length === 0 ? (
                <div className="lyra-mcp-center-empty-state">{labels.emptyInstalled}</div>
              ) : (
                <div className="lyra-mcp-center-server-list">
                  {visibleServers.map((server) => {
                    const runtimeStatus =
                      state.runtimeByServerId[server.id] ?? server.runtimeStatus;
                    return (
                      <button
                        key={server.id}
                        type="button"
                        className={
                          state.selectedServerId === server.id
                            ? "lyra-mcp-center-server-row lyra-mcp-center-server-row-active"
                            : "lyra-mcp-center-server-row"
                        }
                        onClick={() => { model.selectServer(server.id); }}
                      >
                        <span className="lyra-mcp-center-server-icon">
                          {renderCatalogIcon(server.iconKey)}
                        </span>
                        <span className="lyra-mcp-center-server-copy">
                          <strong>{server.title}</strong>
                          <small>{server.summary}</small>
                        </span>
                        <span className="lyra-mcp-center-server-meta">
                          <i
                            className={`lyra-mcp-center-runtime-dot lyra-mcp-center-runtime-dot-${runtimeStatus.phase}`}
                          />
                          <small>{renderRuntimeLabel(runtimeStatus.phase, labels)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="lyra-mcp-center-detail-panel">
              {state.panelMode === "catalog" ? (
                <CatalogPanel
                  catalog={state.catalog}
                  selectedCatalogId={state.selectedCatalogId}
                  presetDraft={state.presetDraft}
                  labels={labels}
                  onSelect={model.selectCatalogItem}
                  onOpenPreset={model.openPreset}
                  onUpdatePresetField={model.updatePresetField}
                  onSavePreset={model.savePresetInstall}
                  onCancelPreset={model.closePanelMode}
                  onInstall={model.installTemplate}
                />
              ) : null}

              {(state.panelMode === "custom" || state.panelMode === "edit") &&
              state.draft !== null ? (
                <CustomForm
                  draft={state.draft}
                  labels={labels}
                  projectScopeAvailable={projectScopeAvailable}
                  errorMessage={state.errorMessage}
                  onFieldChange={model.updateDraftField}
                  onAddEnvironment={model.addDraftEnvironment}
                  onUpdateEnvironment={model.updateDraftEnvironment}
                  onRemoveEnvironment={model.removeDraftEnvironment}
                  onToggleAdvanced={model.toggleDraftAdvanced}
                  onSave={model.saveDraft}
                  onCancel={model.closePanelMode}
                />
              ) : null}

              {state.panelMode === "details" ? (
                <DetailsPanel
                  server={selectedServer}
                  runtimeStatus={
                    selectedServer === null
                      ? null
                      : state.runtimeByServerId[selectedServer.id] ?? selectedServer.runtimeStatus
                  }
                  labels={labels}
                  validation={
                    selectedServer === null
                      ? undefined
                      : state.validationByServerId[selectedServer.id]
                  }
                  introspection={
                    selectedServer === null
                      ? undefined
                      : state.introspectionByServerId[selectedServer.id]
                  }
                  onEdit={model.openEdit}
                  onValidate={model.validateServer}
                  onReadIntrospection={model.readServerIntrospection}
                  onStart={model.startServer}
                  onStop={model.stopServer}
                  onRestart={model.restartServer}
                  onDelete={model.deleteServer}
                />
              ) : null}
            </section>
          </div>
        </section>
      </div>
    </section>
  );
};
