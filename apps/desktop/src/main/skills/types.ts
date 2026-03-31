import type {
  SkillFileSummary,
  InstalledSkillConfig,
  SkillImportDiscovery,
  SkillCatalogItem,
  SkillRuntimeEvent,
  SkillScope
} from "../../shared/skills";

export type PersistedSkillsDocument = {
  readonly version: 1;
  readonly scope: SkillScope;
  readonly projectRoot?: string;
  readonly skills: readonly InstalledSkillConfig[];
};

export type BuiltinSkillPackage = {
  readonly catalog: SkillCatalogItem;
  readonly files: Readonly<Record<string, string>>;
};

export type BuiltinSkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly iconKey: string;
  readonly files: Readonly<Record<string, string>>;
  readonly skillType: "prompt" | "workflow" | "resource" | "tool-guidance";
  readonly triggerSummary: string;
};

export type SkillsIpcBridge = {
  readonly dispose: () => Promise<void>;
};

export type SkillsEventPublisher = (event: SkillRuntimeEvent) => void;

export type SkillsNativeBindings = {
  readonly collectSkillFileSummariesJson: (requestJson: string) => string;
  readonly discoverSkillsImportSourceJson: (requestJson: string) => string;
  readonly buildBuiltinSkillsCatalogJson: (requestJson: string) => string;
  readonly copySkillPackageJson: (requestJson: string) => void;
  readonly writeBuiltinSkillPackageJson: (requestJson: string) => void;
  readonly createLyraSkillPackageJson: (requestJson: string) => string;
  readonly readSkillContentPreviewJson: (requestJson: string) => string;
  readonly readSkillsScopeDocumentJson: (requestJson: string) => string;
  readonly writeSkillsScopeDocumentJson: (requestJson: string) => void;
  readonly mergeEffectiveSkillsJson: (requestJson: string) => string;
  readonly updateInstalledSkillStateJson: (requestJson: string) => string;
  readonly removeInstalledSkillJson: (requestJson: string) => string;
  readonly installSkillsJson: (requestJson: string) => string;
  readonly createAndInstallLyraSkillJson: (requestJson: string) => string;
  readonly updateInstalledSkillStateInStorageJson: (requestJson: string) => string;
  readonly removeInstalledSkillInStorageJson: (requestJson: string) => string;
  readonly readInstalledSkillDetailsJson: (requestJson: string) => string;
};

export type SkillsNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: SkillsNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type SkillsFileSummaryCollectionResult = readonly SkillFileSummary[];

export type SkillsImportDiscoveryResult = SkillImportDiscovery;
