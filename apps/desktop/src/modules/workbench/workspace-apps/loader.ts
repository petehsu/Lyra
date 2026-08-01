import type { LyraAppModule } from "@lyra/app-runtime";

import type { ComponentsApi } from "../../../shared/desktop-bridge";
import {
  hydrateWorkspaceAppVersionState,
  isWorkspaceProductComponent,
  isWorkspaceAppModuleLoaded,
  isWorkspaceAppModuleSurfaceCapable,
  registerWorkspaceAppModule
} from "./registry";

type ModuleNamespace = {
  readonly default?: unknown;
  readonly lyraAppModule?: unknown;
};

type ModuleImporter = (url: string) => Promise<ModuleNamespace>;

export type WorkspaceAppModuleSyncIssue = {
  readonly componentId: string;
  readonly message: string;
};

const inFlight = new Map<string, Promise<void>>();

const importModule: ModuleImporter = async (url) =>
  import(/* @vite-ignore */ url) as Promise<ModuleNamespace>;

const moduleKey = (componentId: string, version: string): string =>
  `${componentId}@${version}`;

export const loadInstalledWorkspaceAppModule = async ({
  components,
  componentId,
  version,
  importer = importModule
}: {
  readonly components: ComponentsApi;
  readonly componentId: string;
  readonly version: string;
  readonly importer?: ModuleImporter;
}): Promise<void> => {
  if (
    isWorkspaceAppModuleLoaded(componentId, version)
    && isWorkspaceAppModuleSurfaceCapable(componentId, version)
  ) {
    return;
  }
  const key = moduleKey(componentId, version);
  const existing = inFlight.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const loading = (async () => {
    const runtime = await components.resolveAppModule({ componentId, version });
    if (runtime.componentId !== componentId || runtime.version !== version) {
      throw new Error(`Resolved workspace app identity mismatch: ${componentId}@${version}`);
    }
    const namespace = await importer(runtime.entryUrl);
    const candidate = namespace.lyraAppModule ?? namespace.default;
    if (
      typeof candidate !== "object"
      || candidate === null
      || (candidate as Partial<LyraAppModule>).id !== componentId
      || (candidate as Partial<LyraAppModule>).version !== version
    ) {
      throw new Error(`Workspace app entry exported the wrong module: ${componentId}@${version}`);
    }
    if (
      typeof (candidate as Partial<LyraAppModule>).mount !== "function"
      || typeof (candidate as Partial<LyraAppModule>).unmount !== "function"
    ) {
      throw new Error(
        `Installed workspace app has no independently mountable surface: ${componentId}@${version}`
      );
    }
    if (!isWorkspaceAppModuleSurfaceCapable(componentId, version)) {
      registerWorkspaceAppModule(candidate, {
        allowedCapabilities: new Set(runtime.permissions),
        replaceFallback: true
      });
    }
  })();
  inFlight.set(key, loading);
  try {
    await loading;
  } finally {
    if (inFlight.get(key) === loading) {
      inFlight.delete(key);
    }
  }
};

export const synchronizeInstalledWorkspaceAppModules = async ({
  components,
  importer = importModule
}: {
  readonly components: ComponentsApi;
  readonly importer?: ModuleImporter;
}): Promise<readonly WorkspaceAppModuleSyncIssue[]> => {
  const installed = await components.list();
  const issues: WorkspaceAppModuleSyncIssue[] = [];
  for (const component of installed) {
    if (component.kind !== "app" || !isWorkspaceProductComponent(component.componentId)) {
      continue;
    }
    try {
      const versions = [...new Set([
        component.active,
        component.previous,
        component.pending
      ].filter((version): version is string => version !== undefined))];
      for (const version of versions) {
        await loadInstalledWorkspaceAppModule({
          components,
          componentId: component.componentId,
          version,
          importer
        });
      }
      hydrateWorkspaceAppVersionState(component.componentId, {
        ...(component.active === undefined ? {} : { active: component.active }),
        ...(component.previous === undefined ? {} : { previous: component.previous }),
        ...(component.pending === undefined ? {} : { pending: component.pending })
      });
    } catch (error) {
      issues.push({
        componentId: component.componentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return issues;
};
