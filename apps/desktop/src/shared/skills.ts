export type SkillId = string;

export type SkillScope = "global" | "project";

export type SkillSourceKind = "builtin" | "lyra" | "claude" | "continue";

export type SkillType = "prompt" | "workflow" | "resource" | "tool-guidance";

export type SkillTrustState = "untrusted" | "trusted";

export type SkillEnableState = "enabled" | "disabled";

export type SkillFileKind = "script" | "resource" | "template" | "document";

export type SkillFileSummary = {
  readonly path: string;
  readonly kind: SkillFileKind;
  readonly size?: number;
};

export type SkillCompatibility = {
  readonly sourceKind: SkillSourceKind;
  readonly detectedFrom: readonly string[];
  readonly notes: readonly string[];
  readonly parseErrors: readonly string[];
  readonly strict?: boolean;
};

export type LyraSkillManifest = {
  readonly id: SkillId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: string;
  readonly iconKey: string;
  readonly sourceKind: SkillSourceKind;
  readonly skillType: SkillType;
  readonly entryPath: string;
  readonly author?: string;
  readonly triggerSummary?: string;
  readonly assets: readonly SkillFileSummary[];
  readonly scripts: readonly string[];
  readonly permissions: readonly string[];
  readonly compatibility: SkillCompatibility;
};

export type SkillCatalogItem = LyraSkillManifest & {
  readonly featured: boolean;
  readonly official: boolean;
};

export type InstalledSkillConfig = {
  readonly skillId: SkillId;
  readonly scope: SkillScope;
  readonly projectRoot?: string;
  readonly manifest: LyraSkillManifest;
  readonly packagePath: string;
  readonly sourcePath?: string;
  readonly trustState: SkillTrustState;
  readonly enableState: SkillEnableState;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
  readonly sourceSummary: readonly SkillFileSummary[];
};

export type EffectiveSkillConfig = InstalledSkillConfig & {
  readonly effectiveScope: SkillScope;
  readonly inheritedFromGlobal: boolean;
  readonly overriddenFields: readonly string[];
};

export type SkillImportDetectedKind =
  | "claude-skill"
  | "claude-plugin"
  | "continue"
  | "unknown";

export type SkillImportPreviewItem = {
  readonly previewId: string;
  readonly manifest: LyraSkillManifest;
  readonly sourcePath: string;
  readonly hasScripts: boolean;
  readonly hasResources: boolean;
  readonly parseErrors: readonly string[];
};

export type SkillImportDiscovery = {
  readonly sourcePath: string;
  readonly detectedKind: SkillImportDetectedKind;
  readonly sourceKind: SkillSourceKind | "unknown";
  readonly summary: string;
  readonly previewItems: readonly SkillImportPreviewItem[];
  readonly parseErrors: readonly string[];
};

export type ReadInstalledSkillsRequest = {
  readonly scope: SkillScope;
  readonly projectRoot?: string;
};

export type ReadEffectiveSkillsRequest = {
  readonly projectRoot?: string;
};

export type SkillImportRequest =
  | {
      readonly scope: SkillScope;
      readonly projectRoot?: string;
      readonly source: {
        readonly kind: "catalog";
        readonly itemIds: readonly string[];
      };
    }
  | {
      readonly scope: SkillScope;
      readonly projectRoot?: string;
      readonly source: {
        readonly kind: "discovery";
        readonly sourcePath: string;
        readonly itemIds: readonly string[];
      };
    };

export type CreateLyraSkillRequest = {
  readonly scope: SkillScope;
  readonly projectRoot?: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly skillType: SkillType;
  readonly triggerSummary?: string;
  readonly author?: string;
  readonly version?: string;
  readonly iconKey?: string;
  readonly content?: string;
};

export type UpdateSkillStateRequest = {
  readonly skillId: SkillId;
  readonly scope: SkillScope;
  readonly projectRoot?: string;
  readonly trustState?: SkillTrustState;
  readonly enableState?: SkillEnableState;
};

export type DeleteSkillRequest = {
  readonly skillId: SkillId;
  readonly scope: SkillScope;
  readonly projectRoot?: string;
};

export type SkillRequest = {
  readonly skillId: SkillId;
  readonly scope: SkillScope;
  readonly projectRoot?: string;
};

export type SkillDetails = InstalledSkillConfig & {
  readonly contentPreview?: string;
};

export type SkillRuntimeEvent =
  | {
      readonly kind: "catalog";
      readonly updatedAt: string;
    }
  | {
      readonly kind: "install";
      readonly scope: SkillScope;
      readonly skillIds: readonly SkillId[];
      readonly timestamp: string;
    }
  | {
      readonly kind: "state-change";
      readonly scope: SkillScope;
      readonly skillId: SkillId;
      readonly trustState: SkillTrustState;
      readonly enableState: SkillEnableState;
      readonly timestamp: string;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly timestamp: string;
      readonly scope?: SkillScope;
      readonly skillId?: SkillId;
    };
