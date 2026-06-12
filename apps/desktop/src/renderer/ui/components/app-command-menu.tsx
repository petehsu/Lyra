import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "../utils";
import { AppDialog } from "./app-dialog";
import { AppEmptyState } from "./app-state";
import { AppObjectRow } from "./app-object-row";
import { AppSearchField } from "./app-search-field";

export type AppCommandMenuItem = {
  readonly badges?: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly id: string;
  readonly keywords?: readonly string[];
  readonly meta?: ReactNode;
  readonly searchText?: string;
  readonly title: ReactNode;
};

export type AppCommandMenuProps = {
  readonly className?: string;
  readonly description?: ReactNode;
  readonly emptyState?: ReactNode;
  readonly items: readonly AppCommandMenuItem[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSearchValueChange?: (value: string) => void;
  readonly onSelectItem: (item: AppCommandMenuItem) => void;
  readonly open: boolean;
  readonly placeholder?: string;
  readonly searchAriaLabel?: string;
  readonly searchValue?: string;
  readonly selectedItemId?: string | null;
  readonly title: ReactNode;
};

const normalizeSearchText = (value: string): string => value.trim().toLocaleLowerCase();

const reactNodeSearchText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  return "";
};

const itemMatchesQuery = (item: AppCommandMenuItem, query: string): boolean => {
  if (query.length === 0) {
    return true;
  }
  const haystack = normalizeSearchText([
    item.searchText,
    reactNodeSearchText(item.title),
    reactNodeSearchText(item.description),
    ...(item.keywords ?? [])
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" "));
  return haystack.includes(query);
};

export const AppCommandMenu = ({
  className,
  description,
  emptyState,
  items,
  onOpenChange,
  onSearchValueChange,
  onSelectItem,
  open,
  placeholder = "Search commands",
  searchAriaLabel = "Search commands",
  searchValue,
  selectedItemId,
  title
}: AppCommandMenuProps) => {
  const [internalSearchValue, setInternalSearchValue] = useState("");
  const queryText = searchValue ?? internalSearchValue;
  const normalizedQuery = normalizeSearchText(queryText);
  const filteredItems = useMemo(
    () => items.filter((item) => itemMatchesQuery(item, normalizedQuery)),
    [items, normalizedQuery]
  );

  useEffect(() => {
    if (open || searchValue !== undefined) {
      return;
    }
    setInternalSearchValue("");
  }, [open, searchValue]);

  const handleSearchValueChange = (value: string): void => {
    onSearchValueChange?.(value);
    if (searchValue === undefined) {
      setInternalSearchValue(value);
    }
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      contentClassName={cn("lyra-app-command-menu", className)}
      bodyClassName="lyra-app-command-menu-body"
    >
      <AppSearchField
        ariaLabel={searchAriaLabel}
        value={queryText}
        placeholder={placeholder}
        onValueChange={handleSearchValueChange}
      />
      <div
        className="lyra-app-command-menu-list"
        role="listbox"
        aria-label={`${searchAriaLabel} results`}
      >
        {filteredItems.length === 0 ? (
          emptyState ?? <AppEmptyState density="compact" title="No commands" description="Try a different search." />
        ) : filteredItems.map((item) => (
          <AppObjectRow
            key={item.id}
            role="option"
            aria-selected={item.id === selectedItemId}
            active={item.id === selectedItemId}
            badges={item.badges}
            description={item.description}
            disabled={item.disabled}
            icon={item.icon}
            meta={item.meta}
            title={item.title}
            onClick={() => {
              if (item.disabled === true) {
                return;
              }
              onSelectItem(item);
            }}
          />
        ))}
      </div>
    </AppDialog>
  );
};
