import { X } from "lucide-react";
import {
  forwardRef,
  type ComponentProps,
  type ElementRef,
  type ReactNode
} from "react";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from "../primitives";
import { cn } from "../utils";
import { AppIconButton } from "./app-icon-button";

export type AppToastTone = "neutral" | "info" | "success" | "warning" | "error";

export type AppToastProps = ComponentProps<typeof Toast> & {
  readonly action?: ReactNode;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly tone?: AppToastTone;
};

export type AppToastProviderProps = ComponentProps<typeof ToastProvider>;
export type AppToastViewportProps = ComponentProps<typeof ToastViewport>;

export const AppToastProvider = ToastProvider;
export const AppToastViewport = ToastViewport;

export const AppToast = forwardRef<ElementRef<typeof Toast>, AppToastProps>(({
  action,
  children,
  className,
  closeLabel = "Dismiss notification",
  description,
  icon,
  title,
  tone = "neutral",
  ...props
}, ref) => (
  <Toast
    ref={ref}
    className={cn("lyra-app-toast", className)}
    data-tone={tone}
    {...props}
  >
    {icon === undefined ? null : (
      <span className="lyra-app-toast-icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <span className="lyra-app-toast-copy">
      <ToastTitle>{title}</ToastTitle>
      {description === undefined ? null : (
        <ToastDescription>{description}</ToastDescription>
      )}
      {children}
    </span>
    {action === undefined ? null : (
      <span className="lyra-app-toast-action">
        {action}
      </span>
    )}
    <ToastClose asChild>
      <AppIconButton aria-label={closeLabel} title={closeLabel} className="lyra-app-toast-close">
        <X aria-hidden="true" size={14} />
      </AppIconButton>
    </ToastClose>
  </Toast>
));

AppToast.displayName = "AppToast";
