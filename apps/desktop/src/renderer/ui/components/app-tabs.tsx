import { type ReactNode } from "react";

import { cn } from "../utils";

export type AppTabOption<TValue extends string = string> = {
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly title?: string;
  readonly value: TValue;
};

export type AppTabsProps<TValue extends string = string> = {
  readonly activeValues?: readonly TValue[];
  readonly ariaLabel: string;
  readonly className?: string;
  readonly onValueChange: (value: TValue) => void;
  readonly options: readonly AppTabOption<TValue>[];
  readonly selectionMode?: "single" | "multiple";
  readonly size?: "sm" | "md";
  readonly value: TValue;
};

export const AppTabs = <TValue extends string = string>({
  activeValues,
  ariaLabel,
  className,
  onValueChange,
  options,
  selectionMode = "single",
  size = "sm",
  value
}: AppTabsProps<TValue>) => (
  <div
    className={cn("lyra-app-tabs", `lyra-app-tabs-size-${size}`, className)}
    role={selectionMode === "single" ? "tablist" : "group"}
    aria-label={ariaLabel}
  >
    {options.map((option) => {
      const selected = activeValues === undefined
        ? option.value === value
        : activeValues.includes(option.value);
      return (
        <button
          key={option.value}
          type="button"
          role={selectionMode === "single" ? "tab" : undefined}
          aria-label={option.ariaLabel}
          aria-selected={selectionMode === "single" ? selected : undefined}
          aria-pressed={selectionMode === "multiple" ? selected : undefined}
          disabled={option.disabled}
          title={option.title}
          className="lyra-app-tab"
          data-active={selected ? "true" : undefined}
          onClick={() => {
            if (option.disabled) return;
            onValueChange(option.value);
          }}
        >
          {option.icon === undefined ? null : (
            <span className="lyra-app-tab-icon" aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className="lyra-app-tab-label">{option.label}</span>
        </button>
      );
    })}
  </div>
);
