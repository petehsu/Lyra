import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type {
  EffectiveSkillConfig,
  InstalledSkillConfig,
  LyraSkillManifest,
  SkillCatalogItem,
  SkillDetails,
  SkillImportDiscovery,
  SkillImportPreviewItem,
  SkillRuntimeEvent
} from "../../../../shared/skills";
import { useSkillsCenterModel } from "../service";
import { selectVisibleSkills } from "../selectors";
import type { SkillsCenterLabels } from "../types";

const FIXED_NOW = "2026-03-28T00:00:00.000Z";
const PROJECT_ROOT = "/workspace/lyra";
const PROJECT_HINT = "/workspace/lyra/apps/desktop/src/main.ts";

const labels: SkillsCenterLabels = {
  title: "Skills Center",
  sidebarDescription: "desc",
  sidebarScope: "Scope",
  sidebarStatus: "Status",
  sidebarSources: "Sources",
  sidebarCategories: "Categories",
  sidebarBuiltin: "Built-in",
  sidebarInstalledGlobal: "Global",
  sidebarInstalledProject: "Project",
  scopeGlobal: "Global",
  scopeProject: "Project",
  scopeProjectUnavailable: "Unavailable",
  statusAll: "All",
  statusEnabled: "Enabled",
  statusDisabled: "Disabled",
  statusUntrusted: "Untrusted",
  sourceAll: "All Sources",
  sourceBuiltin: "Built-in",
  sourceLyra: "Lyra",
  sourceClaude: "Claude",
  sourceContinue: "Continue",
  toolbarInstalled: "Installed",
  toolbarInstalledDescription: "Installed description",
  actionOpenCatalog: "Open Catalog",
  actionOpenImport: "Open Import",
  actionOpenCreate: "Open Create",
  actionRefresh: "Refresh",
  actionInstallBuiltin: "Install Built-in",
  actionDiscoverImport: "Discover",
  actionImportSelected: "Import Selected",
  actionCreateSkill: "Create Skill",
  actionCancel: "Cancel",
  actionTrust: "Trust",
  actionUntrust: "Untrust",
  actionEnable: "Enable",
  actionDisable: "Disable",
  actionDelete: "Delete",
  actionViewDetails: "View Details",
  catalog: "Catalog",
  details: "Details",
  importTitle: "Import",
  importDescription: "Import description",
  createTitle: "Create",
  createDescription: "Create description",
  fieldName: "Name",
  fieldDescription: "Description",
  fieldCategory: "Category",
  fieldAuthor: "Author",
  fieldSkillType: "Skill Type",
  fieldTriggerSummary: "Trigger",
  fieldContent: "Content",
  fieldSource: "Source",
  fieldVersion: "Version",
  fieldTrust: "Trust",
  fieldEnable: "Enable",
  fieldFiles: "Files",
  fieldScripts: "Scripts",
  fieldCompatibility: "Compatibility",
  fieldEntry: "Entry",
  fieldPath: "Path",
  fieldLastError: "Last Error",
  fieldPackagePath: "Package Path",
  fieldOverride: "Override",
  fieldContentPreview: "Content Preview",
  importPathLabel: "Import Path",
  importPathPlaceholder: "/path",
  importPreviewTitle: "Preview",
  importPreviewEmpty: "Empty",
  importPreviewScripts: "Scripts",
  importPreviewResources: "Resources",
  importPreviewErrors: "Errors",
  emptySelection: "No selection",
  emptyInstalled: "No installed",
  emptyCatalog: "No catalog",
  emptyImport: "No import",
  typePrompt: "Prompt",
  typeWorkflow: "Workflow",
  typeResource: "Resource",
  typeToolGuidance: "Tool Guidance",
  trustTrusted: "Trusted",
  trustUntrusted: "Untrusted",
  enableEnabled: "Enabled",
  enableDisabled: "Disabled",
  overrideInherited: "Inherited",
  overrideProjectOnly: "Project only",
  overrideGlobalOnly: "Global only",
  untrustedWarning: "Untrusted warning",
  createDefaultContent: "# New Skill\n\nDescribe it.\n"
};

const createManifest = (
  overrides: Partial<LyraSkillManifest> & Pick<LyraSkillManifest, "id" | "name" | "description">
): LyraSkillManifest => ({
  id: overrides.id,
  name: overrides.name,
  version: overrides.version ?? "1.0.0",
  description: overrides.description,
  category: overrides.category ?? "automation",
  iconKey: overrides.iconKey ?? "sparkles",
  sourceKind: overrides.sourceKind ?? "builtin",
  skillType: overrides.skillType ?? "prompt",
  entryPath: overrides.entryPath ?? "SKILL.md",
  assets: overrides.assets ?? [],
  scripts: overrides.scripts ?? [],
  permissions: overrides.permissions ?? [],
  compatibility: overrides.compatibility ?? {
    sourceKind: overrides.sourceKind ?? "builtin",
    detectedFrom: [overrides.sourceKind ?? "builtin"],
    notes: [],
    parseErrors: []
  },
  ...(overrides.author === undefined ? {} : { author: overrides.author }),
  ...(overrides.triggerSummary === undefined
    ? {}
    : { triggerSummary: overrides.triggerSummary })
});

