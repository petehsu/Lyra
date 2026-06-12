import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("lyra-ui-input", className)} {...props} />
));

Input.displayName = "Input";
