import type * as ReactNamespace from "react";
import type * as ReactDomClientNamespace from "react-dom/client";
import type * as ReactJsxRuntimeNamespace from "react/jsx-runtime";

export const FIRST_PARTY_UI_RUNTIME_VERSION = "1.0.0" as const;

export type FirstPartyCodeEditorSelectionV1 = {
  /** UTF-16 offsets into the current model, matching DOM textarea selection semantics. */
  readonly start: number;
  readonly end: number;
};

export type FirstPartyCodeEditorPresentationV1 = {
  readonly themeId: string;
  readonly themeTone: "light" | "dark";
};

export type FirstPartyCodeEditorCompletionPositionV1 = {
  /** Zero-based line, matching the Runtime LSP protocol. */
  readonly line: number;
  /** Zero-based UTF-16 column, matching the Runtime LSP protocol. */
  readonly column: number;
};

export type FirstPartyCodeEditorCompletionItemV1 = {
  readonly label: string;
  readonly insertText?: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly kind?: number;
  readonly sortText?: string;
  readonly filterText?: string;
};

export type FirstPartyCodeEditorUpdateV1 = {
  readonly value?: string;
  readonly languageId?: string;
  readonly readOnly?: boolean;
  readonly selection?: FirstPartyCodeEditorSelectionV1;
  readonly presentation?: FirstPartyCodeEditorPresentationV1;
};

export type FirstPartyCodeEditorHandleV1 = {
  readonly getValue: () => string;
  readonly getSelection: () => FirstPartyCodeEditorSelectionV1 | null;
  readonly update: (update: FirstPartyCodeEditorUpdateV1) => void;
  readonly focus: () => void;
  readonly layout: () => void;
  readonly dispose: () => void;
};

export type FirstPartyCodeDiffUpdateV1 = {
  readonly original?: string;
  readonly modified?: string;
  readonly languageId?: string;
  readonly presentation?: FirstPartyCodeEditorPresentationV1;
};

export type FirstPartyCodeDiffHandleV1 = {
  readonly update: (update: FirstPartyCodeDiffUpdateV1) => void;
  readonly layout: () => void;
  readonly dispose: () => void;
};

export type FirstPartyCodeEditorMountOptionsV1 = {
  readonly container: HTMLElement;
  /** Stable only for the lifetime of the version-pinned module instance. */
  readonly resourceId: string;
  readonly value: string;
  readonly languageId: string;
  readonly readOnly: boolean;
  readonly selection?: FirstPartyCodeEditorSelectionV1;
  readonly presentation: FirstPartyCodeEditorPresentationV1;
  readonly onChange: (value: string) => void;
  readonly onSelectionChange: (selection: FirstPartyCodeEditorSelectionV1) => void;
  readonly onSave: () => void | Promise<void>;
  readonly onFocusChange?: (focused: boolean) => void;
  readonly provideCompletions: (
    position: FirstPartyCodeEditorCompletionPositionV1
  ) => Promise<readonly FirstPartyCodeEditorCompletionItemV1[]>;
};

export type FirstPartyCodeDiffMountOptionsV1 = {
  readonly container: HTMLElement;
  readonly resourceId: string;
  readonly original: string;
  readonly modified: string;
  readonly languageId: string;
  readonly presentation: FirstPartyCodeEditorPresentationV1;
};

/**
 * Private, same-renderer facade over the Core-owned Monaco runtime. First-party
 * bundles depend on this stable facade, never on Monaco or Desktop source.
 */
export type FirstPartyCodeEditorServiceV1 = {
  readonly mountEditor: (
    options: FirstPartyCodeEditorMountOptionsV1
  ) => Promise<FirstPartyCodeEditorHandleV1>;
  readonly mountDiff: (
    options: FirstPartyCodeDiffMountOptionsV1
  ) => Promise<FirstPartyCodeDiffHandleV1>;
};

export type FirstPartyUiServicesV1 = {
  readonly codeEditor?: FirstPartyCodeEditorServiceV1;
};

export type FirstPartyUiRuntimeV1 = {
  readonly version: typeof FIRST_PARTY_UI_RUNTIME_VERSION;
  readonly react: typeof ReactNamespace;
  readonly reactDomClient: typeof ReactDomClientNamespace;
  readonly jsxRuntime: typeof ReactJsxRuntimeNamespace;
  readonly services?: FirstPartyUiServicesV1;
};

declare global {
  var __LYRA_FIRST_PARTY_UI_RUNTIME_V1__: FirstPartyUiRuntimeV1 | undefined;
}

export const requireFirstPartyUiRuntime = (): FirstPartyUiRuntimeV1 => {
  const runtime = globalThis.__LYRA_FIRST_PARTY_UI_RUNTIME_V1__;
  if (runtime?.version !== FIRST_PARTY_UI_RUNTIME_VERSION) {
    throw new Error("Lyra first-party UI runtime is unavailable or incompatible.");
  }
  return runtime;
};

/**
 * Optional because an installed app may run against an older compatible Core.
 * Callers must retain a functional non-Monaco fallback when the service is not
 * advertised. An incompatible UI runtime still fails closed.
 */
export const optionalFirstPartyCodeEditorService = (
): FirstPartyCodeEditorServiceV1 | undefined => {
  const runtime = globalThis.__LYRA_FIRST_PARTY_UI_RUNTIME_V1__;
  if (runtime === undefined) {
    return undefined;
  }
  if (runtime.version !== FIRST_PARTY_UI_RUNTIME_VERSION) {
    throw new Error("Lyra first-party UI runtime is incompatible.");
  }
  return runtime.services?.codeEditor;
};
