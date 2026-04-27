import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useSearchPillTransition } from "../use-search-pill-transition";

const originalAnimate = HTMLElement.prototype.animate;

const mockAnimate = (implementation: typeof HTMLElement.prototype.animate): void => {
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: implementation
  });
};

const TestPill = ({
  sharedStartRect,
  onSharedAnimationDone
}: {
  readonly sharedStartRect: DOMRect | null | undefined;
  readonly onSharedAnimationDone: (() => void) | undefined;
}) => {
  const ref = useSearchPillTransition({
    sharedStartRect,
    onSharedAnimationDone
  });
  return <div ref={ref} data-testid="pill" />;
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: originalAnimate
  });
});

describe("useSearchPillTransition", () => {
  test("does not animate without a shared start rect", () => {
    const animate = vi.fn();
    mockAnimate(animate as unknown as typeof HTMLElement.prototype.animate);

    render(<TestPill sharedStartRect={null} onSharedAnimationDone={vi.fn()} />);

    expect(animate).not.toHaveBeenCalled();
  });

  test("animates from the shared start rect and calls the finish callback", () => {
    const onSharedAnimationDone = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 20,
      width: 100,
      height: 40,
      right: 120,
      bottom: 60,
      x: 20,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    mockAnimate((() => {
      const animation = {
        cancel: vi.fn(),
        onfinish: null as (() => void) | null
      };
      setTimeout(() => {
        animation.onfinish?.();
      }, 0);
      return animation;
    }) as unknown as typeof HTMLElement.prototype.animate);

    render(
      <TestPill
        sharedStartRect={{
          left: 0,
          top: 0,
          width: 50,
          height: 20,
          right: 50,
          bottom: 20,
          x: 0,
          y: 0,
          toJSON: () => ({})
        } as DOMRect}
        onSharedAnimationDone={onSharedAnimationDone}
      />
    );

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onSharedAnimationDone).toHaveBeenCalledTimes(1);
        resolve();
      }, 0);
    });
  });
});
