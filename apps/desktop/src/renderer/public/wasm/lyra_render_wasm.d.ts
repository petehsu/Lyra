/* tslint:disable */
/* eslint-disable */

export function highlight_spans_json(input: string): string;

export function invalidate_render_cache(): void;

export function render_document_json(input: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly highlight_spans_json: (a: number, b: number, c: number) => void;
    readonly render_document_json: (a: number, b: number, c: number) => void;
    readonly invalidate_render_cache: () => void;
    readonly abort: () => void;
    readonly calloc: (a: number, b: number) => number;
    readonly clock: () => number;
    readonly dup: (a: number) => number;
    readonly fclose: (a: number) => number;
    readonly fdopen: (a: number, b: number) => number;
    readonly fputc: (a: number, b: number) => number;
    readonly fputs: (a: number, b: number) => number;
    readonly free: (a: number) => void;
    readonly fwrite: (a: number, b: number, c: number, d: number) => number;
    readonly iswalnum: (a: number) => number;
    readonly iswalpha: (a: number) => number;
    readonly iswdigit: (a: number) => number;
    readonly iswlower: (a: number) => number;
    readonly iswspace: (a: number) => number;
    readonly iswupper: (a: number) => number;
    readonly iswxdigit: (a: number) => number;
    readonly malloc: (a: number) => number;
    readonly memchr: (a: number, b: number, c: number) => number;
    readonly realloc: (a: number, b: number) => number;
    readonly strchr: (a: number, b: number) => number;
    readonly strcmp: (a: number, b: number) => number;
    readonly strncmp: (a: number, b: number, c: number) => number;
    readonly strncpy: (a: number, b: number, c: number) => number;
    readonly towlower: (a: number) => number;
    readonly towupper: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
