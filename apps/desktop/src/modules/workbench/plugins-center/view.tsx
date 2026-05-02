import { AlertTriangle, Boxes, Check, Download, PackageCheck, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";

import { findPluginEntry, selectVisiblePlugins } from "./selectors";
import type {
  PluginAuthPolicy,
  PluginCenterEntry,
  PluginInstallPolicy,
  PluginSource,
  PluginsCenterLabels,
  PluginsCenterModel
} from "./types";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type PluginsCenterSurfaceProps = {
  readonly model: PluginsCenterModel;
  readonly labels: PluginsCenterLabels;
};

const renderSourceLabel = (source: PluginSource, labels: PluginsCenterLabels): string => {
  if (source.type === "local") {
    return `${labels.sourceLocal} · ${source.path}`;
  }
  if (source.type === "git") {
    return `${labels.sourceGit} · ${source.url}`;
  }
  return labels.sourceRemote;
};

const renderInstallPolicy = (
  policy: PluginInstallPolicy,
  labels: PluginsCenterLabels
): string => {
  if (policy === "AVAILABLE") {
    return labels.installAvailable;
  }
  if (policy === "INSTALLED_BY_DEFAULT") {
    return labels.installDefault;
  }
  return labels.installNotAvailable;
};

const renderAuthPolicy = (policy: PluginAuthPolicy, labels: PluginsCenterLabels): string =>
  policy === "ON_INSTALL" ? labels.authOnInstall : labels.authOnUse;

const pluginTitle = (entry: PluginCenterEntry): string =>
  entry.plugin.interface?.displayName?.trim()
  || entry.plugin.name
  || entry.plugin.id;

const pluginSummary = (entry: PluginCenterEntry, labels: PluginsCenterLabels): string =>
  entry.plugin.interface?.shortDescription?.trim()
  || entry.plugin.interface?.longDescription?.trim()
  || `${entry.marketplaceDisplayName} · ${entry.plugin.installed ? labels.installed : labels.available}`;

export const PluginsCenterSurface = ({ model, labels }: PluginsCenterSurfaceProps) => {
  const { state } = model;
  const visiblePlugins = useMemo(() => selectVisiblePlugins(state), [state]);
  const selectedEntry =
    state.selectedPluginKey === null ? null : findPluginEntry(state, state.selectedPluginKey);
  const selectedDetail =
    state.selectedPluginKey === null ? undefined : state.detailsByKey[state.selectedPluginKey];
  const selectedPluginKey = state.selectedPluginKey;

  useEffect(() => {
    if (
      selectedPluginKey === null ||
      selectedEntry === null ||
      selectedDetail !== undefined ||
      state.busyPluginKey === selectedPluginKey
    ) {
      return;
    }
    void model.readPlugin(selectedPluginKey);
  }, [model, selectedDetail, selectedEntry, selectedPluginKey, state.busyPluginKey]);

  const busy = selectedPluginKey !== null && state.busyPluginKey === selectedPluginKey;
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <>
          <div className="lyra-titlebar-context-controls">
            {([
              ["all", labels.statusAll],
              ["installed", labels.statusInstalled],
              ["enabled", labels.statusEnabled],
              ["disabled", labels.statusDisabled],
              ["available", labels.statusAvailable],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  state.statusFilter === value
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                onClick={() => {
                  model.setStatusFilter(value);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={() => {
                void model.load();
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{labels.actionRefresh}</span>
            </button>
          </div>
        </>
      )
    }),
    [labels, model, state.statusFilter]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <section className="lyra-plugins-center-surface lyra-mcp-center-surface" aria-label="ai-plugins-surface">
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar lyra-plugins-center-shell">
        <section className="lyra-mcp-center-main lyra-plugins-center-main">
          {state.errorMessage === null ? null : (
            <div className="lyra-mcp-center-banner">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{state.errorMessage}</span>
            </div>
          )}
          {state.loadErrors.length === 0 ? null : (
            <div className="lyra-mcp-center-banner">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>
                {labels.loadErrors}:{" "}
                {state.loadErrors.map((entry) => `${entry.marketplacePath}: ${entry.message}`).join("; ")}
              </span>
            </div>
          )}

          <div className="lyra-mcp-center-body">
            <section className="lyra-mcp-center-list-panel lyra-plugins-center-list-panel">
              {visiblePlugins.length === 0 ? (
                <div className="lyra-mcp-center-empty-state">{labels.empty}</div>
              ) : (
                <div className="lyra-mcp-center-server-list">
                  {visiblePlugins.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={
                        state.selectedPluginKey === entry.key
                          ? "lyra-mcp-center-server-row lyra-mcp-center-server-row-active"
                          : "lyra-mcp-center-server-row"
                      }
                      onClick={() => {
                        model.selectPlugin(entry.key);
                      }}
                    >
                      <span className="lyra-mcp-center-server-icon">
                        <Boxes size={15} aria-hidden="true" />
                      </span>
                      <span className="lyra-mcp-center-server-copy">
                        <strong>{pluginTitle(entry)}</strong>
                        <small>{pluginSummary(entry, labels)}</small>
                      </span>
                      <span className="lyra-mcp-center-server-meta">
                        <small>
                          {entry.plugin.installed
                            ? entry.plugin.enabled ? labels.enabled : labels.disabled
                            : labels.available}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="lyra-mcp-center-detail-panel lyra-plugins-center-detail-panel">
              {selectedEntry === null ? (
                <div className="lyra-mcp-center-empty-state">{labels.emptySelection}</div>
              ) : (
                <div className="lyra-plugins-center-detail">
                  <header className="lyra-plugins-center-detail__header">
                    <span>
                      <strong>{pluginTitle(selectedEntry)}</strong>
                      <small>{selectedEntry.plugin.id}</small>
                    </span>
                    <div className="lyra-plugins-center-detail__actions">
                      {selectedEntry.plugin.installed ? (
                        <>
                          <button
                            type="button"
                            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                            disabled={busy}
                            onClick={() => {
                              void model.setPluginEnabled(selectedEntry.key, !selectedEntry.plugin.enabled);
                            }}
                          >
                            <Check size={14} aria-hidden="true" />
                            <span>
                              {selectedEntry.plugin.enabled
                                ? labels.actionDisable
                                : labels.actionEnable}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                            disabled={busy}
                            onClick={() => {
                              void model.uninstallPlugin(selectedEntry.key);
                            }}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            <span>{labels.actionUninstall}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="lyra-mcp-center-button"
                          disabled={busy || selectedEntry.plugin.installPolicy !== "AVAILABLE"}
                          onClick={() => {
                            void model.installPlugin(selectedEntry.key);
                          }}
                        >
                          <Download size={14} aria-hidden="true" />
                          <span>{labels.actionInstall}</span>
                        </button>
                      )}
                    </div>
                  </header>

                  <div className="lyra-plugins-center-detail__badges">
                    <span>{selectedEntry.marketplaceDisplayName}</span>
                    <span>{selectedEntry.plugin.installed ? labels.installed : labels.available}</span>
                    <span>{selectedEntry.plugin.enabled ? labels.enabled : labels.disabled}</span>
                  </div>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldDescription}</h3>
                    <p>
                      {selectedDetail?.description
                        ?? selectedEntry.plugin.interface?.longDescription
                        ?? selectedEntry.plugin.interface?.shortDescription
                        ?? labels.noDescription}
                    </p>
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldPolicies}</h3>
                    <div className="lyra-plugins-center-detail__chips">
                      <span>{renderInstallPolicy(selectedEntry.plugin.installPolicy, labels)}</span>
                      <span>{renderAuthPolicy(selectedEntry.plugin.authPolicy, labels)}</span>
                    </div>
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldSource}</h3>
                    <p>{renderSourceLabel(selectedEntry.plugin.source, labels)}</p>
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldCapabilities}</h3>
                    {selectedEntry.plugin.interface?.capabilities.length ? (
                      <div className="lyra-plugins-center-detail__chips">
                        {selectedEntry.plugin.interface.capabilities.map((capability) => (
                          <span key={capability}>{capability}</span>
                        ))}
                      </div>
                    ) : (
                      <p>{labels.noCapabilities}</p>
                    )}
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldSkills}</h3>
                    {selectedDetail?.skills.length ? (
                      <div className="lyra-plugins-center-detail__stack">
                        {selectedDetail.skills.map((skill) => (
                          <span key={skill.path}>
                            <PackageCheck size={13} aria-hidden="true" />
                            <span>
                              <strong>{skill.name}</strong>
                              <small>{skill.shortDescription ?? skill.description}</small>
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>{labels.noSkills}</p>
                    )}
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldMcpServers}</h3>
                    {selectedDetail?.mcpServers.length ? (
                      <div className="lyra-plugins-center-detail__chips">
                        {selectedDetail.mcpServers.map((server) => (
                          <span key={server}>{server}</span>
                        ))}
                      </div>
                    ) : (
                      <p>{labels.noMcpServers}</p>
                    )}
                  </section>

                  <section className="lyra-plugins-center-detail__section">
                    <h3>{labels.fieldApps}</h3>
                    {selectedDetail?.apps.length ? (
                      <div className="lyra-plugins-center-detail__stack">
                        {selectedDetail.apps.map((app) => (
                          <span key={app.id}>
                            <Boxes size={13} aria-hidden="true" />
                            <span>
                              <strong>{app.name}</strong>
                              <small>
                                {app.description ?? app.id}
                                {app.needsAuth ? ` · ${labels.appNeedsAuth}` : ""}
                              </small>
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>{labels.noApps}</p>
                    )}
                  </section>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </section>
  );
};
