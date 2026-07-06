import { Check, ChevronDown } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "../primitives";
import { cn } from "../utils";

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuContent>;

export type AppModelMenuOption<TValue extends string = string> = {
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly value: TValue;
};

export type AppModelMenuSubmenu<TValue extends string = string> = {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: ReactNode;
  readonly onValueChange: (value: TValue) => void;
  readonly options: readonly AppModelMenuOption<TValue>[];
  readonly value: TValue;
};

export type AppModelMenuGroup<TValue extends string = string> = {
  readonly label: ReactNode;
  readonly options: readonly AppModelMenuOption<TValue>[];
};

export type AppModelMenuProps<TModelValue extends string = string> = {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly collisionBoundary?: DropdownMenuContentProps["collisionBoundary"];
  readonly collisionPadding?: DropdownMenuContentProps["collisionPadding"];
  readonly contentClassName?: string;
  readonly disabled?: boolean;
  readonly groups?: readonly AppModelMenuGroup<TModelValue>[];
  readonly onModelChange: (value: TModelValue) => void;
  readonly options: readonly AppModelMenuOption<TModelValue>[];
  readonly placeholder?: ReactNode;
  readonly submenus?: readonly AppModelMenuSubmenu[];
  readonly value: TModelValue;
};

const labelText = (label: ReactNode): string | undefined =>
  typeof label === "string" ? label : undefined;

