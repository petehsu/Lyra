import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppButton } from "@renderer/ui/components";
import { LyraBrandLogo } from "../brand";

type PillPhase = "idle" | "exit" | "enter";

export type TitlebarAiLaunchPillProps = {
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly logoUrl: string;
  readonly prefix: string;
  readonly verbs: readonly string[];
  readonly ariaLabel: string;
  readonly exitDurationMs?: number;
  readonly enterDurationMs?: number;
};

const DEFAULT_EXIT_MS = 280;
const DEFAULT_ENTER_MS = 360;
const LOGO_SPIN_DURATION_MS = 640;

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
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
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

  const clearPendingTimeouts = useCallback((): void => {
    for (const timeoutId of pendingTimeouts.current) {
      window.clearTimeout(timeoutId);
    }
    pendingTimeouts.current = [];
  }, []);

  const scheduleTimeout = useCallback((callback: () => void, delayMs: number): void => {
    const timeoutId = window.setTimeout(() => {
      pendingTimeouts.current = pendingTimeouts.current.filter((id) => id !== timeoutId);
      callback();
    }, delayMs);
    pendingTimeouts.current.push(timeoutId);
  }, []);

  useEffect(() => clearPendingTimeouts, [clearPendingTimeouts]);

  const playHoverMotion = useCallback((): void => {
    if (phase !== "idle") {
      return;
    }
    if (reducedMotionRef.current) {
      if (safeVerbs.length > 1) {
        setVerbIndex((current) => (current + 1) % safeVerbs.length);
      }
      return;
    }

    setIsLogoSpinning(true);
    scheduleTimeout(() => setIsLogoSpinning(false), LOGO_SPIN_DURATION_MS);
    if (safeVerbs.length <= 1) {
      return;
    }

    setPhase("exit");
    scheduleTimeout(() => {
      const nextIndex = (verbIndex + 1) % safeVerbs.length;
      const nextCharCount = splitGraphemes(safeVerbs[nextIndex] ?? "").length;
      const nextCharDelay = computeCharDelayMs(nextCharCount, enterDurationMs);
      setVerbIndex(nextIndex);
      setPhase("enter");
      scheduleTimeout(
        () => setPhase("idle"),
        Math.max(0, enterDurationMs) + Math.max(0, nextCharCount - 1) * nextCharDelay
      );
    }, Math.max(0, exitDurationMs));
  }, [enterDurationMs, exitDurationMs, phase, safeVerbs, scheduleTimeout, verbIndex]);

  const activeVerb = safeVerbs[verbIndex] ?? "";
  const chars = useMemo(() => splitGraphemes(activeVerb), [activeVerb]);
  const animationDuration =
    phase === "exit" ? exitDurationMs : phase === "enter" ? enterDurationMs : 0;
  const charDelayMs = computeCharDelayMs(chars.length, animationDuration);

  const rootClassName = isOpen
    ? "lyra-titlebar-ai-launch lyra-titlebar-ai-launch-open"
    : "lyra-titlebar-ai-launch";

  return (
    <AppButton
      variant="ghost"
      size="sm"
      className={rootClassName}
      aria-label={ariaLabel}
      aria-pressed={isOpen}
      title={ariaLabel}
      onClick={onToggle}
      onMouseEnter={playHoverMotion}
      data-phase={phase}
    >
      <LyraBrandLogo
        logoUrl={logoUrl}
        className="lyra-titlebar-ai-launch-logo"
        motion={isLogoSpinning ? "active" : "none"}
        spinDurationMs={LOGO_SPIN_DURATION_MS}
      />
      <span className="lyra-titlebar-ai-launch-text">
        <span className="lyra-titlebar-ai-launch-prefix">{prefix}</span>
        <span className="lyra-titlebar-ai-launch-rotator">
          <span
            className="lyra-titlebar-ai-launch-sizer"
            aria-hidden="true"
          >
            {shortestSizerVerb}
          </span>
          <span
            key={String(verbIndex) + ":" + phase}
            className="lyra-titlebar-ai-launch-word"
            data-phase={phase}
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
    </AppButton>
  );
};
