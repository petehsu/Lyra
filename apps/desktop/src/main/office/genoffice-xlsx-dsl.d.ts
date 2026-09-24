export function applyWorkbookOps(
  source: Buffer,
  rawOps: readonly unknown[],
  opts?: { readonly sourcePath?: string }
): Promise<{ readonly buffer: Uint8Array; readonly applied: number }>;
