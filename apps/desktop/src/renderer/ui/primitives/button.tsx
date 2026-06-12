import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../utils";

export const buttonVariants = cva("lyra-ui-button", {
  variants: {
    variant: {
      default: "lyra-ui-button-default",
      secondary: "lyra-ui-button-secondary",
      outline: "lyra-ui-button-outline",
      ghost: "lyra-ui-button-ghost",
      destructive: "lyra-ui-button-destructive"
    },
    size: {
      sm: "lyra-ui-button-size-sm",
      md: "lyra-ui-button-size-md",
      lg: "lyra-ui-button-size-lg",
      icon: "lyra-ui-button-size-icon"
    }
  },
  defaultVariants: {
    variant: "default",
    size: "md"
  }
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  asChild = false,
  className,
  size,
  type = "button",
  variant,
  ...props
}, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : type}
      {...props}
    />
  );
});

Button.displayName = "Button";
