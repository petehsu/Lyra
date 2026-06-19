import { useLayoutEffect, useRef } from "react";

export function SvgContent({
  svg,
  className,
  as = "div"
}: {
  readonly svg: string;
  readonly className: string;
  readonly as?: "div" | "span";
}) {
  const containerRef = useRef<HTMLDivElement | HTMLSpanElement>(null);
  const lastSvgRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || lastSvgRef.current === svg) {
      return;
    }
    container.innerHTML = svg;
    lastSvgRef.current = svg;
  }, [svg]);

  if (as === "span") {
    return <span ref={containerRef} className={className} />;
  }
  return <div ref={containerRef} className={className} />;
}