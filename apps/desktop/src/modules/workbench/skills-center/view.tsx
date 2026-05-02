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
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type SkillsCenterSurfaceProps = {
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
  const selectedSkill =
    allInstalledSkills.find((skill) => skill.skillId === state.selectedSkillId) ?? null;
  const selectedDetails =
    selectedSkill === null ? undefined : state.detailsBySkillId[selectedSkill.skillId];
  const selectedEffective =
    selectedSkill === null
      ? undefined
      : state.effectiveSkills.find((skill) => skill.skillId === selectedSkill.skillId);

  useEffect(() => {
    if (selectedSkill === null || selectedDetails !== undefined) {
      return;
    }
    void model.readSkillDetails(selectedSkill.skillId);
  }, [model, selectedDetails, selectedSkill]);
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <>
          <div className="lyra-titlebar-context-controls">
            <button
              type="button"
              className={
                state.preferredScope === "global"
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                  : "lyra-titlebar-context-text-button"
              }
              onClick={() => { model.setPreferredScope("global"); }}
            >
              {labels.scopeGlobal}
              <span>{state.globalSkills.length}</span>
            </button>
            <button
              type="button"
              className={
                state.preferredScope === "project"
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                  : "lyra-titlebar-context-text-button"
              }
              disabled={state.projectSkills.length === 0}
              onClick={() => { model.setPreferredScope("project"); }}
            >
              {labels.scopeProject}
              <span>{state.projectSkills.length > 0 ? String(state.projectSkills.length) : "—"}</span>
            </button>
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
                    ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-text-button"
                }
                onClick={() => { model.setStatusFilter(value); }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.actionRefresh}
              onClick={() => { void model.load(); }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={model.openCatalog}
            >
              <Package size={14} />
              <span>{labels.actionOpenCatalog}</span>
            </button>
            <button
              type="button"
              className="lyra-titlebar-context-text-button"
              onClick={model.openCreate}
            >
              <FilePlus2 size={14} />
              <span>{labels.actionOpenCreate}</span>
            </button>
          </div>
        </>
      )
    }),
    [
      labels,
      model,
      state.globalSkills.length,
      state.preferredScope,
      state.projectSkills.length,
      state.statusFilter
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <section className="lyra-skills-center-surface lyra-mcp-center-surface" aria-label="ai-skills-surface">
      <div className="lyra-mcp-center-shell lyra-mcp-center-shell-no-sidebar lyra-skills-center-shell">
        <section className="lyra-mcp-center-main lyra-skills-center-main">
          {state.errorMessage === null ? null : (
            <div className="lyra-mcp-center-banner">
              <AlertTriangle size={14} />
              <span>{state.errorMessage}</span>
            </div>
          )}

          <div className="lyra-mcp-center-body">
            <section className="lyra-mcp-center-list-panel lyra-skills-center-list-panel">
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
