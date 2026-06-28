import {
  type CSSProperties,
  type Key,
  type KeyboardEvent,
  type ReactNode
} from "react";

import { cn } from "../utils";
import { AppEmptyState, AppErrorState, AppLoadingState } from "./app-state";

export type AppDataTableColumn<TRow> = {
  readonly align?: "start" | "center" | "end";
  readonly cell: (row: TRow, rowIndex: number) => ReactNode;
  readonly className?: string;
  readonly header: ReactNode;
  readonly headerClassName?: string;
  readonly id: string;
  readonly truncate?: boolean;
  readonly width?: string;
};

export type AppDataTableProps<TRow> = {
  readonly activeRowKey?: Key | null;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly columns: readonly AppDataTableColumn<TRow>[];
  readonly density?: "compact" | "default";
  readonly emptyState?: ReactNode;
  readonly error?: boolean;
  readonly errorState?: ReactNode;
  readonly getRowKey: (row: TRow, rowIndex: number) => Key;
  readonly loading?: boolean;
  readonly loadingState?: ReactNode;
  readonly onRowClick?: (row: TRow, rowIndex: number) => void;
  readonly rowActions?: (row: TRow, rowIndex: number) => ReactNode;
  readonly rows: readonly TRow[];
};

const keyToString = (key: Key): string => String(key);

export const AppDataTable = <TRow,>({
  activeRowKey = null,
  ariaLabel,
  className,
  columns,
  density = "default",
  emptyState,
  error = false,
  errorState,
  getRowKey,
  loading = false,
  loadingState,
  onRowClick,
  rowActions,
  rows
}: AppDataTableProps<TRow>) => {
  const hasActions = rowActions !== undefined;
  const columnCount = columns.length + (hasActions ? 1 : 0);
  const state = loading
    ? (loadingState ?? <AppLoadingState title="Loading" description="Preparing rows." />)
    : error
      ? (errorState ?? <AppErrorState title="Unable to load data" description="Try again from the page action." />)
      : rows.length === 0
        ? (emptyState ?? <AppEmptyState title="No data" />)
        : null;

  return (
    <div
      className={cn("lyra-app-data-table", className)}
      data-density={density}
      data-clickable={onRowClick === undefined ? undefined : "true"}
    >
      <table aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={cn(column.headerClassName)}
                data-align={column.align ?? "start"}
                style={column.width === undefined ? undefined : { width: column.width }}
                scope="col"
              >
                <span className="lyra-app-data-table-header-label">
                  {column.header}
                </span>
              </th>
            ))}
            {hasActions ? (
              <th className="lyra-app-data-table-actions-head" scope="col">
                <span className="lyra-app-data-table-visually-hidden">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {state === null ? rows.map((row, rowIndex) => {
            const rowKey = getRowKey(row, rowIndex);
            const rowKeyString = keyToString(rowKey);
            const rowIsActive = activeRowKey !== null && keyToString(activeRowKey) === rowKeyString;
            const rowClickProps = onRowClick === undefined
              ? {}
              : {
                  onClick: () => onRowClick(row, rowIndex),
                  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row, rowIndex);
                    }
                  },
                  role: "button",
                  tabIndex: 0
                };

            return (
              <tr
                key={rowKey}
                data-active={rowIsActive ? "true" : undefined}
                {...rowClickProps}
              >
                {columns.map((column) => {
                  const cellStyle: CSSProperties | undefined = column.width === undefined
                    ? undefined
                    : { width: column.width };

                  return (
                    <td
                      key={column.id}
                      className={cn(column.className)}
                      data-align={column.align ?? "start"}
                      data-truncate={column.truncate === true ? "true" : undefined}
                      style={cellStyle}
                    >
                      <span className="lyra-app-data-table-cell-content">
                        {column.cell(row, rowIndex)}
                      </span>
                    </td>
                  );
                })}
                {hasActions ? (
                  <td className="lyra-app-data-table-actions-cell">
                    <span
                      className="lyra-app-data-table-actions"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {rowActions(row, rowIndex)}
                    </span>
                  </td>
                ) : null}
              </tr>
            );
          }) : (
            <tr className="lyra-app-data-table-state-row">
              <td colSpan={columnCount}>
                {state}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
