export type UiuxPackTrustState = "untrusted" | "trusted" | "revoked";

export type UiuxPackSource =
  | {
      readonly kind: "local";
      readonly path: string;
    }
  | {
      readonly kind: "git";
      readonly url: string;
      readonly ref?: string;
      readonly subdir?: string;
    }
  | {
      readonly kind: "npm";
      readonly packageName: string;
      readonly version?: string;
      readonly subdir?: string;
    };

export type UiuxPackManifest = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly entry: string;
  readonly css?: string;
  readonly workbenchUiApi: "1";
  readonly permissions: readonly string[];
};

export type InstalledUiuxPack = {
  readonly id: string;
  readonly manifest: UiuxPackManifest;
  readonly source: UiuxPackSource;
  readonly packagePath: string;
  readonly entryPath: string;
  readonly cssPath?: string;
  readonly sourceFingerprint: string;
  readonly trustState: UiuxPackTrustState;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
};

export type BuiltinUiuxPackSummary = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

export type UiuxPackRuntime = {
  readonly packId: string;
  readonly entryUrl: string;
  readonly cssUrl?: string;
};

export type UiuxListPacksResponse = {
  readonly builtin: readonly BuiltinUiuxPackSummary[];
  readonly installed: readonly InstalledUiuxPack[];
  readonly activeExternalPackId?: string;
  readonly pendingExternalPackId?: string;
};

export type UiuxInstallFromLocalRequest = {
  readonly sourcePath: string;
};

export type UiuxInstallFromGitRequest = {
  readonly url: string;
  readonly ref?: string;
  readonly subdir?: string;
};

export type UiuxInstallFromNpmRequest = {
  readonly packageName: string;
  readonly version?: string;
  readonly subdir?: string;
};

export type UiuxSetTrustStateRequest = {
  readonly packId: string;
  readonly trustState: UiuxPackTrustState;
};

export type UiuxRequestActivationRequest = {
  readonly packId: string;
};

export type UiuxRequestActivationResponse = {
  readonly packId: string;
  readonly reloadRequired: boolean;
  readonly activated: boolean;
};

export type UiuxResolveRuntimeRequest = {
  readonly packId: string;
};
