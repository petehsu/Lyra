import { useMemo, useState } from "react";
import { Ban, Check, ExternalLink, X } from "lucide-react";

import { createTranslator, type WorkbenchLocale } from "../i18n";
import type {
  InteractionMcpElicitationRequest,
  McpElicitationField,
} from "./interaction/pending-interaction-mappers";

type McpElicitationPanelProps = {
  readonly locale?: WorkbenchLocale;
  readonly request: InteractionMcpElicitationRequest;
  readonly onSubmit: (payload: {
    readonly action: "accept" | "decline" | "cancel";
    readonly content?: Record<string, unknown>;
    readonly meta?: Record<string, unknown>;
  }) => void;
};

const persistOptions = (meta: Record<string, unknown> | undefined): readonly string[] => {
  const value = meta?.persist;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => entry === "session" || entry === "always");
  }
  return value === "session" || value === "always" ? [value] : [];
};

const initialValueForField = (field: McpElicitationField): unknown => {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  if (field.kind === "boolean") {
    return false;
  }
  if (field.kind === "multi_select") {
    return [];
  }
  return "";
};

const fieldReady = (field: McpElicitationField, value: unknown): boolean => {
  if (!field.required) {
    return true;
  }
  if (field.kind === "boolean") {
    return typeof value === "boolean";
  }
  if (field.kind === "multi_select") {
    return Array.isArray(value) && value.length > 0;
  }
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
};

const serializeFieldValue = (field: McpElicitationField, value: unknown): unknown => {
  if (field.kind === "number") {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value.trim();
    }
  }
  if (field.kind === "string" || field.kind === "single_select") {
    return typeof value === "string" ? value.trim() : value;
  }
  return value;
};

export const McpElicitationPanel = ({
  locale = "en-US",
  request,
  onSubmit,
}: McpElicitationPanelProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(request.fields.map((field) => [field.id, initialValueForField(field)]))
  );
  const [persist, setPersist] = useState<string | null>(null);
  const availablePersistOptions = persistOptions(request.meta);
  const canAccept = request.fields.every((field) => fieldReady(field, values[field.id]));
  const content = useMemo(
    () =>
      Object.fromEntries(
        request.fields
          .map((field) => [field.id, serializeFieldValue(field, values[field.id])] as const)
          .filter(([, value]) => {
            if (Array.isArray(value)) {
              return value.length > 0;
            }
            return value !== undefined && value !== null && value !== "";
          })
      ),
    [request.fields, values]
  );

  const submitAccept = (): void => {
    onSubmit({
      action: "accept",
      content,
      ...(persist === null ? {} : { meta: { persist } }),
    });
  };

  const updateValue = (fieldId: string, value: unknown): void => {
    setValues((current) => ({ ...current, [fieldId]: value }));
  };

  return (
    <div className="lyra-ai-mcp-elicitation">
      <div className="lyra-ai-mcp-elicitation__header">
        <div>
          <div className="lyra-ai-mcp-elicitation__eyebrow">{request.serverName}</div>
          <div className="lyra-ai-mcp-elicitation__title">{t("ai.mcpElicitationTitle")}</div>
        </div>
        <span className="lyra-ai-mcp-elicitation__mode">{request.mode}</span>
      </div>
      <div className="lyra-ai-mcp-elicitation__message">{request.message}</div>
      {request.mode === "url" && request.url !== undefined ? (
        <a
          className="lyra-ai-mcp-elicitation__url"
          href={request.url}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} aria-hidden="true" />
          <span>{request.url}</span>
        </a>
      ) : null}
      {request.fields.length === 0 ? null : (
        <div className="lyra-ai-mcp-elicitation__fields">
          {request.fields.map((field) => (
            <label key={field.id} className="lyra-ai-mcp-elicitation__field">
              <span>{field.label}</span>
              {field.description === undefined ? null : <small>{field.description}</small>}
              {field.kind === "boolean" ? (
                <input
                  type="checkbox"
                  checked={values[field.id] === true}
                  onChange={(event) => {
                    updateValue(field.id, event.target.checked);
                  }}
                />
              ) : field.kind === "single_select" ? (
                <select
                  value={typeof values[field.id] === "string" ? values[field.id] as string : ""}
                  onChange={(event) => {
                    updateValue(field.id, event.target.value);
                  }}
                >
                  <option value="" />
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : field.kind === "multi_select" ? (
                <div className="lyra-ai-mcp-elicitation__checks">
                  {field.options.map((option) => {
                    const selectedValues = Array.isArray(values[field.id]) ? values[field.id] as readonly unknown[] : [];
                    const checked = selectedValues.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={checked
                          ? "lyra-ai-mcp-elicitation__check lyra-ai-mcp-elicitation__check-active"
                          : "lyra-ai-mcp-elicitation__check"}
                        onClick={() => {
                          updateValue(
                            field.id,
                            checked
                              ? selectedValues.filter((value) => value !== option.value)
                              : [...selectedValues, option.value]
                          );
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={field.kind === "number" ? "number" : "text"}
                  value={
                    typeof values[field.id] === "string" || typeof values[field.id] === "number"
                      ? String(values[field.id])
                      : ""
                  }
                  onChange={(event) => {
                    updateValue(field.id, event.target.value);
                  }}
                />
              )}
            </label>
          ))}
        </div>
      )}
      {availablePersistOptions.length === 0 ? null : (
        <div className="lyra-ai-mcp-elicitation__persist">
          {availablePersistOptions.includes("session") ? (
            <button
              type="button"
              className={persist === "session"
                ? "lyra-ai-mcp-elicitation__persist-option lyra-ai-mcp-elicitation__persist-option-active"
                : "lyra-ai-mcp-elicitation__persist-option"}
              onClick={() => {
                setPersist((current) => current === "session" ? null : "session");
              }}
            >
              {t("ai.mcpElicitationAcceptForSession")}
            </button>
          ) : null}
          {availablePersistOptions.includes("always") ? (
            <button
              type="button"
              className={persist === "always"
                ? "lyra-ai-mcp-elicitation__persist-option lyra-ai-mcp-elicitation__persist-option-active"
                : "lyra-ai-mcp-elicitation__persist-option"}
              onClick={() => {
                setPersist((current) => current === "always" ? null : "always");
              }}
            >
              {t("ai.mcpElicitationAcceptAlways")}
            </button>
          ) : null}
        </div>
      )}
      <div className="lyra-ai-mcp-elicitation__actions">
        <button
          type="button"
          className="lyra-ai-plan-bar__icon-action lyra-ai-plan-bar__icon-action-danger"
          aria-label={t("ai.mcpElicitationDecline")}
          title={t("ai.mcpElicitationDecline")}
          onClick={() => {
            onSubmit({ action: "decline" });
          }}
        >
          <Ban size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-ai-plan-bar__icon-action"
          aria-label={t("ai.mcpElicitationCancel")}
          title={t("ai.mcpElicitationCancel")}
          onClick={() => {
            onSubmit({ action: "cancel" });
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lyra-ai-plan-bar__icon-action lyra-ai-plan-bar__icon-action-submit"
          disabled={!canAccept}
          aria-label={t("ai.mcpElicitationAccept")}
          title={t("ai.mcpElicitationAccept")}
          onClick={submitAccept}
        >
          <Check size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
