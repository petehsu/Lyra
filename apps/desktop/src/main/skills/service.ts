import { BrowserWindow, ipcMain } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  CreateLyraSkillRequest,
  DeleteSkillRequest,
  EffectiveSkillConfig,
  InstalledSkillConfig,
  ReadEffectiveSkillsRequest,
  ReadInstalledSkillsRequest,
  SkillCatalogItem,
  SkillDetails,
  SkillImportDiscovery,
  SkillImportRequest,
  SkillRuntimeEvent,
  SkillRequest,
  SkillScope,
  SkillType,
  UpdateSkillStateRequest
} from "../../shared/skills";
import type {
  BuiltinSkillDefinition,
  BuiltinSkillPackage,
  PersistedSkillsDocument,
  SkillsEventPublisher,
  SkillsIpcBridge
} from "./types";
import type { FilesNativeBindings } from "../files/types";
import { createWorkbenchFsPort, type WorkbenchFsPort } from "../runtime/workbench-fs-port";
import { loadSkillsNativeBindings } from "./native-loader";

const GLOBAL_SCOPE: SkillScope = "global";
const PROJECT_SCOPE: SkillScope = "project";

const nowIso = (): string => new Date().toISOString();

const resolveExistingWorkbenchPath = (
  workbenchFsPort: WorkbenchFsPort,
  value: string | undefined
): string | undefined => workbenchFsPort.probePath(value)?.existingPath;

const resolveProjectRoot = (
  workbenchFsPort: WorkbenchFsPort,
  projectRootHint: string | undefined
): string | undefined => workbenchFsPort.probePath(projectRootHint)?.projectRoot;

const buildDefaultDocument = (
  scope: SkillScope,
  projectRoot?: string
): PersistedSkillsDocument => ({
  version: 1,
  scope,
  ...(projectRoot === undefined ? {} : { projectRoot }),
  skills: []
});

const withResolvedScope = (
  workbenchFsPort: WorkbenchFsPort,
  scope: SkillScope,
  projectRootHint?: string
): { readonly scope: SkillScope; readonly projectRoot?: string } => {
  if (scope === GLOBAL_SCOPE) {
    return { scope };
  }
  const projectRoot = resolveProjectRoot(workbenchFsPort, projectRootHint);
  if (projectRoot === undefined) {
    throw new Error("project scope is unavailable until Lyra can resolve a project root");
  }
  return {
    scope,
    projectRoot
  };
};

