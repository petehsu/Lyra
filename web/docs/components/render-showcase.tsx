"use client";

import { LyraDocument } from "@/components/lyra-document/LyraDocument";

const SAMPLE_MARKDOWN = `## Lyra render pipeline

Markdown-it powered rich rendering with **KaTeX** and lazy **Mermaid** diagrams.

Inline math: $E = mc^2$

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\`

\`\`\`mermaid
flowchart LR
  Markdown --> MarkdownIt
  MarkdownIt --> React
\`\`\`
`;

export function RenderShowcase() {
  return (
    <section className="lyra-docs-render-showcase">
      <LyraDocument content={SAMPLE_MARKDOWN} />
    </section>
  );
}
