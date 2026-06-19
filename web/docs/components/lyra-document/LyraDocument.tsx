"use client";

import { renderDocumentBlock } from "./LyraDocumentNodes";
import { useLyraDocument } from "@/lib/render/use-lyra-document";

function PlainDocumentText({ content }: { readonly content: string }) {
  return <pre className="lyra-docs-plain-text">{content}</pre>;
}

export function LyraDocument({ content }: { readonly content: string }) {
  const { document, error, loading } = useLyraDocument(content, true);

  if (loading) {
    return <div className="lyra-docs-render-loading">Rendering…</div>;
  }

  if (error !== null || document === null) {
    return <PlainDocumentText content={content} />;
  }

  return (
    <div className="lyra-docs-rich-document">
      {document.blocks.map((block, index) => renderDocumentBlock(block, index))}
    </div>
  );
}