const buildBuiltinSkillDefinitions = (): readonly BuiltinSkillDefinition[] => {
  const repoScoutFiles = {
    "SKILL.md": `---\nname: repo-scout\ndescription: Build a fast mental model of a repository before editing or planning. Use when the user needs a concise architecture read, module map, or codebase orientation.\n---\n\n# Repo Scout\n\n1. Map the main modules first.\n2. Highlight entrypoints, services, and shared contracts.\n3. End with risks and likely extension points.\n`,
    "resources/checklist.md": "- Entry points\n- State models\n- Shared bridges\n- Native boundaries\n"
  } as const;
  const releaseChecklistFiles = {
    "SKILL.md": `---\nname: release-checklist\ndescription: Prepare a release checklist for desktop or web deliverables. Use when the user needs a reliable packaging, QA, or rollout checklist.\n---\n\n# Release Checklist\n\nWork through build validation, artifact checks, QA, docs, and rollback readiness.\n`,
    "templates/release.md": "# Release\n\n- Validate builds\n- Run smoke checks\n- Verify docs\n- Confirm rollback path\n"
  } as const;
  const mcpBuilderFiles = {
    "SKILL.md": `---\nname: mcp-builder\ndescription: Design and configure MCP integrations with clear permissions, transport choices, and runtime expectations. Use when the user wants to add or review MCP services.\n---\n\n# MCP Builder\n\nFocus on transport, permissions, runtime ownership, and validation coverage.\n`,
    "notes/runtime.md": "Prefer scoped permissions and explicit validation before enabling a new MCP server.\n"
  } as const;
  const docsPolishFiles = {
    "SKILL.md": `---\nname: docs-polish\ndescription: Tighten product documentation for clarity, hierarchy, and consistency. Use when docs need to be cleaner, shorter, or more publishable without losing substance.\n---\n\n# Docs Polish\n\nPrefer concise, product-grade language and remove web-style filler.\n`
  } as const;

  const createBuiltin = (
    id: string,
    name: string,
    description: string,
    category: string,
    iconKey: string,
    files: Readonly<Record<string, string>>,
    skillType: SkillType,
    triggerSummary: string
  ): BuiltinSkillDefinition => ({
    id,
    name,
    description,
    category,
    iconKey,
    files,
    skillType,
    triggerSummary
  });

  return [
    createBuiltin(
      "repo-scout",
      "Repo Scout",
      "Build a fast mental model of a repository before editing or planning.",
      "Development",
      "folder-search",
      repoScoutFiles,
      "prompt",
      "Repository orientation and architectural reading"
    ),
    createBuiltin(
      "release-checklist",
      "Release Checklist",
      "Prepare repeatable release checklists for desktop and web shipping workflows.",
      "Operations",
      "clipboard-check",
      releaseChecklistFiles,
      "workflow",
      "Packaging, QA, and rollout checklists"
    ),
    createBuiltin(
      "mcp-builder",
      "MCP Builder",
      "Guide the design and review of MCP integrations with safe defaults.",
      "AI Infrastructure",
      "plug-zap",
      mcpBuilderFiles,
      "tool-guidance",
      "MCP design and review guidance"
    ),
    createBuiltin(
      "docs-polish",
      "Docs Polish",
      "Refine product documentation into concise, structured publishing-ready text.",
      "Documentation",
      "file-text",
      docsPolishFiles,
      "prompt",
      "Documentation refinement and polishing"
    )
  ] as const;
};

const BUILTIN_SKILL_DEFINITIONS = buildBuiltinSkillDefinitions();

const buildBuiltinCatalog = (
  definitions: readonly BuiltinSkillDefinition[],
  buildBuiltinSkillsCatalogJson: (requestJson: string) => string
): readonly SkillCatalogItem[] =>
  JSON.parse(
    buildBuiltinSkillsCatalogJson(
      JSON.stringify({
        items: definitions
      })
    )
  ) as readonly SkillCatalogItem[];

const buildBuiltinPackages = (
  definitions: readonly BuiltinSkillDefinition[],
  catalog: readonly SkillCatalogItem[]
): readonly BuiltinSkillPackage[] => {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  return definitions.flatMap((definition) => {
    const catalogItem = catalogById.get(definition.id);
    if (catalogItem === undefined) {
      return [];
    }
    return [
      {
        catalog: catalogItem,
        files: definition.files
      }
    ];
  });
};

const discoverImportSource = async (
  nativeDiscover: (requestJson: string) => string,
  sourcePath: string
): Promise<SkillImportDiscovery> =>
  JSON.parse(
    nativeDiscover(
      JSON.stringify({
        sourcePath
      })
    )
  ) as SkillImportDiscovery;

