import { useData } from "../../data/DataProvider";
import { renderDocumentBlock } from "./LyraDocumentNodes";
import { useLyraDocument } from "./use-lyra-document";

export function PlainAgentText({ content }: { readonly content: string }) {
  return <div className="lyra-agents-plain-text">{content}</div>;
}

/**
 * Renders completed agent markdown via the Rust lyra-render pipeline.
 * Falls back to plain text when rich rendering is disabled or native render is unavailable.
 */
export function LyraDocument({ content }: { readonly content: string }) {
  const { aiRichRenderingEnabled } = useData();

  if (!aiRichRenderingEnabled) {
    return <PlainAgentText content={content} />;
  }

  const { document, loading } = useLyraDocument(content, true);

  if (loading && document === null) {
    return <div className="lyra-agents-document-loading">Rendering…</div>;
  }

  if (document === null) {
    return <PlainAgentText content={content} />;
  }

  return (
    <div className="lyra-agents-rich-text lyra-agents-lyra-document">
      {document.blocks.map((block, index) => renderDocumentBlock(block, index))}
    </div>
  );
}