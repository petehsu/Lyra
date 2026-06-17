export type AccessibilityNativeBindings = {
  readonly readOsAxTreeJson: (payload: string) => string;
  readonly actOnOsAxNodeJson: (payload: string) => string;
  // Computer Use semantic surface, backed by lyra-computer-use-core. The
  // accessibility crate is the macOS N-API shim for that core.
  readonly computerMapJson: (payload: string) => string;
  readonly computerFindJson: (payload: string) => string;
  readonly computerActJson: (payload: string) => string;
  readonly computerDiffJson: (payload: string) => string;
  readonly computerExplainJson: (payload: string) => string;
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
