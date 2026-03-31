import type {
  LyraSystemAssignSessionImageRequest,
  LyraSystemClearSessionImageOverrideRequest,
  LyraSystemImageManifest,
  LyraSystemInstallFromDirectoryRequest,
  LyraSystemInstallFromPackageRequest,
  LyraSystemReadResolvedSessionRequest,
  LyraSystemSetDefaultImageRequest,
  LyraSystemSetRuntimeModeOverrideRequest,
  LyraSystemUninstallRequest
} from "../../shared/system-image";

type StorageRootRequest = {
  readonly storageRoot: string;
};

export type NativeSystemImagesReadRequest = StorageRootRequest;
export type NativeSystemInstallFromDirectoryRequest =
  LyraSystemInstallFromDirectoryRequest & StorageRootRequest;
export type NativeSystemInstallFromPackageRequest =
  LyraSystemInstallFromPackageRequest & StorageRootRequest;
export type NativeSystemInstallSeedRequest = StorageRootRequest & {
  readonly manifest: LyraSystemImageManifest;
};
export type NativeSystemUninstallRequest = LyraSystemUninstallRequest & StorageRootRequest;
export type NativeSystemSetDefaultImageRequest =
  LyraSystemSetDefaultImageRequest & StorageRootRequest;
export type NativeSystemAssignSessionImageRequest =
  LyraSystemAssignSessionImageRequest & StorageRootRequest;
export type NativeSystemClearSessionImageOverrideRequest =
  LyraSystemClearSessionImageOverrideRequest & StorageRootRequest;
export type NativeSystemSetRuntimeModeOverrideRequest =
  LyraSystemSetRuntimeModeOverrideRequest & StorageRootRequest;
export type NativeSystemReadResolvedSessionRequest =
  LyraSystemReadResolvedSessionRequest & StorageRootRequest;

export type SystemImageNativeBindings = {
  readonly readSystemImageRegistryJson: (requestJson: string) => string;
  readonly listInstalledSystemImagesJson: (requestJson: string) => string;
  readonly installSystemImageFromDirectoryJson: (requestJson: string) => string;
  readonly installSystemImageFromPackageJson: (requestJson: string) => string;
  readonly installSystemImageSeedJson: (requestJson: string) => string;
  readonly uninstallSystemImageJson: (requestJson: string) => string;
  readonly setDefaultSystemImageJson: (requestJson: string) => string;
  readonly assignSessionSystemImageJson: (requestJson: string) => string;
  readonly clearSessionSystemImageOverrideJson: (requestJson: string) => string;
  readonly setSystemRuntimeModeOverrideJson: (requestJson: string) => string;
  readonly readResolvedSessionSystemJson: (requestJson: string) => string;
};

export type SystemImageNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: SystemImageNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type SystemImageIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: Extract<SystemImageNativeLoadResult, { readonly ok: true }>;
};
