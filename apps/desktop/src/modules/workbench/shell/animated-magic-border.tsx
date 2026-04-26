import { useEffect, useRef } from "react";

const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

export type AnimatedMagicBorderProps = {
  readonly isOpen: boolean;
  readonly className?: string;
};

export const AnimatedMagicBorder = ({ isOpen, className }: AnimatedMagicBorderProps) => {
  const sweepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sweepRef.current;
    if (el === null || prefersReducedMotion()) {
      return;
    }

    let animationFrameId: number;
    let lastTime = performance.now();
    let currentAngle = 0;
    let currentLength = isOpen ? 360 : 90;
    let currentSpeed = 0.15;

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, 50); // Cap dt to prevent huge jumps
      lastTime = now;

      // Target states
      const targetLength = isOpen ? 360 : 90;
      const baseSpeed = isOpen ? 0.25 : 0.15;
      // Add a slow sine wave breathing fluctuation to the speed when closed
      const speedFluctuation = isOpen ? 0 : 0.12 * Math.sin(now / 500);
      const targetSpeed = baseSpeed + speedFluctuation;

      // Smooth interpolation using an exponential decay based on dt
      const lerpRate = 1 - Math.exp(-dt / 400);
      currentLength += (targetLength - currentLength) * lerpRate;
      currentSpeed += (targetSpeed - currentSpeed) * lerpRate;

      // Update rotation (speed is revolutions per second)
      currentAngle = (currentAngle + currentSpeed * 360 * (dt / 1000)) % 360;

      el.style.transform = `translate(-50%, -50%) rotate(${currentAngle}deg)`;

      // Mask logic
      // When closing, show comet tail. When open, full circle.
      if (currentLength > 358) {
        el.style.maskImage = "none";
        el.style.webkitMaskImage = "none";
      } else {
        // Fade extent shrinks as it grows so it doesn't overlap weirdly
        const maxFade = 70;
        const fadeExtent = isOpen
          ? Math.max(0, (maxFade * (360 - currentLength)) / 270)
          : maxFade;

        const maskStr = `conic-gradient(transparent 0deg, black ${fadeExtent}deg, black ${currentLength}deg, transparent ${currentLength}deg)`;
        el.style.maskImage = maskStr;
        el.style.webkitMaskImage = maskStr;
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isOpen]);

  const isReduced = prefersReducedMotion();
  const sweepClassName = isReduced
    ? isOpen
      ? "lyra-magic-border-sweep lyra-magic-border-sweep-open-static"
      : "lyra-magic-border-sweep lyra-magic-border-sweep-closed-static"
    : "lyra-magic-border-sweep";

  return (
    <div
      className={
        className === undefined
          ? "lyra-magic-border-track"
          : `lyra-magic-border-track ${className}`
      }
      aria-hidden="true"
    >
      <div className={sweepClassName} ref={sweepRef} />
    </div>
  );
};
