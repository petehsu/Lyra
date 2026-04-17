export type ActivityDockItemId = "explorer" | "search" | "plugins";

export type ActivityDockItem = {
  readonly id: ActivityDockItemId;
  readonly label: string;
};

export type ActivityDockProps = {
  readonly activeItemId: ActivityDockItemId;
  readonly onSelect: (itemId: ActivityDockItemId) => void;
};
