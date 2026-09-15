"use client";

import type { IconComponent, IconProps, IconWeight } from "reicon-react/createIcon";
import {
  createElement,
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps
} from "react";

export type LyraIconWeight = IconWeight | "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface LyraIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: string | number;
  color?: string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
  weight?: LyraIconWeight;
}

export type LyraIcon = ForwardRefExoticComponent<
  LyraIconProps & RefAttributes<SVGSVGElement>
>;

export type LucideIcon = LyraIcon;

const lucideClassName = (name: string): string => {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1-$2")
    .toLowerCase();
  return `lucide lucide-${kebab}`;
};

export const mapIconWeight = (
  weight: LyraIconWeight | undefined,
  fill: SVGProps<SVGSVGElement>["fill"]
): IconWeight => {
  if (weight === "Filled" || weight === "fill" || weight === "duotone" || weight === "bold") {
    return "Filled";
  }
  if (typeof fill === "string" && fill !== "none" && fill !== "transparent") {
    return "Filled";
  }
  return "Outline";
};

export const wrapReicon = (Icon: IconComponent, name: string): LyraIcon => {
  const Wrapped = forwardRef<SVGSVGElement, LyraIconProps>(
    function LyraReiconIcon(
      {
        size = 16,
        color = "currentColor",
        strokeWidth,
        absoluteStrokeWidth,
        weight,
        className,
        children,
        fill,
        ...rest
      },
      ref
    ) {
      void absoluteStrokeWidth;
      void children;
      const iconProps = {
        ref,
        size,
        color,
        weight: mapIconWeight(weight, fill),
        className: [lucideClassName(name), className].filter(Boolean).join(" "),
        ...(strokeWidth === undefined ? {} : { strokeWidth }),
        ...rest
      };
      return createElement(Icon, iconProps as IconProps & { ref: typeof ref });
    }
  );
  Wrapped.displayName = name;
  return Wrapped;
};

type BrandGlyph = {
  readonly svgContent: string;
};

export const wrapBrand = (icon: BrandGlyph, name: string): LyraIcon => {
  const Wrapped = forwardRef<SVGSVGElement, LyraIconProps>(
    function LyraBrandIcon(
      {
        size = 16,
        color = "currentColor",
        className,
        strokeWidth,
        absoluteStrokeWidth,
        weight,
        children,
        fill,
        ...rest
      },
      ref
    ) {
      void strokeWidth;
      void absoluteStrokeWidth;
      void weight;
      void children;
      return createElement("svg", {
        ref,
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: typeof fill === "string" && fill !== "none" ? fill : color,
        className: [lucideClassName(name), className].filter(Boolean).join(" "),
        "aria-hidden": "true",
        dangerouslySetInnerHTML: { __html: icon.svgContent },
        ...rest
      });
    }
  );
  Wrapped.displayName = name;
  return Wrapped;
};
