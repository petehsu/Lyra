import type { AgentToolActivity } from "../../../../shared/agent";
import type { RenderSurfaceColumn, RenderSurfaceRow, ToolDetails } from "../../ai-panel/lyra-agents/core/types";
import { asRecord, numberField, stringField, toolArgsRecord, toolInputRecord } from "./common";

type ParsedRenderDetails = Extract<ToolDetails, { type: "render" }>;

export const renderSurfaceFormat = (value: string | undefined): ParsedRenderDetails["format"] => {
  switch (value) {
    case "html":
    case "markdown":
    case "svg":
    case "json":
    case "table":
    case "text":
      return value;
    case "md":
      return "markdown";
    default:
      return "html";
  }
};

export const renderSurfaceOperation = (value: string | undefined): ParsedRenderDetails["operation"] => {
  switch (value) {
    case "update":
    case "replace":
    case "append":
      return value;
    default:
      return "create";
  }
};

export const renderSurfaceTheme = (value: string | undefined): ParsedRenderDetails["theme"] => {
  switch (value) {
    case "light":
    case "dark":
      return value;
    default:
      return "auto";
  }
};

export const renderSurfaceColumns = (value: unknown): RenderSurfaceColumn[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const columns = value
    .map((column) => {
      if (typeof column === "string" && column.trim().length > 0) {
        return { key: column, label: column };
      }
      const record = asRecord(column);
      const key = stringField(record, "key", "id", "name");
      if (key === undefined) return null;
      return {
        key,
        label: stringField(record, "label", "title") ?? key
      };
    })
    .filter((column): column is RenderSurfaceColumn => column !== null);
  return columns.length === 0 ? undefined : columns;
};

export const renderSurfaceRows = (value: unknown): RenderSurfaceRow[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((row): row is RenderSurfaceRow => {
    return Array.isArray(row) || (row !== null && typeof row === "object");
  });
};

export const toRenderDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedRenderDetails => {
  const input = toolInputRecord(tool);
  const args = toolArgsRecord(tool);
  const format = renderSurfaceFormat(
    stringField(raw, "format", "kind")
    ?? stringField(args, "kind", "format")
    ?? stringField(input, "kind", "format")
  );
  const surfaceId =
    stringField(raw, "surfaceId", "id")
    ?? stringField(args, "surfaceId", "id")
    ?? stringField(input, "surfaceId", "id")
    ?? tool.id;
  const title =
    stringField(raw, "title")
    ?? stringField(args, "title")
    ?? stringField(input, "title")
    ?? "Render Surface";
  const content =
    stringField(raw, "content")
    ?? stringField(args, "content", format)
    ?? stringField(input, "content", format)
    ?? (format === "table" ? "" : output);
  const height = Math.max(
    140,
    Math.min(720, numberField(raw, "height") ?? numberField(args, "height") ?? numberField(input, "height") ?? 320)
  );
  const rawSecurity = asRecord(raw.security);
  const details: ParsedRenderDetails = {
    type: "render",
    surfaceId,
    title,
    format,
    operation: renderSurfaceOperation(
      stringField(raw, "operation") ?? stringField(args, "operation") ?? stringField(input, "operation")
    ),
    content,
    height,
    interactive: typeof raw.interactive === "boolean" ? raw.interactive : true,
    theme: renderSurfaceTheme(stringField(raw, "theme") ?? stringField(args, "theme") ?? stringField(input, "theme"))
  };
  const summary = stringField(raw, "summary");
  if (summary !== undefined) details.summary = summary;
  if (raw.data !== undefined && raw.data !== null) details.data = raw.data;
  const columns = renderSurfaceColumns(raw.columns ?? args.columns ?? input.columns);
  if (columns !== undefined) details.columns = columns;
  const rows = renderSurfaceRows(raw.rows ?? args.rows ?? input.rows);
  if (rows !== undefined) details.rows = rows;
  if (Object.keys(rawSecurity).length > 0) {
    details.security = {
      ...(typeof rawSecurity.runtime === "string" ? { runtime: rawSecurity.runtime } : {}),
      ...(typeof rawSecurity.node === "boolean" ? { node: rawSecurity.node } : {}),
      ...(typeof rawSecurity.sameOriginWithParent === "boolean"
        ? { sameOriginWithParent: rawSecurity.sameOriginWithParent }
        : {}),
      ...(typeof rawSecurity.parentDomAccess === "boolean"
        ? { parentDomAccess: rawSecurity.parentDomAccess }
        : {}),
      ...(typeof rawSecurity.network === "string" ? { network: rawSecurity.network } : {}),
      ...(typeof rawSecurity.eventBridge === "string" ? { eventBridge: rawSecurity.eventBridge } : {})
    };
  }
  return details;
};
