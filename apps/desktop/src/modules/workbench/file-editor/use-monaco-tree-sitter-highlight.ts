import { useEffect, useRef, type RefObject } from "react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import type { HighlightSpan } from "../../../shared/render";
import { isFileEditorTextModelDisposed } from "./monaco-model-store";
import {
  MONACO_TREE_SITTER_HIGHLIGHT_DEBOUNCE_MS,
  monacoLanguageToTreeSitter,
  shouldSkipMonacoTreeSitterHighlight,
  supportsMonacoTreeSitterHighlight
} from "./monaco-tree-sitter-languages";
import { spansToDecorations } from "./monaco-tree-sitter-spans";

type UseMonacoTreeSitterHighlightInput = {
  readonly monacoRef: RefObject<typeof Monaco | null>;
  readonly textModelRef: RefObject<Monaco.editor.ITextModel | null>;
  readonly languageId: string | undefined;
  readonly filePath: string | undefined;
  readonly themeSignature: string;
  readonly enabled: boolean;
};

const clearModelDecorations = (
  model: Monaco.editor.ITextModel,
  decorationIdsRef: { current: string[] }
): void => {
  if (decorationIdsRef.current.length === 0) {
    return;
  }
  decorationIdsRef.current = model.deltaDecorations(decorationIdsRef.current, []);
};

export const useMonacoTreeSitterHighlight = ({
  monacoRef,
  textModelRef,
  languageId,
  filePath,
  themeSignature,
  enabled
}: UseMonacoTreeSitterHighlightInput): void => {
  const decorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const textModel = textModelRef.current;
    if (
      enabled === false
      || monaco === null
      || textModel === null
      || isFileEditorTextModelDisposed(textModel)
      || languageId === undefined
      || filePath === undefined
    ) {
      return;
    }

    if (supportsMonacoTreeSitterHighlight(languageId) === false) {
      clearModelDecorations(textModel, decorationIdsRef);
      return;
    }

    const treeSitterLanguage = monacoLanguageToTreeSitter(languageId, filePath);
    if (treeSitterLanguage === null) {
      clearModelDecorations(textModel, decorationIdsRef);
      return;
    }

    const initialSource = textModel.getValue();
    if (shouldSkipMonacoTreeSitterHighlight(initialSource)) {
      clearModelDecorations(textModel, decorationIdsRef);
      return;
    }

    const renderApi = window.lyraDesktop?.render;
    if (renderApi === undefined) {
      clearModelDecorations(textModel, decorationIdsRef);
      return;
    }

    let cancelled = false;
    let debounceTimer: number | undefined;
    let highlightGeneration = 0;

    const applyDecorations = (
      spans: readonly HighlightSpan[],
      generation: number
    ): void => {
      if (cancelled || generation !== highlightGeneration) {
        return;
      }
      const activeModel = textModelRef.current;
      const activeMonaco = monacoRef.current;
      if (
        activeModel === null
        || activeMonaco === null
        || isFileEditorTextModelDisposed(activeModel)
        || activeModel !== textModel
      ) {
        return;
      }

      const source = activeModel.getValue();
      decorationIdsRef.current = activeModel.deltaDecorations(
        decorationIdsRef.current,
        spansToDecorations(activeMonaco, activeModel, source, spans)
      );
    };

    const scheduleHighlight = (): void => {
      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = undefined;
        const generation = ++highlightGeneration;
        const activeModel = textModelRef.current;
        if (
          activeModel === null
          || isFileEditorTextModelDisposed(activeModel)
          || activeModel !== textModel
        ) {
          return;
        }

        const source = activeModel.getValue();
        if (shouldSkipMonacoTreeSitterHighlight(source)) {
          clearModelDecorations(activeModel, decorationIdsRef);
          return;
        }

        void renderApi
          .highlightSpans({
            language: treeSitterLanguage,
            source,
            theme: "dark"
          })
          .then((spans) => {
            applyDecorations(spans, generation);
          })
          .catch(() => {
            clearModelDecorations(textModel, decorationIdsRef);
          });
      }, MONACO_TREE_SITTER_HIGHLIGHT_DEBOUNCE_MS);
    };

    scheduleHighlight();
    const contentDisposable = textModel.onDidChangeContent(() => {
      scheduleHighlight();
    });

    return () => {
      cancelled = true;
      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer);
      }
      contentDisposable.dispose();
      if (isFileEditorTextModelDisposed(textModel) === false) {
        clearModelDecorations(textModel, decorationIdsRef);
      }
    };
  }, [enabled, filePath, languageId, monacoRef, textModelRef, themeSignature]);
};