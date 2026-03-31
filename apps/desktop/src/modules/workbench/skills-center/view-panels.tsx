import {
  AlertTriangle,
  BookText,
  Bot,
  CheckCircle2,
  FileCode2,
  FilePlus2,
  Folder,
  Package,
  RefreshCw,
  ShieldCheck,
  Square,
  Wrench,
  X
} from "lucide-react";

import type {
  EffectiveSkillConfig,
  InstalledSkillConfig,
  SkillCatalogItem,
  SkillDetails,
  SkillFileSummary,
  SkillImportPreviewItem,
  SkillSourceKind,
  SkillType
} from "../../../shared/skills";
import { LyraListPicker } from "../list-picker";
import type { SkillsCenterLabels, SkillsCenterModel, SkillsCenterState } from "./types";

export const renderSkillIcon = (iconKey: string) => {
  const size = 15;

  switch (iconKey) {
    case "folder-search":
      return <Folder size={size} />;
    case "clipboard-check":
      return <CheckCircle2 size={size} />;
    case "plug-zap":
      return <Wrench size={size} />;
    case "file-text":
      return <BookText size={size} />;
    case "shield-check":
      return <ShieldCheck size={size} />;
    case "message-square-text":
      return <BookText size={size} />;
    case "sparkles":
      return <Bot size={size} />;
    case "brain-circuit":
      return <Bot size={size} />;
    case "file-code":
      return <FileCode2 size={size} />;
    default:
      return <Package size={size} />;
  }
};

export const renderSourceLabel = (
  sourceKind: SkillSourceKind,
  labels: SkillsCenterLabels
): string => {
  if (sourceKind === "builtin") {
    return labels.sourceBuiltin;
  }
  if (sourceKind === "lyra") {
    return labels.sourceLyra;
  }
  if (sourceKind === "claude") {
    return labels.sourceClaude;
  }
  return labels.sourceContinue;
};

export const renderTypeLabel = (
  skillType: SkillType,
  labels: SkillsCenterLabels
): string => {
  if (skillType === "workflow") {
    return labels.typeWorkflow;
  }
  if (skillType === "resource") {
    return labels.typeResource;
  }
  if (skillType === "tool-guidance") {
    return labels.typeToolGuidance;
  }
  return labels.typePrompt;
};

const renderTrustLabel = (
  trustState: InstalledSkillConfig["trustState"],
  labels: SkillsCenterLabels
): string =>
  trustState === "trusted" ? labels.trustTrusted : labels.trustUntrusted;

export const renderEnableLabel = (
  enableState: InstalledSkillConfig["enableState"],
  labels: SkillsCenterLabels
): string =>
  enableState === "enabled" ? labels.enableEnabled : labels.enableDisabled;

const renderOverrideLabel = (
  effectiveSkill: EffectiveSkillConfig | undefined,
  labels: SkillsCenterLabels
): string => {
  if (effectiveSkill?.inheritedFromGlobal === true) {
    return labels.overrideInherited;
  }
  if (effectiveSkill?.effectiveScope === "project") {
    return labels.overrideProjectOnly;
  }
  return labels.overrideGlobalOnly;
};

const summarizeFileKinds = (
  files: readonly SkillFileSummary[],
  labels: SkillsCenterLabels
): string => {
  const scriptCount = files.filter((file) => file.kind === "script").length;
  const resourceCount = files.filter((file) => file.kind === "resource").length;
  const templateCount = files.filter((file) => file.kind === "template").length;
  const documentCount = files.filter((file) => file.kind === "document").length;
  const summaryParts = [
    scriptCount > 0 ? `${scriptCount} ${labels.importPreviewScripts.toLowerCase()}` : null,
    resourceCount > 0 ? `${resourceCount} ${labels.importPreviewResources.toLowerCase()}` : null,
    templateCount > 0 ? `${templateCount} templates` : null,
    documentCount > 0 ? `${documentCount} docs` : null
  ].filter((part): part is string => part !== null);

  return summaryParts.length > 0 ? summaryParts.join(" · ") : labels.importPreviewEmpty;
};