export const createSkillsIpcBridge = ({
  storageRoot,
  getWindow,
  filesNativeBindings
}: {
  readonly storageRoot: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly filesNativeBindings: FilesNativeBindings;
}): SkillsIpcBridge => {
  const workbenchFsPort = createWorkbenchFsPort(filesNativeBindings);
  const nativeLoadResult = loadSkillsNativeBindings();
  if (nativeLoadResult.ok === false) {
    throw new Error(
      `skills native unavailable: ${nativeLoadResult.errorMessage}\ntried paths:\n${nativeLoadResult.triedPaths.join("\n")}`
    );
  }
  const nativeBindings = nativeLoadResult.bindings;
  const builtinCatalog = buildBuiltinCatalog(
    BUILTIN_SKILL_DEFINITIONS,
    nativeBindings.buildBuiltinSkillsCatalogJson
  );
  const builtinPackages = buildBuiltinPackages(BUILTIN_SKILL_DEFINITIONS, builtinCatalog);

  const publish: SkillsEventPublisher = (event) => {
    const window = getWindow();
    window?.webContents.send(LYRA_CHANNELS.skillsEvent, event);
  };

  const readInstalled = async (
    scope: SkillScope,
    projectRootHint?: string
  ): Promise<readonly InstalledSkillConfig[]> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, scope, projectRootHint);
    const document = JSON.parse(
      nativeBindings.readSkillsScopeDocumentJson(
        JSON.stringify({
          storageRoot,
          scope: resolvedScope.scope,
          ...(resolvedScope.projectRoot === undefined
            ? {}
            : { projectRoot: resolvedScope.projectRoot })
        })
      )
    ) as PersistedSkillsDocument;
    return document.skills;
  };

  const readEffective = async (
    request?: ReadEffectiveSkillsRequest
  ): Promise<readonly EffectiveSkillConfig[]> => {
    const resolvedProjectRoot = resolveProjectRoot(workbenchFsPort, request?.projectRoot);
    const globalDocument = JSON.parse(
      nativeBindings.readSkillsScopeDocumentJson(
        JSON.stringify({
          storageRoot,
          scope: GLOBAL_SCOPE
        })
      )
    ) as PersistedSkillsDocument;
    const projectDocument =
      resolvedProjectRoot === undefined
        ? buildDefaultDocument(PROJECT_SCOPE)
        : (JSON.parse(
            nativeBindings.readSkillsScopeDocumentJson(
              JSON.stringify({
                storageRoot,
                scope: PROJECT_SCOPE,
                projectRoot: resolvedProjectRoot
              })
            )
          ) as PersistedSkillsDocument);
    const effectiveResult = JSON.parse(
      nativeBindings.mergeEffectiveSkillsJson(
        JSON.stringify({
          ...(resolvedProjectRoot === undefined ? {} : { resolvedProjectRoot }),
          globalDocument,
          projectDocument
        })
      )
    ) as {
      readonly skills: readonly EffectiveSkillConfig[];
    };
    return effectiveResult.skills;
  };

  const installSkills = async (request: SkillImportRequest): Promise<readonly InstalledSkillConfig[]> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
    const installed = JSON.parse(
      nativeBindings.installSkillsJson(
        JSON.stringify({
          storageRoot,
          scope: resolvedScope.scope,
          ...(resolvedScope.projectRoot === undefined
            ? {}
            : { projectRoot: resolvedScope.projectRoot }),
          nowIso: nowIso(),
          source:
            request.source.kind === "catalog"
              ? {
                  kind: "catalog",
                  itemIds: request.source.itemIds,
                  packages: builtinPackages
                }
              : {
                  kind: "discovery",
                  itemIds: request.source.itemIds,
                  discovery: await discoverImportSource(
                    nativeBindings.discoverSkillsImportSourceJson,
                    request.source.sourcePath
                  )
                }
        })
      )
    ) as {
      readonly installed: readonly InstalledSkillConfig[];
    };

    publish({
      kind: "install",
      scope: resolvedScope.scope,
      skillIds: installed.installed.map((skill) => skill.skillId),
      timestamp: nowIso()
    });
    return installed.installed;
  };

  const createLyraSkill = async (request: CreateLyraSkillRequest): Promise<InstalledSkillConfig> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
    const result = JSON.parse(
      nativeBindings.createAndInstallLyraSkillJson(
        JSON.stringify({
          storageRoot,
          scope: resolvedScope.scope,
          ...(resolvedScope.projectRoot === undefined
            ? {}
            : { projectRoot: resolvedScope.projectRoot }),
          name: request.name,
          description: request.description,
          category: request.category,
          ...(request.iconKey === undefined ? {} : { iconKey: request.iconKey }),
          skillType: request.skillType,
          ...(request.content === undefined ? {} : { content: request.content }),
          ...(request.version === undefined ? {} : { version: request.version }),
          ...(request.author === undefined ? {} : { author: request.author }),
          ...(request.triggerSummary === undefined
            ? {}
            : { triggerSummary: request.triggerSummary }),
          nowIso: nowIso()
        })
      )
    ) as {
      readonly skill: InstalledSkillConfig;
    };

    publish({
      kind: "install",
      scope: resolvedScope.scope,
      skillIds: [result.skill.skillId],
      timestamp: result.skill.updatedAt
    });
    return result.skill;
  };

  const updateSkillState = async (request: UpdateSkillStateRequest): Promise<InstalledSkillConfig> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
    const result = JSON.parse(
      nativeBindings.updateInstalledSkillStateInStorageJson(
        JSON.stringify({
          storageRoot,
          scope: resolvedScope.scope,
          ...(resolvedScope.projectRoot === undefined
            ? {}
            : { projectRoot: resolvedScope.projectRoot }),
          skillId: request.skillId,
          ...(request.trustState === undefined ? {} : { trustState: request.trustState }),
          ...(request.enableState === undefined ? {} : { enableState: request.enableState }),
          updatedAt: nowIso()
        })
      )
    ) as {
      readonly skill: InstalledSkillConfig;
    };

    publish({
      kind: "state-change",
      scope: resolvedScope.scope,
      skillId: result.skill.skillId,
      trustState: result.skill.trustState,
      enableState: result.skill.enableState,
      timestamp: result.skill.updatedAt
    });
    return result.skill;
  };

  const deleteSkill = async (request: DeleteSkillRequest): Promise<void> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
    nativeBindings.removeInstalledSkillInStorageJson(
      JSON.stringify({
        storageRoot,
        scope: resolvedScope.scope,
        ...(resolvedScope.projectRoot === undefined
          ? {}
          : { projectRoot: resolvedScope.projectRoot }),
        skillId: request.skillId
      })
    );
  };

  const readSkillDetails = async (request: SkillRequest): Promise<SkillDetails | null> => {
    try {
      const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
      return JSON.parse(
        nativeBindings.readInstalledSkillDetailsJson(
          JSON.stringify({
            storageRoot,
            scope: resolvedScope.scope,
            ...(resolvedScope.projectRoot === undefined
              ? {}
              : { projectRoot: resolvedScope.projectRoot }),
            skillId: request.skillId,
            maxChars: 1600
          })
        )
      ) as SkillDetails | null;
    } catch (_error) {
      return null;
    }
  };

  ipcMain.handle(LYRA_CHANNELS.skillsReadCatalog, async () => builtinCatalog);
  ipcMain.handle(
    LYRA_CHANNELS.skillsReadInstalled,
    async (_event, request: ReadInstalledSkillsRequest) => readInstalled(request.scope, request.projectRoot)
  );
  ipcMain.handle(
    LYRA_CHANNELS.skillsReadEffective,
    async (_event, request?: ReadEffectiveSkillsRequest) => readEffective(request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.skillsDiscoverImportSource,
    async (_event, sourcePath: string) =>
      discoverImportSource(
        nativeBindings.discoverSkillsImportSourceJson,
        resolveExistingWorkbenchPath(workbenchFsPort, sourcePath) ?? sourcePath
      )
  );
  ipcMain.handle(LYRA_CHANNELS.skillsImport, async (_event, request: SkillImportRequest) => {
    return await installSkills(request);
  });
  ipcMain.handle(
    LYRA_CHANNELS.skillsCreateLyraSkill,
    async (_event, request: CreateLyraSkillRequest) => await createLyraSkill(request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.skillsUpdateState,
    async (_event, request: UpdateSkillStateRequest) => await updateSkillState(request)
  );
  ipcMain.handle(LYRA_CHANNELS.skillsDelete, async (_event, request: DeleteSkillRequest) => {
    await deleteSkill(request);
  });
  ipcMain.handle(
    LYRA_CHANNELS.skillsReadDetails,
    async (_event, request: SkillRequest) => readSkillDetails(request)
  );
  return {
    dispose: async () => {
      ipcMain.removeHandler(LYRA_CHANNELS.skillsReadCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsReadInstalled);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsReadEffective);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsDiscoverImportSource);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsImport);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsCreateLyraSkill);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsUpdateState);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsDelete);
      ipcMain.removeHandler(LYRA_CHANNELS.skillsReadDetails);
    }
  };
};