const createInstalledSkill = (
  overrides: Partial<InstalledSkillConfig> &
    Pick<InstalledSkillConfig, "skillId" | "scope" | "manifest" | "packagePath">
): InstalledSkillConfig => ({
  skillId: overrides.skillId,
  scope: overrides.scope,
  manifest: overrides.manifest,
  packagePath: overrides.packagePath,
  trustState: overrides.trustState ?? "untrusted",
  enableState: overrides.enableState ?? "disabled",
  installedAt: overrides.installedAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
  sourceSummary: overrides.sourceSummary ?? overrides.manifest.assets,
  ...(overrides.projectRoot === undefined ? {} : { projectRoot: overrides.projectRoot }),
  ...(overrides.sourcePath === undefined ? {} : { sourcePath: overrides.sourcePath }),
  ...(overrides.lastError === undefined ? {} : { lastError: overrides.lastError })
});

const toEffectiveSkill = (
  skill: InstalledSkillConfig,
  overrides?: Partial<EffectiveSkillConfig>
): EffectiveSkillConfig => ({
  ...skill,
  effectiveScope: overrides?.effectiveScope ?? skill.scope,
  inheritedFromGlobal: overrides?.inheritedFromGlobal ?? false,
  overriddenFields: overrides?.overriddenFields ?? []
});

const catalogItem: SkillCatalogItem = {
  ...createManifest({
    id: "repo-scout",
    name: "Repo Scout",
    description: "Inspect repositories quickly",
    sourceKind: "builtin",
    skillType: "workflow"
  }),
  featured: true,
  official: true
};

const globalSkill = createInstalledSkill({
  skillId: "repo-scout",
  scope: "global",
  manifest: catalogItem,
  packagePath: "/skills/packages/global/repo-scout",
  trustState: "trusted",
  enableState: "enabled"
});

const projectSkill = createInstalledSkill({
  skillId: "continue-rules",
  scope: "project",
  projectRoot: PROJECT_ROOT,
  manifest: createManifest({
    id: "continue-rules",
    name: "Continue Rules",
    description: "Imported rules",
    sourceKind: "continue",
    category: "project"
  }),
  packagePath: "/skills/packages/project/continue-rules"
});

const discoveryPreview: SkillImportPreviewItem = {
  previewId: "claude-research-kit",
  manifest: createManifest({
    id: "claude-research-kit",
    name: "Claude Research Kit",
    description: "Imported from Claude",
    sourceKind: "claude",
    skillType: "resource",
    assets: [{ path: "notes.md", kind: "resource" }],
    scripts: ["run.sh"]
  }),
  sourcePath: "/imports/claude-research-kit",
  hasScripts: true,
  hasResources: true,
  parseErrors: []
};

