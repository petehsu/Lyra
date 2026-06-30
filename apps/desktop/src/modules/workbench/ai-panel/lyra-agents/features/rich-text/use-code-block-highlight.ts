import { useEffect, type RefObject } from "react";

import { loadMonaco } from "../../../../file-editor/monaco";
import {
  buildMonacoTheme,
  MONACO_THEME_ID
} from "../../../../file-editor/monaco-helpers";

let monacoThemeReady = false;

const ensureMonacoTheme = async (): Promise<void> => {
  if (monacoThemeReady) return;
  const monaco = await loadMonaco();
  monaco.editor.defineTheme(MONACO_THEME_ID, buildMonacoTheme());
  monaco.editor.setTheme(MONACO_THEME_ID);
  monacoThemeReady = true;
};

export function useCodeBlockHighlight(
  rootRef: RefObject<HTMLDivElement | null>,
  contentSignature: string,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (root === null) return;

    let disposed = false;
    void ensureMonacoTheme()
      .then(() => loadMonaco())
      .then((monaco) => {
        if (disposed || typeof monaco.editor.colorizeElement !== "function") return;
        const codeBlocks = root.querySelectorAll<HTMLElement>(
          "pre.lyra-agents-md-code-block code"
        );
        for (const code of codeBlocks) {
          monaco.editor.colorizeElement(code, { theme: MONACO_THEME_ID });
        }
      })
      .catch(() => {
        // Monaco not available — code blocks render as plain text
      });

    return () => { disposed = true; };
  }, [rootRef, contentSignature, enabled]);
}