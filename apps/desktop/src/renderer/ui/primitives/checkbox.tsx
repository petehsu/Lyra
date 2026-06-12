import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { forwardRef, type ElementRef } from "react";

import { cn } from "../utils";

export type CheckboxProps = CheckboxPrimitive.CheckboxProps;

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn("lyra-ui-checkbox", className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="lyra-ui-checkbox-indicator">
      <Check className="lyra-ui-checkbox-icon" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));

Checkbox.displayName = CheckboxPrimitive.Root.displayName;
