import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  EffectiveSkillConfig,
  InstalledSkillConfig,
  SkillCatalogItem,
  SkillDetails,
  SkillImportPreviewItem,
  SkillScope,
  UpdateSkillStateRequest
} from "../../../shared/skills";
import type {
  SkillsCenterCreateDraft,
  SkillsCenterLabels,
  SkillsCenterModel,
  SkillsCenterSourceFilter,
  SkillsCenterState,
  SkillsCenterStatusFilter,
  UseSkillsCenterModelOptions
} from "./types";
import { createEmptySkillsDraft } from "./types";

const createInitialState = (labels: SkillsCenterLabels): SkillsCenterState => ({
  status: "idle",
  panelMode: "details",
  preferredScope: "global",
  statusFilter: "all",
  sourceFilter: "all",
  categoryFilter: "all",
  catalog: [],
  globalSkills: [],
  projectSkills: [],
  effectiveSkills: [],
  selectedSkillId: null,
  selectedCatalogId: null,
  detailsBySkillId: {},
  importPath: "",
  importDiscovery: null,
  selectedImportPreviewIds: [],
  createDraft: createEmptySkillsDraft(labels),
  errorMessage: null
});

const resolveScopeRequest = (
  scope: SkillScope,
  projectHintPath?: string
): { readonly scope: SkillScope; readonly projectRoot?: string } =>
  scope === "project"
    ? {
        scope,
        ...(projectHintPath === undefined ? {} : { projectRoot: projectHintPath })
      }
    : { scope };

const createDefaultSkillContent = (name: string, description: string): string =>
  `# ${name || "New Skill"}\n\n${description || "Describe when this skill should be used and how it should guide the assistant."}\n`;

const findInstalledSkillById = (
  state: Pick<SkillsCenterState, "globalSkills" | "projectSkills">,
  skillId: string
): InstalledSkillConfig | undefined =>
  [...state.projectSkills, ...state.globalSkills].find((skill) => skill.skillId === skillId);

