import { useLayoutEffect, useRef } from "react";

type UseSearchPillTransitionParams = {
  readonly sharedStartRect: DOMRect | null | undefined;
  readonly onSharedAnimationDone: (() => void) | undefined;
};

export const useSearchPillTransition = ({
  sharedStartRect,
  onSharedAnimationDone
}: UseSearchPillTransitionParams) => {
  const pillRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (sharedStartRect === null || sharedStartRect === undefined) {
      return;
    }

    const pill = pillRef.current;
    if (pill === null) {
      return;
    }

    const targetRect = pill.getBoundingClientRect();
    const deltaX = sharedStartRect.left - targetRect.left;
    const deltaY = sharedStartRect.top - targetRect.top;
    const scaleX = sharedStartRect.width / targetRect.width;
    const scaleY = sharedStartRect.height / targetRect.height;

    const animation = pill.animate(
      [
        {
          transformOrigin: "left top",
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`
        },
        {
          transformOrigin: "left top",
          transform: "translate(0, 0) scale(1, 1)"
        }
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.2, 0.78, 0.08, 0.98)",
        fill: "both"
      }
    );

    animation.onfinish = () => {
      pill.style.transform = "none";
      pill.style.transformOrigin = "";
      onSharedAnimationDone?.();
    };

    return () => {
      animation.cancel();
      pill.style.transform = "";
      pill.style.transformOrigin = "";
    };
  }, [onSharedAnimationDone, sharedStartRect]);

  return pillRef;
};
