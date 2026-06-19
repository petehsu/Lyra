import { useEffect, useRef, useState } from "react";

import type { LyraRenderDocument } from "../../../../../../shared/render";

type LyraDocumentState = {
  readonly document: LyraRenderDocument | null;
  readonly error: string | null;
  readonly loading: boolean;
};

const initialState: LyraDocumentState = {
  document: null,
  error: null,
  loading: false
};

const RENDER_DEBOUNCE_MS = 120;

export const useLyraDocument = (
  content: string,
  enabled: boolean
): LyraDocumentState => {
  const [state, setState] = useState<LyraDocumentState>(initialState);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState(initialState);
      return;
    }

    const renderApi = window.lyraDesktop?.render;
    if (renderApi === undefined) {
      setState({
        document: null,
        error: "render bridge unavailable",
        loading: false
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((previous) => ({
      document: previous.document,
      error: null,
      loading: previous.document === null
    }));

    const timer = window.setTimeout(() => {
      void renderApi
        .renderDocument({
          content,
          mode: "document",
          enableMath: true,
          enableMermaid: true,
          highlightCode: true
        })
        .then((document) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setState({
            document,
            error: null,
            loading: false
          });
        })
        .catch((error: unknown) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          if (import.meta.env.DEV) {
            console.warn("[lyra-render] document render failed:", message);
          }
          setState((previous) => ({
            document: previous.document,
            error: message,
            loading: false
          }));
        });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, enabled]);

  return state;
};