import { useEffect, useRef, useState } from "react";

/**
 * Simulates streaming text output by revealing characters progressively.
 * Returns the currently visible portion of `fullText`.
 *
 * @param fullText - The complete text to stream.
 * @param speed - Characters per lyra-agents-tick (default 2).
 * @param interval - Milliseconds between ticks (default 30).
 * @param enabled - Whether streaming is active (set false to show full text immediately).
 */
export function useStreamText(
  fullText: string,
  {
    speed = 2,
    interval = 30,
    enabled = true,
  }: { speed?: number; interval?: number; enabled?: boolean } = {}
): { text: string; done: boolean } {
  const [streamIndex, setStreamIndex] = useState(0);
  const prevText = useRef(fullText);
  const settledLength = useRef(0);

  useEffect(() => {
    if (fullText === prevText.current) return;
    prevText.current = fullText;
    if (fullText.length < settledLength.current) {
      settledLength.current = 0;
      setStreamIndex(0);
      return;
    }
    setStreamIndex((prev) => Math.max(prev, settledLength.current));
  }, [fullText]);

  const hasSettled = settledLength.current >= fullText.length && fullText.length > 0;
  const charIndex = !enabled || hasSettled
    ? fullText.length
    : streamIndex;

  useEffect(() => {
    if (!enabled || hasSettled) return;
    if (charIndex >= fullText.length) return;

    const timer = window.setInterval(() => {
      setStreamIndex((prev) => {
        const next = prev + speed;
        if (next >= fullText.length) {
          window.clearInterval(timer);
          settledLength.current = fullText.length;
          return fullText.length;
        }
        return next;
      });
    }, interval);

    return () => window.clearInterval(timer);
  }, [fullText, charIndex, speed, interval, enabled, hasSettled]);

  useEffect(() => {
    if (charIndex >= fullText.length && fullText.length > 0) {
      settledLength.current = fullText.length;
    }
  }, [charIndex, fullText.length]);

  return {
    text: fullText.slice(0, charIndex),
    done: charIndex >= fullText.length,
  };
}