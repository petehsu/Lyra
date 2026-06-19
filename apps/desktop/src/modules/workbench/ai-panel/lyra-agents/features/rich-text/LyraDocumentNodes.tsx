import type { ReactNode } from "react";

import type {
  InlineRenderNode,
  RenderBlock
} from "../../../../../../shared/render";
import {
  ActionTargetButton,
  ClickableImage,
  classifyActionTarget
} from "./ActionTargets";
import { renderHighlightedCode } from "./render-highlighted-code";

const renderInlineNodes = (nodes: readonly InlineRenderNode[]): ReactNode =>
  nodes.map((node, index) => renderInlineNode(node, index));

const renderInlineNode = (node: InlineRenderNode, index: number): ReactNode => {
  switch (node.kind) {
    case "text":
      return <span key={index}>{node.value}</span>;
    case "code": {
      const target = classifyActionTarget(node.value);
      if (target !== null) {
        return (
          <ActionTargetButton
            key={index}
            target={target}
            className="lyra-agents-md-inline-code lyra-agents-md-clickable-path"
          >
            {node.value}
          </ActionTargetButton>
        );
      }
      return (
        <code key={index} className="lyra-agents-md-inline-code">
          {node.value}
        </code>
      );
    }
    case "strong":
      return <strong key={index}>{renderInlineNodes(node.children)}</strong>;
    case "emphasis":
      return <em key={index}>{renderInlineNodes(node.children)}</em>;
    case "strikethrough":
      return <s key={index}>{renderInlineNodes(node.children)}</s>;
    case "link": {
      const target = classifyActionTarget(node.href);
      if (target !== null) {
        return (
          <ActionTargetButton key={index} target={target} className="lyra-agents-md-link">
            {renderInlineNodes(node.children)}
          </ActionTargetButton>
        );
      }
      return (
        <a key={index} href={node.href} className="lyra-agents-md-link">
          {renderInlineNodes(node.children)}
        </a>
      );
    }
    case "image":
      return (
        <ClickableImage
          key={index}
          src={node.src}
          alt={node.alt}
          className="lyra-agents-md-image-container"
        />
      );
    case "mathInline":
      if (node.svg !== undefined) {
        return (
          <span
            key={index}
            className="lyra-agents-math-inline"
            dangerouslySetInnerHTML={{ __html: node.svg }}
          />
        );
      }
      return (
        <code key={index} className="lyra-agents-md-inline-code">
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
    return (
      <CellTag key={index}>{renderInlineNodes(cell)}</CellTag>
    );
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
        <pre key={index} className="lyra-agents-md-code-block hljs">
          <code>
            {renderHighlightedCode(block.source, block.spans)}
          </code>
        </pre>
      );
    case "mermaid":
      if (block.svg !== undefined) {
        return (
          <div
            key={index}
            className="lyra-agents-mermaid-container"
            dangerouslySetInnerHTML={{ __html: block.svg }}
          />
        );
      }
      return (
        <pre key={index} className="lyra-agents-md-code-block">
          {block.source}
        </pre>
      );
    case "mathBlock":
      if (block.svg !== undefined) {
        return (
          <div
            key={index}
            className="lyra-agents-math-block"
            dangerouslySetInnerHTML={{ __html: block.svg }}
          />
        );
      }
      return (
        <pre key={index} className="lyra-agents-md-code-block">
          {block.latex}
        </pre>
      );
    case "table":
      return (
        <div key={index} className="lyra-agents-md-table-wrap">
          <table className="lyra-agents-md-table">
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