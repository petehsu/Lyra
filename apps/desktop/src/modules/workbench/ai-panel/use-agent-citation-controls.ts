import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";

import type {
  AgentPageCitation,
  AgentSessionSnapshot,
  AgentTranscriptCitation
} from "../../../shared/agent";
import type { ComposerCitationSink } from "../shell/use-browser-page-context-menu";
import type { CitationScrollTarget } from "./lyra-agents/data/DataProvider";
import type { ComposerInsertableCitation } from "./lyra-agents/features/chat/message-citation";

export const useAgentCitationControls = ({
  session,
  composerCitationSinkRef,
  setPendingCitation,
  setPendingCitationNonce,
  setRenderBudgetCount,
  setCitationScrollTarget,
  setCitationHighlightMessageId
}: {
  readonly session: AgentSessionSnapshot | null;
  readonly composerCitationSinkRef?: MutableRefObject<ComposerCitationSink | null> | undefined;
  readonly setPendingCitation: Dispatch<SetStateAction<ComposerInsertableCitation | null>>;
  readonly setPendingCitationNonce: Dispatch<SetStateAction<number>>;
  readonly setRenderBudgetCount: Dispatch<SetStateAction<number>>;
  readonly setCitationScrollTarget: Dispatch<SetStateAction<CitationScrollTarget | null>>;
  readonly setCitationHighlightMessageId: Dispatch<SetStateAction<string | null>>;
}) => {
  const citationHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addCitationToComposer = useCallback((citation: AgentTranscriptCitation): void => {
    setPendingCitation({ kind: "transcript", citation });
    setPendingCitationNonce((value) => value + 1);
  }, [setPendingCitation, setPendingCitationNonce]);

  const addPageCitationToComposer = useCallback((citation: AgentPageCitation): void => {
    setPendingCitation({ kind: "page", citation });
    setPendingCitationNonce((value) => value + 1);
  }, [setPendingCitation, setPendingCitationNonce]);

  useEffect(() => {
    if (composerCitationSinkRef === undefined) return;
    composerCitationSinkRef.current = { addPageCitation: addPageCitationToComposer };
    return () => {
      if (composerCitationSinkRef.current?.addPageCitation === addPageCitationToComposer) {
        composerCitationSinkRef.current = null;
      }
    };
  }, [addPageCitationToComposer, composerCitationSinkRef]);

  const ensureMessageVisible = useCallback((messageId: string): boolean => {
    if (session === null) return false;
    const index = session.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return false;
    const neededFromEnd = session.messages.length - index;
    setRenderBudgetCount((current) => Math.max(current, neededFromEnd));
    return true;
  }, [session, setRenderBudgetCount]);

  const reportCitationScrollFinished = useCallback((messageId: string): void => {
    setCitationScrollTarget((current) =>
      current?.messageId === messageId ? null : current
    );
    if (citationHighlightTimerRef.current !== null) {
      clearTimeout(citationHighlightTimerRef.current);
      citationHighlightTimerRef.current = null;
    }
    const startHighlight = (): void => {
      setCitationHighlightMessageId(messageId);
      citationHighlightTimerRef.current = setTimeout(() => {
        setCitationHighlightMessageId(null);
        citationHighlightTimerRef.current = null;
      }, 2600);
    };
    setCitationHighlightMessageId((current) => current === messageId ? null : current);
    window.requestAnimationFrame(startHighlight);
  }, [setCitationHighlightMessageId, setCitationScrollTarget]);

  const scrollToMessage = useCallback(async (
    messageId: string,
    options?: {
      readonly blockId?: string | null;
      readonly startOffset?: number | null;
    }
  ): Promise<void> => {
    ensureMessageVisible(messageId);
    setCitationScrollTarget({
      messageId,
      blockId: options?.blockId ?? null,
      startOffset: options?.startOffset ?? null,
      token: performance.now()
    });
  }, [ensureMessageVisible, setCitationScrollTarget]);

  return {
    addCitationToComposer,
    addPageCitationToComposer,
    reportCitationScrollFinished,
    scrollToMessage
  };
};
