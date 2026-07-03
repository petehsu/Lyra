import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type Ref,
  type ReactNode
} from "react";

import { cn } from "../utils";

type AppObjectRowBaseProps = {
  readonly active?: boolean;
  readonly actions?: ReactNode;
  readonly badges?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly meta?: ReactNode;
  readonly title: ReactNode;
};

export type AppObjectRowButtonProps = AppObjectRowBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
    readonly as?: "button";
  };

export type AppObjectRowDivProps = AppObjectRowBaseProps &
  Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
    readonly as: "div";
  };

export type AppObjectRowProps = AppObjectRowButtonProps | AppObjectRowDivProps;

const activateDivButton = (
  event: KeyboardEvent<HTMLDivElement>
): void => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const target = event.currentTarget;
  if (target.getAttribute("aria-disabled") === "true") {
    return;
  }
  event.preventDefault();
  target.click();
};

export const AppObjectRow = forwardRef<HTMLButtonElement | HTMLDivElement, AppObjectRowProps>(({
  active = false,
  actions,
  as = "button",
  badges,
  className,
  description,
  icon,
  meta,
  title,
  ...props
}, ref) => {
  const content = (
    <>
      {icon === undefined ? null : (
        <span className="lyra-app-object-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="lyra-app-object-row-main">
        <span className="lyra-app-object-row-head">
          <span className="lyra-app-object-row-title">{title}</span>
          {meta === undefined ? null : (
            <span className="lyra-app-object-row-meta">{meta}</span>
          )}
        </span>
        {description === undefined ? null : (
          <span className="lyra-app-object-row-description">{description}</span>
        )}
      </span>
      {badges === undefined ? null : (
        <span className="lyra-app-object-row-badges">{badges}</span>
      )}
      {actions === undefined ? null : (
        <span
          className="lyra-app-object-row-actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      )}
    </>
  );
  const rowClassName = cn("lyra-app-object-row", className);

  if (as === "div") {
    const divProps = props as Omit<HTMLAttributes<HTMLDivElement>, "title">;
    const {
      onKeyDown,
      role,
      ...restDivProps
    } = divProps;
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={rowClassName}
        data-active={active ? "true" : undefined}
        data-has-actions={actions === undefined ? undefined : "true"}
        data-has-icon={icon === undefined ? undefined : "true"}
        role={role}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && role === "button") {
            activateDivButton(event);
          }
        }}
        {...restDivProps}
      >
        {content}
      </div>
    );
  }

  const buttonProps = props as Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title">;
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      className={rowClassName}
      data-active={active ? "true" : undefined}
      data-has-actions={actions === undefined ? undefined : "true"}
      data-has-icon={icon === undefined ? undefined : "true"}
      {...buttonProps}
    >
      {content}
    </button>
  );
});

AppObjectRow.displayName = "AppObjectRow";
