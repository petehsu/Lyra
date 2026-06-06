import type { ReactNode } from "react";

export declare const Canvas: (props: {
  readonly camera?: unknown;
  readonly dpr?: number | readonly [number, number];
  readonly flat?: boolean;
  readonly frameloop?: "always" | "demand" | "never";
  readonly gl?: unknown;
  readonly linear?: boolean;
  readonly children?: ReactNode;
}) => ReactNode;

export declare const useFrame: (
  callback: (state: unknown, delta: number) => void
) => void;

export declare const useThree: () => {
  readonly invalidate: () => void;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any;
      planeGeometry: any;
      shaderMaterial: any;
    }
  }
}
