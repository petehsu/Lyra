import {
  useEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";

import { cn } from "../utils";

export type AppShimmerProps = {
  /** Plain text to render. Kept as a string so the sweep overlay can mirror it. */
  readonly text: string;
  /** Sweep overlay fades in while active; the base text keeps its own color. */
  readonly active?: boolean;
  /** Staggers parallel shimmers, like opencode's offset. */
  readonly offset?: number;
  readonly className?: string;
  readonly as?: "span" | "div" | "p";
};

const SWAP_MS = 220;

export const AppShimmer = ({
  text,
  active = true,
  offset = 0,
  className,
  as: Tag = "span"
}: AppShimmerProps) => {
  const [run, setRun] = useState(active);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (active) {
      setRun(true);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setRun(false);
    }, SWAP_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active]);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  return (
    <Tag
      className={cn("lyra-ui-shimmer", className)}
      data-active={active ? "true" : "false"}
      data-run={run ? "true" : "false"}
      data-text={text}
      aria-label={text}
      style={{ "--lyra-shimmer-index": String(offset) } as CSSProperties}
    >
      <span className="lyra-ui-shimmer-base" aria-hidden="true">
        {text}
      </span>
    </Tag>
  );
};
