import { useEffect, useRef, type RefObject } from "react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { isFileEditorTextModelDisposed } from "./monaco-model-store";

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
    ) {
      return;
    }

    clearModelDecorations(textModel, decorationIdsRef);

    return () => {
      if (isFileEditorTextModelDisposed(textModel) === false) {
        clearModelDecorations(textModel, decorationIdsRef);
      }
    };
  }, [enabled, monacoRef, textModelRef]);
};
