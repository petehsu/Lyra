export type PageSpec = {
  readonly elements: readonly unknown[];
};

export type BuildPageDeps = {
  readonly fetchImage: (url: string) => Promise<{ readonly bytes: Uint8Array; readonly ext: string } | null>;
};

export function parsePageSpecObject(
  parsed: unknown
): { readonly ok: true; readonly spec: PageSpec; readonly warnings: readonly string[] } | { readonly ok: false; readonly error: string };

export function buildDeckPptx(
  spec: { readonly pages: readonly PageSpec[] },
  deps: BuildPageDeps
): Promise<{ readonly bytes: Uint8Array }>;
