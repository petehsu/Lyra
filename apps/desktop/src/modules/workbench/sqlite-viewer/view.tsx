import { useEffect, useState } from "react";

import { AppButton } from "@renderer/ui/components";
import type { LyraDesktopApi, SqliteInspectResult } from "../../../shared/desktop-bridge";
import { sqliteTitleFromPath } from "../../../shared/sqlite-documents";

type SqliteViewerStatus = "loading" | "ready" | "error";

export const SqliteViewerSurface = ({
  desktopApi,
  filePath,
  title
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly filePath: string;
  readonly title?: string;
}) => {
  const [table, setTable] = useState<string | null>(null);
  const [status, setStatus] = useState<SqliteViewerStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SqliteInspectResult | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const sqlite = desktopApi?.sqlite;
    if (sqlite === undefined) {
      setStatus("error");
      setMessage("SQLite preview is unavailable.");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    setMessage(null);
    void sqlite.inspect({ path: filePath, ...(table === null ? {} : { table }) }).then((next) => {
      if (cancelled) {
        return;
      }
      setResult(next);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [desktopApi, filePath, table, requestKey]);

  const heading = title ?? sqliteTitleFromPath(filePath);
  const shown = result?.rows.length ?? 0;

  return (
    <section
      className="lyra-app-module lyra-sqlite-viewer"
      data-lyra-component="lyra.sqlite"
      aria-label="sqlite-viewer-surface"
    >
      <header className="lyra-app-module-toolbar">
        <strong>{heading}</strong>
      </header>
      <div className="lyra-sqlite-viewer-tables">
        {result?.tables.map((entry) => (
          <AppButton
            key={entry.name}
            type="button"
            size="sm"
            variant={entry.name === result.table ? "secondary" : "ghost"}
            aria-pressed={entry.name === result.table}
            onClick={() => {
              setTable(entry.name);
            }}
          >
            {entry.name}
          </AppButton>
        ))}
      </div>
      <div className="lyra-sqlite-viewer-grid">
        {result !== null && result.columns.length > 0 ? (
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => <td key={result.columns[cellIndex] ?? cellIndex}>{cell ?? ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <footer className="lyra-app-module-footer">
        <span>
          {status === "error"
            ? message
            : status === "loading"
              ? "Opening…"
              : result?.table === null
                ? "No tables."
                : result?.truncated
                  ? `Showing ${shown} rows. More rows remain.`
                  : `${shown} rows`}
        </span>
        {status === "error" ? (
          <AppButton type="button" size="sm" variant="secondary" onClick={() => setRequestKey((value) => value + 1)}>
            Retry
          </AppButton>
        ) : null}
      </footer>
    </section>
  );
};
