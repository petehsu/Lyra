import type { AiComputerHostPlatform, AiComputerPowerState } from "./computer";

export type LyraSystemRuntimeMode = "sandbox" | "inprocess";

export type LyraSystemShellMode = "content-only" | "full-shell";

export type LyraSystemContextState = "off" | "booting" | "on" | "error";

export type LyraSystemPlatformArch = "x64" | "arm64" | "any";

export type LyraSystemPlatformArtifactKind = "native-binary" | "js-module";

export type LyraSystemPlatformArtifact = {
  readonly platform: AiComputerHostPlatform | "any";
  readonly arch: LyraSystemPlatformArch;
  readonly kind: LyraSystemPlatformArtifactKind;
  readonly path: string;
};

export type LyraSystemCompatibility = {
  readonly min: string;
  readonly max?: string;
};

export type LyraSystemImageManifest = {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly apiVersion: LyraSystemCompatibility;
  readonly shellMode: LyraSystemShellMode;
  readonly defaultRuntimeMode: LyraSystemRuntimeMode;
  readonly entryPath: string;
  readonly capabilities: readonly string[];
  readonly platformArtifacts: readonly LyraSystemPlatformArtifact[];
};

export type LyraSystemImageInstallSource =
  | "directory"
  | "package"
  | "builtin-seed";

export type LyraSystemImageDescriptor = {
  readonly imageId: string;
  readonly title: string;
  readonly version: string;
  readonly source: LyraSystemImageInstallSource;
  readonly installPath: string;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly manifest: LyraSystemImageManifest;
};

export type LyraSystemRegistryState = {
  readonly defaultImageId: string | null;
  readonly runtimeModeOverride: LyraSystemRuntimeMode | null;
  readonly installedImages: readonly LyraSystemImageDescriptor[];
};

export type LyraSystemInstallFromDirectoryRequest = {
  readonly directoryPath: string;
};

export type LyraSystemInstallFromPackageRequest = {
  readonly packagePath: string;
};

export type LyraSystemUninstallRequest = {
  readonly imageId: string;
  readonly wipeData?: boolean;
};

export type LyraSystemSetDefaultImageRequest = {
  readonly imageId: string | null;
};

export type LyraSystemAssignSessionImageRequest = {
  readonly sessionId: string;
  readonly imageId: string | null;
};

export type LyraSystemClearSessionImageOverrideRequest = {
  readonly sessionId: string;
};

export type LyraSystemSetRuntimeModeOverrideRequest = {
  readonly runtimeMode: LyraSystemRuntimeMode | null;
  readonly sessionId?: string;
};

export type LyraSystemReadResolvedSessionRequest = {
  readonly sessionId: string;
  readonly computerPowerState?: AiComputerPowerState;
};

export type LyraSystemResolvedSession = {
  readonly sessionId: string;
  readonly resolvedSystemImageId: string | null;
  readonly effectiveRuntimeMode: LyraSystemRuntimeMode | null;
  readonly effectiveShellMode: LyraSystemShellMode | null;
  readonly systemContextState: LyraSystemContextState;
  readonly updatedAt: string;
};

export type LyraSystemEvent =
  | {
      readonly kind: "registry-updated";
      readonly state: LyraSystemRegistryState;
      readonly timestamp: string;
    }
  | {
      readonly kind: "session-updated";
      readonly sessionId: string;
      readonly resolved: LyraSystemResolvedSession;
      readonly timestamp: string;
    };
