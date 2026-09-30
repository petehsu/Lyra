import { useRef, type ComponentProps } from "react";
import { extractTableDataFromElement, tableDataToMarkdown } from "streamdown";

import { MarkdownCitationButton } from "./markdown-citation";

export function LyraMarkdownTable({ children, node: _node, className, ...props }: ComponentProps<"table"> & {
  readonly node?: unknown;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  return (
    <div className="lyra-markdown-table-block">
      <div className="lyra-markdown-table-actions">
        <MarkdownCitationButton
          getTarget={() => tableRef.current}
          getQuote={(table) => tableDataToMarkdown(extractTableDataFromElement(table))}
        />
      </div>
      <div className="lyra-agents-md-table-wrap">
        <table {...props} ref={tableRef} data-streamdown="table" className={["lyra-agents-md-table", className].filter(Boolean).join(" ")}>
          {children}
        </table>
      </div>
    </div>
  );
}
