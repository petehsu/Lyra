import type {
  CalculatorEvaluateRequest,
  CalculatorMode,
  CalculatorNativeBindings,
  CalculatorNativeLoadResult,
  CalculatorResult,
  DynamicToolCallResponse
} from "./types";
import { loadCalculatorNativeBindings } from "./native-loader";
import { runPythonCalculator } from "./python-runtime";

type HostToolInvocationPayload = {
  readonly arguments?: unknown;
};

const DEFAULT_PRECISION = 50;
const MAX_PRECISION = 1000;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 10_000;
const MAX_EXPRESSION_BYTES = 20_000;

const PYTHON_FIRST_MODES = new Set<CalculatorMode>([
  "symbolic",
  "matrix",
  "statistics",
  "unit"
]);

const PYTHON_HINT_PATTERN =
  /\b(solve|simplify|expand|factor|diff|differentiate|integrate|limit|series|matrix|det|inverse|eigen|mean|median|stdev|variance|convert|to)\b|=|\[\[/i;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readMode = (value: unknown): CalculatorMode => {
  const mode = readString(value);
  return mode === "exact"
    || mode === "numeric"
    || mode === "symbolic"
    || mode === "matrix"
    || mode === "statistics"
    || mode === "unit"
    ? mode
    : "auto";
};

const normalizePrecision = (value: unknown): number => {
  const number = readNumber(value);
  return number === undefined
    ? DEFAULT_PRECISION
    : Math.max(1, Math.min(MAX_PRECISION, Math.round(number)));
};

const normalizeTimeoutMs = (value: unknown): number => {
  const number = readNumber(value);
  return number === undefined
    ? DEFAULT_TIMEOUT_MS
    : Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(number)));
};

const normalizeVariableValue = (
  value: unknown
): number | string | { readonly real: number; readonly imaginary?: number } | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  const record = asRecord(value);
  const real = readNumber(record.real);
  if (real === undefined) {
    return null;
  }
  const imaginary = readNumber(record.imaginary);
  return imaginary === undefined ? { real } : { real, imaginary };
};

const normalizeVariables = (value: unknown): CalculatorEvaluateRequest["variables"] => {
  const record = asRecord(value);
  const result: Record<string, number | string | { readonly real: number; readonly imaginary?: number }> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key.trim().length === 0) {
      continue;
    }
    const normalized = normalizeVariableValue(entry);
    if (normalized !== null) {
      result[key] = normalized;
    }
  }
  return result;
};

const normalizeRequest = (payload: HostToolInvocationPayload): CalculatorEvaluateRequest => {
  const args = asRecord(payload.arguments);
  const expression = readString(args.expression);
  if (expression === undefined) {
    throw Object.assign(new Error("expression is required"), { code: "CALCULATOR_INVALID_INPUT" });
  }
  if (Buffer.byteLength(expression, "utf8") > MAX_EXPRESSION_BYTES) {
    throw Object.assign(
      new Error(`expression exceeds ${MAX_EXPRESSION_BYTES} bytes`),
      { code: "CALCULATOR_INVALID_INPUT" }
    );
  }
  return {
    expression,
    mode: readMode(args.mode),
    variables: normalizeVariables(args.variables),
    precision: normalizePrecision(args.precision),
    timeoutMs: normalizeTimeoutMs(args.timeoutMs),
    wantSteps: readBoolean(args.wantSteps) ?? false
  };
};

