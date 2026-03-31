import { AlertTriangle, FilePlus2, Package, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";

import { selectVisibleSkills } from "./selectors";
import type { SkillsCenterLabels, SkillsCenterModel } from "./types";
import {
  CatalogPanel,
  CreatePanel,
  ImportPanel,
  SkillDetailPanel,
  renderEnableLabel,
  renderSkillIcon,
  renderSourceLabel,
  renderTypeLabel
} from "./view-panels";

type SkillsCenterSurfaceProps = {
  readonly model: SkillsCenterModel;
  readonly labels: SkillsCenterLabels;
};

export const SkillsCenterSurface = ({ model, labels }: SkillsCenterSurfaceProps) => {
  const { state } = model;
  const visibleSkills = useMemo(() => selectVisibleSkills(state), [state]);
  const allInstalledSkills = useMemo(
    () => [...state.globalSkills, ...state.projectSkills],
    [state.globalSkills, state.projectSkills]
  );
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...state.catalog.map((item) => item.category),
          ...allInstalledSkills.map((skill) => skill.manifest.category)
        ])
      ).sort((left, right) => left.localeCompare(right)),
    [allInstalledSkills, state.catalog]
  );
  const selectedSkill =
    allInstalledSkills.find((skill) => skill.skillId === state.selectedSkillId) ?? null;
  const selectedDetails =
    selectedSkill === null ? undefined : state.detailsBySkillId[selectedSkill.skillId];
  const selectedEffective =
    selectedSkill === null
      ? undefined
      : state.effectiveSkills.find((skill) => skill.skillId === selectedSkill.skillId);
  const featuredCatalog = state.catalog.filter((item) => item.featured);

  useEffect(() => {
    if (selectedSkill === null || selectedDetails !== undefined) {
      return;
    }
    void model.readSkillDetails(selectedSkill.skillId);
  }, [model, selectedDetails, selectedSkill]);

  return (
    <section className="lyra-skills-center-surface lyra-mcp-center-surface" aria-label="ai-skills-surface">
      <div className="lyra-mcp-center-shell lyra-skills-center-shell">
        <aside className="lyra-mcp-center-sidebar lyra-skills-center-sidebar">
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
                <small>{state.globalSkills.length}</small>
              </button>
              <button
                type="button"
                className={
                  state.preferredScope === "project"
                    ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                    : "lyra-mcp-center-side-button"
                }
                onClick={() => {
                  model.setPreferredScope("project");
                }}
                disabled={state.projectSkills.length === 0}
              >
                <strong>{labels.scopeProject}</strong>
                <small>
                  {state.projectSkills.length > 0
                    ? String(state.projectSkills.length)
                    : labels.scopeProjectUnavailable}
                </small>
              </button>
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarStatus}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              {([
                ["all", labels.statusAll],
                ["enabled", labels.statusEnabled],
                ["disabled", labels.statusDisabled],
                ["untrusted", labels.statusUntrusted]
              ] as const).map(([value, label]) => (
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
            <div className="lyra-mcp-center-sidebar-stack">
              {([
                ["all", labels.sourceAll],
                ["builtin", labels.sourceBuiltin],
                ["lyra", labels.sourceLyra],
                ["claude", labels.sourceClaude],
                ["continue", labels.sourceContinue]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    state.sourceFilter === value
                      ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                      : "lyra-mcp-center-side-button"
                  }
                  onClick={() => {
                    model.setSourceFilter(value);
                  }}
                >
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarCategories}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              <button
                type="button"
                className={
                  state.categoryFilter === "all"
                    ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                    : "lyra-mcp-center-side-button"
                }
                onClick={() => {
                  model.setCategoryFilter("all");
                }}
              >
                <strong>{labels.statusAll}</strong>
              </button>
              {categoryOptions.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={
                    state.categoryFilter === category
                      ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                      : "lyra-mcp-center-side-button"
                  }
                  onClick={() => {
                    model.setCategoryFilter(category);
                  }}
                >
                  <strong>{category}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarBuiltin}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              {featuredCatalog.length === 0 ? (
                <p className="lyra-mcp-center-muted">{labels.emptyCatalog}</p>
              ) : (
                featuredCatalog.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      state.panelMode === "catalog" && state.selectedCatalogId === item.id
                        ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                        : "lyra-mcp-center-side-button"
                    }
                    onClick={() => {
                      model.selectCatalogItem(item.id);
                    }}
                  >
                    <strong>{item.name}</strong>
                    <small>{renderTypeLabel(item.skillType, labels)}</small>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarInstalledGlobal}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              {state.globalSkills.length === 0 ? (
                <p className="lyra-mcp-center-muted">{labels.emptyInstalled}</p>
              ) : (
                state.globalSkills.map((skill) => (
                  <button
                    key={`global-${skill.skillId}`}
                    type="button"
                    className={
                      state.panelMode === "details" && state.selectedSkillId === skill.skillId
                        ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                        : "lyra-mcp-center-side-button"
                    }
                    onClick={() => {
                      model.selectSkill(skill.skillId);
                      void model.readSkillDetails(skill.skillId);
                    }}
                  >
                    <strong>{skill.manifest.name}</strong>
                    <small>{renderEnableLabel(skill.enableState, labels)}</small>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="lyra-mcp-center-sidebar-group">
            <span>{labels.sidebarInstalledProject}</span>
            <div className="lyra-mcp-center-sidebar-stack">
              {state.projectSkills.length === 0 ? (
                <p className="lyra-mcp-center-muted">{labels.scopeProjectUnavailable}</p>
              ) : (
                state.projectSkills.map((skill) => (
                  <button
                    key={`project-${skill.skillId}`}
                    type="button"
                    className={
                      state.panelMode === "details" && state.selectedSkillId === skill.skillId
                        ? "lyra-mcp-center-side-button lyra-mcp-center-side-button-active"
                        : "lyra-mcp-center-side-button"
                    }
                    onClick={() => {
                      model.selectSkill(skill.skillId);
                      void model.readSkillDetails(skill.skillId);
                    }}
                  >
                    <strong>{skill.manifest.name}</strong>
                    <small>{renderEnableLabel(skill.enableState, labels)}</small>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="lyra-mcp-center-main lyra-skills-center-main">
          <header className="lyra-mcp-center-toolbar lyra-skills-center-toolbar">
            <div className="lyra-mcp-center-toolbar-copy">
              <strong>{labels.toolbarInstalled}</strong>
              <small>{labels.toolbarInstalledDescription}</small>
            </div>
            <div className="lyra-mcp-center-actions">
              <button
                type="button"
                className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                onClick={model.openCatalog}
              >
                <Package size={14} />
                <span>{labels.actionOpenCatalog}</span>
              </button>
              <button
                type="button"
                className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
                onClick={model.openImport}
              >
                <Package size={14} />
                <span>{labels.actionOpenImport}</span>
              </button>
              <button type="button" className="lyra-mcp-center-button" onClick={model.openCreate}>
                <FilePlus2 size={14} />
                <span>{labels.actionOpenCreate}</span>
              </button>
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
            </div>
          </header>

          {state.errorMessage === null ? null : (
            <div className="lyra-mcp-center-banner">
              <AlertTriangle size={14} />
              <span>{state.errorMessage}</span>
            </div>
          )}

          <div className="lyra-mcp-center-body">
            <section className="lyra-mcp-center-list-panel lyra-skills-center-list-panel">
              <header className="lyra-mcp-center-list-header">
                <h3>{labels.details}</h3>
                <span>{visibleSkills.length}</span>
              </header>
              {visibleSkills.length === 0 ? (
                <div className="lyra-mcp-center-empty-state">{labels.emptyInstalled}</div>
              ) : (
                <div className="lyra-mcp-center-server-list">
                  {visibleSkills.map((skill) => (
                    <button
                      key={skill.skillId}
                      type="button"
                      className={
                        state.selectedSkillId === skill.skillId && state.panelMode === "details"
                          ? "lyra-mcp-center-server-row lyra-mcp-center-server-row-active"
                          : "lyra-mcp-center-server-row"
                      }
                      onClick={() => {
                        model.selectSkill(skill.skillId);
                        void model.readSkillDetails(skill.skillId);
                      }}
                    >
                      <span className="lyra-mcp-center-server-icon">
                        {renderSkillIcon(skill.manifest.iconKey)}
                      </span>
                      <span className="lyra-mcp-center-server-copy">
                        <strong>{skill.manifest.name}</strong>
                        <small>
                          {renderSourceLabel(skill.manifest.sourceKind, labels)} ·{" "}
                          {renderTypeLabel(skill.manifest.skillType, labels)}
                        </small>
                      </span>
                      <span className="lyra-mcp-center-server-meta">
                        <small>{renderEnableLabel(skill.enableState, labels)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="lyra-mcp-center-detail-panel lyra-skills-center-detail-panel">
              {state.panelMode === "catalog" ? (
                <CatalogPanel
                  state={state}
                  labels={labels}
                  onSelect={model.selectCatalogItem}
                  onInstall={model.installCatalogSkill}
                  onClose={model.closePanelMode}
                />
              ) : state.panelMode === "import" ? (
                <ImportPanel
                  state={state}
                  labels={labels}
                  onClose={model.closePanelMode}
                  onSetPath={model.setImportPath}
                  onDiscover={model.discoverImportSource}
                  onImport={model.importSelectedSkills}
                  onToggle={model.toggleImportPreviewSelection}
                />
              ) : state.panelMode === "create" ? (
                <CreatePanel
                  state={state}
                  labels={labels}
                  onClose={model.closePanelMode}
                  onFieldChange={model.updateCreateDraftField}
                  onCreate={model.createLyraSkill}
                />
              ) : (
                <SkillDetailPanel
                  skill={selectedSkill}
                  details={selectedDetails}
                  effectiveSkill={selectedEffective}
                  labels={labels}
                  onTrust={model.trustSkill}
                  onUntrust={model.untrustSkill}
                  onEnable={model.enableSkill}
                  onDisable={model.disableSkill}
                  onDelete={model.deleteSkill}
                  onReadDetails={model.readSkillDetails}
                />
              )}
            </section>
          </div>
        </section>
      </div>
    </section>
  );
};
