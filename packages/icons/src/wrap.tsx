"use client";

import type { LucideIcon as LucideGlyph, LucideProps } from "lucide-react";
import {
  createElement,
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps
} from "react";

export type LyraIconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone" | "Filled" | "Outline";

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

export const resolveLucideStrokeWidth = (
  weight: LyraIconWeight | undefined,
  fill: SVGProps<SVGSVGElement>["fill"],
  strokeWidth: number | undefined
): number => {
  if (strokeWidth !== undefined) {
    return strokeWidth;
  }
  if (weight === "thin") {
    return 1;
  }
  if (weight === "light") {
    return 1.5;
  }
  if (
    weight === "bold" ||
    weight === "fill" ||
    weight === "Filled" ||
    weight === "duotone"
  ) {
    return 2.5;
  }
  if (typeof fill === "string" && fill !== "none" && fill !== "transparent") {
    return 2.5;
  }
  return 2;
};

export const wrapLucide = (Icon: LucideGlyph, name: string): LyraIcon => {
  const Wrapped = forwardRef<SVGSVGElement, LyraIconProps>(
    function LyraLucideIcon(
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
      void children;
      const iconProps: LucideProps & { ref: typeof ref } = {
        ref,
        size,
        color,
        strokeWidth: resolveLucideStrokeWidth(weight, fill, strokeWidth),
        className: [lucideClassName(name), className].filter(Boolean).join(" "),
        ...rest,
        ...(absoluteStrokeWidth === undefined ? {} : { absoluteStrokeWidth })
      };
      return createElement(Icon, iconProps);
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
