"use client";

import { LyraDocument } from "@/components/lyra-document/LyraDocument";

const SAMPLE_MARKDOWN = `## Lyra render pipeline

Rust-powered markdown with **tree-sitter**, **RaTeX**, and **merman**.

Inline math: $E = mc^2$

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\`

\`\`\`mermaid
flowchart LR
  Markdown --> RenderCore
  RenderCore --> WASM
\`\`\`
`;

export function RenderShowcase() {
  return (
    <section className="lyra-docs-render-showcase">
      <LyraDocument content={SAMPLE_MARKDOWN} />
    </section>
  );
}