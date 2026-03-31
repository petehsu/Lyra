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

type McpCenterSurfaceProps = {
  readonly model: McpCenterModel;
  readonly labels: McpCenterLabels;
};

export const McpCenterSurface = ({ model, labels }: McpCenterSurfaceProps) => {
  const { state } = model;
  const visibleServers = selectVisibleMcpServers(state);
  const selectedServer =
    state.effectiveConfig.servers.find((server) => server.id === state.selectedServerId) ?? null;
  const projectScopeAvailable = state.effectiveConfig.resolvedProjectRoot !== undefined;
  const officialCount = state.catalog.filter((item) => item.official).length;
  const customCount = state.effectiveConfig.servers.filter((server) => server.source === "custom").length;

  return (
    <section className="lyra-mcp-center-surface" aria-label="ai-mcp-surface">
      <div className="lyra-mcp-center-shell">
        <aside className="lyra-mcp-center-sidebar">
          <header className="lyra-mcp-center-sidebar-header">
            <h2>{labels.title}</h2>
            <p>{labels.sidebarDescription}</p>
          </header>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarScope}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              <button
                type="button"
                className={
                  state.preferredScope === "global"
                    ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                    : "lyra-mcp-center-side-button"
                }
                onClick={() => {
                  model.setPreferredScope("global");
                }}
              >
                <strong>{labels.scopeGlobal}</strong>
                <small>{labels.sidebarGlobalCount}: {state.globalServers.length}</small>
              </button>
              <button
                type="button"
                className={
                  state.preferredScope === "project"
                    ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                    : "lyra-mcp-center-side-button"
                }
                disabled={projectScopeAvailable === false}
                onClick={() => {
                  model.setPreferredScope("project");
                }}
              >
                <strong>{projectScopeAvailable ? labels.scopeProject : labels.scopeProjectUnavailable}</strong>
                <small>{labels.sidebarProjectCount}: {state.projectServers.length}</small>
              </button>
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarStatus}</span>
            <div className="lyra-mcp-center-sidebar-stack">
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
                      ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                      : "lyra-mcp-center-side-button"
                  }
                  onClick={() => {
                    model.setStatusFilter(value);
                  }}
                >
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarSources}</span>
            <div className="lyra-mcp-center-sidebar-meta">
              <div>
                <strong>{labels.sidebarOfficialCatalog}</strong>
                <small>{officialCount}</small>
              </div>
              <div>
                <strong>{labels.sidebarCustomServers}</strong>
                <small>{customCount}</small>
              </div>
              <div>
                <strong>{labels.sidebarProjectRoot}</strong>
                <small>
                  {state.effectiveConfig.resolvedProjectRoot ?? labels.scopeProjectUnavailable}
                </small>
              </div>
            </div>
          </section>
        </aside>

        <section className="lyra-mcp-center-main">
          <header className="lyra-mcp-center-toolbar">
            <div className="lyra-mcp-center-toolbar-copy">
              <strong>{labels.toolbarInstalled}</strong>
              <small>{labels.toolbarInstalledDescription}</small>
            </div>

            <div className="lyra-mcp-center-actions">
              <button
                type="button"
                className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                onClick={() => {
                  void model.load();
                }}
              >
                <RefreshCw size={14} />
                <span>{labels.actionRefresh}</span>
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
              <header className="lyra-mcp-center-list-header">
                <h3>{labels.installed}</h3>
                <span>{visibleServers.length}</span>
              </header>

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
                        onClick={() => {
                          model.selectServer(server.id);
                        }}
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