export const AppModelMenu = <TModelValue extends string = string>({
  ariaLabel,
  className,
  collisionBoundary,
  collisionPadding = 8,
  contentClassName,
  disabled = false,
  groups,
  onModelChange,
  options,
  placeholder,
  submenus = [],
  value
}: AppModelMenuProps<TModelValue>) => {
  const [open, setOpen] = useState(false);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() => new Set());
  const allOptions = groups !== undefined
    ? groups.flatMap((group) => group.options)
    : options;
  const selectedOption = allOptions.find((option) => option.value === value);
  const triggerLabel = selectedOption?.label ?? placeholder ?? ariaLabel;
  const triggerIcon = selectedOption?.icon;
  const enabledSubmenus = submenus.filter((submenu) => submenu.options.length > 0);
  const hasGroups = groups !== undefined && groups.length > 0;

  const renderOption = (option: AppModelMenuOption<TModelValue>) => {
    const active = option.value === value;
    const textValue = labelText(option.label);
    const disabledProps = option.disabled === undefined
      ? {}
      : { disabled: option.disabled };
    const textValueProps = textValue === undefined
      ? {}
      : { textValue };

    return (
      <DropdownMenuItem
        key={option.value}
        className={cn(
          "lyra-app-model-menu-item",
          option.icon === undefined ? "" : "lyra-app-model-menu-item-with-icon"
        )}
        data-active={active ? "true" : undefined}
        onSelect={() => {
          onModelChange(option.value);
          setOpenSubmenuId(null);
          setOpen(false);
        }}
        {...disabledProps}
        {...textValueProps}
      >
        {option.icon === undefined ? null : (
          <span className="lyra-app-model-menu-option-icon" aria-hidden="true">
            {option.icon}
          </span>
        )}
        <span className="lyra-app-model-menu-item-label">
          {option.label}
        </span>
        {active ? (
          <Check className="lyra-ui-menu-check" aria-hidden="true" />
        ) : null}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setOpenSubmenuId(null);
        }
      }}
      modal={false}
    >
      <DropdownMenuTrigger
        className={cn("lyra-ui-select-trigger lyra-app-model-menu-trigger", className)}
        aria-label={ariaLabel}
        disabled={disabled || allOptions.length === 0}
        data-has-icon={triggerIcon === undefined ? undefined : "true"}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="lyra-ui-select-trigger-value">
          {triggerIcon === undefined ? null : (
            <span className="lyra-app-model-menu-option-icon" aria-hidden="true">
              {triggerIcon}
            </span>
          )}
          {triggerLabel}
        </span>
        <ChevronDown className="lyra-ui-select-chevron" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn("lyra-app-model-menu-content", contentClassName)}
        align="start"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
      >
        {hasGroups ? (
          <DropdownMenuGroup>
            {groups.map((group, groupIndex) => {
              const isCollapsed = collapsedGroups.has(groupIndex);
              return (
                <DropdownMenuGroup key={groupIndex}>
                  <DropdownMenuItem
                    className="lyra-app-model-menu-group-header"
                    data-collapsed={isCollapsed ? "true" : undefined}
                    onSelect={(e) => {
                      e.preventDefault();
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(groupIndex)) next.delete(groupIndex);
                        else next.add(groupIndex);
                        return next;
                      });
                    }}
                  >
                    <span className="lyra-app-model-menu-group-line" aria-hidden="true" />
                    <span className="lyra-app-model-menu-group-label">
                      {group.label}
                    </span>
                    <span className="lyra-app-model-menu-group-line" aria-hidden="true" />
                  </DropdownMenuItem>
                  {isCollapsed ? null : group.options.map(renderOption)}
                </DropdownMenuGroup>
              );
            })}
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuGroup>
            {options.map(renderOption)}
          </DropdownMenuGroup>
        )}
        {enabledSubmenus.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {enabledSubmenus.map((submenu) => {
                const currentOption = submenu.options.find((option) => option.value === submenu.value);
                const currentLabel = currentOption?.label ?? submenu.value;
                const currentLabelText = labelText(currentLabel);
                const submenuDisabledProps = submenu.disabled === undefined
                  ? {}
                  : { disabled: submenu.disabled };

                return (
                  <DropdownMenuSub
                    key={submenu.id}
                    open={openSubmenuId === submenu.id}
                    onOpenChange={(nextOpen) => {
                      setOpenSubmenuId(nextOpen ? submenu.id : null);
                    }}
                  >
                    <DropdownMenuSubTrigger
                      className="lyra-app-model-menu-sub-trigger"
                      aria-label={
                        currentLabelText === undefined
                          ? submenu.ariaLabel
                          : `${submenu.ariaLabel} ${currentLabelText}`
                      }
                      onFocus={() => {
                        if (!submenu.disabled) {
                          setOpenSubmenuId(submenu.id);
                        }
                      }}
                      onMouseEnter={() => {
                        if (!submenu.disabled) {
                          setOpenSubmenuId(submenu.id);
                        }
                      }}
                      onPointerMove={() => {
                        if (!submenu.disabled) {
                          setOpenSubmenuId(submenu.id);
                        }
                      }}
                      {...submenuDisabledProps}
                    >
                      <span className="lyra-app-model-menu-sub-label">
                        {submenu.label}
                      </span>
                      <span className="lyra-app-model-menu-sub-value">
                        {currentLabel}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      className="lyra-app-model-menu-sub-content"
                      alignOffset={-4}
                      collisionBoundary={collisionBoundary}
                      collisionPadding={collisionPadding}
                    >
                      {submenu.options.map((option) => {
                        const active = option.value === submenu.value;
                        const textValue = labelText(option.label);
                        const disabledProps = option.disabled === undefined
                          ? {}
                          : { disabled: option.disabled };
                        const textValueProps = textValue === undefined
                          ? {}
                          : { textValue };

                        return (
                          <DropdownMenuItem
                            key={option.value}
                            className={cn(
                              "lyra-app-model-menu-item",
                              option.icon === undefined ? "" : "lyra-app-model-menu-item-with-icon"
                            )}
                            data-active={active ? "true" : undefined}
                            onSelect={() => {
                              submenu.onValueChange(option.value);
                              setOpenSubmenuId(null);
                              setOpen(false);
                            }}
                            {...disabledProps}
                            {...textValueProps}
                          >
                            {option.icon === undefined ? null : (
                              <span className="lyra-app-model-menu-option-icon" aria-hidden="true">
                                {option.icon}
                              </span>
                            )}
                            <span className="lyra-app-model-menu-item-label">
                              {option.label}
                            </span>
                            {active ? (
                              <Check className="lyra-ui-menu-check" aria-hidden="true" />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
