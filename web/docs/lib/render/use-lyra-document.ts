"use client";

import { useEffect, useState } from "react";

import { renderDocumentWasm } from "./wasm-loader";
import type { LyraRenderDocument } from "./types";

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

export const useLyraDocument = (
  content: string,
  enabled: boolean
): LyraDocumentState => {
  const [state, setState] = useState<LyraDocumentState>(initialState);

  useEffect(() => {
    if (!enabled) {
      setState(initialState);
      return;
    }

    let cancelled = false;
    setState({
      document: null,
      error: null,
      loading: true
    });

    void renderDocumentWasm({
      content,
      mode: "document",
      theme: "dark",
      enableMath: true,
      enableMermaid: true,
      highlightCode: true
    })
      .then((document) => {
        if (cancelled) {
          return;
        }
        setState({
          document,
          error: null,
          loading: false
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          document: null,
          error: error instanceof Error ? error.message : String(error),
          loading: false
        });
      });

    return () => {
      cancelled = true;
    };
  }, [content, enabled]);

  return state;
};