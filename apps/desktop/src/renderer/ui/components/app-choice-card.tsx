import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppChoiceCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly active?: boolean;
  readonly description?: ReactNode;
  readonly label?: ReactNode;
  readonly preview?: ReactNode;
};

export const AppChoiceCard = forwardRef<HTMLButtonElement, AppChoiceCardProps>(({
  active = false,
  children,
  className,
  description,
  label,
  preview,
  type = "button",
  ...props
}, ref) => (
  <button
    ref={ref}
    className={cn("lyra-ui-choice-card", className)}
    data-state={active ? "checked" : "unchecked"}
    type={type}
    {...props}
  >
    {preview}
    {children ?? (
      <span className="lyra-ui-choice-card-main">
        {label === undefined ? null : <strong>{label}</strong>}
        {description === undefined ? null : <small>{description}</small>}
      </span>
    )}
  </button>
));

AppChoiceCard.displayName = "AppChoiceCard";
