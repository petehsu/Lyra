import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#1a1b1e",
    primaryColor: "#3b82f6",
    primaryTextColor: "#e6e7ea",
    lineColor: "#6f7380",
    secondaryColor: "#2a2d33",
    tertiaryColor: "#23252a",
  },
});

let mermaidId = 0;

/**
 * Renders a Mermaid diagram from source text.
 * Falls back to showing the raw source in a code block if parsing fails.
 */
export function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++mermaidId}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(id, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <pre className="md-code-block">{code}</pre>;
  }

  if (!svg) {
    return <div className="mermaid-loading">Rendering diagram…</div>;
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
