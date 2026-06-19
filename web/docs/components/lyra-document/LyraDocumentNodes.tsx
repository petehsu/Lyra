import type { ReactNode } from "react";

import { renderHighlightedCode } from "@/lib/render/render-highlighted-code";
import type { InlineRenderNode, RenderBlock } from "@/lib/render/types";

const renderInlineNodes = (nodes: readonly InlineRenderNode[]): ReactNode =>
  nodes.map((node, index) => renderInlineNode(node, index));

const renderInlineNode = (node: InlineRenderNode, index: number): ReactNode => {
  switch (node.kind) {
    case "text":
      return <span key={index}>{node.value}</span>;
    case "code":
      return (
        <code key={index} className="lyra-docs-inline-code">
          {node.value}
        </code>
      );
    case "strong":
      return <strong key={index}>{renderInlineNodes(node.children)}</strong>;
    case "emphasis":
      return <em key={index}>{renderInlineNodes(node.children)}</em>;
    case "strikethrough":
      return <s key={index}>{renderInlineNodes(node.children)}</s>;
    case "link":
      return (
        <a key={index} href={node.href} className="lyra-docs-link">
          {renderInlineNodes(node.children)}
        </a>
      );
    case "image":
      return (
        <img
          key={index}
          src={node.src}
          alt={node.alt}
          className="lyra-docs-image"
        />
      );
    case "mathInline":
      if (node.svg !== undefined) {
        return (
          <span
            key={index}
            className="lyra-docs-math-inline"
            dangerouslySetInnerHTML={{ __html: node.svg }}
          />
        );
      }
      return (
        <code key={index} className="lyra-docs-inline-code">
          ${node.latex}$
        </code>
      );
    case "softBreak":
      return " ";
    case "hardBreak":
      return <br key={index} />;
    default:
      return null;
  }
};

const renderTableCells = (
  cells: readonly InlineRenderNode[][],
  cellTag: "td" | "th"
): ReactNode =>
  cells.map((cell, index) => {
    const CellTag = cellTag;
    return <CellTag key={index}>{renderInlineNodes(cell)}</CellTag>;
  });

export const renderDocumentBlock = (
  block: RenderBlock,
  index: number
): ReactNode => {
  switch (block.kind) {
    case "paragraph":
      return <p key={index}>{renderInlineNodes(block.children)}</p>;
    case "heading": {
      const children = renderInlineNodes(block.children);
      switch (Math.min(6, Math.max(1, block.level))) {
        case 1:
          return <h1 key={index}>{children}</h1>;
        case 2:
          return <h2 key={index}>{children}</h2>;
        case 3:
          return <h3 key={index}>{children}</h3>;
        case 4:
          return <h4 key={index}>{children}</h4>;
        case 5:
          return <h5 key={index}>{children}</h5>;
        default:
          return <h6 key={index}>{children}</h6>;
      }
    }
    case "blockquote":
      return (
        <blockquote key={index}>
          {block.children.map((child, childIndex) =>
            renderDocumentBlock(child, childIndex)
          )}
        </blockquote>
      );
    case "list":
      if (block.ordered) {
        return (
          <ol key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {item.children.map((child, childIndex) =>
                  renderDocumentBlock(child, childIndex)
                )}
              </li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {item.checked !== undefined ? (
                <input type="checkbox" checked={item.checked} readOnly disabled />
              ) : null}
              {item.children.map((child, childIndex) =>
                renderDocumentBlock(child, childIndex)
              )}
            </li>
          ))}
        </ul>
      );
    case "codeBlock":
      return (
        <pre key={index} className="lyra-docs-code-block">
          <code>{renderHighlightedCode(block.source, block.spans)}</code>
        </pre>
      );
    case "mermaid":
      if (block.svg !== undefined) {
        return (
          <div
            key={index}
            className="lyra-docs-mermaid"
            dangerouslySetInnerHTML={{ __html: block.svg }}
          />
        );
      }
      return (
        <pre key={index} className="lyra-docs-code-block">
          {block.source}
        </pre>
      );
    case "mathBlock":
      if (block.svg !== undefined) {
        return (
          <div
            key={index}
            className="lyra-docs-math-block"
            dangerouslySetInnerHTML={{ __html: block.svg }}
          />
        );
      }
      return (
        <pre key={index} className="lyra-docs-code-block">
          {block.latex}
        </pre>
      );
    case "table":
      return (
        <div key={index} className="lyra-docs-table-wrap">
          <table className="lyra-docs-table">
            {block.headers.length > 0 ? (
              <thead>
                <tr>{renderTableCells(block.headers, "th")}</tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{renderTableCells(row, "td")}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "thematicBreak":
      return <hr key={index} />;
    default:
      return null;
  }
};