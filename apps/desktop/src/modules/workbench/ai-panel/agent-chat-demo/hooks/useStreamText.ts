import { useEffect, useRef, useState } from "react";

/**
 * Simulates streaming text output by revealing characters progressively.
 * Returns the currently visible portion of `fullText`.
 *
 * @param fullText - The complete text to stream.
 * @param speed - Characters per tick (default 2).
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
  const charIndex = enabled ? streamIndex : fullText.length;

  // If fullText changes (new content appended), keep streaming from where we were
  useEffect(() => {
    if (fullText !== prevText.current) {
      // Text grew — don't reset, just let the interval catch up
      prevText.current = fullText;
    }
  }, [fullText]);

  useEffect(() => {
    if (!enabled) return;
    if (charIndex >= fullText.length) return;

    const timer = window.setInterval(() => {
      setStreamIndex((prev) => {
        const next = prev + speed;
        if (next >= fullText.length) {
          window.clearInterval(timer);
          return fullText.length;
        }
        return next;
      });
    }, interval);

    return () => window.clearInterval(timer);
  }, [fullText, charIndex, speed, interval, enabled]);

  return {
    text: fullText.slice(0, charIndex),
    done: charIndex >= fullText.length,
  };
}
