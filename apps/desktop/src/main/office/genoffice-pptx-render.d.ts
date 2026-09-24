export const EMU_PER_PX_96: number;

export type AuditSuggest = {
  readonly op: "setTransform";
  readonly target: { readonly slide?: number | string; readonly el: string };
  readonly box: { readonly x: number; readonly y: number; readonly cx: number; readonly cy: number };
  readonly rotDeg?: number;
};

export type AuditFinding = {
  readonly code: string;
  readonly el: string;
  readonly message: string;
  readonly suggest?: AuditSuggest;
};

export function buildRenderSlide(
  slide: unknown,
  size: { readonly cx: number; readonly cy: number },
  options: { readonly fitWidthPx: number; readonly slideNo?: number }
): unknown;

export function auditSlideFindings(
  slide: unknown,
  idOf?: (sourceId: string) => string
): AuditFinding[];