const Field = ({
  label,
  value
}: {
  readonly label: string;
  readonly value: string;
}) => (
  <div className="lyra-mcp-center-field">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const SkillFileList = ({
  files,
  emptyLabel
}: {
  readonly files: readonly SkillFileSummary[];
  readonly emptyLabel: string;
}) => {
  if (files.length === 0) {
    return <p className="lyra-mcp-center-muted">{emptyLabel}</p>;
  }

  return (
    <div className="lyra-mcp-center-kv-list">
      {files.map((file) => (
        <div key={file.path} className="lyra-mcp-center-kv-item">
          <span>{file.kind}</span>
          <strong>{file.path}</strong>
        </div>
      ))}
    </div>
  );
};

const ImportPreviewItemCard = ({
  item,
  checked,
  labels,
  onToggle
}: {
  readonly item: SkillImportPreviewItem;
  readonly checked: boolean;
  readonly labels: SkillsCenterLabels;
  readonly onToggle: (previewId: string) => void;
}) => (
  <label
    className={
      checked
        ? "lyra-skills-center-preview-item lyra-skills-center-preview-item-selected"
        : "lyra-skills-center-preview-item"
    }
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={() => {
        onToggle(item.previewId);
      }}
    />
    <span className="lyra-mcp-center-server-icon">{renderSkillIcon(item.manifest.iconKey)}</span>
    <span className="lyra-skills-center-preview-copy">
      <strong>{item.manifest.name}</strong>
      <small>
        {renderSourceLabel(item.manifest.sourceKind, labels)} ·{" "}
        {renderTypeLabel(item.manifest.skillType, labels)}
      </small>
      <small>{summarizeFileKinds(item.manifest.assets, labels)}</small>
      {item.parseErrors.length === 0 ? null : (
        <small>{`${labels.importPreviewErrors}: ${item.parseErrors.join("; ")}`}</small>
      )}
    </span>
  </label>
);

export const CatalogPanel = ({
  state,
  labels,
  onSelect,
  onInstall,
  onClose
}: {
  readonly state: SkillsCenterState;
  readonly labels: SkillsCenterLabels;
  readonly onSelect: (catalogId: string) => void;
  readonly onInstall: (catalogId: string) => Promise<void>;
  readonly onClose: () => void;
}) => {
  const selectedCatalog =
    state.catalog.find((item) => item.id === state.selectedCatalogId) ?? state.catalog[0] ?? null;

  return (
    <section className="lyra-mcp-center-panel-shell lyra-skills-center-panel-shell">
      <header className="lyra-mcp-center-panel-header">
        <div>
          <h3>{labels.catalog}</h3>
          <p>{labels.sidebarBuiltin}</p>
        </div>
        <div className="lyra-mcp-center-actions">
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={onClose}
          >
            <X size={14} />
            <span>{labels.actionCancel}</span>
          </button>
        </div>
      </header>

      {state.catalog.length === 0 || selectedCatalog === null ? (
        <div className="lyra-mcp-center-empty-state">{labels.emptyCatalog}</div>
      ) : (
        <div className="lyra-mcp-center-catalog-layout">
          <div className="lyra-mcp-center-catalog-list">
            {state.catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === selectedCatalog.id
                    ? "lyra-mcp-center-catalog-item lyra-mcp-center-catalog-item-active"
                    : "lyra-mcp-center-catalog-item"
                }
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                <span className="lyra-mcp-center-server-icon">{renderSkillIcon(item.iconKey)}</span>
                <span className="lyra-mcp-center-catalog-copy">
                  <strong>{item.name}</strong>
                  <small>{renderTypeLabel(item.skillType, labels)}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="lyra-mcp-center-catalog-detail">
            <header className="lyra-mcp-center-detail-header">
              <div className="lyra-mcp-center-detail-title">
                <span className="lyra-mcp-center-server-icon lyra-mcp-center-server-icon-large">
                  {renderSkillIcon(selectedCatalog.iconKey)}
                </span>
                <div>
                  <h3>{selectedCatalog.name}</h3>
                  <p>{selectedCatalog.description}</p>
                </div>
              </div>
              <div className="lyra-mcp-center-actions">
                <button
                  type="button"
                  className="lyra-mcp-center-button"
                  onClick={() => {
                    void onInstall(selectedCatalog.id);
                  }}
                >
                  <Package size={14} />
                  <span>{labels.actionInstallBuiltin}</span>
                </button>
              </div>
            </header>

            <div className="lyra-mcp-center-detail-grid">
              <Field
                label={labels.fieldSource}
                value={renderSourceLabel(selectedCatalog.sourceKind, labels)}
              />
              <Field
                label={labels.fieldSkillType}
                value={renderTypeLabel(selectedCatalog.skillType, labels)}
              />
              <Field label={labels.fieldVersion} value={selectedCatalog.version} />
              <Field
                label={labels.fieldFiles}
                value={String(selectedCatalog.assets.length + 1)}
              />
            </div>

            <section className="lyra-mcp-center-detail-section">
              <header className="lyra-mcp-center-section-header">
                <h4>{labels.fieldCompatibility}</h4>
              </header>
              <div className="lyra-mcp-center-kv-list">
                {selectedCatalog.compatibility.detectedFrom.map((entry) => (
                  <div key={entry} className="lyra-mcp-center-kv-item">
                    <span>{labels.fieldSource}</span>
                    <strong>{entry}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="lyra-mcp-center-detail-section">
              <header className="lyra-mcp-center-section-header">
                <h4>{labels.fieldFiles}</h4>
              </header>
              <SkillFileList files={selectedCatalog.assets} emptyLabel={labels.importPreviewEmpty} />
            </section>
          </div>
        </div>
      )}
    </section>
  );
};

export const ImportPanel = ({
  state,
  labels,
  onClose,
  onSetPath,
  onDiscover,
  onImport,
  onToggle
}: {
  readonly state: SkillsCenterState;
  readonly labels: SkillsCenterLabels;
  readonly onClose: () => void;
  readonly onSetPath: (value: string) => void;
  readonly onDiscover: () => Promise<void>;
  readonly onImport: () => Promise<void>;
  readonly onToggle: (previewId: string) => void;
}) => {
  const discovery = state.importDiscovery;

  return (
    <section className="lyra-mcp-center-panel-shell lyra-skills-center-panel-shell">
      <header className="lyra-mcp-center-panel-header">
        <div>
          <h3>{labels.importTitle}</h3>
          <p>{labels.importDescription}</p>
        </div>
        <div className="lyra-mcp-center-actions">
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={onClose}
          >
            <X size={14} />
            <span>{labels.actionCancel}</span>
          </button>
          <button
            type="button"
            className="lyra-mcp-center-button"
            onClick={() => {
              void onImport();
            }}
            disabled={discovery === null || state.selectedImportPreviewIds.length === 0}
          >
            <Package size={14} />
            <span>{labels.actionImportSelected}</span>
          </button>
        </div>
      </header>

      <section className="lyra-mcp-center-form-section">
        <label>
          <span>{labels.importPathLabel}</span>
          <div className="lyra-skills-center-inline-form">
            <input
              className="lyra-mcp-center-input"
              value={state.importPath}
              placeholder={labels.importPathPlaceholder}
              onChange={(event) => {
                onSetPath(event.target.value);
              }}
            />
            <button
              type="button"
              className="lyra-mcp-center-button"
              onClick={() => {
                void onDiscover();
              }}
            >
              <RefreshCw size={14} />
              <span>{labels.actionDiscoverImport}</span>
            </button>
          </div>
        </label>
      </section>

      {discovery === null ? (
        <div className="lyra-mcp-center-empty-state">{labels.emptyImport}</div>
      ) : (
        <>
          <div className="lyra-mcp-center-alert lyra-mcp-center-alert-inline">
            <CheckCircle2 size={14} />
            <strong>{discovery.summary}</strong>
          </div>

          {discovery.parseErrors.length === 0 ? null : (
            <div className="lyra-mcp-center-alert lyra-mcp-center-alert-error">
              <AlertTriangle size={14} />
              <div>
                <strong>{labels.importPreviewErrors}</strong>
                <p>{discovery.parseErrors.join("; ")}</p>
              </div>
            </div>
          )}

          <section className="lyra-mcp-center-detail-section">
            <header className="lyra-mcp-center-section-header">
              <h4>{labels.importPreviewTitle}</h4>
              <span className="lyra-mcp-center-muted">
                {state.selectedImportPreviewIds.length}/{discovery.previewItems.length}
              </span>
            </header>
            {discovery.previewItems.length === 0 ? (
              <div className="lyra-mcp-center-empty-state">{labels.importPreviewEmpty}</div>
            ) : (
              <div className="lyra-skills-center-preview-list">
                {discovery.previewItems.map((item) => (
                  <ImportPreviewItemCard
                    key={item.previewId}
                    item={item}
                    checked={state.selectedImportPreviewIds.includes(item.previewId)}
                    labels={labels}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
};

export const CreatePanel = ({
  state,
  labels,
  onClose,
  onFieldChange,
  onCreate
}: {
  readonly state: SkillsCenterState;
  readonly labels: SkillsCenterLabels;
  readonly onClose: () => void;
  readonly onFieldChange: SkillsCenterModel["updateCreateDraftField"];
  readonly onCreate: () => Promise<void>;
}) => {
  const draft = state.createDraft;

  return (
    <section className="lyra-mcp-center-panel-shell lyra-skills-center-panel-shell">
      <header className="lyra-mcp-center-panel-header">
        <div>
          <h3>{labels.createTitle}</h3>
          <p>{labels.createDescription}</p>
        </div>
        <div className="lyra-mcp-center-actions">
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={onClose}
          >
            <X size={14} />
            <span>{labels.actionCancel}</span>
          </button>
          <button
            type="button"
            className="lyra-mcp-center-button"
            onClick={() => {
              void onCreate();
            }}
          >
            <FilePlus2 size={14} />
            <span>{labels.actionCreateSkill}</span>
          </button>
        </div>
      </header>

      <section className="lyra-mcp-center-form-section lyra-mcp-center-form-grid">
        <label>
          <span>{labels.fieldName}</span>
          <input
            className="lyra-mcp-center-input"
            value={draft.name}
            onChange={(event) => {
              onFieldChange("name", event.target.value);
            }}
          />
        </label>

        <label>
          <span>{labels.fieldCategory}</span>
          <input
            className="lyra-mcp-center-input"
            value={draft.category}
            onChange={(event) => {
              onFieldChange("category", event.target.value);
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
          <span>{labels.fieldSkillType}</span>
          <LyraListPicker
            className="lyra-mcp-center-list-picker"
            ariaLabel={labels.fieldSkillType}
            listAriaLabel={labels.fieldSkillType}
            value={draft.skillType}
            shape="rounded"
            options={[
              { value: "prompt", label: labels.typePrompt },
              { value: "workflow", label: labels.typeWorkflow },
              { value: "resource", label: labels.typeResource },
              { value: "tool-guidance", label: labels.typeToolGuidance }
            ]}
            onChange={(nextType) => {
              onFieldChange("skillType", nextType);
            }}
          />
        </label>

        <label>
          <span>{labels.fieldAuthor}</span>
          <input
            className="lyra-mcp-center-input"
            value={draft.author}
            onChange={(event) => {
              onFieldChange("author", event.target.value);
            }}
          />
        </label>

        <label className="lyra-mcp-center-form-grid-span-2">
          <span>{labels.fieldTriggerSummary}</span>
          <input
            className="lyra-mcp-center-input"
            value={draft.triggerSummary}
            onChange={(event) => {
              onFieldChange("triggerSummary", event.target.value);
            }}
          />
        </label>

        <label className="lyra-mcp-center-form-grid-span-2">
          <span>{labels.fieldContent}</span>
          <textarea
            className="lyra-mcp-center-textarea lyra-skills-center-textarea-large"
            value={draft.content}
            onChange={(event) => {
              onFieldChange("content", event.target.value);
            }}
          />
        </label>
      </section>
    </section>
  );
};

export const SkillDetailPanel = ({
  skill,
  details,
  effectiveSkill,
  labels,
  onTrust,
  onUntrust,
  onEnable,
  onDisable,
  onDelete,
  onReadDetails
}: {
  readonly skill: InstalledSkillConfig | null;
  readonly details: SkillDetails | undefined;
  readonly effectiveSkill: EffectiveSkillConfig | undefined;
  readonly labels: SkillsCenterLabels;
  readonly onTrust: (skillId: string) => Promise<void>;
  readonly onUntrust: (skillId: string) => Promise<void>;
  readonly onEnable: (skillId: string) => Promise<void>;
  readonly onDisable: (skillId: string) => Promise<void>;
  readonly onDelete: (skillId: string) => Promise<void>;
  readonly onReadDetails: (skillId: string) => Promise<void>;
}) => {
  if (skill === null) {
    return <div className="lyra-mcp-center-empty-state">{labels.emptySelection}</div>;
  }

  return (
    <section className="lyra-mcp-center-panel-shell lyra-skills-center-panel-shell">
      <header className="lyra-mcp-center-detail-header">
        <div className="lyra-mcp-center-detail-title">
          <span className="lyra-mcp-center-server-icon lyra-mcp-center-server-icon-large">
            {renderSkillIcon(skill.manifest.iconKey)}
          </span>
          <div>
            <h3>{skill.manifest.name}</h3>
            <p>{skill.manifest.description}</p>
          </div>
        </div>
        <div className="lyra-mcp-center-actions">
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
            onClick={() => {
              void onReadDetails(skill.skillId);
            }}
          >
            <RefreshCw size={14} />
            <span>{labels.actionViewDetails}</span>
          </button>
          {skill.trustState === "trusted" ? (
            <button
              type="button"
              className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
              onClick={() => {
                void onUntrust(skill.skillId);
              }}
            >
              <X size={14} />
              <span>{labels.actionUntrust}</span>
            </button>
          ) : (
            <button
              type="button"
              className="lyra-mcp-center-button"
              onClick={() => {
                void onTrust(skill.skillId);
              }}
            >
              <ShieldCheck size={14} />
              <span>{labels.actionTrust}</span>
            </button>
          )}
          {skill.enableState === "enabled" ? (
            <button
              type="button"
              className="lyra-mcp-center-button lyra-mcp-center-button-ghost"
              onClick={() => {
                void onDisable(skill.skillId);
              }}
            >
              <Square size={14} />
              <span>{labels.actionDisable}</span>
            </button>
          ) : (
            <button
              type="button"
              className="lyra-mcp-center-button"
              disabled={skill.trustState !== "trusted"}
              onClick={() => {
                void onEnable(skill.skillId);
              }}
            >
              <CheckCircle2 size={14} />
              <span>{labels.actionEnable}</span>
            </button>
          )}
          <button
            type="button"
            className="lyra-mcp-center-button lyra-mcp-center-button-danger"
            onClick={() => {
              void onDelete(skill.skillId);
            }}
          >
            <X size={14} />
            <span>{labels.actionDelete}</span>
          </button>
        </div>
      </header>

      {skill.trustState === "trusted" ? null : (
        <div className="lyra-mcp-center-alert lyra-mcp-center-alert-error">
          <AlertTriangle size={14} />
          <div>
            <strong>{labels.untrustedWarning}</strong>
          </div>
        </div>
      )}

      <div className="lyra-mcp-center-detail-grid">
        <Field label={labels.fieldSource} value={renderSourceLabel(skill.manifest.sourceKind, labels)} />
        <Field label={labels.fieldSkillType} value={renderTypeLabel(skill.manifest.skillType, labels)} />
        <Field label={labels.fieldVersion} value={skill.manifest.version} />
        <Field label={labels.fieldTrust} value={renderTrustLabel(skill.trustState, labels)} />
        <Field label={labels.fieldEnable} value={renderEnableLabel(skill.enableState, labels)} />
        <Field label={labels.fieldOverride} value={renderOverrideLabel(effectiveSkill, labels)} />
        <Field label={labels.fieldEntry} value={skill.manifest.entryPath} />
        <Field label={labels.fieldFiles} value={String(skill.sourceSummary.length)} />
      </div>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldCompatibility}</h4>
        </header>
        <div className="lyra-mcp-center-kv-list">
          {skill.manifest.compatibility.detectedFrom.map((entry) => (
            <div key={entry} className="lyra-mcp-center-kv-item">
              <span>{labels.fieldSource}</span>
              <strong>{entry}</strong>
            </div>
          ))}
          {skill.manifest.compatibility.notes.map((entry) => (
            <div key={entry} className="lyra-mcp-center-kv-item">
              <span>{labels.details}</span>
              <strong>{entry}</strong>
            </div>
          ))}
        </div>
        {skill.manifest.compatibility.parseErrors.length === 0 ? null : (
          <div className="lyra-mcp-center-alert lyra-mcp-center-alert-error">
            <AlertTriangle size={14} />
            <div>
              <strong>{labels.importPreviewErrors}</strong>
              <p>{skill.manifest.compatibility.parseErrors.join("; ")}</p>
            </div>
          </div>
        )}
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldFiles}</h4>
        </header>
        <SkillFileList files={skill.sourceSummary} emptyLabel={labels.importPreviewEmpty} />
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldScripts}</h4>
        </header>
        {skill.manifest.scripts.length === 0 ? (
          <p className="lyra-mcp-center-muted">{labels.importPreviewEmpty}</p>
        ) : (
          <div className="lyra-mcp-center-tag-row">
            {skill.manifest.scripts.map((scriptPath) => (
              <span key={scriptPath} className="lyra-mcp-center-tag">
                {scriptPath}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="lyra-mcp-center-detail-section">
        <header className="lyra-mcp-center-section-header">
          <h4>{labels.fieldPath}</h4>
        </header>
        <div className="lyra-mcp-center-kv-list">
          {skill.sourcePath === undefined ? null : (
            <div className="lyra-mcp-center-kv-item">
              <span>{labels.fieldPath}</span>
              <strong>{skill.sourcePath}</strong>
            </div>
          )}
          <div className="lyra-mcp-center-kv-item">
            <span>{labels.fieldPackagePath}</span>
            <strong>{skill.packagePath}</strong>
          </div>
        </div>
      </section>

      {skill.lastError === undefined ? null : (
        <section className="lyra-mcp-center-detail-section">
          <header className="lyra-mcp-center-section-header">
            <h4>{labels.fieldLastError}</h4>
          </header>
          <div className="lyra-mcp-center-alert lyra-mcp-center-alert-error">
            <AlertTriangle size={14} />
            <div>
              <p>{skill.lastError}</p>
            </div>
          </div>
        </section>
      )}

      {details?.contentPreview === undefined ? null : (
        <section className="lyra-mcp-center-detail-section">
          <header className="lyra-mcp-center-section-header">
            <h4>{labels.fieldContentPreview}</h4>
          </header>
          <pre className="lyra-skills-center-content-preview">{details.contentPreview}</pre>
        </section>
      )}
    </section>
  );
};
