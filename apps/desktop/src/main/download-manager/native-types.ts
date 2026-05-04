export type DownloadNativeBindings = {
  readonly planNativeDownloadJson: (payload: string) => string;
};

export type DownloadNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: DownloadNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
