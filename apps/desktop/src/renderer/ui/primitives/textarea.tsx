import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "../utils";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("lyra-ui-textarea", className)} {...props} />
));

Textarea.displayName = "Textarea";
