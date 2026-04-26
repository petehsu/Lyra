import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

export type LyraListPickerOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
};

type LyraListPickerProps<T extends string> = {
  readonly ariaLabel: string;
  readonly listAriaLabel?: string;
  readonly value: T;
  readonly options: readonly LyraListPickerOption<T>[];
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly variant?: "default" | "compact";
  readonly shape?: "pill" | "rounded";
  readonly disabled?: boolean;
  readonly onChange: (nextValue: T) => void;
};

const joinClassNames = (
  ...tokens: readonly (string | false | null | undefined)[]
): string => tokens.filter((token): token is string => typeof token === "string" && token.length > 0).join(" ");

export const LyraListPicker = <T extends string>({
  ariaLabel,
  listAriaLabel,
  value,
  options,
  className,
  style,
  variant = "default",
  shape = "pill",
  disabled = false,
  onChange
}: LyraListPickerProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const activeOption = options.find((option) => option.value === value) ?? options[0];
  const pickerStyle = {
    ...style,
    "--lyra-list-picker-option-count": String(Math.max(1, options.length))
  } as CSSProperties;

  useEffect(() => {
    if (isOpen === false) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setIsOpen(true);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div
      className={joinClassNames(
        "lyra-list-picker",
        variant === "compact" ? "lyra-list-picker-compact" : "lyra-list-picker-default",
        shape === "rounded" ? "lyra-list-picker-shape-rounded" : "lyra-list-picker-shape-pill",
        isOpen && "lyra-list-picker-open",
        className
      )}
      ref={rootRef}
      style={pickerStyle}
    >
      <div className="lyra-list-picker-surface">
        <ul
          className="lyra-list-picker-options"
          role="listbox"
          aria-label={listAriaLabel ?? ariaLabel}
          aria-hidden={isOpen === false}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            const isOptionDisabled = disabled || option.disabled === true;

            return (
              <li key={option.value} className="lyra-list-picker-option-item">
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isOptionDisabled}
                  className={joinClassNames(
                    "lyra-list-picker-option",
                    isActive && "lyra-list-picker-option-active",
                    isOptionDisabled && "lyra-list-picker-option-disabled"
                  )}
                  disabled={isOptionDisabled}
                  tabIndex={isOpen && isOptionDisabled === false ? 0 : -1}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="lyra-list-picker-trigger"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          disabled={disabled}
          onClick={() => {
            if (disabled) {
              return;
            }
            setIsOpen((current) => !current);
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="lyra-list-picker-trigger-label">{activeOption?.label ?? ""}</span>
        </button>
      </div>
    </div>
  );
};
