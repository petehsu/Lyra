export function applyWorkbookOps(
  source: Buffer,
  rawOps: readonly unknown[]
): Promise<{ readonly buffer: Uint8Array; readonly applied: number }>;
