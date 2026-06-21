import { t } from "./i18n";

export const TURN_FAILURE_CODES = {
  browserBlocked: "lyra_turn_failure:browser_blocked",
  emptyResponse: "lyra_turn_failure:empty_response",
  timeout: "lyra_turn_failure:timeout",
  contextLength: "lyra_turn_failure:context_length",
  providerAuth: "lyra_turn_failure:provider_auth",
  cancelled: "lyra_turn_failure:cancelled",
  generic: "lyra_turn_failure:generic"
} as const;

export type TurnFailureCode = (typeof TURN_FAILURE_CODES)[keyof typeof TURN_FAILURE_CODES];

const TURN_FAILURE_CODE_SET = new Set<string>(Object.values(TURN_FAILURE_CODES));

export const isTurnFailureCode = (value: string | null | undefined): value is TurnFailureCode =>
  typeof value === "string" && TURN_FAILURE_CODE_SET.has(value);

export const mapTurnFailureMessage = (
  raw: string | null | undefined,
  failureKind?: string | null
): string => {
  const code = isTurnFailureCode(failureKind)
    ? failureKind
    : isTurnFailureCode(raw)
      ? raw
      : null;

  if (code === TURN_FAILURE_CODES.browserBlocked) {
    return t("lyra-agents-turnFailure.browserBlocked");
  }
  if (code === TURN_FAILURE_CODES.emptyResponse) {
    return t("lyra-agents-turnFailure.emptyResponse");
  }
  if (code === TURN_FAILURE_CODES.timeout) {
    return t("lyra-agents-turnFailure.timeout");
  }
  if (code === TURN_FAILURE_CODES.contextLength) {
    return t("lyra-agents-turnFailure.contextLength");
  }
  if (code === TURN_FAILURE_CODES.providerAuth) {
    return t("lyra-agents-turnFailure.providerAuth");
  }
  if (code === TURN_FAILURE_CODES.cancelled) {
    return t("lyra-agents-turnFailure.cancelled");
  }
  if (code === TURN_FAILURE_CODES.generic) {
    return t("lyra-agents-turnFailure.generic");
  }

  const message = raw?.trim() ?? "";
  if (message.length === 0) {
    return t("lyra-agents-turnFailure.emptyResponse");
  }
  return t("lyra-agents-turnFailure.generic");
};

export const isInternalRuntimeFallbackText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return (
    /lyra native agent runtime is active/i.test(trimmed)
    || trimmed.includes("模型这次返回了空响应")
    || isTurnFailureCode(trimmed)
  );
};