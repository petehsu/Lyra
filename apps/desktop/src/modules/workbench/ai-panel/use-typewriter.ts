import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Typewriter hook: buffers incoming text and releases it at a controlled rate.
 * Simulates character-by-character appearance for a natural "AI is typing" feel.
 */
type UseTypewriterOptions = {
  /** Characters per second. Default ~40 for comfortable reading speed. */
  charsPerSecond?: number;
  /** Minimum chunk size to release at once. Prevents overly granular updates. */
  minChunkSize?: number;
  /** Whether to skip animation and show all text immediately. */
  instant?: boolean;
  /** Reset buffered output immediately when a new stream identity is observed. */
  resetKey?: string | null;
};

export const useTypewriter = (
  sourceText: string,
  isActive: boolean,
  options: UseTypewriterOptions = {}
): string => {
  const {
    charsPerSecond = 40,
    minChunkSize = 3,
    instant = false,
    resetKey = null
  } = options;

  const [displayText, setDisplayText] = useState("");
  const bufferRef = useRef("");
  const sourceLengthRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActiveRef = useRef(isActive);

  // Track whether we're still receiving updates
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    bufferRef.current = "";
    sourceLengthRef.current = 0;
    setDisplayText("");
  }, [resetKey]);

  // Reset when source text shrinks (new turn started)
  useEffect(() => {
    if (sourceText.length < sourceLengthRef.current) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      bufferRef.current = "";
      sourceLengthRef.current = 0;
      setDisplayText("");
    }
  }, [sourceText.length]);

  // Schedule the next release chunk
  const scheduleNext = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    const buffered = bufferRef.current;
    if (buffered.length === 0) {
      return;
    }

    const releaseCount = Math.min(minChunkSize, buffered.length);
    const intervalMs = Math.max(8, Math.round((releaseCount / charsPerSecond) * 1000));

    timerRef.current = setTimeout(() => {
      const chunk = buffered.slice(0, releaseCount);
      bufferRef.current = buffered.slice(releaseCount);
      setDisplayText((prev) => prev + chunk);
      scheduleNext();
    }, intervalMs);
  }, [charsPerSecond, minChunkSize]);

  // Handle incoming source text updates
  useEffect(() => {
    if (instant || !isActive) {
      return;
    }
    if (sourceText.length <= sourceLengthRef.current) {
      return;
    }

    // Append new characters to the buffer
    const newText = sourceText.slice(sourceLengthRef.current);
    bufferRef.current += newText;
    sourceLengthRef.current = sourceText.length;

    // If nothing is currently displayed, initialize
    if (displayText.length === 0 && bufferRef.current.length > 0) {
      const initialRelease = bufferRef.current.slice(0, minChunkSize);
      bufferRef.current = bufferRef.current.slice(minChunkSize);
      setDisplayText(initialRelease);
      scheduleNext();
      return;
    }

    // If we're caught up to the buffer, release remaining
    if (displayText.length >= sourceLengthRef.current - bufferRef.current.length) {
      scheduleNext();
    }
  }, [sourceText, displayText.length, minChunkSize, scheduleNext, instant, isActive]);

  // When stream ends, flush remaining buffer immediately
  useEffect(() => {
    if (!isActive && bufferRef.current.length > 0) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDisplayText((prev) => prev + bufferRef.current);
      bufferRef.current = "";
    }
  }, [isActive]);

  // When instant mode or animation disabled, bypass entirely
  if (instant || !isActive) {
    return sourceText;
  }

  return displayText;
};