const createSkillsDesktopApi = () => {
  let globalSkills: readonly InstalledSkillConfig[] = [globalSkill];
  let projectSkills: readonly InstalledSkillConfig[] = [projectSkill];
  const listeners = new Set<(event: SkillRuntimeEvent) => void>();

  const readCatalog = vi.fn(async () => [catalogItem]);
  const readInstalled = vi.fn(
    async ({ scope }: { readonly scope: "global" | "project"; readonly projectRoot?: string }) =>
      scope === "project" ? projectSkills : globalSkills
  );
  const readEffectiveSkills = vi.fn(async () => ({
    resolvedProjectRoot: PROJECT_ROOT,
    skills: [
      toEffectiveSkill(globalSkill, { effectiveScope: "global" }),
      toEffectiveSkill(projectSkill, { effectiveScope: "project" })
    ]
  }));
  const discoverImportSource = vi.fn(async () => ({
    sourcePath: "/imports",
    detectedKind: "claude-plugin",
    sourceKind: "claude",
    summary: "1 skill discovered",
    previewItems: [discoveryPreview],
    parseErrors: []
  } satisfies SkillImportDiscovery));
  const importSkills = vi.fn(async (request) => {
    if (request.source.kind === "catalog") {
      const installed = createInstalledSkill({
        skillId: request.source.itemIds[0]!,
        scope: request.scope,
        manifest: catalogItem,
        packagePath: `/skills/packages/${request.scope}/${request.source.itemIds[0]!}`,
        ...(request.projectRoot === undefined ? {} : { projectRoot: request.projectRoot })
      });
      if (request.scope === "project") {
        projectSkills = [installed];
      } else {
        globalSkills = [...globalSkills, installed];
      }
      return [installed];
    }

    const installed = createInstalledSkill({
      skillId: request.source.itemIds[0]!,
      scope: request.scope,
      manifest: discoveryPreview.manifest,
      packagePath: `/skills/packages/${request.scope}/${request.source.itemIds[0]!}`,
      sourcePath: discoveryPreview.sourcePath,
      sourceSummary: discoveryPreview.manifest.assets,
      ...(request.projectRoot === undefined ? {} : { projectRoot: request.projectRoot })
    });
    if (request.scope === "project") {
      projectSkills = [...projectSkills, installed];
    } else {
      globalSkills = [...globalSkills, installed];
    }
    return [installed];
  });
  const createLyraSkill = vi.fn(async (request) =>
    createInstalledSkill({
      skillId: "lyra-skill-1",
      scope: request.scope,
      manifest: createManifest({
        id: "lyra-skill-1",
        name: request.name,
        description: request.description,
        sourceKind: "lyra",
        category: request.category,
        skillType: request.skillType
      }),
      packagePath: "/skills/packages/global/lyra-skill-1",
      ...(request.projectRoot === undefined ? {} : { projectRoot: request.projectRoot })
    })
  );
  const updateSkillState = vi.fn(async () => undefined);
  const deleteSkill = vi.fn(async () => undefined);
  const readSkillDetails = vi.fn(async ({ skillId }) => {
    const found = [...globalSkills, ...projectSkills].find((skill) => skill.skillId === skillId);
    if (found === undefined) {
      return null;
    }
    return {
      ...found,
      contentPreview: "# Preview"
    } satisfies SkillDetails;
  });

  return {
    desktopApi: {
      skills: {
        readCatalog,
        readInstalled,
        readEffectiveSkills,
        discoverImportSource,
        importSkills,
        createLyraSkill,
        updateSkillState,
        deleteSkill,
        readSkillDetails,
        onEvent: (listener: (event: SkillRuntimeEvent) => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }
      }
    } as unknown as LyraDesktopApi,
    readCatalog,
    readInstalled,
    readEffectiveSkills,
    discoverImportSource,
    importSkills,
    createLyraSkill,
    updateSkillState,
    deleteSkill,
    readSkillDetails
  };
};

describe("skills center model", () => {
  test("filters visible skills by status, source, and category", () => {
    const state = {
      preferredScope: "global",
      statusFilter: "enabled",
      sourceFilter: "builtin",
      categoryFilter: "automation",
      globalSkills: [globalSkill],
      projectSkills: [projectSkill]
    } as const;

    expect(selectVisibleSkills(state)).toEqual([globalSkill]);
  });

  test("loads installed skills and installs a built-in skill into the selected scope", async () => {
    const { desktopApi, importSkills } = createSkillsDesktopApi();
    const { result } = renderHook(() =>
      useSkillsCenterModel({
        desktopApi,
        projectHintPath: PROJECT_HINT,
        labels
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.openCatalog();
    });

    await act(async () => {
      await result.current.installCatalogSkill("repo-scout");
    });

    expect(importSkills).toHaveBeenCalledWith({
      scope: "global",
      source: {
        kind: "catalog",
        itemIds: ["repo-scout"]
      }
    });
    expect(result.current.state.panelMode).toBe("details");
    expect(result.current.state.selectedSkillId).toBe("repo-scout");
  });

  test("uses the installed skill scope when reading details and enabling a project skill", async () => {
    const { desktopApi, readSkillDetails, updateSkillState } = createSkillsDesktopApi();
    const { result } = renderHook(() =>
      useSkillsCenterModel({
        desktopApi,
        projectHintPath: PROJECT_HINT,
        labels
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.setPreferredScope("global");
    });

    await act(async () => {
      await result.current.readSkillDetails("continue-rules");
    });

    expect(readSkillDetails).toHaveBeenCalledWith({
      scope: "project",
      projectRoot: PROJECT_ROOT,
      skillId: "continue-rules"
    });

    await act(async () => {
      await result.current.enableSkill("continue-rules");
    });

    expect(updateSkillState).toHaveBeenCalledWith({
      scope: "project",
      projectRoot: PROJECT_ROOT,
      skillId: "continue-rules",
      enableState: "enabled"
    });
  });

  test("discovers and imports selected Claude skills", async () => {
    const { desktopApi, discoverImportSource, importSkills } = createSkillsDesktopApi();
    const { result } = renderHook(() =>
      useSkillsCenterModel({
        desktopApi,
        projectHintPath: PROJECT_HINT,
        labels
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.openImport();
      result.current.setImportPath("/imports");
    });

    await act(async () => {
      await result.current.discoverImportSource();
    });

    expect(discoverImportSource).toHaveBeenCalledWith("/imports");
    expect(result.current.state.importDiscovery?.previewItems).toHaveLength(1);

    await act(async () => {
      await result.current.importSelectedSkills();
    });

    expect(importSkills).toHaveBeenCalledWith({
      scope: "global",
      source: {
        kind: "discovery",
        sourcePath: "/imports",
        itemIds: ["claude-research-kit"]
      }
    });
  });
});