export const useSkillsCenterModel = ({
  desktopApi,
  projectHintPath,
  labels
}: UseSkillsCenterModelOptions & {
  readonly labels: SkillsCenterLabels;
}): SkillsCenterModel => {
  const [state, setState] = useState<SkillsCenterState>(() => createInitialState(labels));

  useEffect(() => {
    setState((current) => ({
      ...current,
      createDraft:
        current.createDraft.content === labels.createDefaultContent
          ? createEmptySkillsDraft(labels)
          : current.createDraft
    }));
  }, [labels]);

  const load = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: "Skills desktop bridge is unavailable."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      status: "loading",
      errorMessage: null
    }));

    try {
      const [catalog, globalSkills, effectiveSkills, projectSkills] = await Promise.all([
        desktopApi.skills.readCatalog(),
        desktopApi.skills.readInstalled({ scope: "global" }),
        desktopApi.skills.readEffectiveSkills(
          projectHintPath === undefined ? undefined : { projectRoot: projectHintPath }
        ),
        projectHintPath === undefined
          ? Promise.resolve([] as readonly InstalledSkillConfig[])
          : desktopApi.skills.readInstalled({
              scope: "project",
              projectRoot: projectHintPath
            })
      ]);

      setState((current) => {
        const scopedSkills =
          current.preferredScope === "project" ? projectSkills : globalSkills;
        const selectedSkillStillExists =
          current.selectedSkillId !== null &&
          scopedSkills.some((skill) => skill.skillId === current.selectedSkillId);
        const selectedCatalogStillExists =
          current.selectedCatalogId !== null &&
          catalog.some((item) => item.id === current.selectedCatalogId);

        return {
          ...current,
          status: "ready",
          catalog,
          globalSkills,
          projectSkills,
          effectiveSkills,
          preferredScope:
            current.preferredScope === "project" && projectHintPath === undefined
              ? "global"
              : current.preferredScope,
          selectedSkillId:
            selectedSkillStillExists
              ? current.selectedSkillId
              : scopedSkills[0]?.skillId ?? null,
          selectedCatalogId:
            selectedCatalogStillExists ? current.selectedCatalogId : catalog[0]?.id ?? null,
          errorMessage: null
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Failed to load Skills Center."
      }));
    }
  }, [desktopApi, projectHintPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    const unsubscribe = desktopApi.skills.onEvent(() => {
      void load();
    });
    return () => {
      unsubscribe();
    };
  }, [desktopApi, load]);

  const selectSkill = useCallback((skillId: string): void => {
    setState((current) => ({
      ...current,
      selectedSkillId: skillId,
      panelMode: "details"
    }));
  }, []);

  const selectCatalogItem = useCallback((catalogId: string): void => {
    setState((current) => ({
      ...current,
      selectedCatalogId: catalogId,
      panelMode: "catalog"
    }));
  }, []);

  const setPreferredScope = useCallback((scope: SkillScope): void => {
    setState((current) => ({
      ...current,
      preferredScope: scope === "project" && projectHintPath === undefined ? "global" : scope,
      selectedSkillId:
        (scope === "project" ? current.projectSkills[0] : current.globalSkills[0])?.skillId ??
        null
    }));
  }, [projectHintPath]);

  const setStatusFilter = useCallback((filter: SkillsCenterStatusFilter): void => {
    setState((current) => ({
      ...current,
      statusFilter: filter
    }));
  }, []);

  const setSourceFilter = useCallback((filter: SkillsCenterSourceFilter): void => {
    setState((current) => ({
      ...current,
      sourceFilter: filter
    }));
  }, []);

  const setCategoryFilter = useCallback((category: string): void => {
    setState((current) => ({
      ...current,
      categoryFilter: category.length === 0 ? "all" : category
    }));
  }, []);

  const openCatalog = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "catalog"
    }));
  }, []);

  const openImport = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "import"
    }));
  }, []);

  const openCreate = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "create",
      createDraft: createEmptySkillsDraft(labels)
    }));
  }, [labels]);

  const closePanelMode = useCallback((): void => {
    setState((current) => ({
      ...current,
      panelMode: "details",
      errorMessage: null
    }));
  }, []);

  const setImportPath = useCallback((value: string): void => {
    setState((current) => ({
      ...current,
      importPath: value
    }));
  }, []);

  const discoverImportSource = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const sourcePath = state.importPath.trim();
    if (sourcePath.length === 0) {
      setState((current) => ({
        ...current,
        importDiscovery: null,
        selectedImportPreviewIds: [],
        errorMessage: labels.emptyImport
      }));
      return;
    }

    const discovery = await desktopApi.skills.discoverImportSource(sourcePath);
    setState((current) => ({
      ...current,
      importDiscovery: discovery,
      selectedImportPreviewIds: discovery.previewItems.map((item) => item.previewId),
      errorMessage: discovery.parseErrors[0] ?? null
    }));
  }, [desktopApi, labels.emptyImport, state.importPath]);

  const toggleImportPreviewSelection = useCallback((previewId: string): void => {
    setState((current) => ({
      ...current,
      selectedImportPreviewIds: current.selectedImportPreviewIds.includes(previewId)
        ? current.selectedImportPreviewIds.filter((id) => id !== previewId)
        : [...current.selectedImportPreviewIds, previewId]
    }));
  }, []);

  const installCatalogSkill = useCallback(async (catalogId: string): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const scopeRequest = resolveScopeRequest(state.preferredScope, projectHintPath);
    await desktopApi.skills.importSkills({
      ...scopeRequest,
      source: {
        kind: "catalog",
        itemIds: [catalogId]
      }
    });
    await load();
    setState((current) => ({
      ...current,
      panelMode: "details",
      selectedSkillId: catalogId
    }));
  }, [desktopApi, load, projectHintPath, state.preferredScope]);

  const importSelectedSkills = useCallback(async (): Promise<void> => {
    if (desktopApi === null || state.importDiscovery === null) {
      return;
    }
    const scopeRequest = resolveScopeRequest(state.preferredScope, projectHintPath);
    const installed = await desktopApi.skills.importSkills({
      ...scopeRequest,
      source: {
        kind: "discovery",
        sourcePath: state.importDiscovery.sourcePath,
        itemIds: state.selectedImportPreviewIds
      }
    });
    await load();
    setState((current) => ({
      ...current,
      panelMode: "details",
      selectedSkillId: installed[0]?.skillId ?? current.selectedSkillId
    }));
  }, [desktopApi, load, projectHintPath, state.importDiscovery, state.preferredScope, state.selectedImportPreviewIds]);

  const updateCreateDraftField = useCallback(
    <K extends keyof SkillsCenterCreateDraft>(field: K, value: SkillsCenterCreateDraft[K]): void => {
      setState((current) => ({
        ...current,
        createDraft: {
          ...current.createDraft,
          [field]: value,
          ...(field === "name" && current.createDraft.content === labels.createDefaultContent
            ? { content: createDefaultSkillContent(String(value), current.createDraft.description) }
            : {}),
          ...(field === "description" && current.createDraft.content === labels.createDefaultContent
            ? { content: createDefaultSkillContent(current.createDraft.name, String(value)) }
            : {})
        }
      }));
    },
    [labels.createDefaultContent]
  );

  const createLyraSkill = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const draft = state.createDraft;
    if (draft.name.trim().length === 0 || draft.description.trim().length === 0 || draft.category.trim().length === 0) {
      setState((current) => ({
        ...current,
        errorMessage: labels.createDescription
      }));
      return;
    }
    const scopeRequest = resolveScopeRequest(state.preferredScope, projectHintPath);
    const created = await desktopApi.skills.createLyraSkill({
      ...scopeRequest,
      name: draft.name,
      description: draft.description,
      category: draft.category,
      skillType: draft.skillType,
      author: draft.author,
      triggerSummary: draft.triggerSummary,
      content: draft.content
    });
    await load();
    setState((current) => ({
      ...current,
      panelMode: "details",
      selectedSkillId: created.skillId,
      createDraft: createEmptySkillsDraft(labels)
    }));
  }, [desktopApi, labels, load, projectHintPath, state.createDraft, state.preferredScope]);

  const updateSkillState = useCallback(async (request: UpdateSkillStateRequest): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    await desktopApi.skills.updateSkillState(request);
    await load();
  }, [desktopApi, load]);

  const trustSkill = useCallback(async (skillId: string): Promise<void> => {
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    await updateSkillState({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot }),
      trustState: "trusted"
    });
  }, [state, updateSkillState]);

  const untrustSkill = useCallback(async (skillId: string): Promise<void> => {
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    await updateSkillState({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot }),
      trustState: "untrusted"
    });
  }, [state, updateSkillState]);

  const enableSkill = useCallback(async (skillId: string): Promise<void> => {
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    await updateSkillState({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot }),
      enableState: "enabled"
    });
  }, [state, updateSkillState]);

  const disableSkill = useCallback(async (skillId: string): Promise<void> => {
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    await updateSkillState({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot }),
      enableState: "disabled"
    });
  }, [state, updateSkillState]);

  const deleteSkill = useCallback(async (skillId: string): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    await desktopApi.skills.deleteSkill({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot })
    });
    await load();
    setState((current) => ({
      ...current,
      selectedSkillId: current.selectedSkillId === skillId ? null : current.selectedSkillId
    }));
  }, [desktopApi, load, state]);

  const readSkillDetails = useCallback(async (skillId: string): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const installedSkill = findInstalledSkillById(state, skillId);
    if (installedSkill === undefined) {
      return;
    }
    const details = await desktopApi.skills.readSkillDetails({
      scope: installedSkill.scope,
      skillId,
      ...(installedSkill.projectRoot === undefined
        ? {}
        : { projectRoot: installedSkill.projectRoot })
    });
    if (details === null) {
      return;
    }
    setState((current) => ({
      ...current,
      detailsBySkillId: {
        ...current.detailsBySkillId,
        [skillId]: details
        }
      }));
  }, [desktopApi, state]);

  return {
    state,
    load,
    selectSkill,
    selectCatalogItem,
    setPreferredScope,
    setStatusFilter,
    setSourceFilter,
    setCategoryFilter,
    openCatalog,
    openImport,
    openCreate,
    closePanelMode,
    setImportPath,
    discoverImportSource,
    toggleImportPreviewSelection,
    installCatalogSkill,
    importSelectedSkills,
    updateCreateDraftField,
    createLyraSkill,
    trustSkill,
    untrustSkill,
    enableSkill,
    disableSkill,
    deleteSkill,
    readSkillDetails
  };
};
