import { t } from "./i18n";

const INTERNAL_FAILURE_NEEDLES = [
  "provider returned no assistant",
  "provider returned reasoning without final assistant",
  "provider finished with tool_calls but returned no complete tool call",
  "provider emitted textual tool protocol leak",
  "assistant promised tool use without structured tool_call",
  "textual tool-call syntax",
  "lyra native agent runtime is active",
  "模型这次返回了空响应"
] as const;

export const isInternalTurnFailureDetail = (message: string): boolean => {
  const lower = message.trim().toLowerCase();
  if (lower.length === 0) return true;
  return INTERNAL_FAILURE_NEEDLES.some((needle) => lower.includes(needle));
};

export const mapTurnFailureMessage = (raw: string | null | undefined): string => {
  const message = raw?.trim() ?? "";
  if (message.length === 0 || isInternalTurnFailureDetail(message)) {
    return t("lyra-agents-turnFailure.emptyResponse");
  }
  const lower = message.toLowerCase();
  if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("取消")) {
    return t("lyra-agents-turnFailure.cancelled");
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("超时")) {
    return t("lyra-agents-turnFailure.timeout");
  }
  if (
    lower.includes("auth")
    || lower.includes("api key")
    || lower.includes("unauthorized")
    || lower.includes("401")
    || lower.includes("403")
    || lower.includes("认证")
  ) {
    return t("lyra-agents-turnFailure.providerAuth");
  }
  if (
    (lower.includes("context") || lower.includes("上下文"))
    && (lower.includes("length") || lower.includes("window") || lower.includes("maximum") || lower.includes("过长"))
  ) {
    return t("lyra-agents-turnFailure.contextLength");
  }
  return t("lyra-agents-turnFailure.generic");
};

export const isInternalRuntimeFallbackText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return (
    /lyra native agent runtime is active/i.test(trimmed)
    || trimmed.includes("模型这次返回了空响应")
    || isInternalTurnFailureDetail(trimmed)
  );
};