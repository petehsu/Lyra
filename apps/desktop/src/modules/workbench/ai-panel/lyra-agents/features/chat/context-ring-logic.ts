export const RING_RADIUS = 6;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type RingStatus = "idle" | "compressing" | "compressed" | "failed";

export const ringColorClass = (rate: number, status: RingStatus): string => {
  if (status === "failed") return "lyra-context-ring--failed";
  if (status === "compressing") return "lyra-context-ring--compressing";
  if (rate >= 0.82) return "lyra-context-ring--danger";
  if (rate >= 0.6) return "lyra-context-ring--warn";
  return "lyra-context-ring--ok";
};

export const ringDashOffset = (rate: number): number =>
  RING_CIRCUMFERENCE * (1 - Math.min(Math.max(rate, 0), 1));