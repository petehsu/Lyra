import { AppButton, AppIconButton, AppInput } from "@renderer/ui/components";
import { Check, Copy } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { writeClipboardText } from "../../../shared/clipboard";

import type { GlobalDialogActionContext, GlobalDialogState } from "./types";

type GlobalDialogHostProps = {
  readonly state: GlobalDialogState;
  readonly onClose: () => void;
  readonly onSelectAction: (actionId: string, context?: GlobalDialogActionContext) => void;
};

const toActionLayoutClassName = (count: number): string => {
  if (count <= 1) {
    return "lyra-global-dialog-actions-1";
  }
  if (count === 2) {
    return "lyra-global-dialog-actions-2";
  }
  return "lyra-global-dialog-actions-3";
};

const DEFAULT_SOURCE_ICON_LABEL = "APP";
const COPIED_MARK_DURATION_MS = 1600;

const resolveSourceIconLabel = (source: GlobalDialogState["source"]): string => {
  if (source === undefined) {
    return DEFAULT_SOURCE_ICON_LABEL;
  }

  if (source.iconLabel !== undefined) {
    return source.iconLabel;
  }

  const compactTitle = source.title.replace(/\s+/g, "");
  const fallback = compactTitle.slice(0, 2).toUpperCase();
  return fallback.length > 0 ? fallback : DEFAULT_SOURCE_ICON_LABEL;
};

export const GlobalDialogHost = ({
  state,
  onClose,
  onSelectAction
}: GlobalDialogHostProps) => {
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const copiedResetTimerRef = useRef<number | null>(null);

  const clearCopiedResetTimer = useCallback((): void => {
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current);
      copiedResetTimerRef.current = null;
    }
  }, []);

  const onCopyItem = useCallback((itemId: string, value: string): void => {
    void (async () => {
      const copied = await writeClipboardText(value);
      if (copied === false) {
        return;
      }

      setCopiedItemId(itemId);
      clearCopiedResetTimer();
      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopiedItemId((currentId) =>
          currentId === itemId ? null : currentId
        );
        copiedResetTimerRef.current = null;
      }, COPIED_MARK_DURATION_MS);
    })();
  }, [clearCopiedResetTimer]);

  useEffect(() => {
    if (state.isOpen === false) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, state.isOpen]);

  useEffect(() => {
    if (state.isOpen === false) {
      setCopiedItemId(null);
      setInputValue("");
      clearCopiedResetTimer();
    }
  }, [clearCopiedResetTimer, state.isOpen]);

  useEffect(() => {
    if (state.isOpen === false) {
      return;
    }
    setInputValue(state.input?.value ?? "");
  }, [state.input?.id, state.input?.value, state.isOpen]);

  const submitActionId = state.input?.submitActionId
    ?? state.actions.find((action) => action.tone === "primary")?.id
    ?? state.actions[0]?.id;

  const onSubmit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (state.input === undefined || submitActionId === undefined) {
      return;
    }
    onSelectAction(submitActionId, { inputValue });
  }, [inputValue, onSelectAction, state.input, submitActionId]);

  useEffect(
    () => () => {
      clearCopiedResetTimer();
    },
    [clearCopiedResetTimer]
  );

  if (state.isOpen === false || typeof document === "undefined") {
    return null;
  }

  const actionsClassName = [
    "lyra-global-dialog-actions",
    toActionLayoutClassName(state.actions.length)
  ].join(" ");
  const sourceIconLabel = resolveSourceIconLabel(state.source);
  const sourceIconTone = state.source?.iconTone ?? "default";
  const sourceIconClassName = [
    "lyra-global-dialog-source-icon",
    `lyra-global-dialog-source-icon-${sourceIconTone}`
  ].join(" ");

  return createPortal(
    <div
      className="lyra-global-dialog-layer"
      aria-label="global-dialog-layer"
      onMouseDown={onClose}
      onDragStart={(event) => {
        event.preventDefault();
      }}
    >
      <form
        className="lyra-global-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.title}
        onSubmit={onSubmit}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onDragStart={(event) => {
          event.preventDefault();
        }}
      >
        {state.source !== undefined ? (
          <section
            className="lyra-global-dialog-source"
            aria-label="global-dialog-source"
          >
            <span className={sourceIconClassName} aria-hidden="true">
              {sourceIconLabel}
            </span>
            <div className="lyra-global-dialog-source-meta">
              <strong>{state.source.title}</strong>
              {state.source.subtitle !== undefined ? (
                <small>{state.source.subtitle}</small>
              ) : null}
            </div>
          </section>
        ) : null}

        <header className="lyra-global-dialog-header">
          <h2>{state.title}</h2>
          {state.description !== undefined ? (
            <p>{state.description}</p>
          ) : null}
        </header>

        {state.input !== undefined ? (
          <label className="lyra-global-dialog-input" htmlFor={`global-dialog-${state.input.id}`}>
            <span>{state.input.label}</span>
            <AppInput
              id={`global-dialog-${state.input.id}`}
              autoFocus
              type={state.input.type ?? "text"}
              value={inputValue}
              placeholder={state.input.placeholder}
              onChange={(event) => {
                setInputValue(event.currentTarget.value);
              }}
            />
          </label>
        ) : null}

        {state.copyItems.length > 0 ? (
          <section
            className="lyra-global-dialog-copy-list"
            aria-label="global-dialog-copy-list"
          >
            {state.copyItems.map((item) => {
              const isCopied = copiedItemId === item.id;
              const copyLabel = isCopied
                ? state.copiedActionLabel
                : state.copyActionLabel;
              const copyClassName = isCopied
                ? "lyra-global-dialog-copy-action lyra-global-dialog-copy-action-copied"
                : "lyra-global-dialog-copy-action";

              return (
                <article
                  key={item.id}
                  className="lyra-global-dialog-copy-item"
                  aria-label={`global-dialog-copy-item-${item.id}`}
                >
                  <div className="lyra-global-dialog-copy-meta">
                    <strong>{item.label}</strong>
                    <code>{item.value}</code>
                  </div>
                  <AppIconButton
                    className={copyClassName}
                    active={isCopied}
                    aria-label={`${copyLabel} ${item.label}`}
                    title={`${copyLabel}: ${item.label}`}
                    onClick={() => {
                      onCopyItem(item.id, item.value);
                    }}
                  >
                    {isCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  </AppIconButton>
                </article>
              );
            })}
          </section>
        ) : null}

        {state.actions.length > 0 ? (
          <footer className={actionsClassName}>
            {state.actions.map((action) => (
              <AppButton
                key={action.id}
                type="button"
                size="sm"
                variant={
                  action.tone === "primary"
                    ? "default"
                    : action.tone === "danger"
                      ? "destructive"
                      : "secondary"
                }
                className={[
                  "lyra-global-dialog-action",
                  action.tone === "primary"
                    ? "lyra-global-dialog-action-primary"
                    : "",
                  action.tone === "danger"
                    ? "lyra-global-dialog-action-danger"
                    : ""
                ]
                  .filter((value) => value.length > 0)
                  .join(" ")}
                disabled={action.disabled}
                onClick={() => {
                  onSelectAction(action.id, { inputValue });
                }}
              >
                {action.label}
              </AppButton>
            ))}
          </footer>
        ) : null}
      </form>
    </div>,
    document.body
  );
};
