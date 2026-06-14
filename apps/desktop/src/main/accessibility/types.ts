export type AccessibilityNativeBindings = {
  readonly readOsAxTreeJson: (payload: string) => string;
  readonly actOnOsAxNodeJson: (payload: string) => string;
};

export type AccessibilityNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: AccessibilityNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
