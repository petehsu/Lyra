import { useEffect, useRef, useState } from "react";

import type { LyraRenderDocument } from "../../../../../../shared/render";
import {
  renderDocument,
  resolveCachedDocument
} from "../../../../../../shared/render-wasm/render-document";

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

const STREAM_DEBOUNCE_MS = 120;

const resolveInitialState = (
  content: string,
  enabled: boolean,
  streaming: boolean
): LyraDocumentState => {
  if (!enabled) {
    return initialState;
  }
  const cached = resolveCachedDocument({ content, streaming });
  if (cached === null) {
    return initialState;
  }
  return {
    document: cached,
    error: null,
    loading: false
  };
};

export const useLyraDocument = (
  content: string,
  enabled: boolean,
  streaming = false
): LyraDocumentState => {
  const [state, setState] = useState<LyraDocumentState>(() =>
    resolveInitialState(content, enabled, streaming)
  );
  const requestIdRef = useRef(0);
  const lastContentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(initialState);
      return;
    }

    const cached = resolveCachedDocument({ content, streaming });
    if (cached !== null) {
      lastContentRef.current = content;
      setState({
        document: cached,
        error: null,
        loading: false
      });
      return;
    }

    if (
      !streaming &&
      lastContentRef.current !== null &&
      content === lastContentRef.current
    ) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((previous) => ({
      document: previous.document,
      error: null,
      loading: previous.document === null
    }));

    const debounceMs = streaming ? STREAM_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      void renderDocument({ content, streaming })
        .then((document) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          lastContentRef.current = content;
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
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, enabled, streaming]);

  return state;
};