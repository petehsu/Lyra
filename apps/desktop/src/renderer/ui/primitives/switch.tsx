import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ElementRef } from "react";

import { cn } from "../utils";

export type SwitchProps = SwitchPrimitive.SwitchProps;

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn("lyra-ui-switch", className)}
    {...props}
  >
    <SwitchPrimitive.Thumb className="lyra-ui-switch-thumb" />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;
