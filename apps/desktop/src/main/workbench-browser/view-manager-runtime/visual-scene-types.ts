import type {
  BrowserActionEffect,
  WorkbenchBrowserAgentElementBounds,
  WorkbenchBrowserAgentModeRequest,
} from "../types";
import type { PointerOptions } from "./bound-pointer";

export type VisualPoint = { readonly x: number; readonly y: number };
export type VisualCell = { readonly row: number; readonly column: number };
export type VisualGrid = {
  readonly source: "dom" | "image-lines";
  /** Normalized real control centers or visible line crossings, not canvas edges. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly cells?: readonly Omit<VisualMark, "mark" | "grid">[];
};
export type VisualMark = {
  readonly mark: string;
  readonly name?: string;
  readonly renderState?: unknown;
  readonly targetRef: string;
  readonly frameTreeNodeId: number;
  readonly documentId: string;
  readonly signature: string;
  readonly kind: "control" | "region";
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly role: string;
  readonly disabled: boolean;
  readonly interactionEvidence?: "occluding-hit-surface";
  readonly grid?: VisualGrid;
  readonly gridCell?: boolean;
};
export type VisualScene = {
  readonly captureId: string;
  readonly marks: readonly VisualMark[];
  readonly clip: WorkbenchBrowserAgentElementBounds;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly totalVisible: number;
  readonly nextOffset?: number;
  readonly documentId: string;
  readonly pixelHash?: string;
  /** Internal clean image + DOM capture; never included in provider scene JSON. */
  readonly pointEvidence?:
    | {
        readonly id: string;
        readonly png: string;
        readonly width: number;
        readonly height: number;
      }
    | undefined;
  readonly lastInput?: VisualStep | undefined;
};
export type VisualSeeRequest = WorkbenchBrowserAgentModeRequest & {
  readonly highlightTargets?: boolean;
  readonly highlightTargetRefs?: readonly string[];
  readonly downsampleForVision?: boolean;
  /** A previously returned region/control mark, retaining the same numbering. */
  readonly region?: string;
  /** Detail around one published grid cell; requires region. */
  readonly cell?: VisualCell;
  /** Pixel enlargement; never changes page layout or invents image detail. */
  readonly zoom?: number;
  readonly offset?: number;
  readonly maxMarks?: number;
};
export type VisualAnchor = {
  readonly anchor: "center" | "lastInput" | VisualCell;
  readonly direction?:
    | "up"
    | "down"
    | "left"
    | "right"
    | "upLeft"
    | "upRight"
    | "downLeft"
    | "downRight";
  readonly steps?: number;
};
export type VisualStep = {
  readonly interaction:
    | "click"
    | "doubleClick"
    | "rightClick"
    | "hover"
    | "drag"
    | "scroll"
    | "type"
    | "press";
  readonly mark?: string;
  /** 1-based row/column in a published grid. */
  readonly cell?: VisualCell;
  readonly at?: VisualAnchor;
  readonly toAt?: VisualAnchor;
  /** Fractions within the marked object's live bounds. */
  readonly position?: VisualPoint;
  readonly toMark?: string;
  readonly toCell?: VisualCell;
  readonly toPosition?: VisualPoint;
  /** Screenshot pixels, only for regions without usable object references. */
  readonly point?: VisualPoint;
  readonly to?: VisualPoint;
  /** A continuous drag path; fractions when mark is supplied, image pixels otherwise. */
  readonly path?: readonly VisualPoint[];
  readonly durationMs?: number;
  readonly holdMs?: number;
  readonly modifiers?: NonNullable<PointerOptions["modifiers"]>;
  readonly button?: NonNullable<PointerOptions["button"]>;
  readonly scrollDx?: number;
  readonly scrollDy?: number;
  readonly text?: string;
  readonly clear?: boolean;
  readonly key?: string;
};
export type VisualActRequest = WorkbenchBrowserAgentModeRequest &
  Omit<VisualStep, "interaction"> & {
    readonly captureId?: string | undefined;
    readonly interaction?: VisualStep["interaction"] | "sequence";
    readonly steps?: readonly VisualStep[];
    readonly effect: BrowserActionEffect;
    readonly observe?: "auto" | "image" | "structure" | "none";
    readonly settleTimeoutMs?: number;
    readonly after?: {
      readonly until:
        | "textContains"
        | "textGone"
        | "targetHidden"
        | "targetEnabled"
        | "stateChanged";
      readonly text?: string;
      readonly mark?: string;
      readonly timeoutMs?: number;
    };
    readonly timeoutMs?: number;
  };
