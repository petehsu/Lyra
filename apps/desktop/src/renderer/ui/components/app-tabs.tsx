import { type ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "../primitives";
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

const renderTabContent = <TValue extends string = string>(option: AppTabOption<TValue>) => (
  <>
    {option.icon === undefined ? null : (
      <span className="lyra-app-tab-icon" aria-hidden="true">
        {option.icon}
      </span>
    )}
    <span className="lyra-app-tab-label">{option.label}</span>
  </>
);

export const AppTabs = <TValue extends string = string>({
  activeValues,
  ariaLabel,
  className,
  onValueChange,
  options,
  selectionMode = "single",
  size = "sm",
  value
}: AppTabsProps<TValue>) => {
  // Multiple mode is a toggle-button group, not tabs: keep plain buttons.
  // Single mode uses Radix Tabs so arrow keys, Home/End and roving tabindex
  // come from the primitive instead of being reimplemented.
  if (selectionMode === "multiple") {
    return (
      <div
        className={cn("lyra-app-tabs", `lyra-app-tabs-size-${size}`, className)}
        role="group"
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
              aria-label={option.ariaLabel}
              aria-pressed={selected}
              disabled={option.disabled}
              title={option.title}
              className="lyra-app-tab"
              data-active={selected ? "true" : undefined}
              onClick={() => {
                if (option.disabled) return;
                onValueChange(option.value);
              }}
            >
              {renderTabContent(option)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Tabs
      className={cn("lyra-app-tabs", `lyra-app-tabs-size-${size}`, className)}
      value={value}
      onValueChange={(nextValue) => {
        onValueChange(nextValue as TValue);
      }}
    >
      <TabsList className="lyra-app-tabs-list inline-flex items-center" aria-label={ariaLabel}>
        {options.map((option) => {
          const selected = activeValues === undefined
            ? option.value === value
            : activeValues.includes(option.value);
          return (
            <TabsTrigger
              key={option.value}
              value={option.value}
              aria-label={option.ariaLabel}
              disabled={option.disabled}
              title={option.title}
              className="lyra-app-tab"
              data-active={selected ? "true" : undefined}
            >
              {renderTabContent(option)}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
};
