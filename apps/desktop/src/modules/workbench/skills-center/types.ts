import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  CreateLyraSkillRequest,
  EffectiveSkillConfig,
  InstalledSkillConfig,
  SkillCatalogItem,
  SkillDetails,
  SkillImportDiscovery,
  SkillScope,
  SkillSourceKind,
  SkillType
} from "../../../shared/skills";

export type SkillsCenterStatus = "idle" | "loading" | "ready" | "error";

export type SkillsCenterPanelMode = "details" | "catalog" | "import" | "create";

export type SkillsCenterStatusFilter = "all" | "enabled" | "disabled" | "untrusted";

export type SkillsCenterSourceFilter = "all" | SkillSourceKind;

export type SkillsCenterCreateDraft = {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly skillType: SkillType;
  readonly author: string;
  readonly triggerSummary: string;
  readonly content: string;
};

export type SkillsCenterState = {
  readonly status: SkillsCenterStatus;
  readonly panelMode: SkillsCenterPanelMode;
  readonly preferredScope: SkillScope;
  readonly statusFilter: SkillsCenterStatusFilter;
  readonly sourceFilter: SkillsCenterSourceFilter;
  readonly categoryFilter: string;
  readonly catalog: readonly SkillCatalogItem[];
  readonly globalSkills: readonly InstalledSkillConfig[];
  readonly projectSkills: readonly InstalledSkillConfig[];
  readonly effectiveSkills: readonly EffectiveSkillConfig[];
  readonly selectedSkillId: string | null;
  readonly selectedCatalogId: string | null;
  readonly detailsBySkillId: Readonly<Record<string, SkillDetails>>;
  readonly importPath: string;
  readonly importDiscovery: SkillImportDiscovery | null;
  readonly selectedImportPreviewIds: readonly string[];
  readonly createDraft: SkillsCenterCreateDraft;
  readonly errorMessage: string | null;
};

export type SkillsCenterLabels = {
  readonly title: string;
  readonly sidebarDescription: string;
  readonly sidebarScope: string;
  readonly sidebarStatus: string;
  readonly sidebarSources: string;
  readonly sidebarCategories: string;
  readonly sidebarBuiltin: string;
  readonly sidebarInstalledGlobal: string;
  readonly sidebarInstalledProject: string;
  readonly scopeGlobal: string;
  readonly scopeProject: string;
  readonly scopeProjectUnavailable: string;
  readonly statusAll: string;
  readonly statusEnabled: string;
  readonly statusDisabled: string;
  readonly statusUntrusted: string;
  readonly sourceAll: string;
  readonly sourceBuiltin: string;
  readonly sourceLyra: string;
  readonly sourceClaude: string;
  readonly sourceContinue: string;
  readonly toolbarInstalled: string;
  readonly toolbarInstalledDescription: string;
  readonly actionOpenCatalog: string;
  readonly actionOpenImport: string;
  readonly actionOpenCreate: string;
  readonly actionRefresh: string;
  readonly actionInstallBuiltin: string;
  readonly actionDiscoverImport: string;
  readonly actionImportSelected: string;
  readonly actionCreateSkill: string;
  readonly actionCancel: string;
  readonly actionTrust: string;
  readonly actionUntrust: string;
  readonly actionEnable: string;
  readonly actionDisable: string;
  readonly actionDelete: string;
  readonly actionViewDetails: string;
  readonly catalog: string;
  readonly details: string;
  readonly importTitle: string;
  readonly importDescription: string;
  readonly createTitle: string;
  readonly createDescription: string;
  readonly fieldName: string;
  readonly fieldDescription: string;
  readonly fieldCategory: string;
  readonly fieldAuthor: string;
  readonly fieldSkillType: string;
  readonly fieldTriggerSummary: string;
  readonly fieldContent: string;
  readonly fieldSource: string;
  readonly fieldVersion: string;
  readonly fieldTrust: string;
  readonly fieldEnable: string;
  readonly fieldFiles: string;
  readonly fieldScripts: string;
  readonly fieldCompatibility: string;
  readonly fieldEntry: string;
  readonly fieldPath: string;
  readonly fieldLastError: string;
  readonly fieldPackagePath: string;
  readonly fieldOverride: string;
  readonly fieldContentPreview: string;
  readonly importPathLabel: string;
  readonly importPathPlaceholder: string;
  readonly importPreviewTitle: string;
  readonly importPreviewEmpty: string;
  readonly importPreviewScripts: string;
  readonly importPreviewResources: string;
  readonly importPreviewErrors: string;
  readonly emptySelection: string;
  readonly emptyInstalled: string;
  readonly emptyCatalog: string;
  readonly emptyImport: string;
  readonly typePrompt: string;
  readonly typeWorkflow: string;
  readonly typeResource: string;
  readonly typeToolGuidance: string;
  readonly trustTrusted: string;
  readonly trustUntrusted: string;
  readonly enableEnabled: string;
  readonly enableDisabled: string;
  readonly overrideInherited: string;
  readonly overrideProjectOnly: string;
  readonly overrideGlobalOnly: string;
  readonly untrustedWarning: string;
  readonly createDefaultContent: string;
};

export type SkillsCenterModel = {
  readonly state: SkillsCenterState;
  readonly load: () => Promise<void>;
  readonly selectSkill: (skillId: string) => void;
  readonly selectCatalogItem: (catalogId: string) => void;
  readonly setPreferredScope: (scope: SkillScope) => void;
  readonly setStatusFilter: (filter: SkillsCenterStatusFilter) => void;
  readonly setSourceFilter: (filter: SkillsCenterSourceFilter) => void;
  readonly setCategoryFilter: (category: string) => void;
  readonly openCatalog: () => void;
  readonly openImport: () => void;
  readonly openCreate: () => void;
  readonly closePanelMode: () => void;
  readonly setImportPath: (value: string) => void;
  readonly discoverImportSource: () => Promise<void>;
  readonly toggleImportPreviewSelection: (previewId: string) => void;
  readonly installCatalogSkill: (catalogId: string) => Promise<void>;
  readonly importSelectedSkills: () => Promise<void>;
  readonly updateCreateDraftField: <K extends keyof SkillsCenterCreateDraft>(
    field: K,
    value: SkillsCenterCreateDraft[K]
  ) => void;
  readonly createLyraSkill: () => Promise<void>;
  readonly trustSkill: (skillId: string) => Promise<void>;
  readonly untrustSkill: (skillId: string) => Promise<void>;
  readonly enableSkill: (skillId: string) => Promise<void>;
  readonly disableSkill: (skillId: string) => Promise<void>;
  readonly deleteSkill: (skillId: string) => Promise<void>;
  readonly readSkillDetails: (skillId: string) => Promise<void>;
};

export type UseSkillsCenterModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly projectHintPath?: string;
};

export const createEmptySkillsDraft = (labels: SkillsCenterLabels): SkillsCenterCreateDraft => ({
  name: "",
  description: "",
  category: "",
  skillType: "prompt",
  author: "",
  triggerSummary: "",
  content: labels.createDefaultContent
});