const parseCalculatorResult = (
  raw: string,
  warningPrefix?: string
): CalculatorResult => {
  try {
    const parsed = JSON.parse(raw) as Partial<CalculatorResult>;
    return {
      ok: parsed.ok === true,
      engine: typeof parsed.engine === "string" ? parsed.engine : "native",
      ...(typeof parsed.result === "string" ? { result: parsed.result } : {}),
      ...(typeof parsed.exact === "string" ? { exact: parsed.exact } : {}),
      ...(typeof parsed.decimal === "string" ? { decimal: parsed.decimal } : {}),
      ...(typeof parsed.latex === "string" ? { latex: parsed.latex } : {}),
      ...(typeof parsed.real === "number" ? { real: parsed.real } : {}),
      ...(typeof parsed.imaginary === "number" ? { imaginary: parsed.imaginary } : {}),
      ...(typeof parsed.units === "string" ? { units: parsed.units } : {}),
      ...(typeof parsed.code === "string" ? { code: parsed.code } : {}),
      ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
      warnings: [
        ...(warningPrefix === undefined ? [] : [warningPrefix]),
        ...(Array.isArray(parsed.warnings)
          ? parsed.warnings.filter((entry): entry is string => typeof entry === "string")
          : [])
      ],
      elapsedMs: typeof parsed.elapsedMs === "number" ? parsed.elapsedMs : 0
    };
  } catch (error) {
    return {
      ok: false,
      engine: "native",
      code: "CALCULATOR_RESULT_PARSE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      warnings: warningPrefix === undefined ? [] : [warningPrefix],
      elapsedMs: 0
    };
  }
};

const nativeEvaluate = (
  bindings: CalculatorNativeBindings,
  request: CalculatorEvaluateRequest
): CalculatorResult => {
  const raw = bindings.evaluateNativeCalculatorJson(JSON.stringify({
    expression: request.expression,
    variables: request.variables,
    precision: request.precision
  }));
  return parseCalculatorResult(raw);
};

const unavailableNativeResult = (
  loadResult: Extract<CalculatorNativeLoadResult, { readonly ok: false }>
): CalculatorResult => ({
  ok: false,
  engine: "native",
  code: "NATIVE_UNAVAILABLE",
  message: loadResult.errorMessage,
  warnings: [],
  elapsedMs: 0
});

const shouldUsePythonFirst = (request: CalculatorEvaluateRequest): boolean =>
  PYTHON_FIRST_MODES.has(request.mode)
  || request.wantSteps
  || (request.mode === "auto" && PYTHON_HINT_PATTERN.test(request.expression));

const withFallbackWarning = (
  result: CalculatorResult,
  warning: string
): CalculatorResult => ({
  ...result,
  warnings: [warning, ...result.warnings]
});

const resultToDynamicToolResponse = (result: CalculatorResult): DynamicToolCallResponse => ({
  contentItems: [{
    type: "inputText",
    text: JSON.stringify(result)
  }],
  success: result.ok
});

export const createCalculatorService = () => {
  const nativeLoadResult = loadCalculatorNativeBindings();

  const evaluate = async (payload: HostToolInvocationPayload): Promise<DynamicToolCallResponse> => {
    const request = normalizeRequest(payload);
    const nativeResult = nativeLoadResult.ok
      ? nativeEvaluate(nativeLoadResult.bindings, request)
      : unavailableNativeResult(nativeLoadResult);

    if (shouldUsePythonFirst(request)) {
      const pythonResult = await runPythonCalculator(request);
      if (pythonResult.ok) {
        return resultToDynamicToolResponse(pythonResult);
      }
      if (nativeResult.ok) {
        return resultToDynamicToolResponse(withFallbackWarning(
          nativeResult,
          `python engine unavailable: ${pythonResult.message ?? pythonResult.code ?? "unknown error"}`
        ));
      }
      return resultToDynamicToolResponse(pythonResult);
    }

    if (nativeResult.ok) {
      return resultToDynamicToolResponse(nativeResult);
    }

    const pythonResult = await runPythonCalculator(request);
    if (pythonResult.ok) {
      return resultToDynamicToolResponse(withFallbackWarning(
        pythonResult,
        `native engine unavailable: ${nativeResult.message ?? nativeResult.code ?? "unknown error"}`
      ));
    }

    return resultToDynamicToolResponse({
      ok: false,
      engine: "calculator",
      code: "CALCULATOR_FAILED",
      message: [
        nativeResult.message ?? nativeResult.code ?? "native failed",
        pythonResult.message ?? pythonResult.code ?? "python failed"
      ].join("; "),
      warnings: [],
      elapsedMs: nativeResult.elapsedMs + pythonResult.elapsedMs
    });
  };

  return {
    nativeLoadResult,
    evaluate
  };
};
