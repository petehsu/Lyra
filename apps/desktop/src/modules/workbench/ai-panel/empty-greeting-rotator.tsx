import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";

type EmptyGreetingPhase = "idle" | "exit" | "enter";

const EMPTY_GREETING_ROTATION_MS = 8000;
const EMPTY_GREETING_EXIT_MS = 280;
const EMPTY_GREETING_ENTER_MS = 360;

const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const splitGraphemes = (input: string): readonly string[] => {
  if (input.length === 0) {
    return [];
  }
  const IntlAny = Intl as typeof Intl & {
    Segmenter?: new (locale?: string, options?: { granularity?: "grapheme" | "word" | "sentence" }) => {
      segment(text: string): Iterable<{ segment: string }>;
    };
  };
  if (typeof IntlAny.Segmenter === "function") {
    try {
      const segmenter = new IntlAny.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(segmenter.segment(input), (chunk) => chunk.segment);
    } catch (_error) {
      /* fall back to array spread */
    }
  }
  return Array.from(input);
};

const computeCharDelayMs = (totalChars: number, durationMs: number): number => {
  if (totalChars <= 1) {
    return 0;
  }
  const available = durationMs * 0.55;
  const ideal = available / totalChars;
  return Math.max(6, Math.min(32, ideal));
};

export const AiPanelEmptyGreetingRotator = ({
  labels,
  fallbackLabel
}: {
  readonly labels: readonly string[] | undefined;
  readonly fallbackLabel: string;
}) => {
  const labelsSignature = (labels ?? []).join("\u001F");
  const safeLabels = useMemo(
    () => {
      const cleaned = (labels ?? [])
        .map((label) => label.trim())
        .filter((label, index, values) => label.length > 0 && values.indexOf(label) === index);
      return cleaned.length > 0 ? cleaned : [fallbackLabel];
    },
    [fallbackLabel, labelsSignature]
  );
  const longestSizerLabel = useMemo<string>(() => {
    let anchor = safeLabels[0] ?? "";
    let anchorLength = splitGraphemes(anchor).length;
    for (let index = 1; index < safeLabels.length; index += 1) {
      const candidate = safeLabels[index] ?? "";
      const candidateLength = splitGraphemes(candidate).length;
      if (candidateLength > anchorLength) {
        anchor = candidate;
        anchorLength = candidateLength;
      }
    }
    return anchor;
  }, [safeLabels]);
  const [labelIndex, setLabelIndex] = useState(0);
  const [phase, setPhase] = useState<EmptyGreetingPhase>("idle");
  const [marqueeDistancePx, setMarqueeDistancePx] = useState(0);
  const rotatorRef = useRef<HTMLSpanElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const pendingTimeouts = useRef<number[]>([]);

  useEffect(() => {
    setLabelIndex(0);
    setPhase("idle");
  }, [safeLabels]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => {
      reducedMotionRef.current = query.matches;
    };
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => {
        query.removeEventListener("change", update);
      };
    }
    query.addListener(update);
    return () => {
      query.removeListener(update);
    };
  }, []);

  useEffect(() => {
    if (safeLabels.length <= 1) {
      return;
    }
    const cleanupPendingTimeouts = (): void => {
      for (const timeoutId of pendingTimeouts.current) {
        window.clearTimeout(timeoutId);
      }
      pendingTimeouts.current = [];
    };
    const handle = window.setInterval(() => {
      if (reducedMotionRef.current) {
        setLabelIndex((current) => (current + 1) % safeLabels.length);
        return;
      }
      cleanupPendingTimeouts();
      setPhase("exit");
      const swapTimeout = window.setTimeout(() => {
        setLabelIndex((current) => {
          const nextIndex = (current + 1) % safeLabels.length;
          const nextLabel = safeLabels[nextIndex] ?? "";
          const nextCharCount = splitGraphemes(nextLabel).length;
          const nextCharDelay = computeCharDelayMs(nextCharCount, EMPTY_GREETING_ENTER_MS);
          const staggerTail = Math.max(0, nextCharCount - 1) * nextCharDelay;
          const restoreTimeout = window.setTimeout(() => {
            setPhase("idle");
          }, EMPTY_GREETING_ENTER_MS + staggerTail);
          pendingTimeouts.current.push(restoreTimeout);
          return nextIndex;
        });
        setPhase("enter");
      }, EMPTY_GREETING_EXIT_MS);
      pendingTimeouts.current.push(swapTimeout);
    }, EMPTY_GREETING_ROTATION_MS);

    return () => {
      window.clearInterval(handle);
      cleanupPendingTimeouts();
    };
  }, [safeLabels]);

  const activeLabel = safeLabels[labelIndex] ?? fallbackLabel;
  const chars = useMemo(() => splitGraphemes(activeLabel), [activeLabel]);
  const animationDuration =
    phase === "exit" ? EMPTY_GREETING_EXIT_MS : phase === "enter" ? EMPTY_GREETING_ENTER_MS : 0;
  const charDelayMs = computeCharDelayMs(chars.length, animationDuration);

  useEffect(() => {
    const rotator = rotatorRef.current;
    const word = wordRef.current;
    if (rotator === null || word === null) {
      return;
    }
    const measure = (): void => {
      const delta = word.scrollWidth - rotator.clientWidth;
      setMarqueeDistancePx(delta > 0 ? delta : 0);
    };
    measure();
    if (typeof ResizeObserver !== "function") {
      return;
    }
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(rotator);
    observer.observe(word);
    return () => {
      observer.disconnect();
    };
  }, [activeLabel, longestSizerLabel, phase]);

  const hasMarquee = marqueeDistancePx > 0;
  const wordStyle = hasMarquee
    ? ({ "--lyra-pill-marquee-distance": "-" + String(marqueeDistancePx) + "px" } as CSSProperties)
    : undefined;

  return (
    <p className="lyra-ai-agent-empty-greeting">
      <span ref={rotatorRef} className="lyra-ai-agent-empty-greeting-rotator">
        <span className="lyra-ai-agent-empty-greeting-sizer" aria-hidden="true">
          {longestSizerLabel}
        </span>
        <span
          ref={wordRef}
          key={String(labelIndex) + ":" + phase}
          className="lyra-ai-agent-empty-greeting-word"
          data-phase={phase}
          data-marquee={hasMarquee ? "true" : "false"}
          {...(wordStyle === undefined ? {} : { style: wordStyle })}
        >
          {chars.length === 0 ? (
            <span className="lyra-ai-agent-empty-greeting-char" aria-hidden="true">
              &nbsp;
            </span>
          ) : (
            chars.map((char, index) => (
              <span
                key={String(index) + ":" + char}
                className="lyra-ai-agent-empty-greeting-char"
                style={{
                  animationDelay: String(index * charDelayMs) + "ms",
                  animationDuration: String(animationDuration) + "ms",
                }}
              >
                {char === " " ? "\u00a0" : char}
              </span>
            ))
          )}
        </span>
      </span>
    </p>
  );
};
