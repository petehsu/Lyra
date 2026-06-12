import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppStatusMessageTone = "neutral" | "success" | "warning" | "error" | "info";

export type AppStatusMessageProps = HTMLAttributes<HTMLParagraphElement> & {
  readonly icon?: ReactNode;
  readonly tone?: AppStatusMessageTone;
};

export const AppStatusMessage = forwardRef<HTMLParagraphElement, AppStatusMessageProps>(({
  children,
  className,
  icon,
  tone = "neutral",
  ...props
}, ref) => (
  <p
    ref={ref}
    className={cn("lyra-app-status-message", `lyra-app-status-message-${tone}`, className)}
    {...props}
  >
    {icon === undefined ? null : (
      <span className="lyra-app-status-message-icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <span className="lyra-app-status-message-content">{children}</span>
  </p>
));

AppStatusMessage.displayName = "AppStatusMessage";
