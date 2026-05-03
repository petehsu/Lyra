export type CalculatorMode =
  | "auto"
  | "exact"
  | "numeric"
  | "symbolic"
  | "matrix"
  | "statistics"
  | "unit";

export type CalculatorEvaluateRequest = {
  readonly expression: string;
  readonly mode: CalculatorMode;
  readonly variables: Readonly<Record<string, number | string | CalculatorComplexValue>>;
  readonly precision: number;
  readonly timeoutMs: number;
  readonly wantSteps: boolean;
};

export type CalculatorComplexValue = {
  readonly real: number;
  readonly imaginary?: number;
};

export type CalculatorResult = {
  readonly ok: boolean;
  readonly engine: string;
  readonly result?: string;
  readonly exact?: string;
  readonly decimal?: string;
  readonly latex?: string;
  readonly real?: number;
  readonly imaginary?: number;
  readonly units?: string;
  readonly code?: string;
  readonly message?: string;
  readonly warnings: readonly string[];
  readonly elapsedMs: number;
};

export type CalculatorNativeBindings = {
  readonly evaluateNativeCalculatorJson: (payload: string) => string;
};

export type CalculatorNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: CalculatorNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type DynamicToolCallResponse = {
  readonly contentItems: readonly {
    readonly type: "inputText";
    readonly text: string;
  }[];
  readonly success: boolean;
};
