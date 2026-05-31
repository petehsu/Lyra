import { useEffect, useMemo, useRef, useState } from "react";

import { LyraBrandLogo } from "../brand";
import { AnimatedMagicBorder } from "./animated-magic-border";

type PillPhase = "idle" | "exit" | "enter";

export type TitlebarAiLaunchPillProps = {
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly logoUrl: string;
  readonly prefix: string;
  readonly verbs: readonly string[];
  readonly ariaLabel: string;
  readonly verbRotationMs?: number;
  readonly exitDurationMs?: number;
  readonly enterDurationMs?: number;
};

const DEFAULT_ROTATION_MS = 8000;
const DEFAULT_EXIT_MS = 280;
const DEFAULT_ENTER_MS = 360;
const MIN_INTERVAL_MS = 1500;

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

const computeCharDelayMs = (totalChars: number, exitOrEnterMs: number): number => {
  if (totalChars <= 1) {
    return 0;
  }
  const maxPerChar = 32;
  const available = exitOrEnterMs * 0.55;
  const ideal = available / totalChars;
  return Math.max(6, Math.min(maxPerChar, ideal));
};

export const TitlebarAiLaunchPill = ({
  isOpen,
  onToggle,
  logoUrl,
  prefix,
  verbs,
  ariaLabel,
  verbRotationMs = DEFAULT_ROTATION_MS,
  exitDurationMs = DEFAULT_EXIT_MS,
  enterDurationMs = DEFAULT_ENTER_MS,
}: TitlebarAiLaunchPillProps) => {
  const safeVerbs = useMemo(
    () => (verbs.length > 0 ? verbs : [""]),
    [verbs]
  );
  const shortestSizerVerb = useMemo<string>(() => {
    let anchor = safeVerbs[0] ?? "";
    let anchorLength = splitGraphemes(anchor).length;
    for (let index = 1; index < safeVerbs.length; index += 1) {
      const candidate = safeVerbs[index] ?? "";
      const candidateLength = splitGraphemes(candidate).length;
      if (candidateLength < anchorLength) {
        anchor = candidate;
        anchorLength = candidateLength;
      }
    }
    return anchor;
  }, [safeVerbs]);
  const [verbIndex, setVerbIndex] = useState(0);
  const [phase, setPhase] = useState<PillPhase>("idle");
  const [marqueeDistancePx, setMarqueeDistancePx] = useState<number>(0);
  const rotatorRef = useRef<HTMLSpanElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const reducedMotionRef = useRef<boolean>(prefersReducedMotion());
  const pendingTimeouts = useRef<number[]>([]);

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
    if (safeVerbs.length <= 1) {
      return;
    }
    const interval = Math.max(MIN_INTERVAL_MS, verbRotationMs);
    const cleanupPendingTimeouts = (): void => {
      for (const timeoutId of pendingTimeouts.current) {
        window.clearTimeout(timeoutId);
      }
      pendingTimeouts.current = [];
    };

    const handle = window.setInterval(() => {
      if (reducedMotionRef.current) {
        setVerbIndex((current) => (current + 1) % safeVerbs.length);
        return;
      }
      cleanupPendingTimeouts();
      setPhase("exit");
      const swapTimeout = window.setTimeout(() => {
        setVerbIndex((current) => {
          const nextIndex = (current + 1) % safeVerbs.length;
          const nextVerb = safeVerbs[nextIndex] ?? "";
          const nextCharCount = splitGraphemes(nextVerb).length;
          const nextCharDelay = computeCharDelayMs(nextCharCount, enterDurationMs);
          const staggerTail = Math.max(0, nextCharCount - 1) * nextCharDelay;
          const nextRestoreMs = Math.max(0, enterDurationMs) + staggerTail;
          const restoreTimeout = window.setTimeout(() => {
            setPhase("idle");
          }, nextRestoreMs);
          pendingTimeouts.current.push(restoreTimeout);
          return nextIndex;
        });
        setPhase("enter");
      }, Math.max(0, exitDurationMs));
      pendingTimeouts.current.push(swapTimeout);
    }, interval);

    return () => {
      window.clearInterval(handle);
      cleanupPendingTimeouts();
    };
  }, [enterDurationMs, exitDurationMs, safeVerbs, verbRotationMs]);

  const activeVerb = safeVerbs[verbIndex] ?? "";
  const chars = useMemo(() => splitGraphemes(activeVerb), [activeVerb]);
  const animationDuration =
    phase === "exit" ? exitDurationMs : phase === "enter" ? enterDurationMs : 0;
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
  }, [activeVerb, phase, prefix, shortestSizerVerb]);

  const rootClassName = isOpen
    ? "lyra-titlebar-ai-launch lyra-titlebar-ai-launch-open"
    : "lyra-titlebar-ai-launch";

  const hasMarquee = marqueeDistancePx > 0;
  const wordStyle = hasMarquee
    ? ({ "--lyra-pill-marquee-distance": "-" + String(marqueeDistancePx) + "px" } as Record<string, string>)
    : undefined;

  return (
    <button
      type="button"
      className={rootClassName}
      aria-label={ariaLabel}
      aria-pressed={isOpen}
      title={ariaLabel}
      onClick={onToggle}
      data-phase={phase}
    >
      <AnimatedMagicBorder isOpen={isOpen} />
      <LyraBrandLogo
        logoUrl={logoUrl}
        className="lyra-titlebar-ai-launch-logo"
        motion={isOpen ? "active" : "ambient"}
        spinIntensity={isOpen ? "steady" : "subtle"}
        spinDurationMs={isOpen ? 6400 : 18000}
      />
      <span className="lyra-titlebar-ai-launch-text">
        <span className="lyra-titlebar-ai-launch-prefix">{prefix}</span>
        <span ref={rotatorRef} className="lyra-titlebar-ai-launch-rotator">
          <span
            className="lyra-titlebar-ai-launch-sizer"
            aria-hidden="true"
          >
            {shortestSizerVerb}
          </span>
          <span
            ref={wordRef}
            key={String(verbIndex) + ":" + phase}
            className="lyra-titlebar-ai-launch-word"
            data-phase={phase}
            data-marquee={hasMarquee ? "true" : "false"}
            {...(wordStyle === undefined ? {} : { style: wordStyle })}
          >
            {chars.length === 0 ? (
              <span className="lyra-titlebar-ai-launch-char" aria-hidden="true">
                &nbsp;
              </span>
            ) : (
              chars.map((char, index) => (
                <span
                  key={String(index) + ":" + char}
                  className="lyra-titlebar-ai-launch-char"
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
      </span>
    </button>
  );
};
