import { type HTMLAttributes } from "react";

import { cn } from "../utils";

export type StatusDotProps = HTMLAttributes<HTMLSpanElement> & {
  readonly tone?: "default" | "success" | "warning" | "error" | "info";
};

export const StatusDot = ({ className, tone = "default", ...props }: StatusDotProps) => (
  <span className={cn("lyra-ui-status-dot", `lyra-ui-status-dot-${tone}`, className)} {...props} />
);
