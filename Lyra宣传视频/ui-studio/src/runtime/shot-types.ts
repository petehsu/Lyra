import type { ComponentType } from "react";

export type ShotViewport = {
  readonly width: number;
  readonly height: number;
};

export type ShotDefinition = {
  readonly id: string;
  readonly title: string;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly viewport: ShotViewport;
  readonly Scene?: ComponentType;
  readonly prepare?: () => void | Promise<void>;
  readonly seek?: (timeMs: number) => void | Promise<void>;
};

export const defineShot = <T extends ShotDefinition>(shot: T): T => shot;
