import { useData } from "../../data/DataProvider";
import type { LyraRenderDocument } from "../../../../../../shared/render";
import { blockKey } from "./block-keys";
import { renderDocumentBlock } from "./LyraDocumentNodes";

export function PlainAgentText({ content }: { readonly content: string }) {
  return <div className="lyra-agents-plain-text">{content}</div>;
}

/**
 * Synchronous rich-text view. Rendering happens in Rust agent runtime;
 * this component only mounts the provided AST snapshot.
 */
export function LyraDocument({
  content,
  document
}: {
  readonly content: string;
  readonly document?: LyraRenderDocument | null;
}) {
  const { aiRichRenderingEnabled } = useData();

  if (!aiRichRenderingEnabled) {
    return <PlainAgentText content={content} />;
  }

  if (document === undefined || document === null) {
    return <PlainAgentText content={content} />;
  }

  return (
    <div className="lyra-agents-rich-text lyra-agents-lyra-document">
      {document.blocks.map((block, index) =>
        renderDocumentBlock(block, blockKey(block, index))
      )}
    </div>
  );
}