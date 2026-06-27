import { useMemo } from "react";
import { useContextUsage } from "../../hooks/use-context-usage";
import { RING_CIRCUMFERENCE, RING_RADIUS, ringColorClass, ringDashOffset } from "./context-ring-logic";

export const ContextRing = (): React.ReactElement | null => {
  const { rate, status } = useContextUsage();

  const dashOffset = useMemo(
    () => ringDashOffset(rate),
    [rate]
  );

  const cls = ringColorClass(rate, status);

  return (
    <div
      className={`lyra-context-ring ${cls}`}
      role="img"
      aria-label={`Context usage ${Math.round(rate * 100)}%`}
      title={`Context ${Math.round(rate * 100)}%`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="1.5"
          className="lyra-context-ring-track"
        />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="lyra-context-ring-fill"
          transform="rotate(-90 8 8)"
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
    </div>
  );
};