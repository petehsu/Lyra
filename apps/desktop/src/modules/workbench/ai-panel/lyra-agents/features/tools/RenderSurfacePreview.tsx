import { useMemo } from "react";
import { renderMarkdown } from "@lyra/markdown-render";

import type {
  RenderSurfaceColumn,
  RenderSurfaceRow,
  ToolDetails as ToolDetailsType
} from "../../core/types";
import { buildRenderSurfaceIframeSrcDoc } from "./render-surface-html";

type RenderSurfaceDetails = Extract<ToolDetailsType, { type: "render" }>;

const iframeSandbox = (interactive: boolean): string =>
  interactive ? "allow-scripts" : "";

const cellValue = (
  row: RenderSurfaceRow,
  column: RenderSurfaceColumn,
  columnIndex: number
): string => {
  if (Array.isArray(row)) {
    const value = row[columnIndex];
    return value === undefined || value === null ? "" : String(value);
  }
  const record = row as Record<string, unknown>;
  const value = record[column.key];
  return value === undefined || value === null ? "" : String(value);
};

function RenderSurfaceTable({
  columns,
  rows
}: {
  readonly columns: readonly RenderSurfaceColumn[];
  readonly rows: readonly RenderSurfaceRow[];
}) {
  return (
    <div className="lyra-agents-render-surface-preview">
      <table className="render-surface-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, columnIndex) => (
                <td key={column.key}>{cellValue(row, column, columnIndex)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderSurfaceIframe({
  srcDoc,
  height,
  interactive,
  title
}: {
  readonly srcDoc: string;
  readonly height: number;
  readonly interactive: boolean;
  readonly title: string;
}) {
  return (
    <div className="lyra-agents-render-surface-preview">
      <iframe
        className="render-surface-frame"
        title={title}
        srcDoc={srcDoc}
        sandbox={iframeSandbox(interactive)}
        style={{ height: `${height}px` }}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

function RenderSurfaceMarkdownPreview({
  details
}: {
  readonly details: RenderSurfaceDetails;
}) {
  const srcDoc = useMemo(() => {
    const rendered = renderMarkdown(details.content, {
      mode: "final",
      theme: details.theme === "auto" ? "system" : details.theme
    });
    return buildRenderSurfaceIframeSrcDoc("markdown", rendered.html, {
        theme: details.theme,
        interactive: false,
        title: details.title,
        surfaceId: details.surfaceId
    });
  }, [details.content, details.surfaceId, details.theme, details.title]);

  return (
    <RenderSurfaceIframe
      srcDoc={srcDoc}
      height={details.height}
      interactive={false}
      title={details.title}
    />
  );
}

function RenderSurfaceJsonPreview({
  details
}: {
  readonly details: RenderSurfaceDetails;
}) {
  const content = useMemo(() => {
    if (details.content.trim().length > 0) {
      return details.content;
    }
    if (details.data === undefined) {
      return "";
    }
    return JSON.stringify(details.data, null, 2);
  }, [details.content, details.data]);

  const srcDoc = buildRenderSurfaceIframeSrcDoc("json", content, {
    theme: details.theme,
    interactive: false,
    title: details.title,
    surfaceId: details.surfaceId
  });

  return (
    <RenderSurfaceIframe
      srcDoc={srcDoc}
      height={details.height}
      interactive={false}
      title={details.title}
    />
  );
}

export function RenderSurfacePreview({
  details
}: {
  readonly details: RenderSurfaceDetails;
}) {
  if (details.format === "table") {
    const columns = details.columns ?? [];
    const rows = details.rows ?? [];
    if (columns.length === 0 || rows.length === 0) {
      return null;
    }
    return <RenderSurfaceTable columns={columns} rows={rows} />;
  }

  if (details.format === "markdown") {
    return <RenderSurfaceMarkdownPreview details={details} />;
  }

  if (details.format === "json") {
    return <RenderSurfaceJsonPreview details={details} />;
  }

  const srcDoc = buildRenderSurfaceIframeSrcDoc(
    details.format === "svg" ? "svg" : details.format === "text" ? "text" : "html",
    details.content,
    {
      theme: details.theme,
      interactive: details.interactive,
      title: details.title,
      surfaceId: details.surfaceId
    }
  );

  return (
    <RenderSurfaceIframe
      srcDoc={srcDoc}
      height={details.height}
      interactive={details.interactive}
      title={details.title}
    />
  );
}
